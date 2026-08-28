import { supabaseAdmin } from "./supabase-admin";

export type RecruitmentFunction = "telecaller" | "field_recruiter" | "influencer" | "manager" | "viewer";

export type WorkforceUserFunction = {
  function: RecruitmentFunction;
  designationCode: string | null;
  trackPerformance: boolean;
  reportingManagerProfileId: string | null;
  updatedAt?: string;
};

export type IncentiveRule = {
  effectiveFrom: string;
  effectiveTo: string | null;
  qualificationDays: number;
  amountPerQualifiedAssociate: number;
  minimumQualifiedAssociates: number;
  eligibleDesignations: string[];
  isActive: boolean;
};

export type WorkforceDesignation = {
  code: string;
  name: string;
};

export type InfluencerMilestone = {
  activeDays: number;
  amount: number;
};

export type InfluencerProgramConfig = {
  attributionWindowDays: number;
  milestones: InfluencerMilestone[];
};

export const defaultInfluencerProgram: InfluencerProgramConfig = {
  attributionWindowDays: 90,
  milestones: [
    { activeDays: 10, amount: 300 },
    { activeDays: 20, amount: 700 },
    { activeDays: 30, amount: 1000 }
  ]
};

export function isRecruitmentInfluencerRole(code?: string | null, name?: string | null) {
  const roleCode = String(code ?? "").trim().toUpperCase();
  const roleName = String(name ?? "").trim().toUpperCase();
  return ["RINF", "RECRUITMENT_INFLUENCER"].includes(roleCode)
    || ["RECRUITMENT INFLUENCER", "RECRUITMENT INFLUENCER PARTNER"].includes(roleName);
}

export function workforceTeamProfileIds(
  managerProfileId: string,
  configured: Record<string, WorkforceUserFunction>
) {
  const visible = new Set<string>([managerProfileId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [profileId, item] of Object.entries(configured)) {
      if (!item.reportingManagerProfileId || !visible.has(item.reportingManagerProfileId) || visible.has(profileId)) continue;
      visible.add(profileId);
      changed = true;
    }
  }
  return [...visible];
}

export type LeadStatusMasterItem = {
  code: string;
  label: string;
  stream: "workforce" | "hr" | "both";
  isActive: boolean;
  requiresSchedule: boolean;
  scheduleType: "callback" | "interview" | null;
  sortOrder: number;
};

export const defaultLeadStatusMaster: LeadStatusMasterItem[] = [
  { code:"no_response", label:"No Response", stream:"both", isActive:true, requiresSchedule:false, scheduleType:null, sortOrder:10 },
  { code:"not_interested", label:"Not Interested", stream:"both", isActive:true, requiresSchedule:false, scheduleType:null, sortOrder:20 },
  { code:"call_back", label:"Call Back", stream:"both", isActive:true, requiresSchedule:true, scheduleType:"callback", sortOrder:30 },
  { code:"long_distance", label:"Long Distance", stream:"workforce", isActive:true, requiresSchedule:false, scheduleType:null, sortOrder:40 },
  { code:"wrong_number", label:"Wrong Number", stream:"both", isActive:true, requiresSchedule:false, scheduleType:null, sortOrder:50 },
  { code:"interview_scheduled", label:"Interview Scheduled", stream:"both", isActive:true, requiresSchedule:true, scheduleType:"interview", sortOrder:60 },
  { code:"interview_rescheduled", label:"Interview Rescheduled", stream:"both", isActive:true, requiresSchedule:true, scheduleType:"interview", sortOrder:65 },
  { code:"not_fit", label:"Not Fit", stream:"both", isActive:true, requiresSchedule:false, scheduleType:null, sortOrder:70 },
  { code:"joined", label:"Joined", stream:"workforce", isActive:true, requiresSchedule:false, scheduleType:null, sortOrder:75 },
  { code:"document_issue", label:"Document Issue", stream:"workforce", isActive:true, requiresSchedule:false, scheduleType:null, sortOrder:80 },
  { code:"selected", label:"Selected by HR", stream:"hr", isActive:true, requiresSchedule:false, scheduleType:null, sortOrder:90 },
  { code:"hold", label:"Keep on Hold", stream:"hr", isActive:true, requiresSchedule:false, scheduleType:null, sortOrder:100 },
  { code:"rejected", label:"Rejected", stream:"hr", isActive:true, requiresSchedule:false, scheduleType:null, sortOrder:110 }
];

