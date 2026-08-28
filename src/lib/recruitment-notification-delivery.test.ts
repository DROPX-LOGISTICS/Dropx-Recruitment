import { describe, expect, it } from "vitest";
import {
  MAX_NOTIFICATION_ATTEMPTS,
  notificationRetryDecision,
  providerDeliveryState
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
});
