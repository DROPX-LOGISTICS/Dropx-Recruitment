import { randomUUID } from 'node:crypto';
import nodemailer from 'nodemailer';
import { supabaseAdmin } from './supabase-admin';
import { requiredEnv } from './recruitment-api';
import { loadAllSupabaseRows } from './supabase-pagination';
import { dailyDue,hash,ist,mailGroups,normalizeAds,renderManagerMail,signAction,verifyAction,type MailAd,type MailGroup,type MailPerson } from './ad-manager-mail-model';

function db(){if(!supabaseAdmin) throw new Error('Database unavailable.');return supabaseAdmin;}
// PostgREST returns data on successful selects; maybeSingle callers still check absence.
function checked<T extends {error:any;data:any}>(r:T):NonNullable<T['data']> {if(r.error) throw new Error(r.error.message);return r.data as NonNullable<T['data']>;}
export async function loadMailContext(company:string) {
 const [people,ads]=await Promise.all([
  db().rpc('recruitment_ad_mail_people',{p_company:company}),
  loadAllSupabaseRows<any>((from,to)=>db().from('recruitment_ads').select('id,ad_name,status,daily_budget,poster_url,raw_payload,last_synced_at,location_id,role_id,recruitment_roles(code,name,stream),recruitment_locations(code,station_id)').eq('company_id',company).order('id').range(from,to),{maxRows:10000})
 ]);
 const audience=checked(people) as MailPerson[];const mapped=normalizeAds(ads);
 return {people:audience,ads:mapped,groups:mailGroups(audience,mapped)};
}
type Payload={groupKey:string;stations:string[];ccIds:string[];adIds:string[];statuses?:Record<string,string>;date:string;sampleKind?:'daily'|'event'};
async function enqueue(company:string,group:MailGroup,kind:'daily'|'event'|'sample',dedupe:string,payload:Payload) {
 const id=randomUUID();const thread=`${payload.date.slice(0,7)}:${group.key}${kind==='sample'?':sample':''}`;
 checked(await db().from('recruitment_ad_mail_deliveries').upsert({id,company_id:company,dedupe_key:dedupe,recipient_id:group.manager.id,kind,payload,thread_key:thread,message_id:`<recruit-${id}@dropxlogistics.com>`},{onConflict:'company_id,dedupe_key',ignoreDuplicates:true}));
}
function payloadFor(g:MailGroup,now:Date):Payload {return {groupKey:g.key,stations:g.stations,ccIds:g.cc.map(p=>p.id),adIds:g.ads.map(a=>a.id),date:ist(now).slice(0,10)};}

export async function runAdMail(company:string,preview=false) {
 const context=await loadMailContext(company);
 const settings=checked(await db().from('recruitment_ad_mail_settings').select('*').eq('company_id',company).maybeSingle());
 if(preview) return {enabled:settings?.enabled===true,schedule:'08:30 Asia/Kolkata',workforceAds:context.ads.length,managerGroups:context.groups.length,
  missingWorkforceContacts:context.groups.filter(g=>!g.cc.some(p=>p.role==='WFA')).length,
  missingBusinessHead:context.groups.filter(g=>!g.cc.some(p=>p.role==='BH')).length,
  unmappedManagerStations:[...new Set(context.ads.filter(a=>!context.groups.some(g=>g.stations.includes(a.stationId))).map(a=>a.station))]};
 if(!settings?.enabled) return {enabled:false};
 const locked=checked(await db().rpc('recruitment_ad_mail_lock',{p_company:company}));
 if(!locked)return {busy:true};
 const now=new Date();let sent=0;
 try {
  const snapshots=await loadAllSupabaseRows<any>((from,to)=>db().from('recruitment_ad_mail_snapshots').select('*').eq('company_id',company).order('ad_id').range(from,to),{maxRows:10000});
  const before=new Map<string,any>(snapshots.map((s:any)=>[s.ad_id,s]));
  for(const ad of context.ads) {
   const old=before.get(ad.id);if(old?.status===ad.status) continue;
   const version=Number(old?.version||0)+1;
   if(settings.baselined_at&&['ACTIVE','PAUSED','COMPLETED'].includes(ad.status)) {
    for(const group of context.groups.filter(g=>g.stations.includes(ad.stationId))) {
     await enqueue(company,group,'event',`event:${ad.id}:${version}:${group.key}`,{...payloadFor(group,now),adIds:[ad.id],statuses:{[ad.id]:ad.status}});
    }
   }
   checked(await db().from('recruitment_ad_mail_snapshots').upsert({company_id:company,ad_id:ad.id,status:ad.status,version},{onConflict:'company_id,ad_id'}));
  }
  if(!settings.baselined_at) checked(await db().from('recruitment_ad_mail_settings').update({baselined_at:now.toISOString()}).eq('company_id',company));
  if(dailyDue(now)) for(const group of context.groups) await enqueue(company,group,'daily',`daily:${ist(now).slice(0,10)}:${group.key}`,payloadFor(group,now));
  const pending=checked(await db().from('recruitment_ad_mail_deliveries').select('*').eq('company_id',company).eq('status','queued').order('created_at').limit(500));
  // Serialize messages within each monthly thread, including its first message.
  const queued=[...new Map<string,any>(pending.slice().reverse().map((j:any)=>[j.thread_key,j])).values()].sort((a,b)=>a.created_at.localeCompare(b.created_at)).slice(0,120);
  for(let i=0;i<queued.length&&Date.now()-now.getTime()<210_000;i+=6) {
   const batch=await Promise.all(queued.slice(i,i+6).map((job:any)=>deliver(company,job,context)));
   sent+=batch.filter(Boolean).length;
  }
  // Never blindly retry a process interrupted after SMTP DATA: it may have delivered.
  checked(await db().from('recruitment_ad_mail_deliveries').update({status:'needs_review',error:'Interrupted SMTP attempt; check delivery before retry.'}).eq('company_id',company).eq('status','sending').lt('created_at',new Date(Date.now()-15*60_000).toISOString()));
  return {enabled:true,sent,queued:queued.length,groups:context.groups.length,baseline:!settings.baselined_at};
 } finally {checked(await db().from('recruitment_ad_mail_settings').update({lease_until:null,updated_at:new Date().toISOString()}).eq('company_id',company));}
}

