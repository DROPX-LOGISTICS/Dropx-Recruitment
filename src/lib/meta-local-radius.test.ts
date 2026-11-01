import { afterEach, describe, expect, it, vi } from "vitest";
import { assertMetaCampaignCompatibility, matchesMetaCampaignCategory } from "./meta-campaign-category";
import { buildEmploymentCampaignValues, publishMetaRecruitmentAd, sameMetaPublishDraft, validateMetaRecruitmentAdSet } from "./meta-ad-builder";
vi.mock("./connection-config", () => ({ getConnectionConfig: async () => ({ isEnabled: true,
  publicConfig: { ad_account_id: "123", page_id: "456" }, secrets: { access_token: "test-token" } }) }));
vi.mock("./meta-graph-throttle", () => ({ withMetaObjectEditGate: (_id: string, run: () => unknown) => run() }));

const draft = {
  campaignMode: "new" as const, campaignCategory: "STANDARD_INDIA" as const, campaignName: "Local recruitment",
  formId: "form-123", dailyBudget: 150, daysRequired: 4, adName: "KOZA_DCD_20261101",
  adSetName: "KOZA_DCD_Local_3KM", creativeName: "KOZA_DCD_Creative", primaryText: "Join DropX",
  headline: "Delivery role", posterUrl: "https://example.com/poster.png", destinationUrl: "https://recruit.dropxlogistics.com",
  callToAction: "APPLY_NOW" as const,
  audience: { locationId: "loc-1", stationCode: "KOZA", stationName: "Kozhikode", address: null,
    latitude: 11.265875, longitude: 75.825172, radiusKm: 3, source: "station_contacts" as const }
};

function mockMeta(options: { reject?: boolean; widen?: boolean; country?: string; categories?: string[] } = {}) {
  const writes: Array<{ path: string; values: Record<string, string> }> = [];
  let adSet: Record<string, string> = {};
  vi.stubGlobal("fetch", vi.fn(async (url: URL | string, init?: RequestInit) => {
    const parsed = new URL(String(url));
    const path = parsed.pathname.split("/").slice(2).join("/");
    let result: unknown;
    if (init?.method === "POST") {
      const values = Object.fromEntries(new URLSearchParams(String(init.body)));
      writes.push({ path, values });
      if (path === "act_123/campaigns") result = { id: "1001" };
      else if (path === "1001") result = { success: true };
      else if (path === "act_123/adsets") {
        if (values.execution_options) {
          if (options.reject) return Response.json({ error: { message: "Special Ad Category errors: audience location", code: 100 } }, { status: 400 });
          result = { success: true };
        } else { adSet = values; result = { id: "1002" }; }
      } else if (path === "act_123/adcreatives") result = { id: "1003" };
      else if (path === "act_123/ads") result = { id: "1004" };
      else throw new Error(`Unexpected write ${path}`);
    } else if (path === "act_123") result = { business_country_code: options.country ?? "IN" };
    else if (path === "1001") result = { id: "1001", objective: "OUTCOME_LEADS", special_ad_categories: options.categories ?? [] };
    else if (path === "1002") {
      const targeting = JSON.parse(adSet.targeting);
      if (options.widen) targeting.geo_locations.custom_locations[0].radius = 17;
      result = { ...adSet, targeting };
    } else if (path === "1004") result = { id: "1004", adset_id: "1002", name: draft.adName };
    else throw new Error(`Unexpected read ${path}`);
    return Response.json(result);
  }));
  return writes;
}

afterEach(() => vi.unstubAllGlobals());

