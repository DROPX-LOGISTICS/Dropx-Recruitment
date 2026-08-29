import { describe, expect, it } from "vitest";
import {
  isRetryableNotificationStatus,
  maskRecruitmentPhone,
  outboxCoversReplayCandidate,
  replayCandidateForLead
} from "./recruitment-whatsapp-log";

describe("Recruit WhatsApp message log replay safety", () => {
  it("replays the current no-response attempt with a stable anchor", () => {
    expect(replayCandidateForLead({ status: "no_response", no_response_attempts: 3 }))
      .toEqual({ trigger: "no_response", anchor: "3" });
  });

  it("replays only upcoming interviews", () => {
    const now = Date.parse("2026-08-29T10:00:00.000Z");
    expect(replayCandidateForLead({
      status: "interview_scheduled",
      follow_up_at: "2026-08-29T11:00:00.000Z"
    }, now)).toEqual({ trigger: "interview", anchor: "2026-08-29T11:00:00.000Z" });
    expect(replayCandidateForLead({
      status: "interview_scheduled",
      follow_up_at: "2026-08-29T09:00:00.000Z"
    }, now)).toBeNull();
  });

  it("recognizes exact and legacy outbox coverage without duplicating messages", () => {
    const candidate = { trigger: "no_response", anchor: "2" } as const;
    expect(outboxCoversReplayCandidate({
      notification_trigger: "no_response",
      notification_context: { anchor: "2" }
    }, candidate)).toBe(true);
    expect(outboxCoversReplayCandidate({
      template_name: "job_application_reminder",
      created_at: "2026-08-29T10:01:00.000Z"
    }, candidate, "2026-08-29T10:00:00.000Z")).toBe(true);
    expect(outboxCoversReplayCandidate({
      template_name: "job_application_reminder",
      created_at: "2026-08-29T09:59:00.000Z"
    }, candidate, "2026-08-29T10:00:00.000Z")).toBe(false);
  });

  it("retries only terminal failed or obsolete outbox states", () => {
    expect(isRetryableNotificationStatus("failed")).toBe(true);
    expect(isRetryableNotificationStatus("skipped")).toBe(true);
    expect(isRetryableNotificationStatus("sent")).toBe(false);
  });

  it("masks candidate phone numbers in the settings log", () => {
    expect(maskRecruitmentPhone("+91 98765 43210")).toBe("••••••3210");
    expect(maskRecruitmentPhone(null)).toBe("—");
  });
});

