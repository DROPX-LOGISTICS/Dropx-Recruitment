import { beforeEach, describe, expect, it, vi } from "vitest";
const fixture=vi.hoisted(()=>({error:null as any,prior:null as any,writes:[] as any[]}));
vi.mock("./scoped-recruitment-ad",()=>({scopedRecruitmentAd:async()=>fixture.error?{error:fixture.error}:{companyId:"company",session:{profileId:"actor"},ad:{id:"ad",meta_ad_id:"meta"}}}));
vi.mock("./supabase-admin",()=>({supabaseAdmin:{from:(table:string)=>{const query:any={select:()=>query,eq:()=>query,maybeSingle:async()=>({data:fixture.prior,error:null}),insert:async(value:any)=>{fixture.writes.push({table,value});return {error:null};}};return query;}}}));
vi.mock("./meta-ad-insights",()=>({fetchRecentMetaInsights:async()=>({available:true,periods:{assessment:{since:"2026-09-02",until:"2026-09-08"}},assessment:[{ad_id:"meta",spend:"100",impressions:"1000"}]})}));
import { POST } from "../app/api/recruitment/ads/[id]/monitor/route";
const requestId="3a1aafc7-8623-43ec-922a-31455b29724f";
const call=(body:any)=>POST(new Request("https://example.test",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({code:"weak_response",requestId,...body})}),{params:{id:"ad"}});
beforeEach(()=>{fixture.error=null;fixture.prior=null;fixture.writes=[];});
describe("non-disruptive ad monitoring actions",()=>{
 it("writes only a review event, with a server-derived deadline and baseline",async()=>{const start=Date.now();expect((await call({}))?.status).toBe(200);expect(fixture.writes).toHaveLength(1);const saved=fixture.writes[0];expect(saved.table).toBe("recruitment_ad_guard_events");expect(saved.value).toMatchObject({company_id:"company",ad_id:"ad",actor_profile_id:"actor",action_taken:"monitor_48h",evidence:{baseline:{spend:100}}});expect(Date.parse(saved.value.evidence.reviewAfter)-start).toBeGreaterThanOrEqual(48*3600000);});
 it("can bring a watched issue back to review immediately",async()=>{await call({action:"review_now"});expect(fixture.writes[0].value.evidence.endedEarly).toBe(true);expect(Date.parse(fixture.writes[0].value.evidence.reviewAfter)).toBeLessThanOrEqual(Date.now());});
 it("does not duplicate the same request",async()=>{fixture.prior={id:requestId,ad_id:"ad",evidence:{reviewAfter:"2026-09-11"}};expect((await call({}))?.status).toBe(200);expect(fixture.writes).toEqual([]);});
 it("cannot use monitoring to send arbitrary ad actions",async()=>{expect((await call({action:"pause_ad"}))?.status).toBe(400);expect(fixture.writes).toEqual([]);});
 it("does not write when the ad is outside the user's permission",async()=>{fixture.error=Response.json({error:"Forbidden"},{status:403});expect((await call({}))?.status).toBe(403);expect(fixture.writes).toEqual([]);});
});
