export const MAX_NOTIFICATION_ATTEMPTS = 5;
export const STALE_NOTIFICATION_CLAIM_MS = 15 * 60_000;

export type StaleNotification = {
  notification_trigger?: string | null;
  template_name?: string | null;
};

export type NotificationLeadState = {
  status?: string | null;
  follow_up_at?: string | null;
};

export function notificationRetryDecision(attemptCount: number, now = Date.now()) {
  const attempts = Math.max(1, Math.floor(Number(attemptCount) || 1));
  const terminal = attempts >= MAX_NOTIFICATION_ATTEMPTS;
  const delayMinutes = Math.min(60, 2 ** attempts);
  return {
    attempts,
    terminal,
    status: terminal ? "failed" as const : "retry" as const,
    nextAttemptAt: new Date(now + delayMinutes * 60_000).toISOString()
  };
}

export function providerDeliveryState(input: unknown) {
  const value = String(input ?? "").trim().toLowerCase();
  return ["sent", "delivered", "read", "failed"].includes(value) ? value : null;
}

export function staleNotificationClaimCutoff(now = Date.now()) {
  return new Date(now - STALE_NOTIFICATION_CLAIM_MS).toISOString();
}

export function outboxNotificationTrigger(item: StaleNotification) {
  const trigger = String(item.notification_trigger ?? "").trim().toLowerCase();
  if (["new_lead", "no_response", "interview"].includes(trigger)) return trigger;
  const template = String(item.template_name ?? "").trim().toLowerCase();
  if (template === "job_application_reminder") return "no_response";
  if (template === "job_location_share") return "interview";
  if (template === "job_application_number") return "new_lead";
  return null;
}

export function shouldRecoverStaleNotification(
  item: StaleNotification,
  lead: NotificationLeadState | null | undefined,
  now = Date.now()
) {
  if (!lead) return false;
  const trigger = outboxNotificationTrigger(item);
  const status = String(lead.status ?? "").trim().toLowerCase();
  if (trigger === "no_response") return status === "no_response";
  if (trigger === "interview") {
    const interviewAt = Date.parse(String(lead.follow_up_at ?? ""));
    return ["interview_scheduled", "interview_rescheduled"].includes(status)
      && Number.isFinite(interviewAt)
      && interviewAt >= now;
  }
  if (trigger === "new_lead") {
    return ["", "new", "assigned", "contacting"].includes(status);
  }
  return false;
}
