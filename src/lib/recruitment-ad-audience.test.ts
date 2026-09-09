import { beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ tables: [] as string[], code: "KLZA", stationId: "canonical-klza" as string | null }));
vi.mock("./supabase-admin", () => ({ supabaseAdmin: { from: (table: string) => {
  fixture.tables.push(table);
  const query: any = { select: () => query, eq: () => query, maybeSingle: async () => ({ error: null,
    data: table === "recruitment_locations" ? { id: "location-klza", station_id: fixture.stationId, code: "KLZA", name: "Old name" }
      : { id: "canonical-klza", station_code: fixture.code, station_name: "Vadakara", address: "Chorode", latitude: 11.61979, longitude: 75.58657 } }) };
  return query;
} } }));
import { resolveRecruitmentAdAudience } from "./recruitment-ad-audience";
beforeEach(() => { fixture.tables = []; fixture.code = "KLZA"; fixture.stationId = "canonical-klza"; });
describe("authoritative publishing location", () => {
  it("reads the canonical station instead of a separate contacts copy", async () => {
    const result = await resolveRecruitmentAdAudience({ companyId: "company", locationId: "location-klza", radiusKm: 16 });
    expect(result).toMatchObject({ stationName: "Vadakara", latitude: 11.61979, longitude: 75.58657, source: "location_master" });
    expect(fixture.tables).toEqual(["recruitment_locations", "stations"]);
  });
  it("fails closed on a missing canonical station link", async () => {
    fixture.stationId = null;
    await expect(resolveRecruitmentAdAudience({ companyId: "company", locationId: "location-klza" })).rejects.toThrow("not linked");
  });
  it("blocks a station-code mismatch instead of publishing to the other station", async () => {
    fixture.code = "KBWE";
    await expect(resolveRecruitmentAdAudience({ companyId: "company", locationId: "location-klza" })).rejects.toThrow("does not match");
  });
});
