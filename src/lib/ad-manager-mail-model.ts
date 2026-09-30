import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { authoritativeRoleStream } from './recruitment-routing';
import { storedAdDelivery } from './meta-ad-delivery';

export type MailPerson = { id:string; name:string; email:string; mobile:string|null; role:string; station_ids:string[] };
export type MailAd = {
 id:string; ad_name:string; status:string; daily_budget:number|null; poster_url:string|null; raw_payload:any;
 last_synced_at:string|null; created_on:string|null; lead_count:number; location_id:string; role_id:string;
 stationId:string; station:string; role:string; ends_at:string|null; current_run_started_at?:string|null;
 budgetSharedOutsideStation?:boolean;
};
export type MailGroup = { key:string; manager:MailPerson; cc:MailPerson[]; stations:string[]; ads:MailAd[] };
export type MailActivity = {
 id?:string; ad_id:string; station_id:string; station:string; ad_name:string; role:string; occurred_at:string;
 previous_status:string|null; current_status:string; previous_budget:number|null; current_budget:number|null; budget_kind:string|null;
 change_types?:string[];
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
function dateTime(value:string) {
 return new Date(value).toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',hour12:false});
}
function runDays(ad:MailAd,reference:Date) {
 const source=ad.current_run_started_at||ad.created_on;
 const started=source?Date.parse(source):Number.NaN;
 if(!Number.isFinite(started)) return null;
 return Math.max(0,Math.ceil((reference.getTime()-started)/86_400_000));
}
function activityChange(activity:MailActivity) {
 const types=new Set(activity.change_types||[]);
 const changes:string[]=[];
 if(types.has('new_ad')) changes.push('New ad posted');
 if(types.has('poster')) changes.push('Poster updated');
 if(types.has('status') || (!types.size&&activity.previous_status&&activity.previous_status!==activity.current_status)) {
  changes.push(activity.previous_status&&activity.previous_status!==activity.current_status?`${statusLabel(activity.previous_status)} → ${statusLabel(activity.current_status)}`:statusLabel(activity.current_status));
 }
 if(types.has('budget') || (!types.size&&activity.previous_budget!==null&&activity.current_budget!==null&&activity.previous_budget!==activity.current_budget)) {
  changes.push(activity.previous_budget!==null&&activity.current_budget!==null?`Budget ${budgetLabel(activity.previous_budget,activity.budget_kind)} → ${budgetLabel(activity.current_budget,activity.budget_kind)}`:'Budget updated');
 }
 return changes.length?changes.join(' · '):statusLabel(activity.current_status);
}
function statusTone(status:string) {
 if(status==='ACTIVE') return {background:'#dcfae6',color:'#067647'};
 if(status==='PAUSED') return {background:'#fff1cc',color:'#a15c07'};
 return {background:'#fef3f2',color:'#b42318'};
}
function metricCell(label:string,value:string) {
 return `<td style="padding:0 4px 0 0;vertical-align:top"><div style="min-width:66px;background:#f8fafc;border-radius:8px;padding:7px 8px"><div style="font-size:9px;letter-spacing:.35px;color:#667085;font-weight:700">${label}</div><div style="padding-top:3px;font-size:12px;line-height:15px;color:#101828;font-weight:700">${escapeHtml(value)}</div></div></td>`;
}
function creativePreview(ad:MailAd,images:Record<string,string>) {
 const cid=images[ad.id];
 return cid
  ? `<img src="cid:${escapeHtml(cid)}" alt="Creative for ${escapeHtml(ad.ad_name)}" width="74" height="56" style="display:block;width:74px;height:56px;object-fit:cover;border:1px solid #d0d5dd;border-radius:8px;background:#f2f4f7">`
  : '<div style="width:72px;height:54px;border:1px dashed #d0d5dd;border-radius:8px;background:#f8fafc;color:#98a2b3;font-size:10px;line-height:54px;text-align:center">No preview</div>';
}
function adDetailRows(ads:MailAd[],images:Record<string,string>,reference:Date,reasonFor:(ad:MailAd)=>string|undefined) {
 return ads.slice().sort((left,right)=>left.station.localeCompare(right.station)||left.ad_name.localeCompare(right.ad_name)).map((ad,index)=>{
  const budget=adBudget(ad);
  const tone=statusTone(ad.status);
  const days=runDays(ad,reference);
  return `<tr style="background:${index%2?'#ffffff':'#f8fafc'}"><td style="padding:10px 10px;border-bottom:1px solid #eaecf0;width:76px">${creativePreview(ad,images)}</td><td style="padding:10px 8px;border-bottom:1px solid #eaecf0"><strong style="font-size:12px;color:#101828">${escapeHtml(ad.station)}</strong><br><span style="font-size:11px;color:#475467">${escapeHtml(ad.role)}</span><br><span style="font-size:10px;color:#98a2b3">${escapeHtml(ad.ad_name)}</span>${reasonFor(ad)?`<br><span style="display:inline-block;margin-top:5px;padding:3px 6px;border-radius:999px;background:#ede9fe;color:#5b21b6;font-size:10px;font-weight:700">${escapeHtml(reasonFor(ad))}</span>`:''}</td><td style="padding:10px 8px;border-bottom:1px solid #eaecf0"><span style="display:inline-block;padding:4px 7px;border-radius:999px;background:${tone.background};color:${tone.color};font-size:10px;font-weight:700">${escapeHtml(statusLabel(ad.status))}</span><table role="presentation" style="border-collapse:collapse;margin-top:7px"><tr>${metricCell('BUDGET',budget.amount?budgetLabel(budget.amount,budget.kind):'—')}${metricCell('LEADS',String(ad.lead_count||0))}${metricCell('RUN DAYS',days===null?'—':String(days))}</tr></table></td></tr>`;
 }).join('');
}

/** Both reports first orient the reader at station level, then reveal compact ad-level detail. */
export function renderManagerMail(input:{group:MailGroup;kind:'daily'|'event';date:string;sample?:boolean;activities?:MailActivity[];images?:Record<string,string>}) {
 const {group,kind,date,sample,activities=[],images={}}=input;
 const reference=new Date(`${date}T23:59:59+05:30`);
 const budgets=stationBudgets(group.ads);
 const live=group.ads.filter(ad=>ad.status==='ACTIVE').length;
 const paused=group.ads.filter(ad=>ad.status==='PAUSED').length;
 const ended=group.ads.filter(ad=>ad.status==='COMPLETED').length;
 const activeAds=group.ads.filter(ad=>ad.status==='ACTIVE');
 const activityStationCount=new Set(activities.map(activity=>activity.station)).size;
 const affectedActivities=activities.slice().sort((left,right)=>left.occurred_at.localeCompare(right.occurred_at));
 const affectedById=new Map<string,MailActivity>();
 for(const activity of affectedActivities) affectedById.set(activity.ad_id,activity);
 const affectedAds=group.ads.filter(ad=>affectedById.has(ad.id));
 const accent=kind==='daily'?'#16a34a':'#7c3aed';
 const softAccent=kind==='daily'?'#ecfdf3':'#f5f3ff';
 const reportLabel=kind==='daily'?'MORNING SNAPSHOT':'EVENING CHANGE LOG';
 const title=kind==='daily'?'Morning workforce ad status':'Evening workforce ad activity';
 const descriptor=kind==='daily'?'08:30 IST status':'00:00–20:00 IST activity';
 const stationRows=budgets.map((row,index)=>`<tr style="background:${index%2?'#ffffff':'#f8fafc'}"><td style="padding:11px 12px;border-bottom:1px solid #eaecf0"><strong style="color:#101828">${escapeHtml(row.station)}</strong></td><td align="center" style="padding:11px 12px;border-bottom:1px solid #eaecf0"><span style="display:inline-block;min-width:22px;padding:3px 8px;border-radius:999px;background:#dcfae6;color:#067647;font-weight:700">${row.count}</span></td><td align="center" style="padding:11px 12px;border-bottom:1px solid #eaecf0;color:#667085">${row.paused||row.ended?`${row.paused} / ${row.ended}`:'—'}</td><td align="right" style="padding:11px 12px;border-bottom:1px solid #eaecf0;color:#344054;font-weight:600">${escapeHtml(`${money(row.daily)}/day${row.lifetime?` + ${money(row.lifetime)} lifetime`:''}${row.shared?' · shared pool':''}${row.uncertain?' · verify budget':''}`)}</td></tr>`).join('');
 const activityRows=affectedActivities.map((activity,index)=>`<tr style="background:${index%2?'#ffffff':'#fafaff'}"><td style="padding:11px 12px;border-bottom:1px solid #eaecf0;white-space:nowrap;color:#667085;font-weight:600">${escapeHtml(dateTime(activity.occurred_at))}</td><td style="padding:11px 12px;border-bottom:1px solid #eaecf0"><strong style="color:#101828">${escapeHtml(activity.station)}</strong></td><td style="padding:11px 12px;border-bottom:1px solid #eaecf0;color:#344054">${escapeHtml(activity.role)}<br><span style="font-size:10px;color:#667085">${escapeHtml(activity.ad_name)}</span></td><td style="padding:11px 12px;border-bottom:1px solid #eaecf0"><span style="display:inline-block;padding:4px 7px;border-radius:999px;background:#ede9fe;color:#5b21b6;font-size:10px;font-weight:700">${escapeHtml(activityChange(activity))}</span></td></tr>`).join('');
 const stationTable=`<table role="presentation" width="100%" style="border-collapse:separate;border-spacing:0;border:1px solid #eaecf0;border-radius:12px;overflow:hidden;font-size:12px"><thead><tr style="background:#f0fdf4;color:#166534"><th align="left" style="padding:10px 12px">Station</th><th style="padding:10px 12px">Live</th><th style="padding:10px 12px">Paused / ended</th><th align="right" style="padding:10px 12px">Configured budget</th></tr></thead><tbody>${stationRows}</tbody></table>`;
 const activeDetail=activeAds.length?`<div style="margin:22px 0 9px;font-size:15px;line-height:21px;color:#101828;font-weight:700">Active ad details <span style="color:#667085;font-size:12px;font-weight:600">· ${activeAds.length} current ads</span></div><p style="margin:0 0 10px;font-size:11px;line-height:16px;color:#667085">Poster, station, role, configured budget, received leads and days in the current run. Creative previews are embedded for the first eight safe images.</p><table role="presentation" width="100%" style="border-collapse:separate;border-spacing:0;border:1px solid #eaecf0;border-radius:12px;overflow:hidden">${adDetailRows(activeAds,images,reference,()=>undefined)}</table>`:'<div style="margin-top:18px;padding:14px;border:1px solid #d0d5dd;border-radius:12px;background:#f8fafc;color:#475467;font-size:13px">No live Workforce ads are mapped to these stations.</div>';
 const eveningDetail=affectedAds.length?`<div style="margin:22px 0 9px;font-size:15px;line-height:21px;color:#101828;font-weight:700">Affected ad details <span style="color:#667085;font-size:12px;font-weight:600">· current creative and delivery context</span></div><p style="margin:0 0 10px;font-size:11px;line-height:16px;color:#667085">New ads and poster updates include the latest available creative preview. Each card shows the current status, configured budget, received leads and run days.</p><table role="presentation" width="100%" style="border-collapse:separate;border-spacing:0;border:1px solid #e9d7fe;border-radius:12px;overflow:hidden">${adDetailRows(affectedAds,images,reference,ad=>activityChange(affectedById.get(ad.id)!))}</table>`:'';
 const body=kind==='daily'
  ? `<p style="margin:0 0 16px;color:#475467;font-size:14px;line-height:21px">Start with the station summary, then use the active-ad detail to see what is live, where it is running and how it is performing.</p>${stationTable}<p style="margin:10px 0 0;font-size:11px;line-height:16px;color:#667085">Configured budget, not actual spend. Shared campaign pools are shown but not allocated to a station.</p>${activeDetail}`
  : affectedActivities.length
    ? `<p style="margin:0 0 16px;color:#475467;font-size:14px;line-height:21px">Every new ad, poster/creative update, status change and budget change recorded today is grouped below.</p><table role="presentation" width="100%" style="border-collapse:separate;border-spacing:0;border:1px solid #e9d7fe;border-radius:12px;overflow:hidden;font-size:12px"><thead><tr style="background:#f5f3ff;color:#5b21b6"><th align="left" style="padding:10px 12px">Time</th><th align="left" style="padding:10px 12px">Station</th><th align="left" style="padding:10px 12px">Ad</th><th align="left" style="padding:10px 12px">What changed</th></tr></thead><tbody>${activityRows}</tbody></table>${eveningDetail}`
    : '<div style="padding:18px;border:1px solid #ddd6fe;border-radius:12px;background:#faf5ff;color:#5b21b6;font-size:14px;line-height:21px"><strong>All steady today.</strong><br>No new ads, poster updates, delivery-status changes or budget changes were recorded for your mapped Workforce ads.</div>';
 const text=kind==='daily'
  ? [sample?'SAMPLE — current live data, no operational recipient was emailed':'',title,date,`Hello ${group.manager.name},`,`${live} live ads across ${budgets.length} mapped stations.`,'STATION | LIVE | PAUSED / ENDED | CONFIGURED BUDGET',...budgets.map(row=>`${row.station} | ${row.count} | ${row.paused} / ${row.ended} | ${money(row.daily)}/day`),'ACTIVE AD DETAILS','STATION | AD | STATUS | BUDGET | LEADS | RUN DAYS',...activeAds.map(ad=>`${ad.station} | ${ad.ad_name} | ${statusLabel(ad.status)} | ${budgetLabel(adBudget(ad).amount,adBudget(ad).kind)} | ${ad.lead_count||0} | ${runDays(ad,reference)??'—'}`),'Configured budget, not actual spend.'].filter(Boolean).join('\n')
  : [sample?'SAMPLE — current live ads with representative change labels':'',title,date,`Hello ${group.manager.name},`,affectedActivities.length?`${affectedActivities.length} recorded changes.`:'No new ads, poster updates, delivery-status changes or budget changes were recorded today.','TIME | STATION | AD | CHANGE',...affectedActivities.map(activity=>`${dateTime(activity.occurred_at)} | ${activity.station} | ${activity.role} | ${activityChange(activity)}`),...(affectedAds.length?['AFFECTED AD DETAILS','STATION | AD | STATUS | BUDGET | LEADS | RUN DAYS',...affectedAds.map(ad=>`${ad.station} | ${ad.ad_name} | ${statusLabel(ad.status)} | ${budgetLabel(adBudget(ad).amount,adBudget(ad).kind)} | ${ad.lead_count||0} | ${runDays(ad,reference)??'—'}`)]:[])].filter(Boolean).join('\n');
 return {subject:`${sample?'[SAMPLE] ':''}DropX Recruit | Workforce ads | ${kind==='daily'?'Morning status':'Evening activity'} | ${date.slice(0,7)}`,
  text,
  html:`<!doctype html><html><body style="margin:0;background:#f5f7fb;font-family:Arial,Helvetica,sans-serif;color:#344054"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:28px 12px"><table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;background:#ffffff;border:1px solid #e4e7ec;border-radius:18px;overflow:hidden;box-shadow:0 8px 24px rgba(16,24,40,.08)"><tr><td style="padding:6px 24px;background:${accent};font-size:0;line-height:0">&nbsp;</td></tr><tr><td style="background:#14213d;padding:25px 26px 23px;color:#ffffff"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td><div style="font-size:12px;letter-spacing:1px;font-weight:700;color:#fbbf24">DROPX · RECRUIT${sample?' · SAMPLE':''}</div><h1 style="font-size:23px;line-height:29px;margin:9px 0 5px;color:#ffffff">${title}</h1><div style="font-size:13px;color:#cbd5e1">${escapeHtml(date)} · ${descriptor}</div></td><td align="right" valign="top"><span style="display:inline-block;padding:7px 10px;border-radius:999px;background:${softAccent};color:${accent};font-size:11px;font-weight:700">${reportLabel}</span></td></tr></table></td></tr><tr><td style="padding:24px 26px 8px"><p style="margin:0 0 16px;font-size:16px;line-height:24px;color:#101828">Hello <strong>${escapeHtml(group.manager.name)}</strong>,</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px"><tr><td width="33.33%" style="padding-right:6px"><div style="background:${kind==='daily'?'#ecfdf3':'#f5f3ff'};border-radius:12px;padding:13px"><div style="font-size:11px;letter-spacing:.4px;color:#667085;font-weight:700">${kind==='daily'?'LIVE ADS':'CHANGES'}</div><div style="margin-top:5px;font-size:22px;line-height:26px;color:${accent};font-weight:700">${kind==='daily'?live:affectedActivities.length}</div></div></td><td width="33.33%" style="padding:0 3px"><div style="background:#eff8ff;border-radius:12px;padding:13px"><div style="font-size:11px;letter-spacing:.4px;color:#667085;font-weight:700">STATIONS</div><div style="margin-top:5px;font-size:22px;line-height:26px;color:#175cd3;font-weight:700">${kind==='daily'?budgets.length:activityStationCount}</div></div></td><td width="33.33%" style="padding-left:6px"><div style="background:#fff6ed;border-radius:12px;padding:13px"><div style="font-size:11px;letter-spacing:.4px;color:#667085;font-weight:700">${kind==='daily'?'PAUSED / ENDED':'VISUAL UPDATES'}</div><div style="margin-top:5px;font-size:${kind==='daily'?'18px':'14px'};line-height:26px;color:#c4320a;font-weight:700">${kind==='daily'?`${paused} / ${ended}`:affectedActivities.filter(a=>a.change_types?.includes('poster')||a.change_types?.includes('new_ad')).length}</div></div></td></tr></table>${body}</td></tr><tr><td style="padding:18px 26px 22px"><div style="height:1px;background:#eaecf0;margin:0 0 13px"></div><p style="margin:0;font-size:11px;line-height:17px;color:#667085">${sample?'Sample only. It uses your current live ads and embedded safe previews; no operational recipient or ad was changed.':'One direct report for your People-mapped stations. Morning status and evening activity remain separate monthly threads.'}</p></td></tr></table></td></tr></table></body></html>`
 };
}
