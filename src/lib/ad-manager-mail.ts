import { randomUUID } from 'node:crypto';
import nodemailer from 'nodemailer';
import { supabaseAdmin } from './supabase-admin';
import { requiredEnv } from './recruitment-api';
import { loadAllSupabaseRows } from './supabase-pagination';
import { adBudget,eveningDue,hash,ist,mailGroups,morningDue,normalizeAds,renderManagerMail,signAction,verifyAction,type MailActivity,type MailAd,type MailGroup,type MailPerson } from './ad-manager-mail-model';

function db(){if(!supabaseAdmin) throw new Error('Database unavailable.');return supabaseAdmin;}
function checked<T extends {error:any;data:any}>(result:T):NonNullable<T['data']> {if(result.error) throw new Error(result.error.message);return result.data as NonNullable<T['data']>;}

export async function loadMailContext(company:string) {
 const [people,ads,leadRows]=await Promise.all([
  db().rpc('recruitment_ad_mail_people',{p_company:company}),
  loadAllSupabaseRows<any>((from,to)=>db().from('recruitment_ads').select('id,ad_name,status,daily_budget,poster_url,raw_payload,last_synced_at,created_on,location_id,role_id,recruitment_roles(code,name,stream),recruitment_locations(code,station_id)').eq('company_id',company).order('id').range(from,to),{maxRows:10000}),
  loadAllSupabaseRows<{ad_id:string|null}>((from,to)=>db().from('recruitment_leads').select('ad_id').eq('company_id',company).not('ad_id','is',null).range(from,to),{maxRows:100000})
 ]);
 const leadsByAd=new Map<string,number>();
 for(const lead of leadRows) if(lead.ad_id) leadsByAd.set(lead.ad_id,(leadsByAd.get(lead.ad_id)||0)+1);
 const audience=checked(people) as MailPerson[];const mapped=normalizeAds(ads.map(ad=>({...ad,lead_count:leadsByAd.get(ad.id)||0})));
 return {people:audience,ads:mapped,groups:mailGroups(audience,mapped)};
}

type Payload={groupKey:string;stations:string[];adIds:string[];date:string;activityIds?:string[];sampleKind?:'daily'|'event';sampleActivities?:MailActivity[]};
async function enqueue(company:string,group:MailGroup,kind:'daily'|'event'|'sample',dedupe:string,payload:Payload) {
 const id=randomUUID();
 const thread=`${payload.date.slice(0,7)}:${group.manager.id}:${kind==='sample'?`sample:${payload.sampleKind||'daily'}`:kind}`;
 checked(await db().from('recruitment_ad_mail_deliveries').upsert({id,company_id:company,dedupe_key:dedupe,recipient_id:group.manager.id,kind,payload,thread_key:thread,message_id:`<recruit-${id}@dropxlogistics.com>`},{onConflict:'company_id,dedupe_key',ignoreDuplicates:true}));
}
function payloadFor(group:MailGroup,now:Date):Payload {return {groupKey:group.key,stations:group.stations,adIds:group.ads.map(ad=>ad.id),date:ist(now).slice(0,10)};}
function istDayStart(now:Date) {return new Date(`${ist(now).slice(0,10)}T00:00:00+05:30`).toISOString();}
function creativeFingerprint(ad:MailAd) {
 const creative=ad.raw_payload?.creative||{};
 return hash(JSON.stringify([ad.poster_url||null,creative.id||null,creative.image_url||null,creative.thumbnail_url||null]));
}

