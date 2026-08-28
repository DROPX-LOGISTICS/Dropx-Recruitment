import { describe, expect, it } from "vitest";
import { classifyFieldPointBatch } from "./field-point-ingestion";

const options = {
  companyId: "company",
  dutyId: "duty",
  earliestAllowedMs: Date.parse("2026-08-05T03:00:00.000Z"),
  latestAllowedMs: Date.parse("2026-08-05T15:00:00.000Z")
};

describe("classifyFieldPointBatch", () => {
  it("acknowledges eligible client IDs only after classifying a retry-safe batch", () => {
    const point = {
      clientPointId: "p-1",
      recordedAt: "2026-08-05T09:00:00.000Z",
      latitude: 11.566,
      longitude: 75.724,
      accuracy: 12
    };
    const first = classifyFieldPointBatch([point], options);
    const retry = classifyFieldPointBatch([point], options);
    expect(first.acknowledgedPointIds).toEqual(["p-1"]);
    expect(retry.accepted[0].row).toEqual(first.accepted[0].row);
  });

  it("keeps legacy v1.3.0 points compatible when clientPointId is absent", () => {
    const result = classifyFieldPointBatch([{
      recordedAt: "2026-08-05T09:00:00.000Z",
      latitude: 11.566,
      longitude: 75.724,
      accuracy: 12,
      sequence: 74
    }], options);
    expect(result.accepted).toHaveLength(1);
    expect(result.acknowledgedPointIds[0]).toMatch(/^legacy-/);
    expect(result.rejectedPointIds).toEqual([]);
    expect(result.accepted[0].row.sequence).toBeNull();
  });

  it("does not persist a restarted client sequence as database identity", () => {
    const points = [1, 1].map((sequence, index) => ({
      clientPointId: `restart-${index}`,
      recordedAt: new Date(options.earliestAllowedMs + 60_000 + index * 10_000).toISOString(),
      latitude: 11.566 + index * 0.0001,
      longitude: 75.724,
      accuracy: 9,
      sequence
    }));
    const result = classifyFieldPointBatch(points, options);
    expect(result.accepted).toHaveLength(2);
    expect(result.accepted.every((point) => point.row.sequence === null)).toBe(true);
  });

  it("terminally rejects invalid and out-of-duty-window points", () => {
    const result = classifyFieldPointBatch([
      { clientPointId: "bad-gps", recordedAt: "2026-08-05T09:00:00Z", latitude: 0, longitude: 0 },
      { clientPointId: "late", recordedAt: "2026-08-06T09:00:00Z", latitude: 11, longitude: 75 }
    ], options);
    expect(result.acknowledgedPointIds).toEqual([]);
    expect(result.rejectedPointIds).toEqual(["bad-gps", "late"]);
    expect(result.rejectionReasons["bad-gps"]).toBe("invalid_coordinates");
    expect(result.rejectionReasons.late).toBe("outside_duty_window");
  });

  it("accepts a legacy reconnect batch up to the 500-point safety cap", () => {
    const points = Array.from({ length: 525 }, (_, index) => ({
      clientPointId: `p-${index}`,
      recordedAt: new Date(options.earliestAllowedMs + 60_000 + index * 1_000).toISOString(),
      latitude: 11,
      longitude: 75,
      accuracy: 10
    }));
    expect(classifyFieldPointBatch(points, options).accepted).toHaveLength(500);
  });
});
