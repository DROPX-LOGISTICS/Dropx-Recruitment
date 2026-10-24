import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { authoritativeRoleStream } from './recruitment-routing';
import { storedAdDelivery } from './meta-ad-delivery';

export type MailPerson = { id:string; name:string; email:string; mobile:string|null; role:string; station_ids:string[] };
export type MailAd = {
 id:string; ad_name:string; status:string; daily_budget:number|null; poster_url:string|null; raw_payload:any;
 last_synced_at:string|null; created_on:string|null; lead_count:number; location_id:string; role_id:string;
 stationId:string; station:string; role:string; ends_at:string|null; current_run_started_at?:string|null;
 budgetSharedOutsideStation?:boolean;
 stationName?:string; meta_ad_id?:string|null; total_spend?:number|null;
 spend_today?:number|null; spend_checked_at?:string|null; budgetShared?:boolean;
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
/** One daily report at 13:00 IST. The window covers cron execution jitter only. */
export const dailyDue = (now=new Date()) => within(now,'13:00','13:05');

export function normalizeAds(rows:any[], now=Date.now()):MailAd[] {
 return rows.flatMap(row => {
  const role=row.recruitment_roles, location=row.recruitment_locations;
  if (!role || authoritativeRoleStream(role.code,role.stream)!=='workforce' || !location?.station_id) return [];
  const delivery=storedAdDelivery(row,now);
  const budget=adBudget(row);
  const shared=rows.some(other=>other.id!==row.id&&adBudget(other).key===budget.key&&storedAdDelivery(other,now).status==='ACTIVE'&&(other.recruitment_locations?.station_id!==location.station_id||authoritativeRoleStream(other.recruitment_roles?.code,other.recruitment_roles?.stream)!=='workforce'));
  const budgetShared=rows.some(other=>other.id!==row.id&&adBudget(other).key===budget.key&&storedAdDelivery(other,now).status==='ACTIVE');
  return [{...delivery,stationId:location.station_id,station:location.code,stationName:location.name||location.code,role:role.name,budgetSharedOutsideStation:shared,budgetShared}];
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

export {renderManagerMail} from './ad-manager-mail-render';
