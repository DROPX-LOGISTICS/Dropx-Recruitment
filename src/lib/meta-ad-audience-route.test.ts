import { beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ denied: false, preview: false, stream: "workforce", writes: [] as any[], prior: null as any, meta: vi.fn(), permissions: vi.fn() }));
vi.mock("./recruitment-api", () => ({
  recruitmentSession: async () => ({ profileId: "actor", email: "actor@example.test", readOnly: fixture.preview }),
  requiredEnv: () => "company", canAccessLead: () => !fixture.denied,
  canUseRecruitmentMenu: (...args: any[]) => { fixture.permissions(...args); return !fixture.denied; }
}));
vi.mock("./supabase-admin", () => ({ supabaseAdmin: { from: (table: string) => {
  const query: any = { select: () => query, eq: () => query, lt: () => query, order: () => query,
    limit: async () => ({ data: [], error: null }),
    maybeSingle: async () => ({ data: table === "recruitment_ads" ? { id: "ad", meta_ad_id: "123456", location_id: "station", role_id: "role", recruitment_roles: { stream: fixture.stream }, raw_payload: {} } : fixture.prior, error: null }),
    single: async () => ({ data: { id: "audit", raw_payload: {} }, error: null }),
    insert: (value: any) => { fixture.writes.push({ table, value }); return query; },
    update: (value: any) => { fixture.writes.push({ table, value }); return query; },
    then: (resolve: any) => resolve({ error: null }) };
  return query;
} } }));
vi.mock("./recruitment-ad-audience", () => ({ resolveRecruitmentAdAudience: async () => ({ latitude: 11, longitude: 75, stationCode: "ABC" }) }));
vi.mock("./meta-ad-builder", () => ({
  getMetaAudienceSnapshot: async () => ({ id: "123456", status: "ACTIVE", adset: { id: "set", status: "ACTIVE", ads: { data: [{ id: "123456" }] }, targeting: {} }, campaign: { id: "camp", status: "ACTIVE" } }),
  editMetaAdAudience: (...args: any[]) => fixture.meta(...args)
}));
import { GET, POST } from "../app/api/recruitment/ads/[id]/audience/route";
const params = { params: { id: "ad" } };
async function request(body: any = {}) {
  const get = await GET(new Request("https://test.example"), params);
  const { version } = await get!.json();
  return POST(new Request("https://test.example", { method: "POST", body: JSON.stringify({ action: "preview", center: "station", radiusKm: 5, expectedVersion: version, clientRequestId: "3a1aafc7-8623-43ec-922a-31455b29724f", ...body }) }), params);
}
beforeEach(() => { fixture.denied = false; fixture.preview = false; fixture.stream = "workforce"; fixture.writes = []; fixture.prior = null; fixture.permissions.mockClear(); fixture.meta.mockReset().mockResolvedValue({ after: { id: "123456", status: "ACTIVE", adset: { id: "set", targeting: {} }, campaign: { id: "camp" } } }); });
describe("audience editor API", () => {
  it.each(["workforce", "hr"])("uses scoped all-level ad permission in %s", async stream => {
    fixture.stream = stream;
    const response = await request(); expect(response?.status).toBe(200);
    expect(fixture.permissions).toHaveBeenCalledWith(expect.anything(), "Active Ads", "all", stream);
    expect(fixture.meta).toHaveBeenCalledWith(expect.objectContaining({ validateOnly: true, radiusKm: 5 }));
    expect(fixture.writes).toEqual([]);
  });
  it("blocks out-of-scope and read-only sessions before Meta edits", async () => {
    fixture.denied = true; expect((await request())?.status).toBe(403);
    fixture.denied = false; fixture.preview = true; expect((await request())?.status).toBe(403);
    expect(fixture.meta).not.toHaveBeenCalled(); expect(fixture.writes).toEqual([]);
  });
  it.each([{ genders: [1] }, { age_min: 25 }, { targeting: {} }, { latitude: 12 }])("rejects extra targeting fields %s", async extra => {
    expect((await request(extra))?.status).toBe(400); expect(fixture.meta).not.toHaveBeenCalled();
  });
  it("rejects a stale version without writing", async () => {
    expect((await request({ expectedVersion: "a".repeat(64) }))?.status).toBe(409); expect(fixture.meta).not.toHaveBeenCalled(); expect(fixture.writes).toEqual([]);
  });
  it("records a before/after audit and syncs Recruit after a verified apply", async () => {
    expect((await request({ action: "apply" }))?.status).toBe(200);
    expect(fixture.writes.some(row => row.table === "recruitment_ad_audience_changes" && row.value.status === "processing")).toBe(true);
    expect(fixture.writes.some(row => row.table === "recruitment_ads" && row.value.raw_payload.last_audience_change.radiusKm === 5)).toBe(true);
    expect(fixture.writes.at(-1).value.status).toBe("completed");
  });
  it("does not resubmit an already completed request", async () => {
    fixture.prior = { ad_id: "ad", status: "completed" };
    expect((await request({ action: "apply" }))?.status).toBe(200); expect(fixture.meta).not.toHaveBeenCalled(); expect(fixture.writes).toEqual([]);
  });
  it("records a failed apply without claiming success", async () => {
    fixture.meta.mockRejectedValue(new Error("Meta rejected this radius"));
    expect((await request({ action: "apply" }))?.status).toBe(502);
    expect(fixture.writes.at(-1).value.status).toBe("failed");
    expect(fixture.writes.some(row => row.table === "recruitment_ads")).toBe(false);
  });
});