export const defaultIncentiveMaster: IncentiveRule[] = [{
  effectiveFrom: new Date().toISOString().slice(0, 10),
  effectiveTo: null,
  qualificationDays: 30,
  amountPerQualifiedAssociate: 0,
  minimumQualifiedAssociates: 1,
  eligibleDesignations: [],
  isActive: true
}];

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export async function loadWorkforceConfig(companyId: string) {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  const result = await supabaseAdmin.from("recruitment_connection_settings")
    .select("id,is_enabled,public_config")
    .eq("company_id", companyId)
    .eq("provider", "mobile")
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  const config = object(result.data?.public_config);
  const rawFunctions = object(config.user_functions);
  const userFunctions = Object.fromEntries(Object.entries(rawFunctions).map(([profileId, raw]) => {
    const item = object(raw);
    const value = String(item.function ?? "viewer") as RecruitmentFunction;
    return [profileId, {
      function: ["telecaller","field_recruiter","influencer","manager","viewer"].includes(value) ? value : "viewer",
      designationCode: String(item.designationCode ?? "").trim().toUpperCase() || null,
      trackPerformance: item.trackPerformance === true,
      reportingManagerProfileId: String(item.reportingManagerProfileId ?? "").trim() || null,
      updatedAt: String(item.updatedAt ?? "") || undefined
    } satisfies WorkforceUserFunction];
  }));
  const rawRules = Array.isArray(config.incentive_master) ? config.incentive_master : defaultIncentiveMaster;
  const incentiveMaster = rawRules.map((raw) => {
    const item = object(raw);
    return {
      effectiveFrom: String(item.effectiveFrom ?? new Date().toISOString().slice(0, 10)),
      effectiveTo: String(item.effectiveTo ?? "").trim() || null,
      qualificationDays: Math.max(1, Math.min(366, Number(item.qualificationDays ?? 30))),
      amountPerQualifiedAssociate: Math.max(0, Number(item.amountPerQualifiedAssociate ?? 0)),
      minimumQualifiedAssociates: Math.max(1, Number(item.minimumQualifiedAssociates ?? 1)),
      eligibleDesignations: Array.isArray(item.eligibleDesignations)
        ? [...new Set(item.eligibleDesignations.map((value) => String(value).trim().toUpperCase()).filter(Boolean))]
        : [],
      isActive: item.isActive !== false
    } satisfies IncentiveRule;
  });
  const recruitmentDesignations = (Array.isArray(config.recruitment_designations)
    ? config.recruitment_designations
    : [])
    .map((raw) => {
      const item = object(raw);
      return {
        code: String(item.code ?? "").trim().toUpperCase(),
        name: String(item.name ?? "").trim()
      } satisfies WorkforceDesignation;
    })
    .filter((item) => item.code && item.name);
  const rawInfluencerProgram = object(config.influencer_program);
  const rawInfluencerMilestones = Array.isArray(rawInfluencerProgram.milestones)
    ? rawInfluencerProgram.milestones
    : defaultInfluencerProgram.milestones;
  const influencerMilestones = rawInfluencerMilestones.map((raw) => {
    const item = object(raw);
    return {
      activeDays: Math.max(1, Math.min(366, Number(item.activeDays ?? 0))),
      amount: Math.max(0, Number(item.amount ?? 0))
    } satisfies InfluencerMilestone;
  }).filter((item) => Number.isFinite(item.activeDays) && Number.isFinite(item.amount))
    .sort((left, right) => left.activeDays - right.activeDays);
  const influencerProgram: InfluencerProgramConfig = {
    attributionWindowDays: Math.max(1, Math.min(366, Number(
      rawInfluencerProgram.attributionWindowDays ?? defaultInfluencerProgram.attributionWindowDays
    ))),
    milestones: influencerMilestones.length ? influencerMilestones : defaultInfluencerProgram.milestones
  };
  const rawStatuses = Array.isArray(config.lead_status_master)
    ? config.lead_status_master
    : defaultLeadStatusMaster;
  let leadStatusMaster = rawStatuses.map((raw, index) => {
    const item = object(raw);
    const stream = String(item.stream ?? "workforce");
    const scheduleType = String(item.scheduleType ?? "");
    return {
      code: String(item.code ?? "").trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_"),
      label: String(item.label ?? "").trim(),
      stream: (["workforce","hr","both"].includes(stream) ? stream : "workforce") as LeadStatusMasterItem["stream"],
      isActive: item.isActive !== false,
      requiresSchedule: item.requiresSchedule === true,
      scheduleType: (["callback","interview"].includes(scheduleType) ? scheduleType : null) as LeadStatusMasterItem["scheduleType"],
      sortOrder: Number.isFinite(Number(item.sortOrder)) ? Number(item.sortOrder) : (index + 1) * 10
    } satisfies LeadStatusMasterItem;
  }).filter((item) => item.code && item.label).map((item) => {
    if (item.scheduleType || !item.requiresSchedule) return item;
    if (item.code === "call_back") return { ...item, scheduleType: "callback" as const };
    if (item.code === "interview_scheduled" || item.code === "interview_rescheduled") {
      return { ...item, scheduleType: "interview" as const };
    }
    return item;
  }).sort((a,b) => a.sortOrder - b.sortOrder);
  // Older installations only stored Workforce statuses.  Add the HR-specific
  // defaults and make the shared first-call outcomes available to both
  // workspaces.  Once saved through Lead Status Master, the administrator's
  // explicit workspace selection remains authoritative.
  if (!leadStatusMaster.some((item) => item.stream === "hr" || item.stream === "both")) {
    const shared = new Set(["no_response", "not_interested", "call_back", "wrong_number", "interview_scheduled", "not_fit"]);
    leadStatusMaster = leadStatusMaster.map((item) => shared.has(item.code) ? { ...item, stream: "both" as const } : item);
  }
  for (const fallback of defaultLeadStatusMaster.filter((item) => item.stream === "hr")) {
    if (!leadStatusMaster.some((item) => item.code === fallback.code)) leadStatusMaster.push(fallback);
  }
  leadStatusMaster.sort((a,b) => a.sortOrder - b.sortOrder);
  return { row: result.data, config, userFunctions, incentiveMaster, recruitmentDesignations, influencerProgram, leadStatusMaster };
}

