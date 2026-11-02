import { beforeEach, describe, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ session: null as any, allowed: true, scoped: true, writes: [] as any[], filters: [] as any[], prior: null as any, duplicate: false, meta: vi.fn(), publish: vi.fn(), ad: null as any }));
vi.mock("./recruitment-api", () => ({ recruitmentSession: async () => f.session, requiredEnv: () => "company", canAccessLead: () => f.scoped, canUseRecruitmentMenu: () => f.allowed }));
vi.mock("./supabase-admin", () => ({ supabaseAdmin: { from: (table: string) => {
  const q: any = { select: () => q, eq: (key: string, value: unknown) => { f.filters.push([table, key, value]); return q; }, in: () => q, order: () => q,
    limit: async () => ({ data: [], error: null }), maybeSingle: async () => ({ data: table === "recruitment_promotion_ads" ? f.ad : f.prior, error: null }),
    single: async () => ({ data: { id: "saved" }, error: f.duplicate ? { code: "23505" } : null }),
    insert: (value: any) => { f.writes.push({ table, value }); return q; }, update: (value: any) => { f.writes.push({ table, value }); return q; }, then: (resolve: any) => resolve({ error: null }) }; return q;
} } }));
vi.mock("./recruitment-ad-audience", () => ({ resolveRecruitmentAdAudience: async () => ({ latitude: 11.5, longitude: 75.8, stationCode: "CHM", stationName: "Chempanoda", address: null, locationId: "station", radiusKm: 10, source: "location_master" }) }));
vi.mock("./meta-promotion-ads", () => ({ validatePromotionCampaign: (...args: any[]) => f.meta(...args), publishPromotion: (...args: any[]) => f.publish(...args), getPromotionSnapshot: async () => f.ad.snapshot, updatePromotionAudience: (...args: any[]) => f.meta(...args), setPromotionDelivery: (...args: any[]) => f.meta(...args) }));
import { GET, POST } from "../app/api/recruitment/promotions/route";
import { GET as getAd, POST as edit } from "../app/api/recruitment/promotions/[id]/route";
import { promotionTargeting, validatePromotionDraft } from "./promotion-audience";
const draftInput = { purpose: "service_offer", campaignCategory: "STANDARD_INDIA", adName: "Parcel service", headline: "Delivery savings", primaryText: "Send a parcel", destinationUrl: "https://example.com/offers", dailyBudget: 150, daysRequired: 7, imageHash: "a".repeat(32), demographics: { ageMin: 25, ageMax: 55, gender: "all" } };
const key = "3a1aafc7-8623-43ec-922a-31455b29724f";
const req = (body: any, stream = "workforce") => new Request(`https://example.test/api?stream=${stream}`, { method: "POST", body: JSON.stringify({ stream, locationId: "station", action: "review", confirmPurpose: true, draft: draftInput, clientRequestId: key, ...body }) });
beforeEach(() => {
  f.session = { isOwner: false, roleIds: [], locationIds: ["station"], workforce: true, hr: true, email: "test@example.test" }; f.allowed = true; f.scoped = true; f.writes = []; f.filters = []; f.prior = null; f.duplicate = false;
  f.meta.mockReset().mockResolvedValue({}); f.publish.mockReset().mockResolvedValue({ progress: { adId: "123" }, snapshot: { status: "PAUSED" } });
  const draft = validatePromotionDraft(draftInput, { latitude: 11.5, longitude: 75.8, stationCode: "CHM", stationName: "Chempanoda", address: null, locationId: "station", radiusKm: 10, source: "location_master" });
  f.ad = { id: "ad", location_id: "station", meta_ad_id: "123", progress: { creativeId: "creative", adSetId: "set", campaignId: "campaign" }, draft,
    snapshot: { id: "123", status: "PAUSED", creative: { id: "creative" }, campaign: { id: "campaign", status: "PAUSED", objective: "OUTCOME_TRAFFIC", special_ad_categories: [] }, adset: { id: "set", status: "PAUSED", ads: { data: [{ id: "123" }] }, targeting: promotionTargeting(draft.audience, 10, draft.demographics) } } };
});
describe("promotion API permissions and idempotency", () => {
  it.each(["workforce", "hr"])("supports reviewed customer promotions in %s", async stream => {
    const response = await POST(req({}, stream)); expect(response.status).toBe(200); expect(f.writes).toEqual([]); expect(f.publish).not.toHaveBeenCalled();
    const { reviewVersion } = await response.json(); expect((await POST(req({ action: "create", reviewVersion }, stream))).status).toBe(200);
    expect(f.writes[0].value).toMatchObject({ stream, company_id: "company", status: "publishing" });
    expect(f.writes.every(w => w.table === "recruitment_promotion_ads")).toBe(true);
  });
  it.each(["readOnly", "isPreview"])("rejects %s sessions before reads or writes to Meta", async flag => {
    f.session[flag] = true; expect((await POST(req({}))).status).toBe(403); expect(f.meta).not.toHaveBeenCalled(); expect(f.writes).toEqual([]);
  });
  it("rejects missing sessions, insufficient menu access, roles and station scope", async () => {
    const session = f.session; f.session = null; expect((await GET(new Request("https://example.test?stream=workforce"))).status).toBe(401);
    f.session = session; f.allowed = false; expect((await POST(req({}))).status).toBe(403);
    f.allowed = true; f.session.roleIds = ["one-role"]; expect((await POST(req({}))).status).toBe(403);
    f.session.roleIds = []; f.scoped = false; expect((await POST(req({}))).status).toBe(403);
    expect(f.meta).not.toHaveBeenCalled(); expect(f.writes).toEqual([]);
  });
  it("limits reads to company, workspace and permitted locations", async () => {
    expect((await getAd(new Request("https://example.test?stream=hr"), { params: { id: "ad" } })).status).toBe(200);
    expect(f.filters).toContainEqual(["recruitment_promotion_ads", "company_id", "company"]); expect(f.filters).toContainEqual(["recruitment_promotion_ads", "stream", "hr"]);
    f.session.hr = false; expect((await getAd(new Request("https://example.test?stream=hr"), { params: { id: "ad" } })).status).toBe(403);
  });
  it("rejects a changed draft and duplicate create without submitting a Meta ad", async () => {
    const { reviewVersion } = await (await POST(req({}))).json();
    expect((await POST(req({ action: "create", reviewVersion, draft: { ...draftInput, dailyBudget: 500 } }))).status).toBe(409);
    f.duplicate = true; expect((await POST(req({ action: "create", reviewVersion }))).status).toBe(409); expect(f.publish).not.toHaveBeenCalled();
  });
  it("requires explicit launch confirmation and rejects stale edits", async () => {
    const { version } = await (await getAd(new Request("https://example.test?stream=workforce"), { params: { id: "ad" } })).json();
    expect((await edit(req({ action: "ACTIVE", version }), { params: { id: "ad" } })).status).toBe(400);
    expect((await edit(req({ action: "ACTIVE", version: "a".repeat(64), confirmLaunch: true }), { params: { id: "ad" } })).status).toBe(409);
    expect(f.writes).toEqual([]); expect(f.meta).not.toHaveBeenCalled();
  });
  it("rejects hiring copy even when the client confirms commercial purpose", async () => {
    expect((await POST(req({ draft: { ...draftInput, headline: "Wishmaster hiring" } }))).status).toBe(400); expect(f.meta).not.toHaveBeenCalled();
  });
});
