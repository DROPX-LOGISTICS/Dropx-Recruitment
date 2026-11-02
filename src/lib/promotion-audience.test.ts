import { describe, expect, it } from "vitest";
import { assertPromotionSnapshot, assertPromotionTargeting, promotionDemographics, promotionEditVersion, promotionReviewVersion, promotionTargeting, validatePromotionDraft } from "./promotion-audience";
import { promotionAdSetValues, promotionCampaignValues } from "./meta-promotion-ads";
import { isCustomerPromotion } from "./promotion-sync";

const audience = { locationId: "station", stationCode: "CHM", stationName: "Chempanoda", address: null, latitude: 11.56, longitude: 75.8, radiusKm: 10, source: "location_master" as const };
const input = { purpose: "service_offer", campaignCategory: "STANDARD_INDIA", adName: "Local parcel service", headline: "Send a parcel", primaryText: "Book delivery for your business", destinationUrl: "https://dropxlogistics.com/services", imageHash: "a".repeat(32), dailyBudget: 150, daysRequired: 7, demographics: { ageMin: 25, ageMax: 55, gender: "female" } };
const draft = () => validatePromotionDraft(input, audience);
function fixture() {
  const record = { meta_ad_id: "123", draft: draft(), progress: { creativeId: "creative", adSetId: "set", campaignId: "campaign" } };
  const snapshot = { id: "123", status: "PAUSED", creative: { id: "creative" }, campaign: { id: "campaign", status: "PAUSED", objective: "OUTCOME_TRAFFIC", special_ad_categories: [] as string[] }, adset: { id: "set", status: "PAUSED", ads: { data: [{ id: "123" }] }, targeting: promotionTargeting(audience, 10, record.draft.demographics) } };
  return { record, snapshot };
}
describe("customer promotion purpose and targeting", () => {
  it("builds a paused website traffic campaign with an explicit adult audience", () => {
    const d = draft(), campaign = promotionCampaignValues(d), set = promotionAdSetValues(d, "campaign", new Date("2026-11-02T07:00:00Z"));
    expect(campaign).toMatchObject({ status: "PAUSED", objective: "OUTCOME_TRAFFIC", special_ad_categories: "[]" });
    expect(set).toMatchObject({ status: "PAUSED", destination_type: "WEBSITE", optimization_goal: "LINK_CLICKS", daily_budget: "15000", end_time: "2026-11-09T07:10:00.000Z" });
    expect(JSON.parse(set.targeting)).toMatchObject({ age_min: 25, age_max: 55, genders: [2], targeting_automation: { advantage_audience: 0 } });
    expect(set).not.toHaveProperty("promoted_object");
  });
  it.each(["Delivery Associate openings", "Wishmaster", "Join our team", "Housing offers", "Credit cards", "Admissions now"])("does not reclassify %s as a standard promotion", headline => {
    expect(() => validatePromotionDraft({ ...input, headline }, audience)).toThrow(/restricted campaign/);
  });
  it.each([{ formId: "123" }, { roleId: "role" }, { campaignMode: "existing", campaignId: "123" }, { campaignCategory: "EMPLOYMENT" }, { destinationUrl: "https://recruit.dropxlogistics.com" }])("blocks hiring form/campaign/destination reuse %j", extra => {
    expect(() => validatePromotionDraft({ ...input, ...extra }, audience)).toThrow();
  });
  it.each([{ ageMin: 17, ageMax: 30, gender: "all" }, { ageMin: 50, ageMax: 30, gender: "all" }, { ageMin: 20, ageMax: 66, gender: "all" }, { ageMin: 20.5, ageMax: 40, gender: "all" }, { ageMin: 20, ageMax: 40, gender: "bad" }])("rejects invalid demographics %j", value => expect(() => promotionDemographics(value)).toThrow());
  it.each(["all", "male", "female"])("supports %s for adult service campaigns", gender => {
    const value = promotionDemographics({ ageMin: 18, ageMax: 65, gender });
    const target = promotionTargeting(audience, 5, value);
    expect(() => assertPromotionTargeting(target, audience, 5, value)).not.toThrow();
  });
  it("detects Meta expanding the selected audience instead of claiming success", () => {
    const f = fixture(); f.snapshot.adset.targeting.genders = [1, 2];
    expect(() => assertPromotionTargeting(f.snapshot.adset.targeting, audience, 10, f.record.draft.demographics)).toThrow(/not confirmed/);
    f.snapshot.adset.targeting = promotionTargeting(audience, 10, f.record.draft.demographics);
    f.snapshot.adset.targeting.targeting_automation.advantage_audience = 1;
    expect(() => assertPromotionTargeting(f.snapshot.adset.targeting, audience, 10, f.record.draft.demographics)).toThrow(/not confirmed/);
  });
  it("invalidates review for demographic, pin and budget changes", () => {
    const d = draft(), hash = promotionReviewVersion(d);
    for (const next of [{ ...d, dailyBudget: 500 }, { ...d, demographics: { ...d.demographics, ageMax: 60 } }, { ...d, audience: { ...d.audience, longitude: 76 } }]) expect(promotionReviewVersion(next)).not.toBe(hash);
    const f = fixture(), version = promotionEditVersion(f.snapshot); f.snapshot.adset.targeting.age_max = 40; expect(promotionEditVersion(f.snapshot)).not.toBe(version);
  });
  it("blocks campaign reclassification, creative replacement and shared audiences", () => {
    const f = fixture(); expect(() => assertPromotionSnapshot(f.snapshot, f.record)).not.toThrow();
    f.snapshot.campaign.special_ad_categories = ["EMPLOYMENT"]; expect(() => assertPromotionSnapshot(f.snapshot, f.record)).toThrow(/Standard India/);
    f.snapshot.campaign.special_ad_categories = []; f.snapshot.creative.id = "changed"; expect(() => assertPromotionSnapshot(f.snapshot, f.record)).toThrow(/changed/);
    f.snapshot.creative.id = "creative"; f.snapshot.adset.ads.data.push({ id: "other" }); expect(() => assertPromotionSnapshot(f.snapshot, f.record)).toThrow(/shared/);
  });
  it("keeps promotions out of recruitment sync even before the last checkpoint", () => {
    expect(isCustomerPromotion({ id: "123", campaign: { name: "renamed" } }, [{ meta_ad_id: "123" }])).toBe(true);
    expect(isCustomerPromotion({ id: "123", campaign: { id: "456" } }, [{ progress: { campaignId: "456" } }])).toBe(true);
    expect(isCustomerPromotion({ id: "123", campaign: { name: "[DropX Promotion] Parcel service" } }, [])).toBe(true);
    expect(isCustomerPromotion({ id: "456", campaign: { name: "CHM_WM" } }, [{ meta_ad_id: "123" }])).toBe(false);
  });
});
