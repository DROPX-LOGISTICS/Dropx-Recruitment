import { supabaseAdmin } from "./supabase-admin";
import { WORKFORCE_PROFILE_TABLE } from "./workforce-register";

export const WORKFORCE_TRAINING_DAYS = 14;
export const WORKFORCE_COOLING_DAYS = 7;
export const WORKFORCE_STOPPED_DAYS = 14;

export type WorkforceLifecycleStage =
  | "scheduled"
  | "training"
  | "productive"
  | "cooling"
  | "attrition_risk"
  | "stopped";

export type WorkforceActivity = {
  lastActivityDate: string | null;
  activeDays7: number;
  activeDays30: number;
  deliveries7: number;
  deliveries30: number;
};

export type WorkforceAssociatePlanningRow = WorkforceActivity & {
  id: string;
  fullName: string;
  dropxId: string | null;
  biometricId: string | null;
  dateOfJoin: string;
  stationCode: string;
  stationName: string;
  onboardingStatus: string;
  isActive: boolean;
  createdBy: string | null;
  initiatedBy: string;
  stage: WorkforceLifecycleStage;
  daysSinceJoin: number;
  daysSinceActivity: number | null;
};

type FieldExecutiveRow = {
  id: string;
  full_name: string | null;
  dropx_id: string | null;
  biometric_id: string | null;
  date_of_join: string;
  location_id: string | null;
  onboarding_status: string | null;
  is_active: boolean | null;
  created_by: string | null;
  stations: { station_code?: string | null; station_name?: string | null } | Array<{ station_code?: string | null; station_name?: string | null }> | null;
};

type ProviderMappingRow = {
  field_executive_id: string;
  provider_member_id: string | null;
  status: string | null;
  effective_from: string | null;
  effective_to: string | null;
};

type AssociateDay = {
  station_code: string;
  work_date: string;
  associate_id: string;
  delivered: number | string | null;
};

