import { describe, expect, it } from "vitest";
import {
  WORKFORCE_ACTIVE_INTERVIEW_STATUS_QUERY,
  workforceInterviewActionOptions,
  workforceInterviewFilterOptions,
  workforceInterviewOutcomeRoute
} from "./workforce-interview-lifecycle";

describe("Workforce interview lifecycle", () => {
  it("keeps only scheduled, rescheduled and joined records in the active interview queue", () => {
    expect(WORKFORCE_ACTIVE_INTERVIEW_STATUS_QUERY).toBe("interview_scheduled,interview_rescheduled,joined");
    expect(WORKFORCE_ACTIVE_INTERVIEW_STATUS_QUERY).not.toContain("no_response");
    expect(WORKFORCE_ACTIVE_INTERVIEW_STATUS_QUERY).not.toContain("call_back");
  });

  it("exposes one outcome filter and preserves configured labels without duplicates", () => {
    const options = workforceInterviewFilterOptions([
      { code: "no_response", label: "Candidate Unreachable" },
      { code: "no_response", label: "Duplicate label" },
      { code: "not_fit", label: "Not Suitable" }
    ]);
    expect(options.filter((item) => item.code === "no_response")).toHaveLength(1);
    expect(options.find((item) => item.code === "no_response")?.label).toBe("Duplicate label");
    expect(options.find((item) => item.code === "not_fit")?.label).toBe("Not Suitable");
    expect(workforceInterviewActionOptions().some((item) => item.code === "interview_scheduled")).toBe(false);
  });

  it("routes reschedules, no responses and joins to deterministic next steps", () => {
    expect(workforceInterviewOutcomeRoute("interview_rescheduled")).toMatchObject({ queue: "interviews", requiresDate: true, scheduleType: "interview" });
    expect(workforceInterviewOutcomeRoute("no_response")).toMatchObject({ queue: "follow_up", requiresDate: false });
    expect(workforceInterviewOutcomeRoute("joined")).toMatchObject({ queue: "interviews", requiresOnboarding: true });
  });
});
