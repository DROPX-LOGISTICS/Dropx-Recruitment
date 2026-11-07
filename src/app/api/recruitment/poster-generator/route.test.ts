import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), allowed: vi.fn(), scope: vi.fn(), from: vi.fn(), generate: vi.fn(), media: vi.fn(), reference: vi.fn() }));
vi.mock("@/lib/recruitment-api", () => ({ recruitmentSession: mocks.session, canUseRecruitmentMenu: mocks.allowed, canAccessLead: mocks.scope, requiredEnv: () => "company-1" }));
vi.mock("@/lib/supabase-admin", () => ({ supabaseAdmin: { from: mocks.from } }));
vi.mock("@/lib/meta-ingestion", () => ({ getFreshMetaAdMedia: mocks.media }));
vi.mock("@/lib/recruitment-poster-ai", () => ({ generateRecruitmentPoster: mocks.generate, downloadPosterReference: mocks.reference, posterCredential: () => "private-server-only" }));
import { DROPX_BRAND } from "@/lib/recruitment-poster-brand";
import { GET, POST } from "./route";
const id = "12345678-1234-1234-1234-123456789012";
const body = { stream: "hr", locationId: id, roleId: id, language: "English", style: "clean", format: "story", phone: "85475 76282", email: "hr@dropxlogistics.com" };
const request = (extra = {}) => new Request("https://recruit.test/api/recruitment/poster-generator", { method: "POST", body: JSON.stringify({ ...body, ...extra }) });
function query(data: unknown) {
  const chain: any = {};
  for (const name of ["select", "eq", "order"]) chain[name] = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(async () => ({ data, error: null }));
  chain.limit = vi.fn(async () => ({ data, error: null }));
  return chain;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ profileId: "actor" }); mocks.allowed.mockReturnValue(true); mocks.scope.mockReturnValue(true);
  mocks.from.mockImplementation((table: string) => query(table === "recruitment_roles" ? { id, name: "Store Manager", stream: "hr" } : { id, name: "Gurgaon" }));
  mocks.generate.mockResolvedValue({ image: Buffer.from([1,2,3]), width: 1080, height: 1920 });
});
describe("poster generation authorization", () => {
  it("rejects unauthenticated users and users without ad access before spending AI credits", async () => {
    mocks.session.mockResolvedValue(null); expect((await POST(request())).status).toBe(401);
    mocks.session.mockResolvedValue({ profileId: "actor" }); mocks.allowed.mockReturnValue(false);
    expect((await POST(request())).status).toBe(403); expect(mocks.generate).not.toHaveBeenCalled(); expect(mocks.from).not.toHaveBeenCalled();
  });
  it("checks station and role scope and refuses a role from another workspace", async () => {
    mocks.scope.mockReturnValue(false); expect((await POST(request())).status).toBe(403);
    mocks.scope.mockReturnValue(true); mocks.from.mockImplementation(() => query({ id, name: "Role", stream: "workforce" }));
    expect((await POST(request())).status).toBe(400); expect(mocks.generate).not.toHaveBeenCalled();
  });
  it("does not send an inaccessible reference to an image provider", async () => {
    mocks.from.mockImplementation((table: string) => query(table === "recruitment_ads" ? null : { id, name: table, stream: "hr" }));
    expect((await POST(request({ referenceAdId: id }))).status).toBe(403);
    expect(mocks.media).not.toHaveBeenCalled(); expect(mocks.generate).not.toHaveBeenCalled();
  });
  it("uses authoritative role/location names and returns private binary media without publishing an ad", async () => {
    const response = await POST(request({ role: "untrusted override", location: "untrusted override", brand: "amazon_now" }));
    expect(response.status).toBe(200); expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.generate.mock.calls[0][1]).toEqual({ role: "Store Manager", location: "Gurgaon", brand: DROPX_BRAND });
    expect(mocks.generate.mock.calls[0][0].format).toBe("story");
  });
  it("filters the previous-design list to visible ads and never returns credentials", async () => {
    mocks.from.mockReturnValue(query([{ id, ad_name: "Visible poster", meta_ad_id: "12345", location_id: id, role_id: id, recruitment_roles: { stream: "hr" } }, { id: "hidden", ad_name: "Hidden", meta_ad_id: "34567", location_id: "outside", recruitment_roles: { stream: "hr" } }]));
    mocks.scope.mockImplementation((_session, ad) => ad.location_id !== "outside");
    const response = await GET(new Request("https://recruit.test/api/recruitment/poster-generator?stream=hr"));
    const result = await response.json(); expect(result.references).toHaveLength(1); expect(JSON.stringify(result)).not.toContain("private-server-only");
  });
});
