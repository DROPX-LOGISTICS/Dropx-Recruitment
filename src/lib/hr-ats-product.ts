import type { HrLifecycleRule } from "./hr-recruitment-lifecycle";

export const HR_PIPELINE_STAGES = [
  { code: "profile", label: "Profile" },
  { code: "screening", label: "Screening" },
  { code: "documents", label: "Documents" },
  { code: "interview", label: "Interview" },
  { code: "offer", label: "Offer" },
  { code: "joining", label: "Joining" }
] as const;

const stageIndex: Record<string, number> = {
  intake: 0,
  follow_up: 0,
  screening: 1,
  interview: 3,
  selection: 4,
  offer: 4,
  joining: 5,
  closed: 0
};

export function hrLifecycleFilterOptions(rules: HrLifecycleRule[] | null | undefined) {
  return (rules ?? [])
    .filter((rule) => rule.isActive)
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((rule) => [rule.code, rule.label] as [string, string]);
}

export function hrQueueStatusQuery(menu: string) {
  if (menu === "Screening") return "new,contacting,screening,documents_pending";
  if (menu === "Documents") return "documents_pending";
  if (menu === "Offers") return "selected,offer_pending,offered";
  if (menu === "Hired") return "joined";
  // The HR Interviews queue is populated from first-class interview records,
  // not a broad collection of old lead statuses.
  if (menu === "Interviews") return "";
  return "";
}

export type CandidateJourneyFacts = {
  hasResume?: boolean;
  interviewCount?: number;
  latestInterviewStatus?: string | null;
  latestInterviewHasCalendar?: boolean;
  latestInterviewHasMeet?: boolean;
  latestOfferStatus?: string | null;
};

export function candidateJourney(
  statusValue: string | null | undefined,
  rules: HrLifecycleRule[] | null | undefined,
  facts: CandidateJourneyFacts = {}
) {
  const status = String(statusValue || "new").trim().toLowerCase() || "new";
  const rule = (rules ?? []).find((item) => item.code === status);
  let activeStage = stageIndex[rule?.stageGroup ?? "intake"] ?? 0;
  if (facts.hasResume) activeStage = Math.max(activeStage, 1);
  if (facts.interviewCount) activeStage = Math.max(activeStage, 3);
  if (facts.latestOfferStatus) activeStage = Math.max(activeStage, 4);
  if (status === "joined") activeStage = 5;

  const blockers: string[] = [];
  if (!facts.hasResume && activeStage <= 1) blockers.push("Resume missing");
  if (facts.interviewCount && facts.latestInterviewStatus && ["scheduled", "rescheduled"].includes(facts.latestInterviewStatus)) {
    if (!facts.latestInterviewHasCalendar) blockers.push("Calendar invite not confirmed");
    if (!facts.latestInterviewHasMeet) blockers.push("Meeting link not available");
  }

  let nextAction = "Start first call";
  if (["no_response", "call_back", "hold"].includes(status)) nextAction = "Complete follow-up";
  else if (["screening", "documents_pending"].includes(status)) nextAction = facts.hasResume ? "Complete screening" : "Collect resume";
  else if (["interview_scheduled", "interview_rescheduled", "round_2_pending"].includes(status)) nextAction = "Complete interview round";
  else if (status === "interview_completed") nextAction = "Record hiring decision";
  else if (status === "selected") nextAction = "Create offer draft";
  else if (status === "offer_pending") nextAction = "Approve offer";
  else if (status === "offered") nextAction = "Confirm joining";
  else if (status === "joined") nextAction = "Send to People onboarding";
  else if (["not_fit", "rejected"].includes(status)) nextAction = "Closed";

  return { status, label: rule?.label ?? status.replaceAll("_", " "), activeStage, nextAction, blockers };
}

export type HrActivityEvent = {
  lead_id: string;
  event_type: string;
  actor_profile_id?: string | null;
  actor_email?: string | null;
  new_value?: string | null;
  created_at?: string | null;
};

export function buildHrUserPerformance(events: HrActivityEvent[]) {
  const users = new Map<string, {
    profileId: string | null;
    email: string;
    totalUpdates: number;
    candidateIds: Set<string>;
    firstCalls: number;
    screenings: number;
    interviews: number;
    decisions: number;
    offers: number;
    joined: number;
    lastActivityAt: string | null;
  }>();
  for (const event of events) {
    const email = String(event.actor_email ?? "").trim().toLowerCase();
    const profileId = String(event.actor_profile_id ?? "").trim() || null;
    // Pollers and notification jobs write useful audit events, but they are not
    // recruiters and must never inflate the user-performance roster.
    if (!profileId && email.startsWith("system:")) continue;
    if (!email && !profileId) continue;
    const key = profileId || email;
    const current = users.get(key) ?? {
      profileId,
      email: email || "DropX user",
      totalUpdates: 0,
      candidateIds: new Set<string>(),
      firstCalls: 0,
      screenings: 0,
      interviews: 0,
      decisions: 0,
      offers: 0,
      joined: 0,
      lastActivityAt: null
    };
    current.totalUpdates += 1;
    current.candidateIds.add(event.lead_id);
    if (["hr_initial_call_outcome", "status_change", "status_updated"].includes(event.event_type)) current.firstCalls += 1;
    if (event.event_type === "hr_screening_profile") current.screenings += 1;
    if (["hr_interview_forwarded", "hr_interview_rescheduled"].includes(event.event_type)) current.interviews += 1;
    if (event.event_type === "hr_interview_decision") current.decisions += 1;
    if (event.event_type.startsWith("hr_offer_")) current.offers += 1;
    if (String(event.new_value ?? "").toLowerCase() === "joined" || event.event_type === "people_handoff_created") current.joined += 1;
    if (event.created_at && (!current.lastActivityAt || event.created_at > current.lastActivityAt)) current.lastActivityAt = event.created_at;
    users.set(key, current);
  }
  return [...users.values()].map((item) => ({
    profileId: item.profileId,
    email: item.email,
    totalUpdates: item.totalUpdates,
    uniqueCandidates: item.candidateIds.size,
    firstCalls: item.firstCalls,
    screenings: item.screenings,
    interviews: item.interviews,
    decisions: item.decisions,
    offers: item.offers,
    joined: item.joined,
    lastActivityAt: item.lastActivityAt
  })).sort((left, right) => right.totalUpdates - left.totalUpdates || left.email.localeCompare(right.email));
}
