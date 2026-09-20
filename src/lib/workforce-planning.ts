import { supabaseAdmin } from "./supabase-admin";
import { WORKFORCE_PROFILE_TABLE } from "./workforce-register";
import { belongsToPerson, joiningState, type JoiningStage, type JoiningPlan, type JoiningPerson, type JoiningMapping, type JoiningAttendance } from './workforce-joining';

export const WORKFORCE_COOLING_DAYS = 7;
export const WORKFORCE_STOPPED_DAYS = 14;

export type WorkforceLifecycleStage =
  | JoiningStage
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
  source_profile_type: string | null;
  source_profile_id: string | null;
  designation:string|null;
  designation_id:string|null;
  lifecycle_status: string | null;
  last_working_date: string | null;
  stations: { station_code?: string | null; station_name?: string | null } | Array<{ station_code?: string | null; station_name?: string | null }> | null;
};

type ProviderMappingRow = JoiningMapping;

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
  return String(value ?? "").trim().toUpperCase();
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
  joiningStage?: JoiningStage;
  coolingDays?: number;
  stoppedDays?: number;
}) {
  const coolingDays = input.coolingDays ?? WORKFORCE_COOLING_DAYS;
  const stoppedDays = input.stoppedDays ?? WORKFORCE_STOPPED_DAYS;
  const daysSinceJoin = dayDistance(input.dateOfJoin, input.reportingDate);
  const inactiveStatus = new Set(["inactive", "rejected", "archived", "closed", "cancelled"]);
  if (input.joiningStage && input.joiningStage !== 'active') return {stage:input.joiningStage,daysSinceJoin,daysSinceActivity:null};
  if (!input.joiningStage && !['active','approved'].includes(input.onboardingStatus ?? 'active')) return {stage:'applicant' as const,daysSinceJoin,daysSinceActivity:null};
  if ((!input.isActive && !input.joiningStage) || inactiveStatus.has(String(input.onboardingStatus ?? "").toLowerCase())) {
    return { stage: "stopped" as const, daysSinceJoin, daysSinceActivity: input.activity.lastActivityDate ? dayDistance(input.activity.lastActivityDate, input.reportingDate) : null };
  }
  if (daysSinceJoin < 0) return { stage: "scheduled" as const, daysSinceJoin, daysSinceActivity: null };
  const daysSinceActivity = input.activity.lastActivityDate
    ? Math.max(0, dayDistance(input.activity.lastActivityDate, input.reportingDate))
    : null;
  // Training is a verified Workforce joining stage, never a 14-day age heuristic.
  if (daysSinceActivity == null) return { stage: "stopped" as const, daysSinceJoin, daysSinceActivity };
  if (daysSinceActivity <= 3) return { stage: "productive" as const, daysSinceJoin, daysSinceActivity };
  if (daysSinceActivity <= coolingDays) return { stage: "cooling" as const, daysSinceJoin, daysSinceActivity };
  if (daysSinceActivity <= stoppedDays) return { stage: "attrition_risk" as const, daysSinceJoin, daysSinceActivity };
  return { stage: "stopped" as const, daysSinceJoin, daysSinceActivity };
}

export function adjustedHiringNeed(capacityGap: number, trainingHeadcount: number) {
  return Math.max(0, Math.ceil(capacityGap) - Math.max(0, Math.floor(trainingHeadcount)));
}

async function allRows(query:any):Promise<any[]> {
  const rows:any[]=[];
  for(let offset=0;offset<100000;offset+=500){const result=await query.range(offset,offset+499);if(result.error)throw new Error(result.error.message);rows.push(...result.data??[]);if((result.data?.length??0)<500)return rows;}
  throw new Error('Workforce planning history exceeds its safe limit. Narrow the station scope.');
}

