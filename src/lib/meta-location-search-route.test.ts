import { beforeEach, describe, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ authenticated: true, preview: false, scope: true, direct: true, publisher: false, meta: vi.fn() }));
vi.mock("./recruitment-api", () => ({
  recruitmentSession: async () => f.authenticated ? { readOnly: f.preview, adRequestActions: f.publisher ? ["publish"] : [] } : null,
  canUseRecruitmentMenu: () => f.direct,
  canAccessLead: () => f.scope,
}));
vi.mock("./scoped-recruitment-ad", () => ({ scopedRecruitmentAd: async () => f.scope ? { session: { isPreview: f.preview } } : { error: new Response("Denied", { status: 403 }) } }));
vi.mock("./meta-ad-builder", () => ({ searchMetaAudienceLocations: (...args: any[]) => f.meta(...args) }));
import { GET } from "../app/api/recruitment/meta-location-search/route";
const request = async (query = "q=Calicut&stream=workforce&locationId=station&roleId=role") => {
  const response = await GET(new Request(`https://example.test?${query}`));
  if (!response) throw new Error("Location search did not return a response.");
  return response;
};
beforeEach(() => { f.authenticated = true; f.preview = false; f.scope = true; f.direct = true; f.publisher = false; f.meta.mockReset().mockResolvedValue([{ key: "123", label: "Calicut, Kerala", latitude: 11.259, longitude: 75.7914 }]); });
describe("scoped Meta location search", () => {
  it.each(["workforce", "hr"])("returns verified coordinates in %s", async stream => {
    const result = await request(`q=Calicut&stream=${stream}&locationId=station&roleId=role`);
    expect(result.status).toBe(200); expect((await result.json()).locations[0].latitude).toBe(11.259);
    expect(result.headers.get("cache-control")).toContain("no-store");
  });
  it("supports authorized request publishers", async () => { f.direct = false; f.publisher = true; expect((await request()).status).toBe(200); });
  it("supports an existing ad scoped by the shared ad permission check", async () => { expect((await request("q=Calicut&adId=ad")).status).toBe(200); });
  it("rejects anonymous, out-of-scope, preview and unprivileged searches", async () => {
    f.authenticated = false; expect((await request()).status).toBe(401);
    f.authenticated = true; f.scope = false; expect((await request()).status).toBe(403);
    f.scope = true; f.preview = true; expect((await request()).status).toBe(403);
    expect((await request("q=Calicut&adId=ad")).status).toBe(403);
    f.preview = false; f.direct = false; expect((await request()).status).toBe(403);
    expect(f.meta).not.toHaveBeenCalled();
  });
  it("rejects insufficient queries before Meta calls", async () => { expect((await request("q=ab")).status).toBe(400); expect(f.meta).not.toHaveBeenCalled(); });
  it("returns a recoverable failure instead of fabricated coordinates", async () => { f.meta.mockRejectedValue(new Error("Meta location search unavailable")); const response = await request(); expect(response.status).toBe(502); expect((await response.json()).error).toContain("unavailable"); });
});
