import { describe, expect, it } from "vitest";
import { buildLeadFacets } from "./lead-facets";

const rows = [
  { locationCode: "JUGD", cluster: "Odisha", roleCode: "TL" },
  { locationCode: "SBPD", cluster: "Odisha", roleCode: "TL" },
  { locationCode: "KOZA", cluster: "Kerala", roleCode: "RC" },
  { locationCode: "ERSE", cluster: "Kerala", roleCode: "RC" }
];

describe("buildLeadFacets", () => {
  it("limits stations and clusters to the selected designation", () => {
    const facets = buildLeadFacets(rows, {
      stationCodes: [],
      clusters: [],
      roleCodes: ["TL"]
    });

    expect(facets.locations).toEqual([
      { value: "JUGD", count: 1 },
      { value: "SBPD", count: 1 }
    ]);
    expect(facets.clusters).toEqual([{ value: "Odisha", count: 2 }]);
  });

  it("limits designations to the selected station while keeping station choices cross-filtered", () => {
    const facets = buildLeadFacets(rows, {
      stationCodes: ["KOZA"],
      clusters: [],
      roleCodes: []
    });

    expect(facets.roles).toEqual([{ value: "RC", count: 1 }]);
    expect(facets.locations).toHaveLength(4);
  });
});
