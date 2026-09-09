import { describe, expect, it } from "vitest";
import { assertMetaTargeting, assertReviewedAudience, coordinateDistanceKm } from "./meta-targeting";
const audience = { locationId: "klza", stationCode: "KLZA", latitude: 11.61979, longitude: 75.58657, radiusKm: 16 };
const targeting = { geo_locations: { custom_locations: [{ ...audience, distance_unit: "kilometer", radius: 16 }], location_types: ["home", "recent"] } };
describe("station pin verification", () => {
  it("accepts Meta's small coordinate rounding at the corrected KLZA pin", () => {
    const value = structuredClone(targeting);
    value.geo_locations.custom_locations[0].latitude = 11.619854;
    value.geo_locations.custom_locations[0].longitude = 75.586722;
    expect(() => assertMetaTargeting(value, audience)).not.toThrow();
    expect(coordinateDistanceKm(value.geo_locations.custom_locations[0], audience)).toBeLessThan(0.02);
  });
  it("blocks a different station even if the ad name says KLZA", () => {
    const value = structuredClone(targeting);
    value.geo_locations.custom_locations[0].latitude = 11.499292;
    expect(() => assertMetaTargeting(value, audience)).toThrow("has not been activated");
  });
  it("rejects missing pins, extra locations and a wider radius", () => {
    expect(() => assertMetaTargeting({}, audience)).toThrow();
    expect(() => assertMetaTargeting({ geo_locations: { ...targeting.geo_locations, countries: ["IN"] } }, audience)).toThrow();
    const value = structuredClone(targeting);
    value.geo_locations.custom_locations[0].radius = 18;
    expect(() => assertMetaTargeting(value, audience)).toThrow();
  });
  it("requires another review if master coordinates or radius changed", () => {
    expect(() => assertReviewedAudience(audience, audience)).not.toThrow();
    expect(() => assertReviewedAudience(audience, { ...audience, latitude: 11.5 })).toThrow("changed after review");
    expect(() => assertReviewedAudience(audience, { ...audience, radiusKm: 17 })).toThrow();
    expect(() => assertReviewedAudience(null, audience)).toThrow();
  });
});