async function recordActivity(company:string,context:Awaited<ReturnType<typeof loadMailContext>>,settings:any,now:Date) {
 const snapshots=await loadAllSupabaseRows<any>((from,to)=>db().from('recruitment_ad_mail_snapshots').select('*').eq('company_id',company).order('ad_id').range(from,to),{maxRows:10000});
 const before=new Map<string,any>(snapshots.map(snapshot=>[snapshot.ad_id,snapshot]));
 let recorded=0;
 for(const ad of context.ads) {
  const old=before.get(ad.id);
  const budget=adBudget(ad);
  const hasBudgetBaseline=old&&old.budget_amount!==null&&old.budget_amount!==undefined&&old.budget_kind;
  const statusChanged=Boolean(old&&old.status!==ad.status);
  const budgetChanged=Boolean(hasBudgetBaseline&&(Number(old.budget_amount)!==budget.amount||old.budget_kind!==budget.kind));
  const creativeKey=creativeFingerprint(ad);
  // Existing rows gain a creative baseline once after this release; that first observation is not an update.
  const posterChanged=Boolean(old?.poster_fingerprint&&old.poster_fingerprint!==creativeKey);
  const newAd=Boolean(settings.baselined_at&&!old);
  const changed=statusChanged||budgetChanged||posterChanged||newAd;
  const version=Number(old?.version||0)+(changed?1:old?0:1);
  if(settings.baselined_at&&changed) {
   const changeTypes=[newAd?'new_ad':null,posterChanged?'poster':null,statusChanged?'status':null,budgetChanged?'budget':null].filter(Boolean);
   checked(await db().from('recruitment_ad_mail_activity').upsert({
    id:randomUUID(),company_id:company,ad_id:ad.id,station_id:ad.stationId,station:ad.station,ad_name:ad.ad_name,role:ad.role,
    occurred_at:now.toISOString(),previous_status:old?.status||null,current_status:ad.status,
    previous_budget:hasBudgetBaseline?Number(old.budget_amount):null,current_budget:budget.amount,budget_kind:budget.kind,change_types:changeTypes,version
   },{onConflict:'company_id,ad_id,version',ignoreDuplicates:true}));
   recorded++;
  }
  checked(await db().from('recruitment_ad_mail_snapshots').upsert({company_id:company,ad_id:ad.id,status:ad.status,budget_amount:budget.amount,budget_kind:budget.kind,poster_fingerprint:creativeKey,version},{onConflict:'company_id,ad_id'}));
 }
 if(!settings.baselined_at) checked(await db().from('recruitment_ad_mail_settings').update({baselined_at:now.toISOString(),updated_at:now.toISOString()}).eq('company_id',company));
 return {baseline:!settings.baselined_at,recorded};
}

/** Called after each Meta poll. It records audit rows only and never sends an email. */
export async function observeAdMailActivity(company:string) {
 const context=await loadMailContext(company);
 const settings=checked(await db().from('recruitment_ad_mail_settings').select('*').eq('company_id',company).maybeSingle());
 if(!settings?.enabled) return {enabled:false,recorded:0};
 const locked=checked(await db().rpc('recruitment_ad_mail_lock',{p_company:company}));
 if(!locked)return {enabled:true,busy:true,recorded:0};
 const now=new Date();
 try{return {enabled:true,...await recordActivity(company,context,settings,now)};}
 finally {checked(await db().from('recruitment_ad_mail_settings').update({lease_until:null,updated_at:new Date().toISOString()}).eq('company_id',company));}
}

export async function runAdMail(company:string,preview=false) {
 const context=await loadMailContext(company);
 const settings=checked(await db().from('recruitment_ad_mail_settings').select('*').eq('company_id',company).maybeSingle());
 if(preview) return {enabled:settings?.enabled===true,schedule:['08:30 Asia/Kolkata','20:00 Asia/Kolkata'],workforceAds:context.ads.length,recipientGroups:context.groups.length,unmappedStations:[...new Set(context.ads.filter(ad=>!context.groups.some(group=>group.stations.includes(ad.stationId))).map(ad=>ad.station))]};
 if(!settings?.enabled) return {enabled:false};
 const locked=checked(await db().rpc('recruitment_ad_mail_lock',{p_company:company}));
 if(!locked)return {busy:true};
 const now=new Date();const morning=morningDue(now);const evening=eveningDue(now);let sent=0;
 try {
  const observation=await recordActivity(company,context,settings,now);
  if(morning) for(const group of context.groups) await enqueue(company,group,'daily',`morning:${ist(now).slice(0,10)}:${group.manager.id}`,payloadFor(group,now));
  if(evening) {
   const activity=checked(await db().from('recruitment_ad_mail_activity').select('*').eq('company_id',company).gte('occurred_at',istDayStart(now)).lt('occurred_at',now.toISOString()).order('occurred_at').limit(5000)) as MailActivity[];
   for(const group of context.groups) {
    const scoped=activity.filter(item=>group.stations.includes(item.station_id));
    await enqueue(company,group,'event',`evening:${ist(now).slice(0,10)}:${group.manager.id}`,{...payloadFor(group,now),adIds:[...new Set(scoped.map(item=>item.ad_id))],activityIds:scoped.map(item=>item.id).filter(Boolean) as string[]});
   }
  }
  const dispatchKind=morning?'daily':evening?'event':null;
  if(!dispatchKind) return {enabled:true,sent:0,queued:0,groups:context.groups.length,...observation};
  const pending=checked(await db().from('recruitment_ad_mail_deliveries').select('*').eq('company_id',company).eq('kind',dispatchKind).eq('status','queued').eq('payload->>date',ist(now).slice(0,10)).order('created_at').limit(500));
  for(let index=0;index<pending.length&&Date.now()-now.getTime()<210_000;index+=6) {
   const batch=await Promise.all(pending.slice(index,index+6).map((job:any)=>deliver(company,job,context)));
   sent+=batch.filter(Boolean).length;
  }
  checked(await db().from('recruitment_ad_mail_deliveries').update({status:'needs_review',error:'Interrupted SMTP attempt; check delivery before retry.'}).eq('company_id',company).eq('status','sending').lt('created_at',new Date(Date.now()-15*60_000).toISOString()));
  return {enabled:true,sent,queued:pending.length,groups:context.groups.length,...observation};
 } finally {checked(await db().from('recruitment_ad_mail_settings').update({lease_until:null,updated_at:new Date().toISOString()}).eq('company_id',company));}
}