export async function loadWorkforcePlanning(options: {
  companyId: string;
  reportingDate: string;
  stations: Array<{ id: string; code: string; name: string; providerId:string }>;
  visibleCreatorIds?: string[] | null;
}) {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  const stationIds = options.stations.map((station) => station.id).filter(Boolean);
  const stationCodes = options.stations.map((station) => station.code).filter(Boolean);
  if (!stationIds.length || !stationCodes.length) {
    return { associates: [] as WorkforceAssociatePlanningRow[], visibleAssociates: [] as WorkforceAssociatePlanningRow[], byStation: new Map<string, WorkforceAssociatePlanningRow[]>() };
  }

  const executivePages = await Promise.all(chunks(stationIds, 100).map((ids) => allRows(
    supabaseAdmin!.from(WORKFORCE_PROFILE_TABLE)
      .select("id,full_name,dropx_id,biometric_id,date_of_join,location_id,onboarding_status,is_active,created_by,source_profile_type,source_profile_id,lifecycle_status,last_working_date,designation,designation_id,stations(station_code,station_name)")
      .eq("company_id", options.companyId)
      .is('deleted_at',null).neq('migration_state','reclassified')
      .in("location_id", ids)
      .lte("date_of_join", shiftDate(options.reportingDate, 31))
      .order('id')
  )));
  const designationRows=await allRows(supabaseAdmin.from('designations').select('id,code,name,category:designation_categories!designations_designation_category_id_fkey(people_module)').eq('company_id',options.companyId).order('id'));
  const workforceDesignations=designationRows.filter(row=>related(row.category as {people_module:string}|{people_module:string}[])?.people_module==='delivery_network');
  const roleIds=new Set(workforceDesignations.map(row=>row.id)),roleKeys=new Set(workforceDesignations.flatMap(row=>[row.code,row.name].map(value=>String(value??'').trim().toLowerCase())));
  const executives = (executivePages.flat() as FieldExecutiveRow[]).filter(row=>row.designation_id?roleIds.has(row.designation_id):roleKeys.has(String(row.designation??'').trim().toLowerCase()));
  const executiveIds = executives.map((item) => item.id);
  const creatorIds = [...new Set(executives.map((item) => item.created_by).filter((value): value is string => Boolean(value)))];

  const identityGroups=[{column:'workforce_id',ids:executiveIds},...['field_executive','contractor'].map(type=>({column:`${type}_id`,ids:executives.filter(row=>row.source_profile_type===type&&row.source_profile_id).map(row=>row.source_profile_id!)}))];
  const [mappingPages, activityPages, profilePages, planPages] = await Promise.all([
    Promise.all(identityGroups.flatMap(group=>chunks(group.ids,150).map(ids=>{
      let query=supabaseAdmin!.from('field_executive_provider_mappings').select('id,workforce_id,field_executive_id,contractor_id,employee_id,provider_id,station_id,provider_member_id,status,effective_from,effective_to').eq('company_id',options.companyId).in(group.column,ids).neq('status','cancelled').order('id');
      if(group.column!=='workforce_id')query=query.is('workforce_id',null);
      return allRows(query);
    }))),
    Promise.all(chunks(stationCodes, 20).map((codes) => allRows(supabaseAdmin!.rpc("capacity_associate_daily", {
      p_company_id: options.companyId,
      p_station_codes: codes,
      p_from: shiftDate(options.reportingDate, -29),
      p_to: options.reportingDate
    }).order('station_code').order('work_date').order('associate_id')))),
    Promise.all(chunks(creatorIds, 150).map((ids) => ids.length
      ? supabaseAdmin!.from("profiles").select("id,full_name,email").eq("company_id", options.companyId).in("id", ids)
      : Promise.resolve({ data: [] as Array<{ id: string; full_name: string | null; email: string | null }>, error: null }))),
    Promise.all(chunks(executiveIds,150).map(ids=>allRows(supabaseAdmin!.from('workforce_joining_plans').select('*').eq('company_id',options.companyId).in('workforce_id',ids).order('workforce_id'))))
  ]);
  const failure = profilePages.find((result) => result.error);
  if (failure?.error) throw new Error(failure.error.message);

  const mappings = [...new Map(mappingPages.flat().map(row=>[row.id,row])).values()] as ProviderMappingRow[];
  const plans=planPages.flat() as JoiningPlan[];
  const planByPerson=new Map(plans.map(plan=>[plan.workforce_id,plan]));
  const eligibleFrom=plans.map(plan=>plan.eligible_from).sort()[0];
  const attendance:JoiningAttendance[]=eligibleFrom?(await Promise.all(identityGroups.flatMap(group=>chunks(group.ids,150).map(ids=>{
    let query=supabaseAdmin!.from('attendance_daily').select('id,workforce_id,field_executive_id,contractor_id,punch_date,in_time,out_time,work_minutes,status,punch_in_location_id,location_id,in_source,out_source,enrolment_id,updated_at').eq('company_id',options.companyId).in(group.column,ids).gte('punch_date',eligibleFrom).lte('punch_date',options.reportingDate).order('id');
    if(group.column!=='workforce_id')query=query.is('workforce_id',null);
    return allRows(query);
  })))).flat():[];
  const enrolments=[...new Set(attendance.map(row=>row.enrolment_id).filter(Boolean))];
  const flagged=new Set<string>();
  for(const ids of chunks(enrolments,150))for(const row of await allRows(supabaseAdmin!.from('attendance_punches').select('id,enrolment_id,punch_date').eq('company_id',options.companyId).in('enrolment_id',ids).eq('is_flagged',true).gte('punch_date',eligibleFrom).lte('punch_date',options.reportingDate).order('id')))flagged.add(`${row.enrolment_id}:${row.punch_date}`);
  const verifiedAttendance=[...new Map(attendance.map(row=>[row.id,{...row,flagged:flagged.has(`${row.enrolment_id}:${row.punch_date}`)}])).values()];
  const activityRows = activityPages.flat() as AssociateDay[];
  const profiles = new Map(profilePages.flatMap((result) => result.data ?? []).map((profile) => [profile.id, profile]));
  const activityByIdentity = new Map<string, AssociateDay[]>();
  activityRows.forEach((row) => {
    const key = `${String(row.station_code ?? "").trim().toUpperCase()}|${normalizedId(row.associate_id)}`;
    const current = activityByIdentity.get(key) ?? [];
    current.push(row);
    activityByIdentity.set(key, current);
  });
  const sevenDayStart = shiftDate(options.reportingDate, -6);

  const associates = executives.map((executive): WorkforceAssociatePlanningRow => {
    const station = related(executive.stations);
    const stationCode = String(station?.station_code ?? "").trim().toUpperCase();
    const person={...executive,is_active:executive.is_active===true} as JoiningPerson;
    const personMappings=mappings.filter(mapping=>belongsToPerson(mapping,person));
    const stationProvider=options.stations.find(row=>row.id===executive.location_id)?.providerId;
    const rows = personMappings.flatMap(mapping=>(activityByIdentity.get(`${stationCode}|${normalizedId(mapping.provider_member_id)}`)??[]).filter(row=>Boolean(stationProvider)&&mapping.provider_id===stationProvider&&(!mapping.station_id||mapping.station_id===executive.location_id)&&row.work_date>=mapping.effective_from&&(!mapping.effective_to||row.work_date<=mapping.effective_to)));
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
      joiningStage:joiningState(person,planByPerson.get(person.id)??null,personMappings,verifiedAttendance,options.reportingDate).stage,
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
