export type HrLifecycleActor = "recruiter" | "interviewer" | "hr_head" | "owner";

export type HrLifecycleRule = {
  code: string;
  label: string;
  stageGroup: string;
  sortOrder: number;
  isActive: boolean;
  isTerminal: boolean;
  requiresRemarks: boolean;
  requiresSchedule: boolean;
  recruiterCanSet: boolean;
  interviewerCanSet: boolean;
  firstCallAvailable: boolean;
  allowedNextCodes: string[];
  notificationTrigger: string | null;
};

export type HrInterviewDecision = "advance" | "selected" | "hold" | "rejected" | "no_show";

export type HrWorkflowSettings = {
  maxInterviewRounds: number;
  defaultInterviewMinutes: number;
  requireOfferApproval: boolean;
};

type LifecycleReader = {
  from(table: string): any;
};

export const defaultHrWorkflowSettings: HrWorkflowSettings = {
  maxInterviewRounds: 2,
  defaultInterviewMinutes: 45,
  requireOfferApproval: true
};

export const defaultHrLifecycleRules: HrLifecycleRule[] = [
  rule("new", "New profile", "intake", 10, ["contacting", "screening", "no_response", "call_back", "not_fit", "interview_scheduled", "selected"]),
  rule("contacting", "Contacting", "screening", 20, ["screening", "no_response", "call_back", "not_fit", "interview_scheduled", "selected"]),
  rule("screening", "Screening", "screening", 30, ["documents_pending", "interview_scheduled", "selected", "hold", "rejected"]),
  rule("documents_pending", "Documents pending", "screening", 40, ["screening", "interview_scheduled", "rejected"]),
  rule("interview_scheduled", "Interview scheduled", "interview", 50, ["interview_rescheduled", "interview_completed", "interview_no_show", "hold", "rejected"], { requiresSchedule: true, interviewerCanSet: true }),
  rule("interview_rescheduled", "Interview rescheduled", "interview", 55, ["interview_rescheduled", "interview_completed", "interview_no_show", "hold", "rejected"], { requiresSchedule: true, interviewerCanSet: true }),
  rule("interview_completed", "Interview completed", "interview", 60, ["round_2_pending", "selected", "hold", "rejected"], { interviewerCanSet: true }),
  rule("round_2_pending", "Round 2 pending", "interview", 65, ["interview_scheduled", "rejected"]),
  rule("interview_no_show", "Candidate did not attend", "interview", 70, ["interview_rescheduled", "rejected"], { interviewerCanSet: true }),
  rule("selected", "Selected", "selection", 80, ["offer_pending", "rejected"]),
  rule("offer_pending", "Offer pending", "offer", 90, ["offered", "rejected"]),
  rule("offered", "Offer issued", "offer", 100, ["joined", "rejected"]),
  rule("joined", "Joined", "joining", 110, [], { isTerminal: true }),
  rule("no_response", "No response", "follow_up", 120, ["contacting", "call_back", "not_fit", "interview_scheduled", "rejected"]),
  rule("call_back", "Call back", "follow_up", 130, ["contacting", "screening", "no_response", "not_fit", "interview_scheduled", "rejected"]),
  rule("hold", "On hold", "follow_up", 140, ["screening", "interview_scheduled", "rejected"]),
  rule("not_fit", "Not fit", "closed", 150, [], { isTerminal: true }),
  rule("rejected", "Rejected", "closed", 160, [], { isTerminal: true })
];

function rule(
  code: string,
  label: string,
  stageGroup: string,
  sortOrder: number,
  allowedNextCodes: string[],
  options: Partial<Pick<HrLifecycleRule, "isTerminal" | "requiresSchedule" | "interviewerCanSet">> = {}
): HrLifecycleRule {
  return {
    code,
    label,
    stageGroup,
    sortOrder,
    isActive: true,
    isTerminal: options.isTerminal ?? false,
    requiresRemarks: !["new", "joined"].includes(code),
    requiresSchedule: options.requiresSchedule ?? false,
    recruiterCanSet: !["interview_completed", "interview_no_show"].includes(code),
    interviewerCanSet: options.interviewerCanSet ?? false,
    firstCallAvailable: ["no_response", "call_back", "not_fit", "interview_scheduled"].includes(code),
    allowedNextCodes,
    notificationTrigger: code === "interview_scheduled" || code === "interview_rescheduled"
      ? "interview"
      : code === "no_response" ? "no_response" : null
  };
}

export function normalizeHrLifecycleRules(
  rows: Array<Record<string, unknown>> | null | undefined,
  options: { includeInactive?: boolean } = {}
) {
  if (!rows?.length) return defaultHrLifecycleRules;
  return rows.map((row) => ({
    code: String(row.code ?? "").trim().toLowerCase(),
    label: String(row.label ?? row.code ?? "").trim(),
    stageGroup: String(row.stage_group ?? "pipeline").trim().toLowerCase(),
    sortOrder: Number(row.sort_order ?? 0),
    isActive: row.is_active !== false,
    isTerminal: row.is_terminal === true,
    requiresRemarks: row.requires_remarks !== false,
    requiresSchedule: row.requires_schedule === true,
    recruiterCanSet: row.recruiter_can_set !== false,
    interviewerCanSet: row.interviewer_can_set === true,
    firstCallAvailable: row.first_call_available === true,
    allowedNextCodes: Array.isArray(row.allowed_next_codes)
      ? row.allowed_next_codes.map(String).map((value) => value.trim().toLowerCase()).filter(Boolean)
      : [],
    notificationTrigger: row.notification_trigger ? String(row.notification_trigger) : null
  })).filter((item) => item.code && (options.includeInactive || item.isActive)).sort((left, right) => left.sortOrder - right.sortOrder);
}