async function deliveryActivities(company:string,activityIds:string[]|undefined) {
 if(!activityIds?.length) return [] as MailActivity[];
 // A regional report can contain thousands of UUIDs. A single PostgREST IN URL
 // exceeds the gateway limit; bounded reads also avoid response-row truncation.
 const ids=[...new Set(activityIds)];const rows:MailActivity[]=[];
 for(let offset=0;offset<ids.length;offset+=100) {
  const result=await db().from('recruitment_ad_mail_activity').select('*').eq('company_id',company).in('id',ids.slice(offset,offset+100)).order('occurred_at');
  rows.push(...checked(result) as MailActivity[]);
 }
 return rows.sort((a,b)=>a.occurred_at.localeCompare(b.occurred_at));
}

/** Embed only vetted, bounded images so a report never exposes an arbitrary remote URL to recipients. */
export async function posterAttachment(ad:MailAd) {
 try {
  const creative=ad.raw_payload?.creative||{};
  const url=new URL(ad.poster_url||creative.image_url||creative.thumbnail_url||'');
  const storageHost=new URL(requiredEnv('NEXT_PUBLIC_SUPABASE_URL')).hostname;
  const allowed=url.hostname.endsWith('.fbcdn.net')||(url.hostname===storageHost&&url.pathname.startsWith('/storage/v1/object/'));
  if(url.protocol!=='https:'||url.username||url.password||url.port||!allowed)return null;
  const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(7000),cache:'no-store'});
  const mime=(response.headers.get('content-type')||'').split(';')[0];
  if(!response.ok||!['image/png','image/jpeg','image/webp'].includes(mime)||Number(response.headers.get('content-length'))>600_000)return null;
  const reader=response.body?.getReader();if(!reader)return null;
  const chunks:Uint8Array[]=[];let size=0;
  while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;if(size>600_000){await reader.cancel();return null;}chunks.push(chunk.value);}
  return {filename:`${ad.station}-poster.${mime==='image/jpeg'?'jpg':mime.split('/')[1]}`,content:Buffer.concat(chunks),contentType:mime,cid:`poster-${ad.id}@dropx`};
 }catch{return null;}
}

