import {beforeEach,describe,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({tables:{} as Record<string,any[]>,people:[] as any[],smtp:vi.fn(),lock:true}));
vi.mock('./recruitment-api',()=>({requiredEnv:(key:string)=>({RECRUITMENT_COMPANY_ID:'company',CRON_SECRET:'test-secret',NEXT_PUBLIC_SUPABASE_URL:'https://test.supabase.co'}[key]||'test')}));
vi.mock('nodemailer',()=>({default:{createTransport:()=>({sendMail:mocks.smtp,close:()=>{}})}}));
vi.mock('./supabase-admin',()=>({supabaseAdmin:{
 rpc:async(name:string)=>({data:name==='recruitment_ad_mail_lock'?mocks.lock:mocks.people,error:null}),
 from:(table:string)=>{
  let mode='read',values:any,conflict:any;const predicates:((r:any)=>boolean)[]=[];let cap=Infinity,single=false;
  const q:any={select:()=>q,range:(from:number,to:number)=>{cap=to-from+1;return q;},eq:(k:string,v:any)=>{predicates.push(r=>k.includes('->>')?r[k.split('->>')[0]]?.[k.split('->>')[1]]===v:r[k]===v);return q;},lt:(k:string,v:any)=>{predicates.push(r=>r[k]<v);return q;},order:()=>q,limit:(n:number)=>{cap=n;return q;},maybeSingle:()=>{single=true;return q;},single:()=>{single=true;return q;},insert:(v:any)=>{mode='insert';values=v;return q;},upsert:(v:any,c:any)=>{mode='upsert';values=v;conflict=c;return q;},update:(v:any)=>{mode='update';values=v;return q;},then:(resolve:any)=>{
   const rows=mocks.tables[table]??(mocks.tables[table]=[]);let data:any;
   if(mode==='read')data=rows.filter(r=>predicates.every(p=>p(r))).slice(0,cap);
   if(mode==='update'){data=rows.filter(r=>predicates.every(p=>p(r)));data.forEach((r:any)=>Object.assign(r,values));}
   if(mode==='insert'||mode==='upsert'){
    const keys=String(conflict?.onConflict||'id').split(',');const found=rows.find(r=>keys.every(k=>r[k]===values[k]));
    if(found&&mode==='upsert'){if(!conflict?.ignoreDuplicates)Object.assign(found,values);data=[found];}
    else{const row={status:'queued',attempts:0,created_at:new Date().toISOString(),...values};rows.push(row);data=[row];}
   }
   return Promise.resolve({data:structuredClone(single?data[0]??null:data),error:null}).then(resolve);
  }};return q;
 }
}}));
import {runAdMail,sendManagerSamples,submitMailAction,resolveMailAction} from './ad-manager-mail';
import {signAction} from './ad-manager-mail-model';
const company='company';
beforeEach(()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-28T17:00:00Z'));
 mocks.lock=true;mocks.smtp.mockReset().mockResolvedValue({accepted:['manager@example.com','workforce@example.com','head@example.com','owner@example.com'],rejected:[]});
 mocks.people=[{id:'manager',name:'Manager',email:'manager@example.com',mobile:'123',role:'CLM',station_ids:['station']},{id:'wfa',name:'Workforce',email:'workforce@example.com',mobile:'456',role:'WFA',station_ids:['station']},{id:'bh',name:'Business Head',email:'head@example.com',mobile:'789',role:'BH',station_ids:['station']}];
 mocks.tables={recruitment_ad_mail_settings:[{company_id:company,enabled:true,baselined_at:null}],recruitment_ads:[{company_id:company,id:'ad',ad_name:'Workforce ad',status:'ACTIVE',daily_budget:100,poster_url:null,location_id:'loc',role_id:'da',raw_payload:{},recruitment_roles:{code:'DA',name:'Delivery Associate',stream:'workforce'},recruitment_locations:{code:'STATION',station_id:'station'}}],email_notification_settings:[{company_id:company,id:true,is_enabled:true,smtp_host:'smtp.example.com',smtp_from:'notify@example.com',smtp_user:'user',smtp_pass:'password',smtp_port:587}],profiles:[{company_id:company,id:'owner',full_name:'Owner',email:'owner@example.com',is_active:true}]};
});
describe('Ad mail delivery and request boundaries',()=>{
 it('baselines historic ads without sending and sends a later transition only once',async()=>{
  expect(await runAdMail(company)).toMatchObject({baseline:true,sent:0});expect(mocks.smtp).not.toHaveBeenCalled();
  mocks.tables.recruitment_ads[0].status='PAUSED';expect(await runAdMail(company)).toMatchObject({sent:1});
  await runAdMail(company);expect(mocks.smtp).toHaveBeenCalledTimes(1);expect(mocks.smtp.mock.calls[0][0].cc).toEqual(['head@example.com','workforce@example.com']);
 });
 it('queues the 08:30 digest once per day and threads later events to its actual message',async()=>{
  vi.setSystemTime(new Date('2026-09-29T03:00:00Z'));await runAdMail(company);await runAdMail(company);
  expect(mocks.smtp).toHaveBeenCalledTimes(1);const first=mocks.smtp.mock.calls[0][0];
  mocks.tables.recruitment_ads[0].status='PAUSED';await runAdMail(company);
  const second=mocks.smtp.mock.calls[1][0];expect(second.subject).toBe(first.subject);expect(second.inReplyTo).toBe(first.messageId);expect(second.references).toContain(first.messageId);
 });
 it('does not send when disabled or another worker holds the lease',async()=>{
  mocks.tables.recruitment_ad_mail_settings[0].enabled=false;await runAdMail(company);
  mocks.tables.recruitment_ad_mail_settings[0].enabled=true;mocks.lock=false;await runAdMail(company);expect(mocks.smtp).not.toHaveBeenCalled();
 });
 it('sends both labelled samples only to the selected owner, never operational CCs',async()=>{
  expect(await sendManagerSamples(company,'owner')).toEqual({sent:2,to:'owner@example.com'});await sendManagerSamples(company,'owner');
  expect(mocks.smtp).toHaveBeenCalledTimes(2);for(const [mail] of mocks.smtp.mock.calls){expect(mail.to).toBe('owner@example.com');expect(mail.cc).toEqual([]);expect(mail.subject).toContain('[SAMPLE]');expect(mail.html).not.toContain('/ad-response?token=');}
 });
 it('does not resend uncertain SMTP attempts',async()=>{
  mocks.smtp.mockRejectedValueOnce(new Error('Socket disconnected after DATA'));
  vi.setSystemTime(new Date('2026-09-29T03:00:00Z'));await runAdMail(company);await runAdMail(company);
  expect(mocks.smtp).toHaveBeenCalledTimes(1);expect(mocks.tables.recruitment_ad_mail_deliveries[0].status).toBe('needs_review');
 });
 it('creates a pending review request, not a Meta change; duplicate clicks reuse it',async()=>{
  await runAdMail(company);mocks.tables.recruitment_ads[0].status='PAUSED';await runAdMail(company);
  const delivery=mocks.tables.recruitment_ad_mail_deliveries[0];
  const token=signAction({company,person:'manager',ad:'ad',action:'resume_ad',source:delivery.id,exp:Date.now()+10000},'test-secret');
  const first=await submitMailAction(token,3,'Need three associates');expect(await submitMailAction(token,3,'Again')).toBe(first);
  expect(mocks.tables.recruitment_ad_requests).toHaveLength(1);expect(mocks.tables.recruitment_ad_requests[0]).toMatchObject({status:'requested',request_type:'resume_ad',raw_payload:{headcount:3,requiresWorkforceReview:true}});
  expect(mocks.tables.recruitment_ads[0].status).toBe('PAUSED');expect((await resolveMailAction(token)).requestId).toBe(first);
  mocks.people[0].station_ids=[];await expect(submitMailAction(token,3,'')).rejects.toThrow(/station access/);
 });
 it('rejects invalid headcount and never accepts sample links as real requests',async()=>{
  await sendManagerSamples(company,'owner');const delivery=mocks.tables.recruitment_ad_mail_deliveries[0];
  const token=signAction({company,person:'manager',ad:'ad',action:'resume_ad',source:delivery.id,exp:Date.now()+10000},'test-secret');
  await expect(submitMailAction(token,0,'')).rejects.toThrow();expect(mocks.tables.recruitment_ad_requests||[]).toHaveLength(0);
 });
});
