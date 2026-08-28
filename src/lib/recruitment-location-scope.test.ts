import { describe, expect, it } from "vitest";
import { calculateEffectiveRecruitmentLocationScope } from "./recruitment-location-scope";

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
