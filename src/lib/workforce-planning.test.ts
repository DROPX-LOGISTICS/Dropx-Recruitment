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
  it("never counts a pending applicant as training from joining date alone", () => {
    expect(classifyWorkforceLifecycle({
      reportingDate: "2026-08-03",
      dateOfJoin: "2026-07-29",
      isActive: true,
      onboardingStatus: "pending",
      activity: noActivity
    }).stage).toBe("applicant");
  });

  it('uses the verified Workforce journey before activity-age heuristics',()=>{
    for(const joiningStage of ['training','awaiting_arrival','awaiting_activation','applicant','offboarded','ready'] as const) {
      expect(classifyWorkforceLifecycle({reportingDate:'2026-09-20',dateOfJoin:'2026-08-01',isActive:false,joiningStage,activity:noActivity}).stage).toBe(joiningStage);
    }
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
