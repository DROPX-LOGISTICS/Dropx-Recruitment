export type LeadFacetRow = {
  locationCode: string | null;
  cluster: string | null;
  roleCode: string | null;
};

export type LeadFacetSelections = {
  stationCodes: string[];
  clusters: string[];
  roleCodes: string[];
};

function matches(value: string | null, selected: string[]) {
  return !selected.length || Boolean(value && selected.includes(value));
}

function counts(values: Array<string | null>) {
  const result = new Map<string, number>();
  for (const value of values) {
    if (value) result.set(value, (result.get(value) ?? 0) + 1);
  }
  return [...result.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => a.value.localeCompare(b.value));
}

export function buildLeadFacets(rows: LeadFacetRow[], selected: LeadFacetSelections) {
  const locationRows = rows.filter((row) =>
    matches(row.cluster, selected.clusters) &&
    matches(row.roleCode, selected.roleCodes)
  );
  const clusterRows = rows.filter((row) =>
    matches(row.locationCode, selected.stationCodes) &&
    matches(row.roleCode, selected.roleCodes)
  );
  const roleRows = rows.filter((row) =>
    matches(row.locationCode, selected.stationCodes) &&
    matches(row.cluster, selected.clusters)
  );

  return {
    locations: counts(locationRows.map((row) => row.locationCode)),
    clusters: counts(clusterRows.map((row) => row.cluster)),
    roles: counts(roleRows.map((row) => row.roleCode))
  };
}
