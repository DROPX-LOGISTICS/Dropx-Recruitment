import { beforeEach, describe, expect, it, vi } from "vitest";
const fixture=vi.hoisted(()=>({session:{} as any,menu:true,scope:true,reads:0}));
vi.mock("./recruitment-api",()=>({recruitmentSession:async()=>fixture.session,requiredEnv:()=>"company",canUseRecruitmentMenu:()=>fixture.menu,canAccessLead:()=>fixture.scope}));
vi.mock("./supabase-admin",()=>({supabaseAdmin:{from:()=>{fixture.reads++;const query:any={select:()=>query,eq:()=>query,maybeSingle:async()=>({data:{id:"ad",recruitment_roles:{stream:"workforce"}},error:null})};return query;}}}));
import { scopedRecruitmentAd } from "./scoped-recruitment-ad";
beforeEach(()=>{fixture.session={};fixture.menu=true;fixture.scope=true;fixture.reads=0;});
describe("ad diagnostics and monitoring authorisation",()=>{
 it("requires authentication before loading an ad",async()=>{fixture.session=null;const result=await scopedRecruitmentAd(new Request("http://localhost"),"ad");expect("error" in result && result.error.status).toBe(401);expect(fixture.reads).toBe(0);});
 it("denies monitoring without its menu grant",async()=>{fixture.menu=false;const result=await scopedRecruitmentAd(new Request("http://localhost"),"ad",true);expect("error" in result && result.error.status).toBe(403);});
 it("denies an ad outside the assigned location or role scope",async()=>{fixture.scope=false;const result=await scopedRecruitmentAd(new Request("http://localhost"),"ad");expect("error" in result && result.error.status).toBe(403);});
 it("returns a scoped ad and company when both grants match",async()=>expect(await scopedRecruitmentAd(new Request("http://localhost"),"ad")).toMatchObject({companyId:"company",ad:{id:"ad"}}));
});