function related<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function normalizedId(value: unknown) {
  return String(value ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dayDistance(from: string, to: string) {
  return Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function chunks<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

export function classifyWorkforceLifecycle(input: {
  reportingDate: string;
  dateOfJoin: string;
  isActive: boolean;
  onboardingStatus?: string | null;
  activity: WorkforceActivity;
  trainingDays?: number;
  coolingDays?: number;
  stoppedDays?: number;
}) {
  const trainingDays = input.trainingDays ?? WORKFORCE_TRAINING_DAYS;
  const coolingDays = input.coolingDays ?? WORKFORCE_COOLING_DAYS;
  const stoppedDays = input.stoppedDays ?? WORKFORCE_STOPPED_DAYS;
  const daysSinceJoin = dayDistance(input.dateOfJoin, input.reportingDate);
  const inactiveStatus = new Set(["inactive", "rejected", "returned", "archived", "closed", "cancelled"]);
  if (!input.isActive || inactiveStatus.has(String(input.onboardingStatus ?? "").toLowerCase())) {
    return { stage: "stopped" as const, daysSinceJoin, daysSinceActivity: input.activity.lastActivityDate ? dayDistance(input.activity.lastActivityDate, input.reportingDate) : null };
  }
  if (daysSinceJoin < 0) return { stage: "scheduled" as const, daysSinceJoin, daysSinceActivity: null };
  const daysSinceActivity = input.activity.lastActivityDate
    ? Math.max(0, dayDistance(input.activity.lastActivityDate, input.reportingDate))
    : null;
  if (daysSinceJoin <= trainingDays && input.activity.activeDays7 < 3) {
    return { stage: "training" as const, daysSinceJoin, daysSinceActivity };
  }
  if (daysSinceActivity == null) return { stage: "stopped" as const, daysSinceJoin, daysSinceActivity };
  if (daysSinceActivity <= 3) return { stage: "productive" as const, daysSinceJoin, daysSinceActivity };
  if (daysSinceActivity <= coolingDays) return { stage: "cooling" as const, daysSinceJoin, daysSinceActivity };
  if (daysSinceActivity <= stoppedDays) return { stage: "attrition_risk" as const, daysSinceJoin, daysSinceActivity };
  return { stage: "stopped" as const, daysSinceJoin, daysSinceActivity };
}

export function adjustedHiringNeed(capacityGap: number, trainingHeadcount: number) {
  return Math.max(0, Math.ceil(capacityGap) - Math.max(0, Math.floor(trainingHeadcount)));
}

export async function loadWorkforcePlanning(options: {
  companyId: string;
  reportingDate: string;
  stations: Array<{ id: string; code: string; name: string }>;
  visibleCreatorIds?: string[] | null;
}) {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  const stationIds = options.stations.map((station) => station.id).filter(Boolean);
  const stationCodes = options.stations.map((station) => station.code).filter(Boolean);
  if (!stationIds.length || !stationCodes.length) {
    return { associates: [] as WorkforceAssociatePlanningRow[], visibleAssociates: [] as WorkforceAssociatePlanningRow[], byStation: new Map<string, WorkforceAssociatePlanningRow[]>() };
  }

  const executivePages = await Promise.all(chunks(stationIds, 100).map((ids) =>
    supabaseAdmin!.from(WORKFORCE_PROFILE_TABLE)
      .select("id,full_name,dropx_id,biometric_id,date_of_join,location_id,onboarding_status,is_active,created_by,stations(station_code,station_name)")
      .eq("company_id", options.companyId)
      .in("location_id", ids)
      .lte("date_of_join", shiftDate(options.reportingDate, 31))
      .limit(5000)
  ));
  const executiveFailure = executivePages.find((result) => result.error);
  if (executiveFailure?.error) throw new Error(executiveFailure.error.message);
  const executives = executivePages.flatMap((result) => (result.data ?? []) as unknown as FieldExecutiveRow[]);
  const executiveIds = executives.map((item) => item.id);
  const creatorIds = [...new Set(executives.map((item) => item.created_by).filter((value): value is string => Boolean(value)))];

  const [mappingPages, activityPages, profilePages] = await Promise.all([
    Promise.all(chunks(executiveIds, 150).map((ids) => ids.length
      ? supabaseAdmin!.from("field_executive_provider_mappings")
        .select("field_executive_id,provider_member_id,status,effective_from,effective_to")
        .in("field_executive_id", ids)
      : Promise.resolve({ data: [] as ProviderMappingRow[], error: null }))),
    Promise.all(chunks(stationCodes, 20).map((codes) => supabaseAdmin!.rpc("capacity_associate_daily", {
      p_company_id: options.companyId,
      p_station_codes: codes,
      p_from: shiftDate(options.reportingDate, -29),
      p_to: options.reportingDate
    }))),
    Promise.all(chunks(creatorIds, 150).map((ids) => ids.length
      ? supabaseAdmin!.from("profiles").select("id,full_name,email").eq("company_id", options.companyId).in("id", ids)
      : Promise.resolve({ data: [] as Array<{ id: string; full_name: string | null; email: string | null }>, error: null })))
  ]);
  const failure = [...mappingPages, ...activityPages, ...profilePages].find((result) => result.error);
  if (failure?.error) throw new Error(failure.error.message);

  const mappings = mappingPages.flatMap((result) => (result.data ?? []) as ProviderMappingRow[]);
  const activityRows = activityPages.flatMap((result) => (result.data ?? []) as AssociateDay[]);
  const profiles = new Map(profilePages.flatMap((result) => result.data ?? []).map((profile) => [profile.id, profile]));
  const activityByIdentity = new Map<string, AssociateDay[]>();
  activityRows.forEach((row) => {
    const key = `${String(row.station_code ?? "").trim().toUpperCase()}|${normalizedId(row.associate_id)}`;
    const current = activityByIdentity.get(key) ?? [];
    current.push(row);
    activityByIdentity.set(key, current);
  });
  const mappingIdsByExecutive = new Map<string, string[]>();
  mappings.forEach((mapping) => {
    const current = mappingIdsByExecutive.get(mapping.field_executive_id) ?? [];
    const member = normalizedId(mapping.provider_member_id);
    if (member) current.push(member);
    mappingIdsByExecutive.set(mapping.field_executive_id, current);
  });
  const sevenDayStart = shiftDate(options.reportingDate, -6);

  const associates = executives.map((executive): WorkforceAssociatePlanningRow => {
    const station = related(executive.stations);
    const stationCode = String(station?.station_code ?? "").trim().toUpperCase();
    const candidateIds = new Set([
      ...(mappingIdsByExecutive.get(executive.id) ?? []),
      normalizedId(executive.dropx_id),
      normalizedId(executive.biometric_id)
    ].filter(Boolean));
    const rows = [...candidateIds].flatMap((identity) => activityByIdentity.get(`${stationCode}|${identity}`) ?? []);
    const uniqueRows = [...new Map(rows.map((row) => [`${row.work_date}|${row.associate_id}`, row])).values()];
    const activity: WorkforceActivity = {
      lastActivityDate: uniqueRows.map((row) => row.work_date).sort().at(-1) ?? null,
      activeDays7: new Set(uniqueRows.filter((row) => row.work_date >= sevenDayStart).map((row) => row.work_date)).size,
      activeDays30: new Set(uniqueRows.map((row) => row.work_date)).size,
      deliveries7: uniqueRows.filter((row) => row.work_date >= sevenDayStart).reduce((sum, row) => sum + numberValue(row.delivered), 0),
      deliveries30: uniqueRows.reduce((sum, row) => sum + numberValue(row.delivered), 0)
    };
    const lifecycle = classifyWorkforceLifecycle({
      reportingDate: options.reportingDate,
      dateOfJoin: executive.date_of_join,
      isActive: executive.is_active !== false,
      onboardingStatus: executive.onboarding_status,
      activity
    });
    const creator = executive.created_by ? profiles.get(executive.created_by) : null;
    return {
      id: executive.id,
      fullName: executive.full_name || "Unnamed associate",
      dropxId: executive.dropx_id,
      biometricId: executive.biometric_id,
      dateOfJoin: executive.date_of_join,
      stationCode,
      stationName: String(station?.station_name ?? stationCode),
      onboardingStatus: executive.onboarding_status || "pending",
      isActive: executive.is_active !== false,
      createdBy: executive.created_by,
      initiatedBy: creator?.full_name || creator?.email || "Recruitment user",
      ...activity,
      ...lifecycle
    };
  });

  const visible = options.visibleCreatorIds == null
    ? associates
    : associates.filter((associate) => associate.createdBy && options.visibleCreatorIds!.includes(associate.createdBy));
  const byStation = new Map<string, WorkforceAssociatePlanningRow[]>();
  associates.forEach((associate) => {
    const current = byStation.get(associate.stationCode) ?? [];
    current.push(associate);
    byStation.set(associate.stationCode, current);
  });
  return { associates, visibleAssociates: visible, byStation };
}
