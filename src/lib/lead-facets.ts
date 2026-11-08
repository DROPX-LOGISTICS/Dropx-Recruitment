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

export type LeadFacetGroup = {
  locationCode: string | null;
  roleCode: string | null;
  status: string;
  finalStatus: string | null;
  age: number;
  count: number;
};
export const UPDATED_AGE_BITS: Record<string, number> = {never: 1, lt30: 2, gt60: 4, gt120: 8, gt24h: 16, gt2d: 32};
export type DependentFacetSelections = LeadFacetSelections & {statuses: string[]; finalStatuses: string[]; updatedAges: string[]};
export function facetSelections(params: URLSearchParams): DependentFacetSelections {
  const csv = (key: string) => (params.get(key) ?? "").split(",").map(value => value.trim()).filter(Boolean);
  return {stationCodes: csv("station"), clusters: csv("cluster"), roleCodes: csv("role"), statuses: csv("status"), finalStatuses: csv("finalStatus"), updatedAges: csv("updatedAge")};
}

/** Match the table's existing Updated selection semantics, including overlaps. */
function selectedAgeBit(values: string[]) {
  if (values.length === 1 && values[0] === "never") return 1;
  for (const code of ["lt30", "gt60", "gt120", "gt24h", "gt2d"]) if (values.includes(code)) return UPDATED_AGE_BITS[code];
  return 0;
}

/** Exclude only a filter's own selection so multi-select alternatives remain usable. */
export function buildDependentLeadFacets(groups: LeadFacetGroup[], selected: DependentFacetSelections, owners: Map<string, string | null>) {
  const maps = {locations: new Map<string, number>(), clusters: new Map<string, number>(), roles: new Map<string, number>(), statuses: new Map<string, number>(), finalStatuses: new Map<string, number>(), updatedAges: new Map<string, number>()};
  const statuses = selected.statuses.map(value => value === "__BLANK__" ? "new" : value);
  const ageBit = selectedAgeBit(selected.updatedAges);
  for (const row of groups) {
    const owner = row.locationCode ? owners.get(row.locationCode) ?? null : null;
    const match = {
      locations: matches(row.locationCode, selected.stationCodes),
      clusters: matches(owner, selected.clusters),
      roles: matches(row.roleCode, selected.roleCodes),
      statuses: matches(row.status, statuses),
      finalStatuses: matches(row.finalStatus, selected.finalStatuses),
      updatedAges: !ageBit || Boolean(row.age & ageBit)
    };
    const failed = Object.values(match).filter(value => !value).length;
    if (failed > 1) continue;
    const values = {locations: row.locationCode, clusters: owner, roles: row.roleCode, statuses: row.status, finalStatuses: row.finalStatus};
    for (const key of Object.keys(values) as Array<keyof typeof values>) {
      const value = values[key];
      if (value && (failed === 0 || !match[key])) maps[key].set(value, (maps[key].get(value) ?? 0) + row.count);
    }
    if (failed === 0 || !match.updatedAges) {
      for (const [code, bit] of Object.entries(UPDATED_AGE_BITS)) if (row.age & bit) maps.updatedAges.set(code, (maps.updatedAges.get(code) ?? 0) + row.count);
    }
  }
  const entries = (map: Map<string, number>) => [...map].map(([value, count]) => ({value, count})).sort((a,b) => a.value.localeCompare(b.value));
  return {locations: entries(maps.locations), clusters: entries(maps.clusters), roles: entries(maps.roles), statuses: entries(maps.statuses), finalStatuses: entries(maps.finalStatuses), updatedAges: entries(maps.updatedAges)};
}

/** Preserve a selected zero-result value so it can always be removed. */
export function dependentFilterOptions(catalog: Array<[string, string]>, counts: Array<{value: string; count: number}> | undefined, selected: string, normalize = (value: string) => value, includeObserved = false): Array<[string, string]> {
  const selectedValues = selected.split(",").filter(Boolean);
  const selectedSet = new Set(selectedValues);
  const totals = new Map((counts ?? []).map(item => [item.value, item.count]));
  const known = new Set(catalog.map(([code]) => code));
  // Historical station/role masters can be inactive while their leads remain
  // in the queue. Keep those observed codes discoverable as well.
  const additional = new Set([...selectedValues, ...(includeObserved ? [...totals.keys()] : [])]);
  const options: Array<[string, string]> = [...catalog, ...[...additional].filter(code => !known.has(code)).map(code => [code, code] as [string, string])];
  return options.filter(([code]) => selectedSet.has(code) || (totals.get(normalize(code)) ?? 0) > 0)
    .map(([code, label]) => [code, counts ? `${label} (${(totals.get(normalize(code)) ?? 0).toLocaleString("en-IN")})` : label]);
}
