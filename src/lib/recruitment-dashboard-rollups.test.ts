import {beforeEach,describe,it,expect,vi} from 'vitest';
const fixture=vi.hoisted(()=>({allowed:true,signedIn:true,requests:[] as {url:URL;body:any}[]}));
vi.mock('./recruitment-api',()=>({
 recruitmentSession:async()=>fixture.signedIn?{isOwner:false,allLocations:false,locationIds:['allowed-station'],roleIds:['allowed-role']}:null,
 canUseRecruitmentMenu:()=>fixture.allowed,hasFullLeadAccess:()=>false,canAccessLead:()=>true,requiredEnv:()=> 'company',applyLeadScope:(q:any)=>q
}));
vi.mock('./main-dashboard-masters',()=>({loadMainDashboardStations:async()=>[]}));
vi.mock('./supabase-admin',async()=>{
 const {createClient}=await import('@supabase/supabase-js');
 const counters={total:4,no_status:4,no_response:0,call_back:0,interviews:0,joined:0,pending:4,stale:2,no_status_12h:3,no_status_24h:2,no_status_48h:1,retry_due:0,callback_due:0,interviews_today:0,unassigned:2,updated_today:1,response_minutes:0,response_count:0};
 return {supabaseAdmin:createClient('https://database.example.test','test-key',{auth:{persistSession:false},global:{fetch:async(input,init)=>{
  const url=new URL(String(input));fixture.requests.push({url,body:init?.body?JSON.parse(String(init.body)):null});
  return new Response(JSON.stringify(url.pathname.includes('/rpc/')?{groups:[{...counters,s:'new',location_id:'allowed-station',role_id:'allowed-role',ad_id:null,recruitment_locations:{code:'STN',name:'Station'},recruitment_roles:{code:'DA',name:'Delivery Associate'}}],attention:[]}:[]),{headers:{'content-type':'application/json'}});
 }}})};
});
import {GET} from '../app/api/recruitment/dashboard/route';
beforeEach(()=>{fixture.requests=[];fixture.signedIn=true;fixture.allowed=true;});
describe('dashboard rollup API',()=>{
 it('returns weighted counts and never downloads individual lead pages',async()=>{
  const response=await GET(new Request('https://recruit.test/api/recruitment/dashboard?stream=workforce'));
  expect(response.status).toBe(200);const body=await response.json();
  expect(body.metrics).toMatchObject({total:4,noStatus:4,pending24h:2,unmapped:0});
  expect(body.queues).toMatchObject({noStatus12h:3,noStatus24h:2,noStatus48h:1});
  expect(body.stationHealth[0]).toMatchObject({total:4,unassigned:2,stale:2});
  expect(body.adDesignationPendency[0]).toMatchObject({totalLeads:4,pending:4,stale24h:2});
  expect(fixture.requests.some(r=>r.url.pathname.endsWith('/recruitment_leads'))).toBe(false);
  expect(fixture.requests.find(r=>r.url.pathname.includes('/rpc/'))?.body).toMatchObject({p_company_id:'company',p_scope_location_ids:['allowed-station'],p_scope_role_ids:['allowed-role']});
 });
 it('rejects unauthenticated and unauthorized requests before returning cached aggregates',async()=>{
  fixture.signedIn=false;expect((await GET(new Request('https://recruit.test/api/recruitment/dashboard?stream=workforce'))).status).toBe(401);
  fixture.signedIn=true;fixture.allowed=false;expect((await GET(new Request('https://recruit.test/api/recruitment/dashboard?stream=workforce'))).status).toBe(403);
  expect(fixture.requests).toHaveLength(0);
 });
});
