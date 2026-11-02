import { describe, expect, it, vi } from "vitest";
import { audienceVersion, changeMetaAudience, currentAudiencePin, plannedAudience, type AudienceSnapshot } from "./meta-ad-audience-edit";

const station = { latitude: 11.5, longitude: 75.8 };
function fixture(status = "ACTIVE") {
  const ad: AudienceSnapshot = { id: "ad", status, campaign: { id: "campaign", status: "ACTIVE", special_ad_categories: ["EMPLOYMENT"] },
    adset: { id: "set", status: "ACTIVE", ads: { data: [{ id: "ad" }] }, targeting: { age_min: 21, age_max: 40, genders: [1], publisher_platforms: ["facebook"], geo_locations: { custom_locations: [{ latitude: 11.6, longitude: 75.9, radius: 17, distance_unit: "kilometer" }] } } } };
  const read = vi.fn(async () => structuredClone(ad));
  const post = vi.fn(async (_id: string, values: Record<string, string>, check: () => Promise<void>) => {
    await check();
    if (!values.execution_options) ad.adset!.targeting = JSON.parse(values.targeting);
  });
  return { ad, input: { adId: "ad", expectedVersion: audienceVersion(ad, station), station, center: "current", radiusKm: 10, validateOnly: false, read, post, sleep: async () => {} } };
}

describe("existing Meta audience updates", () => {
  it.each(["ACTIVE", "PAUSED"])("changes only targeting and keeps %s delivery configuration", async status => {
    const f = fixture(status), before = structuredClone(f.ad);
    const result = await changeMetaAudience(f.input);
    expect(Object.keys(f.input.post.mock.calls[0][1])).toEqual(["targeting"]);
    expect(result.after).toEqual({ ...before, adset: { ...before.adset, targeting: {
      ...before.adset!.targeting, age_min: 18, age_max: 65, genders: [1, 2], geo_locations: {
        custom_locations: [{ latitude: 11.6, longitude: 75.9, radius: 10, distance_unit: "kilometer" }], location_types: ["home", "recent"]
      }
    } } });
  });
  it("sets a custom ad pin without changing the station default", async () => {
    const f = fixture(), originalStation = { ...station };
    const result = await changeMetaAudience({ ...f.input, center: "custom", customPin: { latitude: 11.259, longitude: 75.7914, label: "Calicut" } });
    expect(result.plan.point).toMatchObject({ latitude: 11.259, longitude: 75.7914 });
    expect(station).toEqual(originalStation);
    expect(result.after.adset!.targeting!.geo_locations.custom_locations[0]).toEqual({ latitude: 11.259, longitude: 75.7914, radius: 10, distance_unit: "kilometer" });
  });
  it.each([null, { latitude: "", longitude: 75 }, { latitude: 100, longitude: 75 }, { latitude: 11, longitude: "bad" }])("rejects an invalid custom pin before editing Meta", async customPin => {
    const f = fixture();
    await expect(changeMetaAudience({ ...f.input, center: "custom", customPin })).rejects.toThrow();
    expect(f.input.post).not.toHaveBeenCalled();
  });
  it("supports a validated preview without changing the live audience", async () => {
    const f = fixture(), before = structuredClone(f.ad);
    await changeMetaAudience({ ...f.input, validateOnly: true });
    expect(f.input.post.mock.calls[0][1].execution_options).toBe('["validate_only"]');
    expect(f.ad).toEqual(before);
  });
  it("replaces legacy ZIP areas and exclusions only on an explicit station-pin selection", () => {
    const f = fixture(); f.ad.adset!.targeting = { geo_locations: { zips: [{ key: "12345" }] }, excluded_geo_locations: { cities: [{ key: "1" }] } };
    expect(currentAudiencePin(f.ad.adset!.targeting)).toBeNull();
    expect(() => plannedAudience(f.ad, station, { center: "current", radiusKm: 10 })).toThrow("multiple areas");
    const next = plannedAudience(f.ad, station, { center: "station", radiusKm: 5 });
    expect(next.targeting.geo_locations.custom_locations[0]).toMatchObject({ ...station, radius: 5 });
    expect(next.targeting).not.toHaveProperty("excluded_geo_locations");
  });
  it.each([2, 0, 81, 10.5, "bad"])("rejects invalid radius %s without Meta edits", async radiusKm => {
    const f = fixture(); await expect(changeMetaAudience({ ...f.input, radiusKm: radiusKm as any })).rejects.toThrow("whole-number"); expect(f.input.post).not.toHaveBeenCalled();
  });
  it("blocks edits of a shared ad set", async () => {
    const f = fixture(); f.ad.adset!.ads!.data!.push({ id: "another" });
    await expect(changeMetaAudience(f.input)).rejects.toThrow("shared"); expect(f.input.post).not.toHaveBeenCalled();
  });
  it("fails closed when the linked ads cannot be read", async () => {
    const f = fixture(); delete f.ad.adset!.ads;
    await expect(changeMetaAudience(f.input)).rejects.toThrow("shared");
  });
  it("rejects stale targeting or a station pin changed since review", async () => {
    const f = fixture(); f.ad.adset!.targeting!.age_max = 55;
    await expect(changeMetaAudience(f.input)).rejects.toThrow("changed"); expect(f.input.post).not.toHaveBeenCalled();
    const g = fixture(); await expect(changeMetaAudience({ ...g.input, station: { ...station, latitude: 12 } })).rejects.toThrow("changed");
  });
  it("rechecks targeting after waiting for Meta's edit gate", async () => {
    const f = fixture(); const write = vi.fn();
    const post = async (_id: string, _values: Record<string, string>, check: () => Promise<void>) => { f.ad.adset!.targeting!.age_max = 50; await check(); write(); };
    await expect(changeMetaAudience({ ...f.input, post })).rejects.toThrow("changed"); expect(write).not.toHaveBeenCalled();
  });
  it("preserves Meta's validation error without changing campaign category", async () => {
    const f = fixture(); f.input.post.mockRejectedValue(new Error("Meta minimum is 17 km"));
    await expect(changeMetaAudience({ ...f.input, validateOnly: true })).rejects.toThrow("17 km");
    expect(f.ad.campaign!.special_ad_categories).toEqual(["EMPLOYMENT"]);
  });
  it("does not claim success when Meta has not confirmed the saved radius", async () => {
    const f = fixture(); const post = vi.fn(async () => {});
    await expect(changeMetaAudience({ ...f.input, post })).rejects.toThrow("not confirmed");
    expect(post).toHaveBeenCalledTimes(1);
  });
  it("normalizes mile pins and rejects invalid coordinates", () => {
    const f = fixture(); const pin = f.ad.adset!.targeting!.geo_locations.custom_locations[0];
    pin.distance_unit = "miles"; pin.radius = 10;
    expect(currentAudiencePin(f.ad.adset!.targeting)?.radiusKm).toBeCloseTo(16.09344);
    pin.latitude = null; expect(currentAudiencePin(f.ad.adset!.targeting)).toBeNull();
  });
});
