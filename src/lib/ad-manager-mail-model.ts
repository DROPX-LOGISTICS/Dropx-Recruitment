import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { authoritativeRoleStream } from './recruitment-routing';
import { storedAdDelivery } from './meta-ad-delivery';

export type MailPerson = { id:string; name:string; email:string; mobile:string|null; role:string; station_ids:string[] };
export type MailAd = { id:string; ad_name:string; status:string; daily_budget:number|null; poster_url:string|null; raw_payload:any; last_synced_at:string|null; location_id:string; role_id:string; stationId:string; station:string; role:string; ends_at:string|null; budgetSharedOutsideStation?:boolean };
export type MailGroup = { key:string; manager:MailPerson; cc:MailPerson[]; stations:string[]; ads:MailAd[] };
export const emailValid = (v:string) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(v);
export const hash = (v:string) => createHash('sha256').update(v).digest('hex').slice(0,24);
export const ist = (now=new Date()) => new Date(now.getTime()+330*60_000).toISOString();
export const dailyDue = (now=new Date()) => { const time=ist(now).slice(11,16); return time >= '08:30' && time < '10:30'; };
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
/** Split on CC scope so neither a copied colleague nor a manager sees other stations. */
export function mailGroups(people:MailPerson[],ads:MailAd[]):MailGroup[] {
 const valid=people.filter(p=>emailValid(p.email));
 const result:MailGroup[]=[];
 const stations=[...new Set(ads.map(a=>a.stationId))].sort();
 const seen=new Set<string>();
 for(const manager of valid.filter(p=>!['WFA','BH'].includes(p.role))) {
  const buckets=new Map<string,{cc:MailPerson[];stations:string[]}>();
  for(const station of stations.filter(s=>manager.station_ids.includes(s))) {
   const cc=valid.filter(p=>['WFA','BH'].includes(p.role)&&p.station_ids.includes(station)&&p.email.toLowerCase()!==manager.email.toLowerCase());
   const unique=[...new Map(cc.map(p=>[p.email.toLowerCase(),p])).values()].sort((a,b)=>a.id.localeCompare(b.id));
   const key=unique.map(p=>p.id).join(',');
   const bucket=buckets.get(key)??{cc:unique,stations:[]};bucket.stations.push(station);buckets.set(key,bucket);
  }
  for(const b of buckets.values()) {
   const key=hash([manager.email.toLowerCase(),...b.stations,...b.cc.map(p=>p.email.toLowerCase())].join('|'));
   if(seen.has(key)) continue;seen.add(key);
   result.push({key,manager,...b,ads:ads.filter(a=>b.stations.includes(a.stationId))});
  }
 }
 return result;
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
export function adBudget(ad:{id:string;raw_payload?:any;daily_budget?:number|null}) {
 const raw=ad.raw_payload||{};const campaign=raw.campaign||{},set=raw.adset||{};
 const source=Number(campaign.daily_budget)>0||Number(campaign.lifetime_budget)>0?'campaign':raw.budget_source==='campaign'?'campaign':'adset';
 const entity=source==='campaign'?campaign:set;
 const amount=Number(entity.daily_budget)>0?Number(entity.daily_budget)/100:Number(entity.lifetime_budget)>0?Number(entity.lifetime_budget)/100:Number(ad.daily_budget||0);
 const kind=Number(entity.daily_budget)>0?'daily':Number(entity.lifetime_budget)>0?'lifetime':raw.budget_source?'unknown':'daily';
 return {key:`${source}:${entity.id||raw[`${source}_id`]||ad.id}`,source,amount,kind};
}
const money=(n:number)=>`₹${n.toLocaleString('en-IN',{maximumFractionDigits:2})}`;
export function stationBudgets(ads:MailAd[]) {
 return [...new Set(ads.map(a=>a.station))].sort().map(station=>{
  const active=ads.filter(a=>a.station===station&&a.status==='ACTIVE');
  const pools=new Map(active.map(a=>[adBudget(a).key,{...adBudget(a),shared:a.budgetSharedOutsideStation}]));
  let daily=0,lifetime=0,uncertain=0,shared=0;
  for(const budget of pools.values()) {if(budget.shared)shared++;else if(budget.kind==='daily')daily+=budget.amount;else if(budget.kind==='lifetime')lifetime+=budget.amount;else uncertain++;}
  return {station,count:active.length,daily,lifetime,shared,uncertain};
 });
}
export function renderManagerMail(input:{group:MailGroup;kind:'daily'|'event';date:string;sample?:boolean;images?:Record<string,string>;actions?:Record<string,string>;statuses?:Record<string,string>;budgetAds?:MailAd[]}) {
 const {group,kind,date,sample,images={},actions={},statuses={}}=input;
 const title=kind==='daily'?'Your stations · morning ad update':'Your stations · ad status update';
 const ads=kind==='daily'?group.ads.filter(a=>a.status==='ACTIVE'):group.ads;
 const contact=group.cc.filter(p=>p.role==='WFA');
 const budgetLabel=(a:MailAd)=>{const b=adBudget(a);return `${money(b.amount)}${b.kind==='daily'?'/day':b.kind==='lifetime'?' total run budget':' · period unverified'}${b.source==='campaign'?' · shared campaign budget':''}`;};
 const line=(a:MailAd)=>`${a.station} · ${a.role} — ${statuses[a.id]||a.status} · ${budgetLabel(a)}`;
 const totals=stationBudgets(input.budgetAds||group.ads);
 const totalLabel=(b:ReturnType<typeof stationBudgets>[number])=>`${money(b.daily)}/day${b.lifetime?` + ${money(b.lifetime)} lifetime budget`:''}${b.shared?' + shared pool (station allocation unavailable)':''}${b.uncertain?' + unverified budget':''}`;
 const budgetTable=`<tr><td style="padding:8px 20px 18px"><div style="background:#eef7f3;padding:14px;border-radius:8px"><strong style="font-size:13px;color:#08785a">STATION BUDGET · ACTIVE WORKFORCE ADS</strong><table role="presentation" width="100%" style="font-size:13px">${totals.map(b=>`<tr><td style="padding:8px 0">${escapeHtml(b.station)} · ${b.count} active</td><td align="right"><strong>${escapeHtml(totalLabel(b))}</strong></td></tr>`).join('')}</table><div style="font-size:11px;color:#667085">Configured budget, not actual spend. Shared budgets counted once; unallocated cross-station pools are not added to a station total.</div></div></td></tr>`;
 const instructions='Still hiring? Request a resume. Ad no longer needed? Send a stop request. Workforce reviews every request before changing an ad.';
 const cards=ads.map(a=>{
  const state=statuses[a.id]||a.status;const color=state==='ACTIVE'?'#07845e':state==='PAUSED'?'#a56500':'#6350a2';
  const action=state==='ACTIVE'?'Ad no longer required':'Request resume';
  return `<tr><td style="padding:16px;border-bottom:1px solid #e6e9ef"><table role="presentation" width="100%"><tr>${images[a.id]?`<td width="120" valign="top"><img src="cid:${escapeHtml(images[a.id])}" width="108" alt="${escapeHtml(a.station)} recruitment poster" style="border-radius:8px;max-width:108px"></td>`:''}<td><span style="font-size:12px;font-weight:bold;color:${color}">${escapeHtml(state==='COMPLETED'?'ENDED':state)}</span><h3 style="margin:6px 0;color:#182338;font-size:16px">${escapeHtml(a.station)} · ${escapeHtml(a.role)}</h3><div style="font-size:12px;color:#667085">${escapeHtml(a.ad_name)}</div><p style="margin:8px 0;font-size:13px">${escapeHtml(budgetLabel(a))}${a.ends_at?` · Ends ${escapeHtml(new Date(a.ends_at).toLocaleDateString('en-IN',{timeZone:'Asia/Kolkata',day:'numeric',month:'short'}))}`:''}</p>${actions[a.id]?`<a href="${escapeHtml(actions[a.id])}" style="display:inline-block;background:#ecf1ff;color:#274a8f;padding:9px 12px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:12px">${action} →</a>`:`<span style="font-size:12px;color:#667085">${sample?'Sample only · actions disabled':'Contact Workforce to request a change'}</span>`}</td></tr></table></td></tr>`;
 }).join('');
 const contacts=contact.length?contact.map(p=>`<p style="margin:6px 0"><strong>${escapeHtml(p.name)}</strong><br><a href="mailto:${escapeHtml(p.email)}">${escapeHtml(p.email)}</a> · ${escapeHtml(p.mobile||'Mobile not configured')}</p>`).join(''):'<p>Workforce contact not assigned for this location. Contact your Business Head.</p>';
 const text=[sample?'SAMPLE — no ad has been changed':'',title,date,`Hello ${group.manager.name},`,...ads.map(line),'Station budgets (active workforce ads):',...totals.map(b=>`${b.station}: ${totalLabel(b)}`),!ads.length?'No active workforce ads in these stations.':'',instructions,'Workforce contact:',...contact.map(p=>`${p.name} | ${p.email} | ${p.mobile||'Mobile not configured'}`),'Ended means the scheduled advertising run ended; it does not mean hiring is complete.'].filter(Boolean).join('\n');
 return {subject:`${sample?'[SAMPLE] ':''}DropX Recruit | Workforce ads | ${date.slice(0,7)} | ${[...new Set(group.ads.map(a=>a.station))].sort().join(', ').slice(0,80)}`,
 text,html:`<!doctype html><html><body style="margin:0;background:#f2f4f8;font-family:Arial,sans-serif;color:#344054"><table role="presentation" width="100%"><tr><td align="center" style="padding:24px 10px"><table role="presentation" width="640" style="width:100%;max-width:640px;background:white;border-radius:14px;overflow:hidden"><tr><td style="background:#22223c;border-top:5px solid #e52362;color:white;padding:24px"><div style="color:#ffae67;font-weight:bold;font-size:13px">DROPX · RECRUIT ${sample?' · SAMPLE':''}</div><h1 style="font-size:22px;margin:10px 0">${title}</h1><span style="font-size:13px;color:#ddd">${escapeHtml(date)} · Workforce hiring only</span></td></tr><tr><td style="padding:20px 20px 8px">Hello ${escapeHtml(group.manager.name)},<p style="margin:10px 0">${ads.length} ${kind==='daily'?'active ads':'ad updates'} across ${new Set(ads.map(a=>a.station)).size} stations.</p><p style="font-size:13px;color:#667085">${instructions}</p></td></tr>${budgetTable}${cards||'<tr><td style="padding:20px">No active workforce ads in your stations.</td></tr>'}<tr><td style="padding:20px;background:#fff6ef;font-size:13px"><strong style="color:#b34517">YOUR WORKFORCE CONTACT</strong>${contacts}</td></tr><tr><td style="padding:16px 20px;font-size:11px;color:#667085">${sample?'Sample only. No manager emails or ad changes were triggered.':'Daily summary at 8:30 AM IST. Updates stay in this monthly thread. Buttons create requests; they do not change ads.'}<br>Ended = scheduled run finished, not hiring completed. Posters are included when available; no Recruit login is needed to view them.</td></tr></table></td></tr></table></body></html>`};
}
