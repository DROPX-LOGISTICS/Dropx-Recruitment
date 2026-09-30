import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { authoritativeRoleStream } from './recruitment-routing';
import { storedAdDelivery } from './meta-ad-delivery';

export type MailPerson = { id:string; name:string; email:string; mobile:string|null; role:string; station_ids:string[] };
export type MailAd = { id:string; ad_name:string; status:string; daily_budget:number|null; poster_url:string|null; raw_payload:any; last_synced_at:string|null; location_id:string; role_id:string; stationId:string; station:string; role:string; ends_at:string|null; budgetSharedOutsideStation?:boolean };
export type MailGroup = { key:string; manager:MailPerson; cc:MailPerson[]; stations:string[]; ads:MailAd[] };
export type MailActivity = {
 id?:string; ad_id:string; station_id:string; station:string; ad_name:string; role:string; occurred_at:string;
 previous_status:string|null; current_status:string; previous_budget:number|null; current_budget:number|null; budget_kind:string|null;
};

export const emailValid = (v:string) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(v);
export const hash = (v:string) => createHash('sha256').update(v).digest('hex').slice(0,24);
export const ist = (now=new Date()) => new Date(now.getTime()+330*60_000).toISOString();
const within = (now:Date,start:string,end:string) => { const time=ist(now).slice(11,16); return time>=start&&time<end; };
/** The Vercel cron runs exactly at 08:30 IST; this short window only covers execution jitter. */
export const morningDue = (now=new Date()) => within(now,'08:30','08:35');
/** The Vercel cron runs exactly at 20:00 IST; this short window only covers execution jitter. */
export const eveningDue = (now=new Date()) => within(now,'20:00','20:05');
export const dailyDue = morningDue;

export function normalizeAds(rows:any[], now=Date.now()):MailAd[] {
 return rows.flatMap(row => {
  const role=row.recruitment_roles, location=row.recruitment_locations;
  if (!role || authoritativeRoleStream(role.code,role.stream)!=='workforce' || !location?.station_id) return [];
  const delivery=storedAdDelivery(row,now);
  const budget=adBudget(row);
  const shared=rows.some(other=>other.id!==row.id&&adBudget(other).key===budget.key&&storedAdDelivery(other,now).status==='ACTIVE'&&(other.recruitment_locations?.station_id!==location.station_id||authoritativeRoleStream(other.recruitment_roles?.code,other.recruitment_roles?.stream)!=='workforce'));
  return [{...delivery,stationId:location.station_id,station:location.code,role:role.name,budgetSharedOutsideStation:shared}];
 });
}

/** Every mapped person receives one direct email for their complete current station scope. */
export function mailGroups(people:MailPerson[],ads:MailAd[]):MailGroup[] {
 const byProfile=new Map<string,MailPerson>();
 for(const person of people.filter(p=>emailValid(p.email))) {
  const existing=byProfile.get(person.id);
  if(!existing) {byProfile.set(person.id,person);continue;}
  const priority=(role:string)=>role==='OWNER'?2:role==='LOCATION'?0:1;
  const preferred=priority(person.role)>priority(existing.role)?person:existing;
  byProfile.set(person.id,{...preferred,station_ids:[...new Set([...existing.station_ids,...person.station_ids])]});
 }
 const stations=[...new Set(ads.map(ad=>ad.stationId))].sort();
 return [...byProfile.values()]
  .sort((left,right)=>left.email.localeCompare(right.email))
  .flatMap(manager=>{
   const scoped=stations.filter(station=>manager.station_ids.includes(station));
   if(!scoped.length) return [];
   return [{key:hash(`recipient:${manager.id}`),manager,cc:[],stations:scoped,ads:ads.filter(ad=>scoped.includes(ad.stationId))}];
  });
}

export type MailAction = { company:string; person:string; ad:string; action:'resume_ad'|'stop_ad'; source:string; exp:number };
export function signAction(payload:MailAction,secret:string) {
 const body=Buffer.from(JSON.stringify(payload)).toString('base64url');
 return `${body}.${createHmac('sha256',secret).update(body).digest('base64url')}`;
}
export function verifyAction(token:string,secret:string,now=Date.now()):MailAction {
 const [body,sig,...extra]=token.split('.');
 if(!body||!sig||extra.length||token.length>2048) throw new Error('Invalid request link.');
 const expected=createHmac('sha256',secret).update(body).digest();const actual=Buffer.from(sig,'base64url');
 if(actual.length!==expected.length||!timingSafeEqual(actual,expected)) throw new Error('Invalid request link.');
 const p=JSON.parse(Buffer.from(body,'base64url').toString()) as MailAction;
 if(!['resume_ad','stop_ad'].includes(p.action)||!p.company||!p.person||!p.ad||!p.source||!Number.isFinite(p.exp)||p.exp<now) throw new Error('This request link has expired. Use the latest email.');
 return p;
}

