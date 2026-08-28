import { supabaseAdmin } from "./supabase-admin";

type CapacityRule = {
  stationCode: string;
  targetSpr: number;
  bufferPercent: number;
  recentDays: number;
  isActive?: boolean;
};

type CapacityDay = {
  station_code: string;
  work_date: string;
  active_ids: number | string | null;
  delivered: number | string | null;
};

type RateCardLine = {
  metric_code: string;
  rate: number | string;
  unit: string | null;
};

type RateCard = {
  id: string;
  station_id: string;
  name: string;
  pay_type: string | null;
  effective_from: string;
  effective_to: string | null;
  rate_card_lines?: RateCardLine[] | null;
};

export type CapacityDemandRow = {
  stationCode: string;
  stationName: string;
  dataDate: string;
  workload: number;
  currentHeadcount: number;
  requiredHeadcount: number;
  modelledGap: number;
  gap: number;
  targetSpr: number;
  bufferPercent: number;
  rateCards: Array<{
    id: string;
    name: string;
    payType: string | null;
    lines: Array<{ metricCode: string; rate: number; unit: string | null }>;
  }>;
};

function numberValue(value: unknown) {
  const parsed = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseRule(row: { description: string | null }) {
  try {
    const rule = JSON.parse(row.description ?? "{}") as CapacityRule;
    const stationCode = String(rule.stationCode ?? "").trim().toUpperCase();
    const targetSpr = numberValue(rule.targetSpr);
    if (!stationCode || !targetSpr || rule.isActive === false) return null;
    return {
      stationCode,
      targetSpr,
      bufferPercent: Math.max(0, numberValue(rule.bufferPercent)),
      recentDays: Math.max(14, numberValue(rule.recentDays) || 14)
    } satisfies CapacityRule;
  } catch {
    return null;
  }
}

function dateShift(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function trimmedAverage(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const trimmed = sorted.length >= 7 ? sorted.slice(1, -1) : sorted;
  return trimmed.reduce((sum, value) => sum + value, 0) / trimmed.length;
}

export function stableCapacityGap(input: {
  days: Array<{ activeIds: number; workload: number }>;
  targetSpr: number;
  bufferPercent: number;
}) {
  const operational = input.days.filter((day) => day.activeIds > 0 && day.workload > 0);
  if (!operational.length || !input.targetSpr) {
    return { workload: 0, currentHeadcount: 0, requiredHeadcount: 0, modelledGap: 0, gap: 0 };
  }
  const workload = trimmedAverage(operational.map((day) => day.workload));
  const regularCapacity = median(operational.map((day) => day.activeIds));
  const requiredHeadcount = Math.ceil(workload / input.targetSpr * (1 + input.bufferPercent / 100));
  const modelledGap = requiredHeadcount - regularCapacity;
  return {
    workload: Math.round(workload),
    currentHeadcount: Math.round(regularCapacity),
    requiredHeadcount,
    modelledGap,
    gap: Math.max(0, Math.ceil(modelledGap))
  };
}

function chunks<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

export async function loadCapacityDemand(options: {
  companyId: string;
  date: string;
  locations: Array<{ code: string; name: string }>;
  includeBalanced?: boolean;
}) {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  const locations = options.locations
    .map((location) => ({
      code: String(location.code ?? "").trim().toUpperCase(),
      name: String(location.name ?? "").trim()
    }))
    .filter((location) => location.code);
  const stationCodes = [...new Set(locations.map((location) => location.code))];
  if (!stationCodes.length) {
    return { rows: [] as CapacityDemandRow[], unconfiguredStations: 0 };
  }

  const from = dateShift(options.date, -13);
  const [ruleResult, stationResult, capacityResults, workloadResults] = await Promise.all([
    supabaseAdmin
      .from("report_import_master")
      .select("description")
      .eq("company_id", options.companyId)
      .eq("parser_type", "capacity_master")
      .eq("is_active", true),
    supabaseAdmin
      .from("stations")
      .select("id,station_code,station_name")
      .eq("company_id", options.companyId)
      .in("station_code", stationCodes)
      .eq("is_active", true),
    Promise.all(chunks(stationCodes, 6).map((codes) =>
      supabaseAdmin!.rpc("capacity_station_daily", {
        p_company_id: options.companyId,
        p_station_codes: codes,
        p_from: from,
        p_to: options.date
      })
    )),
    Promise.all(chunks(stationCodes, 100).map((codes) =>
      supabaseAdmin!.from("cps_station_daily")
        .select("station_code,work_date,total_delivery,c_return")
        .eq("company_id", options.companyId)
        .in("station_code", codes)
        .gte("work_date", from)
        .lte("work_date", options.date)
    ))
  ]);

  if (ruleResult.error) throw new Error(ruleResult.error.message);
  if (stationResult.error) throw new Error(stationResult.error.message);
  const capacityFailure = capacityResults.find((result) => result.error);
  if (capacityFailure?.error) throw new Error(capacityFailure.error.message);
  const workloadFailure = workloadResults.find((result) => result.error);
  if (workloadFailure?.error) throw new Error(workloadFailure.error.message);

  const rules = new Map(
    (ruleResult.data ?? [])
      .map(parseRule)
      .filter((rule): rule is CapacityRule => Boolean(rule))
      .map((rule) => [rule.stationCode, rule])
  );
  const stationByCode = new Map(
    (stationResult.data ?? []).map((station) => [
      String(station.station_code ?? "").trim().toUpperCase(),
      station
    ])
  );
  const locationNameByCode = new Map(locations.map((location) => [location.code, location.name]));
  const workloadByStationDay = new Map<string, number>();
  workloadResults.flatMap((result) => result.data ?? []).forEach((row) => {
    workloadByStationDay.set(
      `${String(row.station_code ?? "").trim().toUpperCase()}|${row.work_date}`,
      numberValue(row.total_delivery) + numberValue(row.c_return)
    );
  });

  const daysByStation = new Map<string, CapacityDay[]>();
  capacityResults.flatMap((result) => (result.data ?? []) as CapacityDay[]).forEach((row) => {
    const stationCode = String(row.station_code ?? "").trim().toUpperCase();
    const current = daysByStation.get(stationCode) ?? [];
    current.push(row);
    daysByStation.set(stationCode, current);
  });

  const gapBase = stationCodes.flatMap((stationCode) => {
    const rule = rules.get(stationCode);
    const days = (daysByStation.get(stationCode) ?? []).sort((left, right) => left.work_date.localeCompare(right.work_date));
    if (!rule || !days.length) return [];
    const recentDays = days.slice(-Math.max(14, rule.recentDays || 14));
    const position = stableCapacityGap({
      days: recentDays.map((day) => ({
        activeIds: numberValue(day.active_ids),
        workload: workloadByStationDay.get(`${stationCode}|${day.work_date}`) ?? numberValue(day.delivered)
      })),
      targetSpr: rule.targetSpr,
      bufferPercent: rule.bufferPercent
    });
    if (!options.includeBalanced && position.modelledGap <= 0) return [];
    const station = stationByCode.get(stationCode);
    const latestDay = recentDays.at(-1);
    return [{
      stationId: station?.id ?? null,
      stationCode,
      stationName: station?.station_name || locationNameByCode.get(stationCode) || stationCode,
      dataDate: latestDay?.work_date || options.date,
      workload: position.workload,
      currentHeadcount: position.currentHeadcount,
      requiredHeadcount: position.requiredHeadcount,
      modelledGap: position.modelledGap,
      gap: position.gap,
      targetSpr: rule.targetSpr,
      bufferPercent: rule.bufferPercent
    }];
  });

  const stationIds = gapBase.map((row) => row.stationId).filter((id): id is string => Boolean(id));
  const rateResult = stationIds.length
    ? await supabaseAdmin
      .from("rate_cards")
      .select("id,station_id,name,pay_type,effective_from,effective_to,rate_card_lines(metric_code,rate,unit)")
      .in("station_id", stationIds)
      .in("status", ["active", "approved"])
      .lte("effective_from", options.date)
      .order("effective_from", { ascending: false })
    : { data: [] as RateCard[], error: null };
  if (rateResult.error) throw new Error(rateResult.error.message);

  const rateCardsByStation = new Map<string, CapacityDemandRow["rateCards"]>();
  ((rateResult.data ?? []) as unknown as RateCard[])
    .filter((card) => !card.effective_to || card.effective_to >= options.date)
    .forEach((card) => {
      const cards = rateCardsByStation.get(card.station_id) ?? [];
      cards.push({
        id: card.id,
        name: card.name,
        payType: card.pay_type,
        lines: (card.rate_card_lines ?? []).map((line) => ({
          metricCode: line.metric_code,
          rate: numberValue(line.rate),
          unit: line.unit
        }))
      });
      rateCardsByStation.set(card.station_id, cards);
    });

  const rows: CapacityDemandRow[] = gapBase
    .map((row) => ({
      stationCode: row.stationCode,
      stationName: row.stationName,
      dataDate: row.dataDate,
      workload: row.workload,
      currentHeadcount: row.currentHeadcount,
      requiredHeadcount: row.requiredHeadcount,
      modelledGap: row.modelledGap,
      gap: row.gap,
      targetSpr: row.targetSpr,
      bufferPercent: row.bufferPercent,
      rateCards: row.stationId ? rateCardsByStation.get(row.stationId) ?? [] : []
    }))
    .sort((left, right) => right.gap - left.gap || left.stationCode.localeCompare(right.stationCode));

  return {
    rows,
    unconfiguredStations: stationCodes.filter((stationCode) => !rules.has(stationCode)).length
  };
}
