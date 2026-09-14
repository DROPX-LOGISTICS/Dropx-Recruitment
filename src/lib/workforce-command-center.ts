export type AdPendencyRow = {
  adId?: string | null;
  adName?: string | null;
  adStatus?: string | null;
  station?: string | null;
  stationName?: string | null;
  designation?: string | null;
  designationName?: string | null;
  totalLeads?: number | null;
  pending?: number | null;
  noStatus?: number | null;
  noResponse?: number | null;
  callBack?: number | null;
  interviews?: number | null;
  joined?: number | null;
  stale24h?: number | null;
  lifetimeTotalLeads?: number | null;
  dailyBudget?: number | null;
  totalSpend?: number | null;
  createdOn?: string | null;
};

export type WorkforceCapacityRow = {
  stationCode?: string | null;
  stationName?: string | null;
  workload?: number | null;
  currentHeadcount?: number | null;
  requiredHeadcount?: number | null;
  capacityGap?: number | null;
  targetSpr?: number | null;
  bufferPercent?: number | null;
  trainingHeadcount?: number | null;
  scheduledHeadcount?: number | null;
  netHiringNeed?: number | null;
  attritionRiskHeadcount?: number | null;
};

export type WorkforceActionRow = {
  key: string;
  station: string;
  stationName: string;
  designation: string;
  designationName: string;
  adCount: number;
  adIds: string[];
  adNames: string[];
  totalLeads: number;
  pending: number;
  noStatus: number;
  noResponse: number;
  callBack: number;
  interviews: number;
  joined: number;
  stale24h: number;
  capacity: WorkforceCapacityRow | null;
};

const numberValue = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalized = (value: unknown, fallback: string) => String(value ?? "").trim() || fallback;

export function workforceAdStatusOptions(rows: AdPendencyRow[]) {
  const preferred = ["active", "paused", "completed", "closed", "archived", "inactive", "not_active"];
  const statuses = [...new Set(rows.map((row) => normalized(row.adStatus, "not_active").toLowerCase()))];
  return statuses.sort((left, right) => {
    const leftRank = preferred.indexOf(left);
    const rightRank = preferred.indexOf(right);
    return (leftRank < 0 ? preferred.length : leftRank) - (rightRank < 0 ? preferred.length : rightRank)
      || left.localeCompare(right);
  });
}

export function buildWorkforceActionRows(
  adRows: AdPendencyRow[],
  capacityRows: WorkforceCapacityRow[],
  selectedAdStatuses: string[]
): WorkforceActionRow[] {
  const selected = new Set(selectedAdStatuses.map((value) => value.trim().toLowerCase()).filter(Boolean));
  const capacityByStation = new Map(capacityRows.map((row) => [normalized(row.stationCode, "Unmapped").toUpperCase(), row]));
  const groups = new Map<string, WorkforceActionRow>();

  for (const row of adRows) {
    const adStatus = normalized(row.adStatus, "not_active").toLowerCase();
    if (selected.size && !selected.has(adStatus)) continue;
    const station = normalized(row.station, "Unmapped");
    const designation = normalized(row.designation, "Unmapped");
    const key = `${station.toUpperCase()}|${designation.toUpperCase()}`;
    const group = groups.get(key) ?? {
      key,
      station,
      stationName: normalized(row.stationName, station),
      designation,
      designationName: normalized(row.designationName, designation),
      adCount: 0,
      adIds: [],
      adNames: [],
      totalLeads: 0,
      pending: 0,
      noStatus: 0,
      noResponse: 0,
      callBack: 0,
      interviews: 0,
      joined: 0,
      stale24h: 0,
      capacity: capacityByStation.get(station.toUpperCase()) ?? null
    };
    group.adCount += 1;
    const adId = normalized(row.adId, "");
    if (adId && !group.adIds.includes(adId)) group.adIds.push(adId);
    const adName = normalized(row.adName, "Unnamed ad");
    if (!group.adNames.includes(adName)) group.adNames.push(adName);
    group.totalLeads += numberValue(row.totalLeads);
    group.pending += numberValue(row.pending);
    group.noStatus += numberValue(row.noStatus);
    group.noResponse += numberValue(row.noResponse);
    group.callBack += numberValue(row.callBack);
    group.interviews += numberValue(row.interviews);
    group.joined += numberValue(row.joined);
    group.stale24h += numberValue(row.stale24h);
    groups.set(key, group);
  }

  return [...groups.values()].sort((left, right) =>
    right.noStatus - left.noStatus
    || right.pending - left.pending
    || numberValue(right.capacity?.netHiringNeed) - numberValue(left.capacity?.netHiringNeed)
    || left.station.localeCompare(right.station)
    || left.designation.localeCompare(right.designation)
  );
}

export function noStatusSeverity(count: number, highestCount: number) {
  if (count <= 0) return "clear";
  const criticalFloor = Math.max(10, Math.ceil(highestCount * 0.5));
  if (count >= criticalFloor) return "critical";
  if (count >= 10) return "warning";
  return "normal";
}