const escapeHtml=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const money=(n:number)=>`₹${n.toLocaleString('en-IN',{maximumFractionDigits:2})}`;
const statusLabel=(status:string)=>status==='COMPLETED'?'Ended':status.charAt(0)+status.slice(1).toLowerCase();

export function adBudget(ad:{id:string;raw_payload?:any;daily_budget?:number|null}) {
 const raw=ad.raw_payload||{};const campaign=raw.campaign||{},set=raw.adset||{};
 const source=Number(campaign.daily_budget)>0||Number(campaign.lifetime_budget)>0?'campaign':raw.budget_source==='campaign'?'campaign':'adset';
 const entity=source==='campaign'?campaign:set;
 const amount=Number(entity.daily_budget)>0?Number(entity.daily_budget)/100:Number(entity.lifetime_budget)>0?Number(entity.lifetime_budget)/100:Number(ad.daily_budget||0);
 const kind=Number(entity.daily_budget)>0?'daily':Number(entity.lifetime_budget)>0?'lifetime':raw.budget_source?'unknown':'daily';
 return {key:`${source}:${entity.id||raw[`${source}_id`]||ad.id}`,source,amount,kind};
}

export function stationBudgets(ads:MailAd[]) {
 return [...new Set(ads.map(a=>a.station))].sort().map(station=>{
  const scoped=ads.filter(a=>a.station===station);
  const active=scoped.filter(a=>a.status==='ACTIVE');
  const pools=new Map(active.map(a=>[adBudget(a).key,{...adBudget(a),shared:a.budgetSharedOutsideStation}]));
  let daily=0,lifetime=0,uncertain=0,shared=0;
  for(const budget of pools.values()) {if(budget.shared)shared++;else if(budget.kind==='daily')daily+=budget.amount;else if(budget.kind==='lifetime')lifetime+=budget.amount;else uncertain++;}
  return {station,count:active.length,paused:scoped.filter(a=>a.status==='PAUSED').length,ended:scoped.filter(a=>a.status==='COMPLETED').length,daily,lifetime,shared,uncertain};
 });
}

function budgetLabel(amount:number|null,kind:string|null) {
 if(amount===null||amount===undefined) return '—';
 return `${money(amount)}${kind==='daily'?'/day':kind==='lifetime'?' total run':''}`;
}

function activityChange(activity:MailActivity) {
 const status=activity.previous_status&&activity.previous_status!==activity.current_status
  ? `${statusLabel(activity.previous_status)} → ${statusLabel(activity.current_status)}`
  : statusLabel(activity.current_status);
 const budget=activity.previous_budget!==null&&activity.current_budget!==null&&activity.previous_budget!==activity.current_budget
  ? `${budgetLabel(activity.previous_budget,activity.budget_kind)} → ${budgetLabel(activity.current_budget,activity.budget_kind)}`
  : null;
 return budget?`${status} · budget ${budget}`:status;
}

function dateTime(value:string) {
 return new Date(value).toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',hour12:false});
}

