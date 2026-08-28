export type WorkforceStatusOption = {
  code: string;
  label: string;
  isActive?: boolean;
};

export const WORKFORCE_ACTIVE_INTERVIEW_STATUSES = [
  "interview_scheduled",
  "interview_rescheduled",
  "joined"
] as const;

export const WORKFORCE_ACTIVE_INTERVIEW_STATUS_QUERY = WORKFORCE_ACTIVE_INTERVIEW_STATUSES.join(",");

type WorkforceInterviewOutcomeDefinition = {
  code: string;
  label: string;
  action: boolean;
  requiresDate?: boolean;
  scheduleType?: "interview" | "callback";
  requiresOnboarding?: boolean;
};

const interviewOutcomeDefinitions: readonly WorkforceInterviewOutcomeDefinition[] = [
  { code: "interview_scheduled", label: "Pending Outcome", action: false },
  { code: "interview_rescheduled", label: "Rescheduled", action: true, requiresDate: true, scheduleType: "interview" },
  { code: "joined", label: "Joined", action: true, requiresOnboarding: true },
  { code: "interview_no_show", label: "No Show", action: true },
  { code: "no_response", label: "No Response", action: true },
  { code: "call_back", label: "Call Back", action: true, requiresDate: true, scheduleType: "callback" },
  { code: "not_interested", label: "Not Interested", action: true },
  { code: "not_fit", label: "Not Fit", action: true },
  { code: "long_distance", label: "Long Distance", action: true }
];

export type WorkforceInterviewOutcome = WorkforceInterviewOutcomeDefinition & {
  isActive: boolean;
};

function configuredLabels(options: WorkforceStatusOption[]) {
  return new Map(options
    .filter((item) => item && item.code && item.isActive !== false)
    .map((item) => [item.code, item.label]));
}

export function workforceInterviewFilterOptions(options: WorkforceStatusOption[] = []): WorkforceInterviewOutcome[] {
  const labels = configuredLabels(options);
  return interviewOutcomeDefinitions.map((item) => ({
    ...item,
    label: labels.get(item.code) || item.label,
    isActive: true
  }));
}

export function workforceInterviewActionOptions(options: WorkforceStatusOption[] = []): WorkforceInterviewOutcome[] {
  return workforceInterviewFilterOptions(options)
    .filter((item) => item.action)
    .map((item) => item.code === "joined" ? { ...item, label: "Joined / Start Onboarding" } : item);
}

export function workforceInterviewOutcomeRoute(code: string) {
  const outcome = interviewOutcomeDefinitions.find((item) => item.code === code);
  return {
    queue: code === "no_response" || code === "call_back" ? "follow_up"
      : code === "interview_rescheduled" || code === "joined" || code === "interview_scheduled" ? "interviews"
      : "completed",
    requiresDate: outcome?.requiresDate === true,
    scheduleType: outcome?.scheduleType ?? null,
    requiresOnboarding: outcome?.requiresOnboarding === true
  };
}
