import { beforeEach, describe, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({
  session: null as any, allowed: true, rows: [] as any[], dbWrites: [] as any[], extend: vi.fn()
}));
vi.mock("./recruitment-api", () => ({
  recruitmentSession: async () => f.session,
  canAccessLead: () => f.allowed,
  requiredEnv: () => "company"
}));
vi.mock("./meta-ad-extension", async importOriginal => ({
  ...await importOriginal<typeof import("./meta-ad-extension")>(), extendMetaAd: f.extend
}));
vi.mock("./meta-ad-builder", () => ({ getMetaAdDeliverySnapshot: async () => ({ status:"ACTIVE", adset:{end_time:"2026-11-05T12:00:00Z"} }) }));
vi.mock("./supabase-admin", async () => {
  const { createClient } = await import("@supabase/supabase-js");
  return { supabaseAdmin: createClient("https://database.example.test", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input));
      const table = url.pathname.split("/").at(-1);
      const method = init?.method || "GET";
      const payload = init?.body ? JSON.parse(String(init.body)) : null;
      const ad = { id:"ad", meta_ad_id:"meta-ad", location_id:"station", role_id:"role", daily_budget:150, raw_payload:{}, recruitment_roles:{stream:"workforce"} };
      let row: any;
      if(method === "POST") { row={...payload,id:"request"}; f.rows.push(row); }
      else if(method === "PATCH") { f.dbWrites.push({table,payload}); row={...(f.rows[0]||{}),...payload}; if(table==="recruitment_ad_requests") f.rows[0]=row; }
      else row=table==="recruitment_ads"?ad:{...f.rows[0],recruitment_ads:ad,recruitment_roles:{stream:"workforce"}};
      return new Response(JSON.stringify(row), {status:200,headers:{"Content-Type":"application/json"}});
    } }
  }) };
});
import { POST, PATCH } from "../app/api/recruitment/ad-requests/route";
const call = (body = {}) => POST(new Request("https://recruit.example.test/api/recruitment/ad-requests", { method:"POST",body:JSON.stringify({requestType:"extend_ad",adId:"ad",daysRequired:7,oldBudget:150,expectedEndTime:"2099-11-02T14:07:00Z",...body}) }));
beforeEach(()=>{
  f.session={profileId:"admin",email:"admin@example.test",displayName:"Admin",isOwner:true,workforce:true,adRequestActions:["create","approve","publish","view_all"]};
  f.allowed=true; f.rows=[]; f.dbWrites=[];
  f.extend.mockReset().mockResolvedValue({before:{adset:{end_time:"2099-11-02T14:07:00Z"}},after:{id:"meta-ad",status:"ACTIVE",effective_status:"ACTIVE",adset:{end_time:"2099-11-09T14:07:00Z"}},endTime:"2099-11-09T14:07:00Z",dailyBudget:150});
});
describe("ad extension workflow",()=>{
  it("applies an authorized extension, saves the schedule and completed audit",async()=>{
    const res=await call({requestedBudget:999});
    expect(res.status).toBe(201);
    expect((await res.json()).appliedDirectly).toBe(true);
    expect(f.extend).toHaveBeenCalledWith(expect.objectContaining({adId:"meta-ad",days:7,expectedBudget:150,expectedEndTime:"2099-11-02T14:07:00Z"}));
    expect(f.rows[0]).toMatchObject({request_type:"extend_ad",requested_budget:null,status:"completed",location_id:"station"});
    expect(f.dbWrites.find(x=>x.table==="recruitment_ads").payload.raw_payload.last_extension).toMatchObject({days:7,endTime:"2099-11-09T14:07:00Z"});
  });
  it("queues scoped manager requests until an approver applies them",async()=>{
    f.session.isOwner=false; f.session.adRequestActions=["create","view_own"];
    const res=await call();
    expect(res.status).toBe(201); expect(f.rows[0].status).toBe("requested"); expect(f.extend).not.toHaveBeenCalled();
    f.session.adRequestActions=["approve","view_all"];
    const applied=await PATCH(new Request("https://recruit.example.test/api/recruitment/ad-requests",{method:"PATCH",body:JSON.stringify({id:"request",action:"publish"})}));
    expect(applied.status).toBe(200); expect(f.extend).toHaveBeenCalledOnce(); expect(f.rows[0].status).toBe("completed");
  });
  it.each(["anonymous","no create","outside scope"])("blocks %s before any write",async kind=>{
    if(kind==="anonymous") f.session=null;
    if(kind==="no create") f.session.adRequestActions=[];
    if(kind==="outside scope") f.allowed=false;
    expect((await call()).status).toBe(kind==="anonymous"?401:403);
    expect(f.rows).toHaveLength(0); expect(f.extend).not.toHaveBeenCalled();
  });
  it("rejects invalid durations before creating a request",async()=>{
    expect((await call({daysRequired:0})).status).toBe(400); expect(f.rows).toHaveLength(0);
  });
  it("does not mark an unconfirmed extension complete",async()=>{
    f.extend.mockRejectedValueOnce(new Error("Meta did not confirm the schedule"));
    const res=await call();
    expect(res.status).toBe(400); expect((await res.json()).error).toContain("did not confirm");
    expect(f.rows[0].status).toBe("cancelled");
  });
});
