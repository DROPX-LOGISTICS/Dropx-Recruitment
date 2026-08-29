import { describe, expect, it } from "vitest";
import {
  MAX_NOTIFICATION_ATTEMPTS,
  notificationRetryDecision,
  outboxNotificationTrigger,
  providerDeliveryState,
  shouldRecoverStaleNotification,
  staleNotificationClaimCutoff
} from "./recruitment-notification-delivery";

describe("recruitment notification delivery", () => {
  it("backs off retryable failures without prematurely dropping the message", () => {
    expect(notificationRetryDecision(1, 0)).toEqual({
      attempts: 1,
      terminal: false,
      status: "retry",
      nextAttemptAt: new Date(2 * 60_000).toISOString()
    });
  });

  it("moves a message to failed only after the configured attempt ceiling", () => {
    const decision = notificationRetryDecision(MAX_NOTIFICATION_ATTEMPTS, 0);
    expect(decision.terminal).toBe(true);
    expect(decision.status).toBe("failed");
  });

  it("accepts only delivery states emitted by WhatsApp", () => {
    expect(providerDeliveryState("DELIVERED")).toBe("delivered");
    expect(providerDeliveryState("unknown")).toBeNull();
  });

  it("recovers a stale claim only while its candidate action is still current", () => {
    expect(shouldRecoverStaleNotification(
      { notification_trigger: "no_response" },
      { status: "no_response" }
    )).toBe(true);
    expect(shouldRecoverStaleNotification(
      { notification_trigger: "no_response" },
      { status: "joined" }
    )).toBe(false);
  });

  it("never replays an obsolete interview appointment", () => {
    expect(shouldRecoverStaleNotification(
      { template_name: "job_location_share" },
      { status: "interview_scheduled", follow_up_at: "2026-08-29T10:00:00.000Z" },
      Date.parse("2026-08-29T11:00:00.000Z")
    )).toBe(false);
    expect(shouldRecoverStaleNotification(
      { notification_trigger: "interview" },
      { status: "interview_rescheduled", follow_up_at: "2026-08-29T12:00:00.000Z" },
      Date.parse("2026-08-29T11:00:00.000Z")
    )).toBe(true);
  });

  it("recognizes legacy rows and calculates a deterministic stale cutoff", () => {
    expect(outboxNotificationTrigger({ template_name: "job_application_reminder" })).toBe("no_response");
    expect(staleNotificationClaimCutoff(15 * 60_000)).toBe(new Date(0).toISOString());
  });
});