async function deliver(company:string,job:any,context:Awaited<ReturnType<typeof loadMailContext>>) {
 const payload=job.payload as Payload;const sample=job.kind==='sample';
 let group=context.groups.find(candidate=>candidate.key===payload.groupKey&&candidate.manager.id===job.recipient_id);
 if(sample) {
  const recipient=checked(await db().from('profiles').select('id,full_name,email,is_active').eq('company_id',company).eq('id',job.recipient_id).single());
  if(recipient.is_active)group={key:payload.groupKey,manager:{id:recipient.id,name:recipient.full_name,email:recipient.email,mobile:null,role:'sample',station_ids:payload.stations},cc:[],stations:payload.stations,ads:context.ads.filter(ad=>payload.stations.includes(ad.stationId))};
 }
 if(!group){checked(await db().from('recruitment_ad_mail_deliveries').update({status:'cancelled',error:'Recipient or station scope changed.'}).eq('id',job.id).eq('company_id',company));return false;}
 const kind=sample?payload.sampleKind!:job.kind as 'daily'|'event';
 try {
  const activities=kind==='event'?(payload.sampleActivities||await deliveryActivities(company,payload.activityIds)):[];
  const smtp=checked(await db().from('email_notification_settings').select('is_enabled,smtp_host,smtp_port,smtp_user,smtp_pass,smtp_from,from_name').eq('company_id',company).eq('id',true).single());
  if(!smtp.is_enabled||!smtp.smtp_host||!smtp.smtp_from)throw new Error('Company email service is disabled or incomplete.');
  const visualAds=(kind==='daily'?group.ads.filter(ad=>ad.status==='ACTIVE'):group.ads.filter(ad=>activities.some(activity=>activity.ad_id===ad.id))).slice(0,8);
  const posters=await Promise.all(visualAds.map(posterAttachment));
  const images:Record<string,string>={};const attachments:any[]=[];
  for(let index=0;index<posters.length;index++) {
   const attachment=posters[index];
   if(attachment){attachments.push(attachment);images[visualAds[index].id]=attachment.cid;}
  }
  const mail=renderManagerMail({group,kind,date:payload.date,sample,activities,images});
  const previous=checked(await db().from('recruitment_ad_mail_deliveries').select('message_id').eq('company_id',company).eq('thread_key',job.thread_key).eq('status','sent').order('sent_at').limit(1).maybeSingle());
  const claimed=checked(await db().from('recruitment_ad_mail_deliveries').update({status:'sending',attempts:Number(job.attempts)+1,error:null}).eq('id',job.id).eq('company_id',company).eq('status','queued').select('id'));
  if(!claimed.length)return false;
  const transport=nodemailer.createTransport({host:smtp.smtp_host,port:smtp.smtp_port||587,secure:Number(smtp.smtp_port)===465,requireTLS:Number(smtp.smtp_port)!==465,auth:{user:smtp.smtp_user,pass:smtp.smtp_pass},connectionTimeout:15000,greetingTimeout:15000,socketTimeout:20000});
  try {
   const result=await transport.sendMail({from:{name:smtp.from_name||'DropX Recruit',address:smtp.smtp_from},to:group.manager.email,cc:[],subject:mail.subject,text:mail.text,html:mail.html,attachments,messageId:job.message_id,...(previous?{inReplyTo:previous.message_id,references:[previous.message_id]}:{})});
   const accepted=new Set((result.accepted||[]).map(value=>(typeof value==='string'?value:value.address).toLowerCase()));
   const rejected=result.rejected?.length||!accepted.has(group.manager.email.toLowerCase());
   checked(await db().from('recruitment_ad_mail_deliveries').update({status:rejected?'needs_review':'sent',sent_at:new Date().toISOString(),error:rejected?'SMTP rejected the recipient. Check provider delivery logs before retry.':null}).eq('id',job.id).eq('company_id',company));
   return !rejected;
  }catch(error){
   checked(await db().from('recruitment_ad_mail_deliveries').update({status:'needs_review',error:'SMTP attempt not confirmed. Review provider delivery before retrying.'}).eq('company_id',company).eq('id',job.id));
   console.error('recruit-ad-mail SMTP failed',job.id,(error as {code?:string}).code||'unknown');return false;
  }finally{transport.close();}
 }catch(error){
  checked(await db().from('recruitment_ad_mail_deliveries').update({status:'failed',error:'Email preparation failed. Check SMTP configuration and server logs.'}).eq('company_id',company).eq('id',job.id).eq('status','queued'));
  console.error('recruit-ad-mail preparation failed',job.id,error instanceof Error?error.message:'unknown');return false;
 }
}

