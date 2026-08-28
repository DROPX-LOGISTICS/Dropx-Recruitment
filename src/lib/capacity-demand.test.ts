import { describe, expect, it } from "vitest";
import { stableCapacityGap } from "./capacity-demand";

describe("stableCapacityGap", () => {
  it("uses the stable multi-day workload and median headcount", () => {
    const result = stableCapacityGap({
      days: [
        { activeIds: 33, workload: 2050 },
        { activeIds: 34, workload: 2120 },
        { activeIds: 34, workload: 2132 },
        { activeIds: 35, workload: 2190 },
        { activeIds: 34, workload: 2140 },
        { activeIds: 33, workload: 2110 },
        { activeIds: 34, workload: 2160 }
      ],
      targetSpr: 60,
      bufferPercent: 10
    });

    expect(result.currentHeadcount).toBe(34);
    expect(result.requiredHeadcount).toBe(40);
    expect(result.gap).toBe(6);
  });

  it("rounds any positive fractional modelled shortage up to a hiring need", () => {
    const result = stableCapacityGap({
      days: [
        { activeIds: 5, workload: 300 },
        { activeIds: 6, workload: 300 }
      ],
      targetSpr: 60,
      bufferPercent: 10
    });

    expect(result.modelledGap).toBe(0.5);
    expect(result.gap).toBe(1);
  });

  it("does not expose balanced or excess capacity as a recruitment gap", () => {
    const result = stableCapacityGap({
      days: [{ activeIds: 12, workload: 500 }],
      targetSpr: 60,
      bufferPercent: 0
    });

    expect(result.modelledGap).toBeLessThanOrEqual(0);
    expect(result.gap).toBe(0);
  });
});
