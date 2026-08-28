export const workforceOnboardingReviewActions = [
  "approve", "return", "reject", "save_checklist", "activate"
] as const;

export type WorkforceOnboardingReviewAction = typeof workforceOnboardingReviewActions[number];

export type WorkforceChecklistInput = {
  code: string;
  status: "pending" | "completed" | "not_applicable";
  remarks?: string;
  value?: Record<string, unknown>;
};

const clean = (value: unknown, limit = 500) => String(value ?? "").trim().slice(0, limit);

export function normalizeWorkforceOnboardingReviewInput(input: Record<string, unknown>) {
  const action = clean(input.action, 30).toLowerCase() as WorkforceOnboardingReviewAction;
  if (!workforceOnboardingReviewActions.includes(action)) throw new Error("Choose a valid onboarding action.");
  const remarks = clean(input.remarks, 1000);
  if (["return", "reject"].includes(action) && remarks.length < 3) {
    throw new Error(action === "return" ? "Return remarks are required." : "Rejection reason is required.");
  }
  const checklist = Array.isArray(input.checklist) ? input.checklist.map((raw) => {
    const item = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const code = clean(item.code, 80).toLowerCase();
    const status = clean(item.status, 30).toLowerCase();
    if (!code || !["pending", "completed", "not_applicable"].includes(status)) {
      throw new Error("Every checklist update needs a valid item and status.");
    }
    return {
      code,
      status: status as WorkforceChecklistInput["status"],
      remarks: clean(item.remarks, 500) || undefined,
      value: item.value && typeof item.value === "object" && !Array.isArray(item.value)
        ? item.value as Record<string, unknown>
        : {}
    } satisfies WorkforceChecklistInput;
  }) : [];
  const providerIdStatus = clean(input.providerIdStatus, 30).toLowerCase() || "not_started";
  if (!["not_started", "in_progress", "created", "blocked", "not_required"].includes(providerIdStatus)) {
    throw new Error("Choose a valid Amazon / provider ID status.");
  }
  const providerEmployeeId = clean(input.providerEmployeeId, 100);
  if (action === "activate" && providerIdStatus === "created" && !providerEmployeeId) {
    throw new Error("Amazon / provider employee ID is required before activation.");
  }
  return { action, remarks, checklist, providerIdStatus, providerEmployeeId };
}

export function onboardingApplicationSource(recruitmentFunction: unknown) {
  const source = clean(recruitmentFunction, 60).toLowerCase();
  return source || "workforce_user";
}

