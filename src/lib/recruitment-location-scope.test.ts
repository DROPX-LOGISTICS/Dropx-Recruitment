import { describe, expect, it } from "vitest";
import { calculateEffectiveRecruitmentLocationScope, isPeopleManagedRecruitmentScope } from "./recruitment-location-scope";

const mainStations = [
  { id: "main-kl-1", code: "CHM" },
  { id: "main-kl-2", code: "KGQE" },
  { id: "main-ap-1", code: "GNTF" }
];
const recruitmentLocations = [
  { id: "recruit-kl-1", code: "CHM" },
  { id: "recruit-kl-2", code: "KGQE" },
  { id: "recruit-ap-1", code: "GNTF" }
];

describe("calculateEffectiveRecruitmentLocationScope", () => {
  const peopleInput = {
    isMasterOwner: false,
    universalLocationAccessMode: "assigned_locations",
    universalStationIds: ["old-home-station"],
    recruitmentScopeMode: "custom" as const,
    selectedRecruitmentLocationIds: ["recruit-ap-1"],
    mainStations,
    recruitmentLocations,
    productMembership: {
      source_system: "designation_policy", designation_id: "clm",
      has_all_location_access: false, location_scope_ids: ["main-kl-1", "main-kl-2"]
    }
  };
  it("inherits People locations despite a stale Recruit custom assignment (Akshay regression)", () => {
    const scope = calculateEffectiveRecruitmentLocationScope(peopleInput);
    expect(scope.locationIds).toEqual(["recruit-kl-1", "recruit-kl-2"]);
    expect(scope.mode).toBe("inherit");
    expect(scope.allLocations).toBe(false);
  });
  it("keeps People-managed person overrides in sync (Govind regression)", () => {
    const scope = calculateEffectiveRecruitmentLocationScope({ ...peopleInput, productMembership: {
      ...peopleInput.productMembership, source_system: "person_override", location_scope_ids: ["main-kl-2"]
    } });
    expect(scope.locationIds).toEqual(["recruit-kl-2"]);
  });
  it("does not revive removed People locations or fall back to the role's global setting", () => {
    const scope = calculateEffectiveRecruitmentLocationScope({ ...peopleInput,
      universalLocationAccessMode: "all_locations",
      productMembership: { ...peopleInput.productMembership, location_scope_ids: [] }
    });
    expect(scope.locationIds).toEqual([]);
    expect(scope.allLocations).toBe(false);
  });
  it("honours a People all-location grant and ignores unknown station IDs", () => {
    expect(calculateEffectiveRecruitmentLocationScope({ ...peopleInput, productMembership: {
      ...peopleInput.productMembership, has_all_location_access: true
    } }).allLocations).toBe(true);
    expect(calculateEffectiveRecruitmentLocationScope({ ...peopleInput, productMembership: {
      ...peopleInput.productMembership, location_scope_ids: ["unknown"]
    } }).locationIds).toEqual([]);
  });
  it("retains custom subsets for non-People accounts and explicit product-owned overrides", () => {
    for (const source_system of ["manual", "product_owner", "product_admin", "location_identity"]) {
      const input = { ...peopleInput, universalStationIds: ["main-kl-1", "main-ap-1"],
        productMembership: { ...peopleInput.productMembership, source_system } };
      expect(isPeopleManagedRecruitmentScope(input.productMembership)).toBe(false);
      expect(calculateEffectiveRecruitmentLocationScope(input).locationIds).toEqual(["recruit-ap-1"]);
    }
    expect(isPeopleManagedRecruitmentScope({ source_system: "person_override" })).toBe(false);
  });
  it("maps inherited universal station IDs to Recruitment location IDs", () => {
    const scope = calculateEffectiveRecruitmentLocationScope({
      isMasterOwner: false,
      universalLocationAccessMode: "assigned_locations",
      universalStationIds: ["main-kl-1", "main-kl-2"],
      recruitmentScopeMode: "inherit",
      selectedRecruitmentLocationIds: [],
      mainStations,
      recruitmentLocations
    });

    expect(scope.allLocations).toBe(false);
    expect(scope.locationIds).toEqual(["recruit-kl-1", "recruit-kl-2"]);
    expect(scope.mode).toBe("inherit");
  });

  it("includes a newly projected Dashboard station and excludes a Recruit-only orphan", () => {
    const scope = calculateEffectiveRecruitmentLocationScope({
      isMasterOwner: false,
      universalLocationAccessMode: "assigned_locations",
      universalStationIds: ["main-kbwe"],
      recruitmentScopeMode: "inherit",
      selectedRecruitmentLocationIds: ["recruit-ersn"],
      mainStations: [...mainStations, { id: "main-kbwe", code: "KBWE" }],
      recruitmentLocations: [
        ...recruitmentLocations,
        { id: "recruit-kbwe", code: "KBWE" },
        { id: "recruit-ersn", code: "ERSN" }
      ]
    });

    expect(scope.locationIds).toEqual(["recruit-kbwe"]);
    expect(scope.locationIds).not.toContain("recruit-ersn");
  });

  it("clamps a stale all-stations Recruitment record to the live universal scope", () => {
    const scope = calculateEffectiveRecruitmentLocationScope({
      isMasterOwner: false,
      universalLocationAccessMode: "assigned_locations",
      universalStationIds: ["main-kl-1"],
      recruitmentScopeMode: "inherit",
      selectedRecruitmentLocationIds: ["recruit-ap-1"],
      mainStations,
      recruitmentLocations
    });

    expect(scope.allLocations).toBe(false);
    expect(scope.locationIds).toEqual(["recruit-kl-1"]);
    expect(scope.adjustedToUniversalScope).toBe(true);
  });

  it("allows a custom Recruitment subset but never expands beyond universal access", () => {
    const scope = calculateEffectiveRecruitmentLocationScope({
      isMasterOwner: false,
      universalLocationAccessMode: "assigned_locations",
      universalStationIds: ["main-kl-1", "main-kl-2"],
      recruitmentScopeMode: "custom",
      selectedRecruitmentLocationIds: ["recruit-kl-2", "recruit-ap-1"],
      mainStations,
      recruitmentLocations
    });

    expect(scope.allLocations).toBe(false);
    expect(scope.locationIds).toEqual(["recruit-kl-2"]);
    expect(scope.adjustedToUniversalScope).toBe(true);
  });

  it("lets an all-location universal user inherit all or choose a custom subset", () => {
    const inherited = calculateEffectiveRecruitmentLocationScope({
      isMasterOwner: false,
      universalLocationAccessMode: "all_locations",
      universalStationIds: [],
      recruitmentScopeMode: "inherit",
      selectedRecruitmentLocationIds: [],
      mainStations,
      recruitmentLocations
    });
    const custom = calculateEffectiveRecruitmentLocationScope({
      isMasterOwner: false,
      universalLocationAccessMode: "all_locations",
      universalStationIds: [],
      recruitmentScopeMode: "custom",
      selectedRecruitmentLocationIds: ["recruit-kl-1"],
      mainStations,
      recruitmentLocations
    });

    expect(inherited.allLocations).toBe(true);
    expect(inherited.locationIds).toEqual([]);
    expect(custom.allLocations).toBe(false);
    expect(custom.locationIds).toEqual(["recruit-kl-1"]);
  });
});
