import { describe, expect, it } from "vitest";
import { assertCreativeReplacementDelivery } from "./meta-creative-delivery";

const endsAt = "2026-09-04T07:28:08+0530";
describe("creative replacement delivery guard", () => {
  it.each(["ACTIVE", "PAUSED"])("preserves existing %s replacement access", (deliveryStatus) => {
    expect(assertCreativeReplacementDelivery({ deliveryStatus, endsAt: null })).toBe(false);
  });
  it("accepts the verified completed schedule across timezone representations", () => {
    expect(assertCreativeReplacementDelivery({ deliveryStatus: "COMPLETED", endsAt }, "2026-09-04T01:58:08Z")).toBe(true);
  });
  it.each([undefined, "invalid", "2026-09-03T01:58:08Z"])("rejects an absent or stale completed schedule: %s", (expected) => {
    expect(() => assertCreativeReplacementDelivery({ deliveryStatus: "COMPLETED", endsAt }, expected)).toThrow("schedule changed");
  });
  it("rejects an ad restarted after its completed preview opened", () => {
    expect(() => assertCreativeReplacementDelivery({ deliveryStatus: "ACTIVE", endsAt: "2026-09-16T01:58:08Z" }, endsAt)).toThrow("schedule changed");
  });
  it.each(["ARCHIVED", "DELETED", "UNKNOWN", "SCHEDULED"])("blocks %s", (deliveryStatus) => {
    expect(() => assertCreativeReplacementDelivery({ deliveryStatus, endsAt }, endsAt)).toThrow("Only Active");
  });
});
