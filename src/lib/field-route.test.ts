import { describe, expect, it } from "vitest";
import { calculateFieldRouteMetrics, fieldTrackingPointIsUsable } from "./field-route";

const at = (minute: number, second = 0) => new Date(Date.UTC(2026, 7, 3, 8, minute, second)).toISOString();

describe("calculateFieldRouteMetrics", () => {
  it("keeps a stationary eight-hour GPS cloud at zero distance", () => {
    const points = Array.from({ length: 241 }, (_, index) => {
      const angle = index * 1.73;
      const radiusMeters = 4 + index % 5 * 2;
      return {
        recordedAt: new Date(Date.parse(at(0)) + index * 120_000).toISOString(),
        latitude: 11.566 + Math.sin(angle) * radiusMeters / 111_111,
        longitude: 75.724 + Math.cos(angle) * radiusMeters / (111_111 * Math.cos(11.566 * Math.PI / 180)),
        accuracy: 8 + index % 12,
        speed: 0,
        isMocked: false
      };
    });
    const result = calculateFieldRouteMetrics(points);
    expect(result.distanceMeters).toBe(0);
    expect(result.rawDistanceMeters).toBeGreaterThan(1_000);
    expect(result.stationaryPointCount).toBeGreaterThan(230);
  });

  it("calculates a sustained multi-kilometre route after movement confirmation", () => {
    const points = Array.from({ length: 25 }, (_, index) => ({
      recordedAt: new Date(Date.parse(at(0)) + index * 20_000).toISOString(),
      latitude: 11,
      longitude: 75 + index * 0.001,
      accuracy: 8,
      speed: 5.5,
      isMocked: false
    }));
    const result = calculateFieldRouteMetrics(points);
    expect(result.validPointCount).toBe(25);
    expect(result.distanceMeters).toBeGreaterThan(2_500);
    expect(result.distanceMeters).toBeLessThan(2_700);
    expect(result.confidencePercent).toBeGreaterThanOrEqual(95);
  });

  it("can recalculate server-normalized accepted points for the dashboard map", () => {
    const original = Array.from({ length: 25 }, (_, index) => ({
      recorded_at: new Date(Date.parse(at(0)) + index * 20_000).toISOString(),
      latitude: 11,
      longitude: 75 + index * 0.001,
      accuracy_meters: 8,
      speed_mps: 5.5,
      is_mocked: false
    }));
    const serverMetrics = calculateFieldRouteMetrics(original);
    const dashboardMetrics = calculateFieldRouteMetrics(serverMetrics.acceptedPoints);

    expect(serverMetrics.acceptedPoints.length).toBeGreaterThan(0);
    expect(dashboardMetrics.totalPointCount).toBe(serverMetrics.acceptedPoints.length);
    expect(dashboardMetrics.validPointCount).toBe(serverMetrics.acceptedPoints.length);
    expect(dashboardMetrics.qualityPoints.length).toBeGreaterThan(0);
    expect(dashboardMetrics.lastPointAt).toBe(serverMetrics.lastPointAt);
  });

  it("recovers an offline twelve-kilometre route with 20 precise points out of 74 readings", () => {
    const points = Array.from({ length: 74 }, (_, index) => ({
      clientPointId: `offline-${index}`,
      recordedAt: new Date(Date.parse(at(0)) + index * 60_000).toISOString(),
      latitude: 11,
      longitude: 75 + index * (0.11 / 73),
      accuracy: index % 4 === 0 || index === 73 ? 9 : 36,
      speed: 2.8,
      isMocked: false
    }));
    const result = calculateFieldRouteMetrics(points);
    expect(result.validPointCount).toBe(20);
    expect(result.totalPointCount).toBe(74);
    expect(result.coveragePercent).toBeCloseTo(27.03, 2);
    expect(result.distanceMeters).toBeGreaterThan(11_000);
    expect(result.distanceMeters).toBeLessThan(12_500);
  });

  it("starts a new segment instead of adding a long recovered-GPS bridge", () => {
    const start = Date.parse(at(0));
    const beforeGap = Array.from({ length: 6 }, (_, index) => ({
      recordedAt: new Date(start + index * 20_000).toISOString(),
      latitude: 11,
      longitude: 75 + index * 0.0005,
      accuracy: 8,
      speed: 4
    }));
    const afterGap = Array.from({ length: 7 }, (_, index) => ({
      recordedAt: new Date(start + 60 * 60_000 + index * 20_000).toISOString(),
      latitude: 11.2,
      longitude: 75.2 + index * 0.0005,
      accuracy: 8,
      speed: 4
    }));
    const result = calculateFieldRouteMetrics([...beforeGap, ...afterGap]);
    expect(result.evaluations.some((item) => item.rejectionCodes.includes("route_gap_reset"))).toBe(true);
    expect(result.distanceMeters).toBeGreaterThan(500);
    expect(result.distanceMeters).toBeLessThan(2_000);
    expect(result.routeSegments).toHaveLength(2);
  });

  it("does not turn sparse stationary samples across a blackout into a stop", () => {
    const start = Date.parse(at(0));
    const points = [0, 30 * 60_000, 30 * 60_000 + 20_000].map((offset, index) => ({
      recordedAt: new Date(start + offset).toISOString(),
      latitude: 11 + index * 0.000001,
      longitude: 75,
      accuracy: 8,
      speed: 0
    }));
    expect(calculateFieldRouteMetrics(points).stops).toHaveLength(0);
  });

  it("excludes a jump-and-return spike, mocked points and weak accuracy", () => {
    const points = [
      { recordedAt: at(0), latitude: 11, longitude: 75, accuracy: 8, speed: 4 },
      { recordedAt: at(0, 20), latitude: 11, longitude: 75.0005, accuracy: 8, speed: 4 },
      { recordedAt: at(0, 40), latitude: 11, longitude: 75.001, accuracy: 8, speed: 4 },
      { recordedAt: at(1), latitude: 11, longitude: 75.0015, accuracy: 8, speed: 4 },
      { recordedAt: at(1, 20), latitude: 12, longitude: 76, accuracy: 8, speed: 0 },
      { recordedAt: at(1, 40), latitude: 11, longitude: 75.0016, accuracy: 8, speed: 4 },
      { recordedAt: at(2), latitude: 11, longitude: 75.002, accuracy: 60, speed: 4 },
      { recordedAt: at(2, 20), latitude: 11, longitude: 75.003, accuracy: 8, speed: 4, isMocked: true }
    ];
    const result = calculateFieldRouteMetrics(points);
    expect(result.inaccuratePointCount).toBe(1);
    expect(result.mockedPointCount).toBe(1);
    expect(result.rejectedSegmentCount).toBeGreaterThanOrEqual(1);
    expect(result.evaluations.some((item) => item.rejectionCodes.includes("jump_return"))).toBe(true);
    expect(result.distanceMeters).toBeLessThan(300);
  });

  it("does not count a short wander that never confirms sustained movement", () => {
    const points = [
      { recordedAt: at(0), latitude: 11, longitude: 75, accuracy: 9 },
      { recordedAt: at(0, 5), latitude: 11, longitude: 75.00035, accuracy: 9 },
      { recordedAt: at(0, 10), latitude: 11, longitude: 74.9998, accuracy: 9 },
      { recordedAt: at(0, 15), latitude: 11, longitude: 75.00005, accuracy: 9 }
    ];
    expect(calculateFieldRouteMetrics(points).distanceMeters).toBe(0);
  });

  it("reports a meaningful stop without turning stationary drift into distance", () => {
    const start = Date.parse(at(0));
    const movingOut = Array.from({ length: 7 }, (_, index) => ({
      recordedAt: new Date(start + index * 20_000).toISOString(),
      latitude: 11,
      longitude: 75 + index * 0.0005,
      accuracy: 8,
      speed: 4,
    }));
    const stopBase = start + 7 * 20_000;
    const stopped = Array.from({ length: 13 }, (_, index) => ({
      recordedAt: new Date(stopBase + index * 30_000).toISOString(),
      latitude: 11 + Math.sin(index) * 3 / 111_111,
      longitude: 75.003 + Math.cos(index) * 3 / 109_000,
      accuracy: 8,
      speed: 0,
    }));
    const resumeBase = stopBase + 13 * 30_000;
    const movingAgain = Array.from({ length: 6 }, (_, index) => ({
      recordedAt: new Date(resumeBase + index * 20_000).toISOString(),
      latitude: 11,
      longitude: 75.0035 + index * 0.0005,
      accuracy: 8,
      speed: 4,
    }));
    const result = calculateFieldRouteMetrics([
      ...movingOut,
      ...stopped,
      ...movingAgain,
    ]);
    expect(result.stops).toHaveLength(1);
    expect(result.stops[0].durationMinutes).toBeGreaterThanOrEqual(5);
    expect(result.stops[0].latitude).toBeCloseTo(11, 4);
    expect(result.stops[0].longitude).toBeCloseTo(75.003, 3);
    expect(result.stationaryDurationSeconds).toBeGreaterThanOrEqual(300);
    expect(result.distanceMeters).toBeGreaterThan(600);
    expect(result.distanceMeters).toBeLessThan(1_200);
  });
});

describe("fieldTrackingPointIsUsable", () => {
  const current = {
    recordedAt: "2026-08-04T08:00:00.000Z",
    latitude: 11.566,
    longitude: 75.724,
    accuracy: 18,
    isMocked: false
  };

  it("accepts a fresh, precise, real device location", () => {
    expect(fieldTrackingPointIsUsable(current, {
      nowMs: Date.parse("2026-08-04T08:00:05.000Z"), maximumAgeMs: 10_000
    })).toBe(true);
  });

  it("rejects zero coordinates, mock locations, stale points and accuracy over 25 metres", () => {
    expect(fieldTrackingPointIsUsable({ ...current, latitude: 0, longitude: 0 })).toBe(false);
    expect(fieldTrackingPointIsUsable({ ...current, isMocked: true })).toBe(false);
    expect(fieldTrackingPointIsUsable({ ...current, accuracy: 26 })).toBe(false);
    expect(fieldTrackingPointIsUsable(current, {
      nowMs: Date.parse("2026-08-04T08:00:11.000Z"), maximumAgeMs: 10_000
    })).toBe(false);
  });
});
