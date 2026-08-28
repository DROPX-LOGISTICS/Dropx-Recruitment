export type RecruitmentLocationReference = {
  id: string;
  code: string | null;
};

export type EffectiveRecruitmentLocationScope = {
  mode: "inherit" | "custom";
  allLocations: boolean;
  locationIds: string[];
  universalAllLocations: boolean;
  universalLocationIds: string[];
  adjustedToUniversalScope: boolean;
};

function normalizedCode(value: unknown) {
  return String(value ?? "").trim().toUpperCase();
}

function uniqueValidIds(values: string[], validIds: Set<string>) {
  return [...new Set(values.map(String).filter((id) => validIds.has(id)))];
}

/**
 * The main DropX dashboard is always the location-access ceiling.
 *
 * `inherit` means "use the user's live universal scope", not "all company
 * stations". `custom` can only narrow that live universal scope. This keeps
 * Recruitment configurable without allowing a stale Recruitment row to
 * expand a user's access after their main-dashboard scope changes.
 */
export function calculateEffectiveRecruitmentLocationScope(input: {
  isMasterOwner: boolean;
  universalLocationAccessMode?: string | null;
  universalStationIds: string[];
  recruitmentScopeMode: "inherit" | "custom";
  selectedRecruitmentLocationIds: string[];
  mainStations: RecruitmentLocationReference[];
  recruitmentLocations: RecruitmentLocationReference[];
}): EffectiveRecruitmentLocationScope {
  const validRecruitmentIds = new Set(input.recruitmentLocations.map((location) => location.id));
  const selectedLocationIds = uniqueValidIds(
    input.selectedRecruitmentLocationIds,
    validRecruitmentIds
  );
  const universalAllLocations = input.isMasterOwner
    || input.universalLocationAccessMode === "all_locations";

  if (universalAllLocations) {
    if (input.recruitmentScopeMode === "inherit") {
      return {
        mode: "inherit",
        allLocations: true,
        locationIds: [],
        universalAllLocations: true,
        universalLocationIds: [],
        adjustedToUniversalScope: false
      };
    }
    return {
      mode: "custom",
      allLocations: false,
      locationIds: selectedLocationIds,
      universalAllLocations: true,
      universalLocationIds: [],
      adjustedToUniversalScope: false
    };
  }

  const universalStationIds = new Set(input.universalStationIds.map(String));
  const allowedCodes = new Set(
    input.mainStations
      .filter((station) => universalStationIds.has(station.id))
      .map((station) => normalizedCode(station.code))
      .filter(Boolean)
  );
  const universalLocationIds = input.recruitmentLocations
    .filter((location) => allowedCodes.has(normalizedCode(location.code)))
    .map((location) => location.id);
  const allowedRecruitmentIds = new Set(universalLocationIds);
  const effectiveLocationIds = input.recruitmentScopeMode === "inherit"
    ? universalLocationIds
    : selectedLocationIds.filter((id) => allowedRecruitmentIds.has(id));

  return {
    mode: input.recruitmentScopeMode,
    allLocations: false,
    locationIds: effectiveLocationIds,
    universalAllLocations: false,
    universalLocationIds,
    adjustedToUniversalScope: input.recruitmentScopeMode === "inherit"
      || effectiveLocationIds.length !== selectedLocationIds.length
  };
}
