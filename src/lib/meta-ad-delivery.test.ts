import { describe, expect, it } from "vitest";
import { metaDeliveryStatus, storedAdDelivery, metaAdSyncDue } from "./meta-ad-delivery";

const now = Date.parse("2026-09-09T11:00:00Z");
describe("Meta delivery, not just its on/off toggle", () => {
  it("marks the real expired KDJE schedule completed although every level says ACTIVE", () => {
    expect(metaDeliveryStatus({ effective_status: "ACTIVE", campaign: { effective_status: "ACTIVE" },
      adset: { effective_status: "ACTIVE", end_time: "2026-09-02T12:38:58+0530" } }, now)).toBe("COMPLETED");
  });
  it("expires exactly at the deadline without waiting for another Meta sync", () => {
    const ad = { status: "ACTIVE", raw_payload: { adset: { end_time: new Date(now).toISOString() } } };
    expect(storedAdDelivery(ad, now - 1).status).toBe("ACTIVE");
    expect(storedAdDelivery(ad, now).status).toBe("COMPLETED");
  });
  it("keeps KOZA DCD active until its future deadline", () => {
    expect(metaDeliveryStatus({ effective_status: "ACTIVE", adset: { end_time: "2026-09-09T18:25:20+0530" } }, now)).toBe("ACTIVE");
  });
  it("distinguishes scheduled, paused, deleted, and rejected ads", () => {
    expect(metaDeliveryStatus({ effective_status: "ACTIVE", adset: { start_time: new Date(now + 1).toISOString() } }, now)).toBe("SCHEDULED");
    expect(metaDeliveryStatus({ effective_status: "ACTIVE", campaign: { status: "PAUSED" } }, now)).toBe("PAUSED");
    expect(metaDeliveryStatus({ status: "DELETED", adset: { end_time: "2020-01-01" } }, now)).toBe("DELETED");
    expect(metaDeliveryStatus({ effective_status: "DISAPPROVED" }, now)).toBe("DISAPPROVED");
  });
  it("moves a saved scheduled ad to active when the start is reached", () => {
    expect(storedAdDelivery({ status: "SCHEDULED", raw_payload: { adset: { start_time: new Date(now).toISOString() } } }, now).status).toBe("ACTIVE");
  });
  it("does not invent live delivery without a status", () => {
    expect(metaDeliveryStatus({ adset: { status: "ACTIVE" } }, now)).toBe("UNKNOWN");
  });
  it("uses the dedicated successful sync timestamp, including first run and retry", () => {
    expect(metaAdSyncDue(null, now)).toBe(true);
    expect(metaAdSyncDue("invalid", now)).toBe(true);
    expect(metaAdSyncDue(new Date(now - 30 * 60000).toISOString(), now)).toBe(true);
    expect(metaAdSyncDue(new Date(now - 29 * 60000).toISOString(), now)).toBe(false);
  });
});