export async function posterAttachment(ad:MailAd) {
 try {
  const raw=ad.raw_payload?.creative;
  const url=new URL(ad.poster_url||raw?.image_url||raw?.thumbnail_url||'');
  const storageHost=new URL(requiredEnv('NEXT_PUBLIC_SUPABASE_URL')).hostname;
  if(url.protocol!=='https:'||url.username||url.password||url.port||!(url.hostname.endsWith('.fbcdn.net')||url.hostname===storageHost&&url.pathname.startsWith('/storage/v1/object/')))return null;
  const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(7000),cache:'no-store'});
  const mime=(response.headers.get('content-type')||'').split(';')[0];
  if(!response.ok||!['image/png','image/jpeg','image/webp'].includes(mime)||Number(response.headers.get('content-length'))>750000)return null;
  const reader=response.body?.getReader();if(!reader)return null;
  const chunks:Uint8Array[]=[];let size=0;
  while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;if(size>750000){await reader.cancel();return null;}chunks.push(chunk.value);}
  return {filename:`${ad.station}-poster.${mime==='image/jpeg'?'jpg':mime.split('/')[1]}`,content:Buffer.concat(chunks),contentType:mime,cid:`poster-${ad.id}@dropx`};
 }catch{return null;}
}
async function deliver(company:string,job:any,context:Awaited<ReturnType<typeof loadMailContext>>) {
 const p=job.payload as Payload;const sample=job.kind==='sample';
 let group=context.groups.find(g=>g.key===p.groupKey&&g.manager.id===job.recipient_id);
 if(sample) {
  const recipient=checked(await db().from('profiles').select('id,full_name,email,is_active').eq('company_id',company).eq('id',job.recipient_id).single());
  if(recipient.is_active)group={key:p.groupKey,manager:{id:recipient.id,name:recipient.full_name,email:recipient.email,mobile:null,role:'sample',station_ids:p.stations},cc:context.people.filter(v=>p.ccIds.includes(v.id)),stations:p.stations,ads:context.ads.filter(a=>p.stations.includes(a.stationId))};
 }
 if(!group){checked(await db().from('recruitment_ad_mail_deliveries').update({status:'cancelled',error:'Recipient or station scope changed.'}).eq('id',job.id).eq('company_id',company));return false;}
 const currentGroup=group;const kind=sample?p.sampleKind!:job.kind as 'daily'|'event';
 const selected={...currentGroup,ads:currentGroup.ads.filter(a=>p.adIds.includes(a.id))};
 const actions:Record<string,string>={};
 const visible=kind==='daily'?selected.ads.filter(a=>a.status==='ACTIVE'):selected.ads;
 for(const ad of visible) {
  const action=(p.statuses?.[ad.id]||ad.status)==='ACTIVE'?'stop_ad':'resume_ad';
  if(!sample)actions[ad.id]=`https://recruit.dropxlogistics.com/ad-response?token=${signAction({company,person:group.manager.id,ad:ad.id,action,source:job.id,exp:Date.now()+7*86400_000},requiredEnv('CRON_SECRET'))}`;
 }
 try {
  const smtp=checked(await db().from('email_notification_settings').select('is_enabled,smtp_host,smtp_port,smtp_secure,smtp_user,smtp_pass,smtp_from,from_name').eq('company_id',company).eq('id',true).single());
  if(!smtp.is_enabled||!smtp.smtp_host||!smtp.smtp_from)throw new Error('Company email service is disabled or incomplete.');
  const images:Record<string,string>={};const attachments=[];
  const posters=await Promise.all(visible.slice(0,8).map(posterAttachment));
  for(let i=0;i<posters.length;i++){const attachment=posters[i];if(attachment){attachments.push(attachment);images[visible[i].id]=attachment.cid;}}
  const mail=renderManagerMail({group:selected,kind,date:p.date,sample,images,actions,statuses:p.statuses,budgetAds:currentGroup.ads});
  // Stable subject and real first-message headers: all updates in this monthly scope thread.
  const subject=renderManagerMail({group:currentGroup,kind:'daily',date:p.date,sample}).subject;
  const previous=checked(await db().from('recruitment_ad_mail_deliveries').select('message_id').eq('company_id',company).eq('thread_key',job.thread_key).eq('status','sent').order('sent_at').limit(1).maybeSingle());
  const claimed=checked(await db().from('recruitment_ad_mail_deliveries').update({status:'sending',attempts:Number(job.attempts)+1,error:null}).eq('id',job.id).eq('company_id',company).eq('status','queued').select('id'));
  if(!claimed.length)return false;
  const transport=nodemailer.createTransport({host:smtp.smtp_host,port:smtp.smtp_port||587,secure:Number(smtp.smtp_port)===465,requireTLS:Number(smtp.smtp_port)!==465,auth:{user:smtp.smtp_user,pass:smtp.smtp_pass},connectionTimeout:15000,greetingTimeout:15000,socketTimeout:20000});
  try {
   const result=await transport.sendMail({from:{name:smtp.from_name||'DropX Recruit',address:smtp.smtp_from},to:group.manager.email,cc:sample?[]:group.cc.map(v=>v.email),subject,text:mail.text,html:mail.html,attachments,messageId:job.message_id,...(previous?{inReplyTo:previous.message_id,references:[previous.message_id]}:{})});
   const accepted=new Set((result.accepted||[]).map(v=>(typeof v==='string'?v:v.address).toLowerCase()));
   const expected=[group.manager.email,...(sample?[]:group.cc.map(v=>v.email))];
   const rejected=result.rejected?.length||expected.some(email=>!accepted.has(email.toLowerCase()));
   checked(await db().from('recruitment_ad_mail_deliveries').update({status:rejected?'needs_review':'sent',sent_at:new Date().toISOString(),error:rejected?'SMTP rejected one or more recipients. Check provider delivery logs before retry.':null}).eq('id',job.id).eq('company_id',company));
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
 const recipient=checked(await db().from('profiles').select('id,full_name,email,is_active,is_master_owner').eq('company_id',company).eq('id',profileId).single());
 if(!recipient.is_active) throw new Error('Sample recipient is inactive.');
 const source=context.groups.find(g=>g.cc.some(p=>p.role==='WFA')&&g.ads.some(a=>a.status==='ACTIVE'));
 if(!source)throw new Error('No mapped Workforce ad is available for a sample.');
 const ads=source.ads.filter(a=>a.status==='ACTIVE').slice(0,2);
 const group={...source,key:hash(`sample:${profileId}`),stations:[...new Set(ads.map(a=>a.stationId))],manager:{...source.manager,id:profileId,name:recipient.full_name,email:recipient.email},ads};
 for(const kind of ['daily','event'] as const) {
  const payload={...payloadFor(group,new Date()),sampleKind:kind,...(kind==='event'?{statuses:Object.fromEntries(ads.map((a,i)=>[a.id,i?'COMPLETED':'PAUSED']))}:{})};
  await enqueue(company,group,'sample',`sample:${ist().slice(0,10)}:${profileId}:${kind}`,payload);
 }
 const jobs=checked(await db().from('recruitment_ad_mail_deliveries').select('*').eq('company_id',company).eq('recipient_id',profileId).eq('kind','sample').eq('status','queued'));
 let sent=0;for(const job of jobs)if(await deliver(company,job,context))sent++;
 return {sent,to:recipient.email};
}

export async function resolveMailAction(token:string) {
 const action=verifyAction(token,requiredEnv('CRON_SECRET'));
 if(action.company!==requiredEnv('RECRUITMENT_COMPANY_ID'))throw new Error('Invalid company.');
 const context=await loadMailContext(action.company);
 const ad=context.ads.find(a=>a.id===action.ad);
 const person=context.people.find(p=>p.id===action.person&&!['BH','WFA'].includes(p.role));
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
