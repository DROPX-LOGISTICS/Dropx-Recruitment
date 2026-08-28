import { describe, expect, it } from "vitest";
import { assignedLocationAllowed, lockedFieldDutyLocation, normalizeFieldHotspots } from "./field-duty-location";

describe("field duty assigned-location controls", () => {
  it("allows only explicitly assigned locations when assignments exist", () => {
    const scope = { allLocations: true, locationIds: ["koza", "pmb"] };
    expect(assignedLocationAllowed(scope, "koza")).toBe(true);
    expect(assignedLocationAllowed(scope, "outside")).toBe(false);
  });

  it("keeps empty locations optional and honours true global scope", () => {
    expect(assignedLocationAllowed({ allLocations: false, locationIds: [] }, null)).toBe(true);
    expect(assignedLocationAllowed({ allLocations: true, locationIds: [] }, "anywhere")).toBe(true);
    expect(assignedLocationAllowed({ allLocations: false, locationIds: [] }, "anywhere")).toBe(false);
  });

  it("uses the server-locked IN station for every duty action", () => {
    expect(lockedFieldDutyLocation({
      primary_location_id: "tlp-location",
      primary_location_code: "TLP",
      primary_location_name: "Taliparamba"
    })).toEqual({
      locationId: "tlp-location",
      locationCode: "TLP",
      locationName: "Taliparamba"
    });
  });
});

describe("field duty hotspots", () => {
  it("keeps the supported compact categories and sanitizes unknown values", () => {
    expect(normalizeFieldHotspots([
      { name: "  Kozhikode College  ", type: "college" },
      { name: "Town square", type: "unexpected" },
      { name: "x", type: "other" }
    ])).toEqual([
      { name: "Kozhikode College", type: "college" },
      { name: "Town square", type: "other" }
    ]);
  });
});