export async function saveWorkforceConfig(
  companyId: string,
  patch: Record<string, unknown>,
  actorProfileId: string,
  actorEmail: string | null
) {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  const current = await loadWorkforceConfig(companyId);
  const values = {
    company_id: companyId,
    provider: "mobile",
    is_enabled: current.row?.is_enabled ?? false,
    public_config: { ...current.config, ...patch },
    updated_by: actorProfileId,
    updated_by_email: actorEmail,
    updated_at: new Date().toISOString()
  };
  const saved = current.row?.id
    ? await supabaseAdmin.from("recruitment_connection_settings").update(values).eq("id", current.row.id)
    : await supabaseAdmin.from("recruitment_connection_settings").insert(values);
  if (saved.error) throw new Error(saved.error.message);
}

export function workforceFunctionFor(
  profileId: string,
  accessTemplate: string | undefined,
  manageUsers: boolean,
  configured: Record<string, WorkforceUserFunction>,
  aliases: string[] = [],
  universalRoleCode?: string | null,
  universalRoleName?: string | null
): WorkforceUserFunction {
  const lookupIds = [profileId, ...aliases]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
  const normalizedIds = new Set(lookupIds.map((value) => value.toLowerCase()));
  const saved = lookupIds.map((value) => configured[value]).find(Boolean)
    ?? Object.entries(configured).find(([savedProfileId]) =>
      normalizedIds.has(savedProfileId.trim().toLowerCase())
    )?.[1];
  const roleCode = String(universalRoleCode ?? "").trim().toUpperCase();
  const roleName = String(universalRoleName ?? "").trim().toUpperCase();
  if (isRecruitmentInfluencerRole(roleCode, roleName)) {
    return {
      ...saved,
      function: "influencer",
      designationCode: "RINF",
      trackPerformance: true,
      reportingManagerProfileId: saved?.reportingManagerProfileId ?? null
    };
  }
  if (["FREC", "REC"].includes(roleCode) || ["FIELD RECRUITER", "RECRUITER"].includes(roleName)) {
    return {
      ...saved,
      function: "field_recruiter",
      designationCode: "FREC",
      trackPerformance: true,
      reportingManagerProfileId: saved?.reportingManagerProfileId ?? null
    };
  }
  if (saved) return saved;
  if (manageUsers || ["owner","admin"].includes(accessTemplate ?? "")) {
    return { function: "manager", designationCode: null, trackPerformance: false, reportingManagerProfileId: null };
  }
  return { function: "viewer", designationCode: null, trackPerformance: false, reportingManagerProfileId: null };
}
