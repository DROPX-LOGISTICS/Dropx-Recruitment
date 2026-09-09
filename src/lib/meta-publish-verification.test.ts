import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("./connection-config", () => ({ getConnectionConfig: async () => ({ isEnabled: true,
  publicConfig: { ad_account_id: "123", page_id: "456", graph_version: "v25.0" }, secrets: { access_token: "test-token" } }) }));
import { publishMetaRecruitmentAd, sameMetaPublishDraft, type MetaAdDraft } from "./meta-ad-builder";
const draft: MetaAdDraft = {
  campaignMode: "new", campaignName: "KLZA recruitment", formId: "789", dailyBudget: 100, daysRequired: 7,
  adName: "KLZA_DA_20260909", adSetName: "KLZA_DA_Local_16KM", creativeName: "KLZA creative",
  primaryText: "Join DropX", headline: "Delivery Associate", posterUrl: "https://example.com/poster.png",
  destinationUrl: "https://recruit.dropxlogistics.com", callToAction: "APPLY_NOW",
  audience: { locationId: "klza", stationCode: "KLZA", stationName: "Vadakara", address: null,
    latitude: 11.61979, longitude: 75.58657, radiusKm: 16, source: "location_master" }
};
afterEach(() => vi.unstubAllGlobals());
describe("publishing read-back verification", () => {
  function graph(pinLatitude = draft.audience.latitude) {
    const calls: { path: string; method: string; values: URLSearchParams }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: URL, init: RequestInit) => {
      const path = new URL(url).pathname;
      const method = init.method || "GET";
      calls.push({ path, method, values: new URLSearchParams(String(init.body || "")) });
      const now = Date.now();
      let data: unknown = { success: true };
      if (path.endsWith("/campaigns")) data = { id: "111" };
      if (path.endsWith("/adsets")) data = { id: "222" };
      if (path.endsWith("/adcreatives")) data = { id: "333" };
      if (path.endsWith("/ads")) data = { id: "444" };
      if (path.endsWith("/222") && method === "GET") data = { id: "222", campaign_id: "111", daily_budget: "10000",
        start_time: new Date(now).toISOString(), end_time: new Date(now + 7 * 86400000).toISOString(),
        targeting: { geo_locations: { custom_locations: [{ latitude: pinLatitude, longitude: 75.58657, radius: 16, distance_unit: "kilometer" }] } } };
      if (path.endsWith("/444") && method === "GET") data = { id: "444", adset_id: "222", name: draft.adName };
      return new Response(JSON.stringify(data), { status: 200 });
    }));
    return calls;
  }
  it("verifies the saved pin and ad-to-adset relationship", async () => {
    const calls = graph();
    const result = await publishMetaRecruitmentAd({ draft });
    expect(result.progress.adId).toBe("444");
    expect(calls.some((call) => call.path.endsWith("/222") && call.method === "GET")).toBe(true);
    expect(calls.at(-1)?.path).toBe("/v25.0/444");
    expect(calls.filter((call) => call.method === "POST").some((call) => call.values.get("status") === "ACTIVE")).toBe(false);
  });
  it("stops before creating an ad when Meta returns the wrong station pin", async () => {
    const calls = graph(11.499292);
    await expect(publishMetaRecruitmentAd({ draft })).rejects.toThrow("has not been activated");
    expect(calls.some((call) => call.path.endsWith("/ads"))).toBe(false);
  });
  it("rejects a retry for a different station before making any Meta requests", async () => {
    const calls = graph();
    await expect(publishMetaRecruitmentAd({ draft, progress: { campaignId: "111" },
      previousDraft: { ...draft, audience: { ...draft.audience, locationId: "kbwe" } } })).rejects.toThrow("different ad setup");
    expect(calls).toHaveLength(0);
  });
  it("allows an unchanged retry regardless of JSON key order", () => {
    const reordered = Object.fromEntries(Object.entries(draft).reverse()) as MetaAdDraft;
    expect(sameMetaPublishDraft(draft, reordered)).toBe(true);
    expect(sameMetaPublishDraft(draft, { ...draft, dailyBudget: 200 })).toBe(false);
  });
});