export async function sendManagerSamples(company:string,profileId:string) {
 const context=await loadMailContext(company);
 const recipient=checked(await db().from('profiles').select('id,full_name,email,is_active').eq('company_id',company).eq('id',profileId).single());
 if(!recipient.is_active) throw new Error('Sample recipient is inactive.');
 const source=context.groups.find(group=>group.manager.id===profileId&&group.ads.some(ad=>ad.status==='ACTIVE'))||context.groups.find(group=>group.ads.some(ad=>ad.status==='ACTIVE'));
 if(!source)throw new Error('No mapped Workforce ad is available for a sample.');
 const ads=source.ads.filter(ad=>ad.status==='ACTIVE').slice(0,2);
 const group={...source,key:hash(`sample:${profileId}`),manager:{...source.manager,id:profileId,name:recipient.full_name,email:recipient.email},cc:[]};
 const now=new Date();
 const activity:MailActivity[]=ads.map((ad,index)=>({
  ad_id:ad.id,station_id:ad.stationId,station:ad.station,ad_name:ad.ad_name,role:ad.role,
  occurred_at:new Date(now.getTime()-(index+1)*45*60_000).toISOString(),previous_status:index?'ACTIVE':'PAUSED',current_status:'ACTIVE',
  previous_budget:index?100:100,current_budget:index?150:100,budget_kind:'daily',change_types:index?['new_ad','budget']:['poster','status']
 }));
 for(const kind of ['daily','event'] as const) {
  await enqueue(company,group,'sample',`sample-v2:${ist(now).slice(0,10)}:${profileId}:${kind}`,{...payloadFor(group,now),sampleKind:kind,sampleActivities:kind==='event'?activity:undefined});
 }
 const jobs=checked(await db().from('recruitment_ad_mail_deliveries').select('*').eq('company_id',company).eq('recipient_id',profileId).eq('kind','sample').eq('status','queued'));
 let sent=0;for(const job of jobs)if(await deliver(company,job,context))sent++;
 return {sent,to:recipient.email};
}

export async function resolveMailAction(token:string) {
 const action=verifyAction(token,requiredEnv('CRON_SECRET'));
 if(action.company!==requiredEnv('RECRUITMENT_COMPANY_ID'))throw new Error('Invalid company.');
 const context=await loadMailContext(action.company);
 const ad=context.ads.find(candidate=>candidate.id===action.ad);
 const person=context.people.find(candidate=>candidate.id===action.person&&!['BH','WFA'].includes(candidate.role));
 const delivery=checked(await db().from('recruitment_ad_mail_deliveries').select('recipient_id,payload,kind,status').eq('company_id',action.company).eq('id',action.source).maybeSingle());
 if(!ad||!person||!person.station_ids.includes(ad.stationId)||!delivery||delivery.recipient_id!==person.id||delivery.kind==='sample'||!['sent','needs_review'].includes(delivery.status)||!delivery.payload.adIds?.includes(ad.id))throw new Error('This request is no longer within your current station access.');
 const existing=checked(await db().from('recruitment_ad_requests').select('request_id').eq('company_id',action.company).eq('raw_payload->>mailSource',`${action.source}:${action.ad}:${action.action}`).maybeSingle());
 return {action,ad,person,requestId:existing?.request_id||null};
}

export async function submitMailAction(token:string,headcount:number,note:string) {
 const {action,ad,person}=await resolveMailAction(token);
 if(note.length>1000)throw new Error('Keep the note within 1,000 characters.');
 if(action.action==='resume_ad'&&(!Number.isInteger(headcount)||headcount<1||headcount>1000))throw new Error('Enter a headcount between 1 and 1,000.');
 const source=`${action.source}:${action.ad}:${action.action}`;
 const existing=checked(await db().from('recruitment_ad_requests').select('request_id').eq('company_id',action.company).eq('raw_payload->>mailSource',source).maybeSingle());
 if(existing)return existing.request_id;
 const now=new Date().toISOString();const requestId=`AR-MAIL-${randomUUID().slice(0,8).toUpperCase()}`;
 const reason=action.action==='stop_ad'?'Ad no longer required':`Hiring still required: ${headcount} associates`;
 const result=await db().from('recruitment_ad_requests').insert({company_id:action.company,request_id:requestId,request_type:action.action,ad_id:ad.id,location_id:ad.location_id,role_id:ad.role_id,status:'requested',requested_by:person.id,requested_at:now,reason,notes:note||null,old_budget:ad.daily_budget,
  raw_payload:{stream:'workforce',mailSource:source,headcount:action.action==='resume_ad'?headcount:null,requestedByProfileId:person.id,requestedByName:person.name,requestedByEmail:person.email,requiresWorkforceReview:true,lifecycleHistory:[{action:'submit',from:null,to:'requested',at:now,actorProfileId:person.id,actorName:person.name,actorEmail:person.email,remarks:`${reason}${note?` · ${note}`:''}`} ]}});
 if(result.error?.code==='23505')return checked(await db().from('recruitment_ad_requests').select('request_id').eq('company_id',action.company).eq('raw_payload->>mailSource',source).single()).request_id;
 checked(result);return requestId;
}
