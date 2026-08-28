import { describe, expect, it } from "vitest";
import { adjustedHiringNeed, classifyWorkforceLifecycle } from "./workforce-planning";

const noActivity = {
  lastActivityDate: null,
  activeDays7: 0,
  activeDays30: 0,
  deliveries7: 0,
  deliveries30: 0
};

describe("workforce planning lifecycle", () => {
  it("counts a recent joiner without an operations ID as training", () => {
    expect(classifyWorkforceLifecycle({
      reportingDate: "2026-08-03",
      dateOfJoin: "2026-07-29",
      isActive: true,
      onboardingStatus: "pending",
      activity: noActivity
    }).stage).toBe("training");
  });

  it("does not keep an old zero-activity record in training", () => {
    expect(classifyWorkforceLifecycle({
      reportingDate: "2026-08-03",
      dateOfJoin: "2026-07-01",
      isActive: true,
      onboardingStatus: "active",
      activity: noActivity
    }).stage).toBe("stopped");
  });

  it("moves active associates through cooling and attrition risk", () => {
    const cooling = classifyWorkforceLifecycle({
      reportingDate: "2026-08-03",
      dateOfJoin: "2026-06-01",
      isActive: true,
      activity: { ...noActivity, lastActivityDate: "2026-07-29", activeDays30: 8 }
    });
    const risk = classifyWorkforceLifecycle({
      reportingDate: "2026-08-03",
      dateOfJoin: "2026-06-01",
      isActive: true,
      activity: { ...noActivity, lastActivityDate: "2026-07-24", activeDays30: 8 }
    });
    expect(cooling.stage).toBe("cooling");
    expect(risk.stage).toBe("attrition_risk");
  });

  it("reduces a station hiring gap by healthy training headcount", () => {
    expect(adjustedHiringNeed(5, 2)).toBe(3);
    expect(adjustedHiringNeed(2, 4)).toBe(0);
  });
});
