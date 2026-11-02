import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ read: vi.fn(), post: vi.fn() }));
vi.mock("./meta-ad-builder", async original => ({ ...(await original<any>()), metaPromotionGateway: async () => ({ accountId: "account", pageId: "page", ...state }) }));
import { publishPromotion, setPromotionDelivery, updatePromotionAudience } from "./meta-promotion-ads";
import { promotionEditVersion, promotionTargeting, validatePromotionDraft } from "./promotion-audience";
const point = { latitude: 11.5, longitude: 75.8 };
const draft = validatePromotionDraft({ purpose: "customer_offer", campaignCategory: "STANDARD_INDIA", adName: "Parcel offer", primaryText: "Book a local delivery", headline: "Delivery savings", destinationUrl: "https://example.com/offers", dailyBudget: 150, daysRequired: 7, imageHash: "a".repeat(32), demographics: { ageMin: 25, ageMax: 50, gender: "male" } }, { ...point, radiusKm: 10, stationCode: "CHM", stationName: "Chempanoda", address: null, locationId: "location", source: "location_master" });
let snapshot: any;
const record = { meta_ad_id: "123", draft, progress: { campaignId: "456", adSetId: "789", creativeId: "101" } };
beforeEach(() => {
  state.read.mockReset(); state.post.mockReset();
  snapshot = { id: "123", status: "PAUSED", creative: { id: "101" }, campaign: { id: "456", status: "PAUSED", objective: "OUTCOME_TRAFFIC", special_ad_categories: [] }, adset: { id: "789", status: "PAUSED", ads: { data: [{ id: "123" }] }, targeting: promotionTargeting(point, 10, draft.demographics) } };
  state.read.mockImplementation(async id => id === "123" ? structuredClone(snapshot) : id === "456" ? { adsets: { data: [{ id: "789" }] } } : { ...snapshot.adset, end_time: new Date(Date.now() + 86400000).toISOString(), daily_budget: "15000" });
  state.post.mockImplementation(async (_id, values, check) => { await check?.(); if (values.targeting && !values.execution_options) snapshot.adset.targeting = JSON.parse(values.targeting); if (_id === "123" && values.status) snapshot.status = values.status; return { success: true }; });
});
describe("promotion Meta writes", () => {
  it("validates and reads back an audience change without altering campaign classification", async () => {
    const after = await updatePromotionAudience({ record, expectedVersion: promotionEditVersion(snapshot), point, radiusKm: 5, demographics: { ...draft.demographics, gender: "female" }, validateOnly: false });
    expect(state.post).toHaveBeenCalledTimes(2); expect(state.post.mock.calls[0][1].execution_options).toBe('["validate_only"]');
    expect(after.adset?.targeting).toMatchObject({ genders: [2] }); expect(snapshot.campaign.special_ad_categories).toEqual([]);
  });
  it("review does not change the live target", async () => {
    await updatePromotionAudience({ record, expectedVersion: promotionEditVersion(snapshot), point, radiusKm: 5, demographics: draft.demographics, validateOnly: true });
    expect(snapshot.adset.targeting.geo_locations.custom_locations[0].radius).toBe(10);
  });
  it("checks freshness again after entering the Meta edit gate", async () => {
    state.post.mockImplementation(async (_id, _value, check) => { snapshot.creative.id = "changed"; await check(); });
    await expect(updatePromotionAudience({ record, expectedVersion: promotionEditVersion(snapshot), point, radiusKm: 5, demographics: draft.demographics, validateOnly: false })).rejects.toThrow(/changed/);
    expect(state.post).toHaveBeenCalledTimes(1);
  });
  it("cannot activate a campaign with another ad set", async () => {
    state.read.mockImplementation(async id => id === "123" ? snapshot : { adsets: { data: [{ id: "789" }, { id: "other" }] } });
    await expect(setPromotionDelivery(record, "ACTIVE", promotionEditVersion(snapshot))).rejects.toThrow(/other ad sets/);
    expect(state.post).not.toHaveBeenCalled();
  });
  it("pauses only the selected promotion", async () => {
    await setPromotionDelivery(record, "PAUSED", promotionEditVersion(snapshot));
    expect(state.post.mock.calls.map(c => c.slice(0, 2))).toEqual([["123", { status: "PAUSED" }]]);
  });
  it("keeps partially published objects paused when Meta rejects the audience", async () => {
    state.post.mockImplementation(async (path, values) => { if (path.endsWith("/campaigns")) return { id: "456" }; if (values.execution_options) throw new Error("Unsupported audience"); return {}; });
    const checkpoint = vi.fn(); await expect(publishPromotion(draft, checkpoint)).rejects.toThrow("Unsupported audience");
    expect(checkpoint).toHaveBeenCalledWith({ campaignId: "456" });
    expect(state.post.mock.calls.every(call => !call[1].status || call[1].status === "PAUSED")).toBe(true);
  });
});
