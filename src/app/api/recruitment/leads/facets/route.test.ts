import {beforeEach, describe, expect, it, vi} from "vitest";
const mocks = vi.hoisted(()=>({session:vi.fn(), permission:vi.fn(), full:vi.fn(), rpc:vi.fn()}));
vi.mock("@/lib/recruitment-api",()=>({recruitmentSession:mocks.session,canUseRecruitmentMenu:mocks.permission,hasFullLeadAccess:mocks.full,requiredEnv:()=>"company-1"}));
vi.mock("@/lib/supabase-admin",()=>({supabaseAdmin:{rpc:mocks.rpc}}));
import {GET} from "./route";
import {leadFacetArguments} from "@/lib/lead-facet-data";
const scopedSession = {isOwner:false,allLocations:false,locationIds:["location-2","location-1"],roleIds:["role-1"],workforce:true,hr:false};
const request = (query="") => new Request(`https://recruit.dropxlogistics.com/api/recruitment/leads/facets?stream=workforce&menu=All+Leads${query}`);

beforeEach(()=>{vi.clearAllMocks();mocks.session.mockResolvedValue(scopedSession);mocks.permission.mockReturnValue(true);mocks.full.mockReturnValue(false);mocks.rpc.mockResolvedValue({data:[],error:null});});
describe("scoped lead facet endpoint",()=>{
  it("denies unauthenticated and inaccessible queues without querying data",async()=>{
    mocks.session.mockResolvedValueOnce(null);
    expect((await GET(request())).status).toBe(401);
    mocks.permission.mockReturnValue(false);
    expect((await GET(request())).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("denies invalid menus and workspaces",async()=>{
    expect((await GET(new Request("https://example.com?stream=workforce&menu=Roles"))).status).toBe(403);
    expect((await GET(new Request("https://example.com?stream=all&menu=All+Leads"))).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("uses server-derived location and designation permissions, never client scope",async()=>{
    const response = await GET(request("&locationIds=attacker&roleIds=attacker&allLocations=true&station=PMB&role=DA&status=new"));
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("recruitment_lead_facet_summary",{
      p_company_id:"company-1",p_stream:"workforce",p_location_ids:["location-1","location-2"],p_role_ids:["role-1"],p_filters:{menu:"All Leads"}
    });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it("preserves empty location scopes as deny-all and respects full-access escape hatch",()=>{
    const empty = {...scopedSession,locationIds:[],roleIds:[]};
    expect(leadFacetArguments(empty as any,new URL(request().url),"company-1","workforce").p_location_ids).toEqual([]);
    mocks.full.mockReturnValue(true);
    const args=leadFacetArguments(scopedSession as any,new URL(request().url),"company-1","workforce");
    expect(args.p_location_ids).toBeNull();expect(args.p_role_ids).toBeNull();
  });
  it("keeps queue restrictions, dates and search consistent with the table",()=>{
    const url=new URL("https://example.com?menu=Interviews&archive=archived&adIds=ad-1&interviewFrom=2026-11-07&interviewTo=2026-11-08&stale24=true&unmapped=true&search=%25SBPD_RC%25");
    expect(leadFacetArguments(scopedSession as any,url,"company-1","hr").p_filters).toEqual({menu:"Interviews",archive:"archived",adIds:"ad-1",interviewFrom:"2026-11-07T00:00:00.000+05:30",interviewTo:"2026-11-08T23:59:59.999+05:30",stale24:"true",unmapped:"true",search:"SBPD_RC"});
  });
  it("deduplicates concurrent identical scopes but never combines different scopes",async()=>{
    let finish:(value:any)=>void=()=>{};
    mocks.rpc.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    const first=GET(request());const second=GET(request());
    await vi.waitFor(()=>expect(mocks.rpc).toHaveBeenCalledTimes(1));
    mocks.session.mockResolvedValueOnce({...scopedSession,locationIds:["different"]});
    expect((await GET(request())).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    finish({data:[],error:null});await Promise.all([first,second]);
  });
  it("allows retry after a database failure without exposing internal errors",async()=>{
    const log=vi.spyOn(console,"error").mockImplementation(()=>{});
    mocks.rpc.mockResolvedValueOnce({data:null,error:{message:"private database detail"}});
    const response=await GET(request());expect(response.status).toBe(500);
    expect(await response.json()).toEqual({error:"Unable to update filter choices."});
    expect((await GET(request())).status).toBe(200);
    log.mockRestore();
  });
});