/** Compact, table-first recipient mail. The two report kinds intentionally have separate monthly threads. */
export function renderManagerMail(input:{group:MailGroup;kind:'daily'|'event';date:string;sample?:boolean;activities?:MailActivity[]}) {
 const {group,kind,date,sample,activities=[]}=input;
 const budgets=stationBudgets(group.ads);
 const live=group.ads.filter(ad=>ad.status==='ACTIVE').length;
 const paused=group.ads.filter(ad=>ad.status==='PAUSED').length;
 const ended=group.ads.filter(ad=>ad.status==='COMPLETED').length;
 const stationCount=budgets.length;
 const activityStationCount=new Set(activities.map(activity=>activity.station)).size;
 const accent=kind==='daily'?'#16a34a':'#7c3aed';
 const softAccent=kind==='daily'?'#ecfdf3':'#f5f3ff';
 const reportLabel=kind==='daily'?'MORNING SNAPSHOT':'DAILY CHANGE LOG';
 const title=kind==='daily'?'Morning workforce ad status':'Evening workforce ad activity';
 const descriptor=kind==='daily'?'08:30 IST status':'00:00-20:00 IST activity';
 const statusRows=budgets.map((row,index)=>`<tr style="background:${index%2?'#ffffff':'#f8fafc'}"><td style="padding:12px 14px;border-bottom:1px solid #eaecf0"><strong style="color:#101828">${escapeHtml(row.station)}</strong></td><td align="center" style="padding:12px 14px;border-bottom:1px solid #eaecf0"><span style="display:inline-block;min-width:22px;padding:3px 8px;border-radius:999px;background:#dcfae6;color:#067647;font-weight:700">${row.count}</span></td><td align="center" style="padding:12px 14px;border-bottom:1px solid #eaecf0;color:#667085">${row.paused||row.ended?`${row.paused} / ${row.ended}`:'—'}</td><td align="right" style="padding:12px 14px;border-bottom:1px solid #eaecf0;color:#344054;font-weight:600">${escapeHtml(`${money(row.daily)}/day${row.lifetime?` + ${money(row.lifetime)} lifetime`:''}${row.shared?' · shared pool':''}${row.uncertain?' · verify budget':''}`)}</td></tr>`).join('');
 const activityRows=activities.slice().sort((left,right)=>left.occurred_at.localeCompare(right.occurred_at)).map((activity,index)=>`<tr style="background:${index%2?'#ffffff':'#fafaff'}"><td style="padding:12px 14px;border-bottom:1px solid #eaecf0;white-space:nowrap;color:#667085;font-weight:600">${escapeHtml(dateTime(activity.occurred_at))}</td><td style="padding:12px 14px;border-bottom:1px solid #eaecf0"><strong style="color:#101828">${escapeHtml(activity.station)}</strong></td><td style="padding:12px 14px;border-bottom:1px solid #eaecf0;color:#344054">${escapeHtml(activity.role)}<br><span style="font-size:11px;color:#667085">${escapeHtml(activity.ad_name)}</span></td><td style="padding:12px 14px;border-bottom:1px solid #eaecf0"><span style="display:inline-block;padding:4px 8px;border-radius:999px;background:#ede9fe;color:#5b21b6;font-size:12px;font-weight:700">${escapeHtml(activityChange(activity))}</span></td></tr>`).join('');
 const body=kind==='daily'
  ? `<p style="margin:0 0 18px;color:#475467;font-size:14px;line-height:21px">Here is the current workforce-ad position for your mapped stations.</p><table role="presentation" width="100%" style="border-collapse:separate;border-spacing:0;border:1px solid #eaecf0;border-radius:12px;overflow:hidden;font-size:13px"><thead><tr style="background:#f0fdf4;color:#166534"><th align="left" style="padding:11px 14px">Station</th><th style="padding:11px 14px">Live</th><th style="padding:11px 14px">Paused / ended</th><th align="right" style="padding:11px 14px">Configured budget</th></tr></thead><tbody>${statusRows}</tbody></table><p style="margin:14px 0 0;font-size:11px;line-height:17px;color:#667085">Configured budget, not actual spend. Shared campaign pools are shown but not allocated to a station.</p>`
  : activities.length
    ? `<p style="margin:0 0 18px;color:#475467;font-size:14px;line-height:21px">A compact record of today’s live, paused, ended and budget updates.</p><table role="presentation" width="100%" style="border-collapse:separate;border-spacing:0;border:1px solid #e9d7fe;border-radius:12px;overflow:hidden;font-size:13px"><thead><tr style="background:#f5f3ff;color:#5b21b6"><th align="left" style="padding:11px 14px">Time</th><th align="left" style="padding:11px 14px">Station</th><th align="left" style="padding:11px 14px">Ad</th><th align="left" style="padding:11px 14px">Change</th></tr></thead><tbody>${activityRows}</tbody></table>`
    : '<div style="padding:18px;border:1px solid #ddd6fe;border-radius:12px;background:#faf5ff;color:#5b21b6;font-size:14px;line-height:21px"><strong>All steady today.</strong><br>No live, paused, ended, or budget changes were recorded for your mapped workforce ads.</div>';
 const text=kind==='daily'
  ? [sample?'SAMPLE - no email was sent to operational recipients':'',title,date,`Hello ${group.manager.name},`,`${live} live ads across ${budgets.length} mapped stations.`,'STATION | LIVE | PAUSED / ENDED | CONFIGURED BUDGET',...budgets.map(row=>`${row.station} | ${row.count} | ${row.paused} / ${row.ended} | ${money(row.daily)}/day`),'Configured budget, not actual spend.'].filter(Boolean).join('\n')
  : [sample?'SAMPLE - no email was sent to operational recipients':'',title,date,`Hello ${group.manager.name},`,activities.length?`${activities.length} recorded changes.`:'No live, paused, ended, or budget changes were recorded today.','TIME | STATION | AD | CHANGE',...activities.map(activity=>`${dateTime(activity.occurred_at)} | ${activity.station} | ${activity.role} | ${activityChange(activity)}`)].filter(Boolean).join('\n');
 return {subject:`${sample?'[SAMPLE] ':''}DropX Recruit | Workforce ads | ${kind==='daily'?'Morning status':'Evening activity'} | ${date.slice(0,7)}`,
  text,
  html:`<!doctype html><html><body style="margin:0;background:#f5f7fb;font-family:Arial,Helvetica,sans-serif;color:#344054"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:28px 12px"><table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;background:#ffffff;border:1px solid #e4e7ec;border-radius:18px;overflow:hidden;box-shadow:0 8px 24px rgba(16,24,40,.08)"><tr><td style="padding:6px 24px;background:${accent};font-size:0;line-height:0">&nbsp;</td></tr><tr><td style="background:#14213d;padding:25px 26px 23px;color:#ffffff"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td><div style="font-size:12px;letter-spacing:1px;font-weight:700;color:#fbbf24">DROPX · RECRUIT${sample?' · SAMPLE':''}</div><h1 style="font-size:23px;line-height:29px;margin:9px 0 5px;color:#ffffff">${title}</h1><div style="font-size:13px;color:#cbd5e1">${escapeHtml(date)} · ${descriptor}</div></td><td align="right" valign="top"><span style="display:inline-block;padding:7px 10px;border-radius:999px;background:${softAccent};color:${accent};font-size:11px;font-weight:700">${reportLabel}</span></td></tr></table></td></tr><tr><td style="padding:24px 26px 8px"><p style="margin:0 0 16px;font-size:16px;line-height:24px;color:#101828">Hello <strong>${escapeHtml(group.manager.name)}</strong>,</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px"><tr><td width="33.33%" style="padding-right:6px"><div style="background:${kind==='daily'?'#ecfdf3':'#f5f3ff'};border-radius:12px;padding:13px"><div style="font-size:11px;letter-spacing:.4px;color:#667085;font-weight:700">${kind==='daily'?'LIVE ADS':'CHANGES'}</div><div style="margin-top:5px;font-size:22px;line-height:26px;color:${accent};font-weight:700">${kind==='daily'?live:activities.length}</div></div></td><td width="33.33%" style="padding:0 3px"><div style="background:#eff8ff;border-radius:12px;padding:13px"><div style="font-size:11px;letter-spacing:.4px;color:#667085;font-weight:700">STATIONS</div><div style="margin-top:5px;font-size:22px;line-height:26px;color:#175cd3;font-weight:700">${kind==='daily'?stationCount:activityStationCount}</div></div></td><td width="33.33%" style="padding-left:6px"><div style="background:#fff6ed;border-radius:12px;padding:13px"><div style="font-size:11px;letter-spacing:.4px;color:#667085;font-weight:700">${kind==='daily'?'PAUSED / ENDED':'TIME WINDOW'}</div><div style="margin-top:5px;font-size:${kind==='daily'?'18px':'14px'};line-height:26px;color:#c4320a;font-weight:700">${kind==='daily'?`${paused} / ${ended}`:'Today'}</div></div></td></tr></table>${body}</td></tr><tr><td style="padding:18px 26px 22px"><div style="height:1px;background:#eaecf0;margin:0 0 13px"></div><p style="margin:0;font-size:11px;line-height:17px;color:#667085">${sample?'Sample only. No operational recipient or ad was changed.':'This is one direct report for your People-mapped stations. No blanket CC recipients. Morning status and evening activity remain separate monthly threads.'}</p></td></tr></table></td></tr></table></body></html>`
 };
}
