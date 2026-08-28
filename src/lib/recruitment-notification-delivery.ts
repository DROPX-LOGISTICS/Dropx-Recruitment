export const MAX_NOTIFICATION_ATTEMPTS = 5;

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