describe("Local India recruitment publishing", () => {
  it.each([3, 5, 10, 80])("validates %s km with Meta and preserves the exact pin, form and budget", async (radiusKm) => {
    const writes = mockMeta();
    const result = await publishMetaRecruitmentAd({ draft: { ...draft, audience: { ...draft.audience, radiusKm } } });
    expect(result.progress.adId).toBe("1004");
    const requests = writes.filter((w) => w.path === "act_123/adsets");
    expect(requests).toHaveLength(2);
    expect(JSON.parse(requests[0].values.execution_options)).toEqual(["validate_only"]);
    const { execution_options, ...validated } = requests[0].values;
    expect(requests[1].values).toEqual(validated);
    expect(JSON.parse(validated.targeting).geo_locations.custom_locations).toEqual([
      { latitude: draft.audience.latitude, longitude: draft.audience.longitude, radius: radiusKm, distance_unit: "kilometer" }
    ]);
    expect(validated.daily_budget).toBe("15000");
    expect(writes.every((w) => w.values.status !== "ACTIVE")).toBe(true);
    const creative = writes.find((w) => w.path.endsWith("/adcreatives"))!;
    expect(JSON.parse(creative.values.object_story_spec).link_data.call_to_action.value.lead_gen_form_id).toBe(draft.formId);
  });
  it("checks existing-campaign previews using only Meta validation requests", async () => {
    const writes = mockMeta();
    await expect(validateMetaRecruitmentAdSet({ ...draft, campaignMode: "existing", campaignId: "1001" })).resolves.toBe(true);
    expect(writes).toHaveLength(1);
    expect(writes[0].path).toBe("act_123/adsets");
    expect(JSON.parse(writes[0].values.execution_options)).toEqual(["validate_only"]);
  });
  it("does not create a campaign during a new-campaign preview", async () => {
    const writes = mockMeta();
    await expect(validateMetaRecruitmentAdSet(draft)).resolves.toBe(false);
    expect(writes).toHaveLength(0);
  });
  it("stops on Meta rejection without changing category or creating an ad", async () => {
    const writes = mockMeta({ reject: true });
    await expect(publishMetaRecruitmentAd({ draft })).rejects.toThrow("Special Ad Category");
    expect(writes.filter((w) => w.path.endsWith("/adsets"))).toHaveLength(1);
    expect(writes.some((w) => w.path.endsWith("/ads") || w.path.endsWith("/adcreatives"))).toBe(false);
  });
  it("blocks an unexpectedly widened radius before creative creation or activation", async () => {
    const writes = mockMeta({ widen: true });
    await expect(publishMetaRecruitmentAd({ draft })).rejects.toThrow("does not match");
    expect(writes.some((w) => w.path.endsWith("/adcreatives"))).toBe(false);
  });
  it.each(["US", "", "CA"])("rejects standard mode for account country %s before any writes", async (country) => {
    const writes = mockMeta({ country });
    await expect(publishMetaRecruitmentAd({ draft })).rejects.toThrow("Indian business country");
    expect(writes).toHaveLength(0);
  });
  it("rechecks a changed campaign category on retry", async () => {
    const writes = mockMeta({ categories: ["EMPLOYMENT"] });
    await expect(publishMetaRecruitmentAd({ draft, previousDraft: draft, progress: { campaignId: "1001" } })).rejects.toThrow("does not match");
    expect(writes).toHaveLength(0);
  });
  it("preserves legacy Employment drafts and distinguishes category in idempotency checks", () => {
    expect(buildEmploymentCampaignValues("Legacy").special_ad_categories).toBe('["EMPLOYMENT"]');
    expect(buildEmploymentCampaignValues("India", "STANDARD_INDIA").special_ad_categories).toBe('[]');
    expect(buildEmploymentCampaignValues("India", "STANDARD_INDIA")).not.toHaveProperty("special_ad_category_country");
    expect(sameMetaPublishDraft(draft, { ...draft, campaignCategory: "EMPLOYMENT" })).toBe(false);
  });
  it("rejects unrelated categories and incompatible small Employment radii", () => {
    expect(matchesMetaCampaignCategory(["HOUSING"], "STANDARD_INDIA")).toBe(false);
    expect(matchesMetaCampaignCategory(["EMPLOYMENT", "HOUSING"], "EMPLOYMENT")).toBe(false);
    expect(() => assertMetaCampaignCompatibility({ category: "EMPLOYMENT", accountCountry: "IN", radiusKm: 3 })).toThrow("Employment campaign range");
  });
});
