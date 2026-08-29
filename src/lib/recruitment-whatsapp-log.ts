import { outboxNotificationTrigger } from "./recruitment-notification-delivery";
import type { LeadNotificationTrigger } from "./recruitment-notifications";

export type ReplayCandidateLead = {
  status?: string | null;
  no_response_attempts?: number | null;
  follow_up_at?: string | null;
};

export type ReplayCandidate = {
  trigger: Extract<LeadNotificationTrigger, "no_response" | "interview">;
  anchor: string;
};

export type ReplayOutboxRow = {
  notification_trigger?: string | null;
  template_name?: string | null;
  notification_context?: Record<string, unknown> | null;
  created_at?: string | null;
  status?: string | null;
};

export function replayCandidateForLead(
  lead: ReplayCandidateLead,
  now = Date.now()
): ReplayCandidate | null {
  const status = String(lead.status ?? "").trim().toLowerCase();
  if (status === "no_response") {
    return {
      trigger: "no_response",
      anchor: String(Math.max(1, Math.floor(Number(lead.no_response_attempts) || 0)))
    };
  }
  if (!["interview_scheduled", "interview_rescheduled"].includes(status)) return null;
  const followUpAt = String(lead.follow_up_at ?? "").trim();
  const followUpTime = Date.parse(followUpAt);
  if (!followUpAt || !Number.isFinite(followUpTime) || followUpTime < now) return null;
  return { trigger: "interview", anchor: followUpAt };
}

export function outboxCoversReplayCandidate(
  row: ReplayOutboxRow,
  candidate: ReplayCandidate,
  latestEventAt?: string | null
) {
  if (outboxNotificationTrigger(row) !== candidate.trigger) return false;
  const savedAnchor = String(row.notification_context?.anchor ?? "").trim();
  if (savedAnchor) return savedAnchor === candidate.anchor;
  const eventTime = Date.parse(String(latestEventAt ?? ""));
  const createdTime = Date.parse(String(row.created_at ?? ""));
  if (Number.isFinite(eventTime) && Number.isFinite(createdTime)) return createdTime >= eventTime;
  // Legacy outbox rows did not persist notification_context. Treat a matching
  // trigger as coverage when no reliable event timestamp exists to avoid a
  // duplicate candidate message.
  return true;
}

export function isRetryableNotificationStatus(status: unknown) {
  return ["failed", "skipped"].includes(String(status ?? "").trim().toLowerCase());
}

export function maskRecruitmentPhone(value: unknown) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length < 4) return digits ? `••${digits}` : "—";
  return `••••••${digits.slice(-4)}`;
}

