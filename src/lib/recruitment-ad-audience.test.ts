import { beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ tables: [] as string[], code: "KLZA", stationId: "canonical-klza" as string | null, adLatitude: 11.61979 as number | null, adLongitude: 75.58657 as number | null, stationLatitude: 28.419502 as number | null, stationLongitude: 77.09079 as number | null }));
vi.mock("./supabase-admin", () => ({ supabaseAdmin: { from: (table: string) => {
  fixture.tables.push(table);
  const query: any = { select: () => query, eq: () => query, maybeSingle: async () => ({ error: null,
    data: table === "recruitment_locations" ? { id: "location-klza", station_id: fixture.stationId, code: "KLZA", name: "Old name" }
      : table === "recruitment_location_contacts" ? { ad_latitude: fixture.adLatitude, ad_longitude: fixture.adLongitude }
      : { id: "canonical-klza", station_code: fixture.code, station_name: "Vadakara", latitude: fixture.stationLatitude, longitude: fixture.stationLongitude, address: "Station address" } }) };
  return query;
} } }));
import { resolveRecruitmentAdAudience } from "./recruitment-ad-audience";
beforeEach(() => { fixture.tables = []; fixture.code = "KLZA"; fixture.stationId = "canonical-klza"; fixture.adLatitude = 11.61979; fixture.adLongitude = 75.58657; fixture.stationLatitude = 28.419502; fixture.stationLongitude = 77.09079; });
describe("authoritative publishing location", () => {
  it("uses the Meta ad pin instead of the candidate-facing station pin", async () => {
    const result = await resolveRecruitmentAdAudience({ companyId: "company", locationId: "location-klza", radiusKm: 16 });
    expect(result).toMatchObject({ stationName: "Vadakara", latitude: 11.61979, longitude: 75.58657, source: "station_contacts" });
    expect(fixture.tables).toEqual(["recruitment_locations", "stations", "recruitment_location_contacts"]);
  });
  it("uses an ad-only override while retaining the canonical station identity", async () => {
    const result = await resolveRecruitmentAdAudience({ companyId: "company", locationId: "location-klza", radiusKm: 5, customPin: { latitude: 11.259, longitude: 75.7914, label: "Calicut" } });
    expect(result).toMatchObject({ stationName: "Vadakara", latitude: 11.259, longitude: 75.7914, radiusKm: 5, source: "ad_override" });
    expect(fixture.adLatitude).toBe(11.61979);
  });
  it("rejects a malformed override rather than silently using the station pin", async () => {
    await expect(resolveRecruitmentAdAudience({ companyId: "company", locationId: "location-klza", customPin: { latitude: "", longitude: 75 } })).rejects.toThrow("valid");
  });
  it("fails closed on a missing canonical station link", async () => {
    fixture.stationId = null;
    await expect(resolveRecruitmentAdAudience({ companyId: "company", locationId: "location-klza" })).rejects.toThrow("not linked");
  });
  it("blocks a station-code mismatch instead of publishing to the other station", async () => {
    fixture.code = "KBWE";
    await expect(resolveRecruitmentAdAudience({ companyId: "company", locationId: "location-klza" })).rejects.toThrow("does not match");
  });
  it("uses Location Master coordinates when the dedicated ad pin is unset (TFB7 regression)", async () => {
    fixture.adLatitude = null;
    fixture.adLongitude = null;
    const result = await resolveRecruitmentAdAudience({ companyId: "company", locationId: "location-klza", radiusKm: 10 });
    expect(result).toMatchObject({ latitude: 28.419502, longitude: 77.09079, radiusKm: 10, address: "Station address", source: "location_master" });
    expect(fixture.adLatitude).toBeNull();
  });
  it("allows a custom pin when neither source has coordinates", async () => {
    fixture.adLatitude = fixture.adLongitude = fixture.stationLatitude = fixture.stationLongitude = null;
    const result = await resolveRecruitmentAdAudience({ companyId: "company", locationId: "location-klza", radiusKm: 7, customPin: { latitude: 28.419502, longitude: 77.09079 } });
    expect(result).toMatchObject({ latitude: 28.419502, longitude: 77.09079, radiusKm: 7, source: "ad_override" });
  });
  it("requires a pin before publishing if both stored sources are missing", async () => {
    fixture.adLatitude = fixture.adLongitude = fixture.stationLatitude = fixture.stationLongitude = null;
    await expect(resolveRecruitmentAdAudience({ companyId: "company", locationId: "location-klza" })).rejects.toThrow("Choose an ad pin");
  });
  it("does not mix a partial saved ad pin with the Location Master", async () => {
    fixture.adLongitude = null;
    await expect(resolveRecruitmentAdAudience({ companyId: "company", locationId: "location-klza" })).rejects.toThrow("Choose an ad pin");
  });
  it.each([0, 100, NaN])("rejects invalid fallback coordinates: %s", async latitude => {
    fixture.adLatitude = fixture.adLongitude = null;
    fixture.stationLatitude = latitude;
    await expect(resolveRecruitmentAdAudience({ companyId: "company", locationId: "location-klza" })).rejects.toThrow("valid latitude");
  });
});