export async function loadHrLifecycleRules(
  client: LifecycleReader,
  companyId: string,
  options: { includeInactive?: boolean } = {}
) {
  let query = client.from("recruitment_hr_lifecycle_rules")
    .select("code,label,stage_group,sort_order,is_active,is_terminal,requires_remarks,requires_schedule,recruiter_can_set,interviewer_can_set,first_call_available,allowed_next_codes,notification_trigger")
    .eq("company_id", companyId);
  if (!options.includeInactive) query = query.eq("is_active", true);
  const result = await query.order("sort_order");
  if (result.error) {
    // This keeps the current production deployment operational until the new
    // migration is applied, while the migration-backed master remains the
    // source of truth once present.
    if (/relation .* does not exist|schema cache/i.test(result.error.message)) return defaultHrLifecycleRules;
    throw new Error(result.error.message);
  }
  return normalizeHrLifecycleRules(result.data, options);
}

export async function loadHrWorkflowSettings(client: LifecycleReader, companyId: string): Promise<HrWorkflowSettings> {
  const result = await client.from("recruitment_hr_workflow_settings")
    .select("max_interview_rounds,default_interview_minutes,require_offer_approval")
    .eq("company_id", companyId)
    .maybeSingle();
  if (result.error) {
    if (/relation .* does not exist|schema cache/i.test(result.error.message)) return defaultHrWorkflowSettings;
    throw new Error(result.error.message);
  }
  if (!result.data) return defaultHrWorkflowSettings;
  return {
    maxInterviewRounds: Math.max(1, Math.min(10, Number(result.data.max_interview_rounds) || 2)),
    defaultInterviewMinutes: Math.max(15, Math.min(240, Number(result.data.default_interview_minutes) || 45)),
    requireOfferApproval: result.data.require_offer_approval !== false
  };
}

export function validateHrTransition(input: {
  currentCode: string | null | undefined;
  nextCode: string;
  actor: HrLifecycleActor;
  remarks?: string | null;
  scheduledAt?: string | null;
  rules: HrLifecycleRule[];
}) {
  const currentCode = String(input.currentCode || "new").trim().toLowerCase() || "new";
  const nextCode = String(input.nextCode).trim().toLowerCase();
  const current = input.rules.find((item) => item.code === currentCode);
  const next = input.rules.find((item) => item.code === nextCode && item.isActive);
  if (!next) throw new Error("Choose an active HR lifecycle status from Lifecycle Master.");
  if (current?.isTerminal) throw new Error(`${current.label} is terminal. Reopen the candidate before another transition.`);
  if (current && current.code !== next.code && !current.allowedNextCodes.includes(next.code)) {
    throw new Error(`${next.label} is not an allowed next step after ${current.label}.`);
  }
  if (input.actor === "recruiter" && !next.recruiterCanSet) {
    throw new Error(`${next.label} can only be recorded by the assigned interviewer or an authorised HR lead.`);
  }
  if (input.actor === "interviewer" && !next.interviewerCanSet) {
    throw new Error(`${next.label} is not available in the interviewer workspace.`);
  }
  if (next.requiresRemarks && !String(input.remarks ?? "").trim()) {
    throw new Error(`A remark is required for ${next.label}.`);
  }
  if (next.requiresSchedule && (!input.scheduledAt || !Number.isFinite(new Date(input.scheduledAt).getTime()))) {
    throw new Error(`A valid date and time are required for ${next.label}.`);
  }
  return next;
}

export function allowedHrFirstCallOutcomeCodes(
  rules: HrLifecycleRule[] | null | undefined,
  currentCodeValue: string | null | undefined
) {
  const activeFirstCallRules = (rules ?? []).filter((item) => item.isActive && item.firstCallAvailable);
  if (!activeFirstCallRules.length) return [];
  const currentCode = String(currentCodeValue || "new").trim().toLowerCase() || "new";
  const current = (rules ?? []).find((item) => item.code === currentCode);
  if (!current) return activeFirstCallRules.map((item) => item.code);
  if (current.isTerminal) return [];
  return activeFirstCallRules
    .filter((item) => item.code === current.code || current.allowedNextCodes.includes(item.code))
    .map((item) => item.code);
}

export function interviewDecisionTransition(decision: HrInterviewDecision, round: number, maxRounds = 2) {
  if (decision === "no_show") return "interview_no_show";
  if (decision === "hold") return "hold";
  if (decision === "rejected") return "rejected";
  if (decision === "selected") return "selected";
  return round < maxRounds ? "round_2_pending" : "selected";
}
