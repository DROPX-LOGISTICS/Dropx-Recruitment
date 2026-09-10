import { describe, expect, it } from "vitest";
import { adRunEndTime, adScheduleSummary, formatAdScheduleDate, sameMetaInstant, toMetaGraphDateTime } from "./ad-schedule";

const now = Date.parse("2026-09-09T12:00:00Z");
describe("visible ad schedules", () => {
  it("uses the same seven-day deadline for the preview and Meta update", () => {
    expect(adRunEndTime(7, now)).toBe("2026-09-16T12:00:00.000Z");
    expect(adRunEndTime(7, now + 999)).toBe("2026-09-16T12:00:00.000Z");
  });
  it.each([0, 1.5, 91, NaN])("has no estimated end for invalid duration %s", (days) => {
    expect(adRunEndTime(days, now)).toBeNull();
  });
  it("shows the actual IST date even when the UTC date differs", () => {
    expect(formatAdScheduleDate("2026-09-09T23:00:00Z").replaceAll(",", "")).toBe("Thu 10 Sept 2026 04:30 am IST");
  });
  it("shows remaining time and marks the final 24 hours", () => {
    expect(adScheduleSummary({ status: "ACTIVE", ends_at: "2026-09-10T11:00:00Z" }, now)).toMatchObject({
      kind: "scheduled", detail: "23h 0m remaining", endingSoon: true
    });
  });
  it("switches to Ended exactly at expiry", () => {
    expect(adScheduleSummary({ status: "ACTIVE", ends_at: new Date(now).toISOString() }, now)).toMatchObject({ kind: "ended", detail: "Run finished", endingSoon: false });
  });
  it("does not imply a paused ad is delivering until its end date", () => {
    expect(adScheduleSummary({ status: "PAUSED", ends_at: "2026-09-16T12:00:00Z" }, now).detail).toBe("7d 0h until scheduled end");
  });
  it("distinguishes an open schedule from missing Meta data", () => {
    expect(adScheduleSummary({ status: "ACTIVE", schedule_known: true }, now)).toMatchObject({ endLabel: "No end date", detail: "Runs until paused" });
    expect(adScheduleSummary({ status: "unknown" }, now)).toMatchObject({ endLabel: "Schedule unavailable" });
    expect(adScheduleSummary({ status: "ACTIVE", schedule_known: true, ends_at: "invalid" }, now)).toMatchObject({ endLabel: "Schedule unavailable" });
  });
  it("uses the latest run start rather than the original ad-set start", () => {
    expect(adScheduleSummary({ starts_at: "2026-08-01T12:00:00Z", current_run_started_at: new Date(now).toISOString() }, now).startLabel?.replaceAll(",", "")).toContain("09 Sept 2026");
  });
  it("formats Graph datetimes without milliseconds and tolerates Meta timezone echoes", () => {
    expect(toMetaGraphDateTime(now)).toBe("2026-09-09T12:00:00+0000");
    expect(sameMetaInstant("2026-09-16T12:00:00.000Z", "2026-09-16T17:30:00+0530")).toBe(true);
    expect(sameMetaInstant("2026-09-16T12:00:00Z", "2026-09-16T12:00:30Z")).toBe(true);
    expect(sameMetaInstant("2026-09-16T12:00:00Z", "2026-09-16T12:02:00Z")).toBe(false);
  });
});
