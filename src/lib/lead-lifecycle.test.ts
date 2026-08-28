import { describe, expect, it } from "vitest";
import { canTransition, contactAttemptUpdate } from "./lead-lifecycle";

describe("lead lifecycle", () => {
  it("lets a legacy blank-status lead enter the working lifecycle directly", () => {
    expect(canTransition("", "no_response")).toBe(true);
    expect(canTransition("", "call_back")).toBe(true);
    expect(canTransition("", "interested")).toBe(true);
  });
  it("allows the operational callback and interview path", () => {
    expect(canTransition("new", "call_back")).toBe(true);
    expect(canTransition("call_back", "interested")).toBe(true);
    expect(canTransition("interested", "interview_scheduled")).toBe(true);
    expect(canTransition("interview_scheduled", "selected")).toBe(true);
    expect(canTransition("interview_scheduled", "joined")).toBe(true);
    expect(canTransition("interview_rescheduled", "joined")).toBe(true);
  });

  it("increments total and no-response attempts independently", () => {
    expect(contactAttemptUpdate({
      nextStatus: "no_response",
      totalAttempts: 3,
      noResponseAttempts: 1,
      callBackAttempts: 2,
      now: "2026-07-28T20:00:00.000Z"
    })).toEqual({
      actualStatus: "no_response",
      fields: { total_attempts: 4, no_response_attempts: 2 }
    });
  });

  it("archives exactly on the fifth no-response attempt", () => {
    expect(contactAttemptUpdate({
      nextStatus: "no_response",
      totalAttempts: 8,
      noResponseAttempts: 4,
      callBackAttempts: 4,
      now: "2026-07-28T20:00:00.000Z"
    })).toEqual({
      actualStatus: "archived",
      fields: {
        total_attempts: 9,
        no_response_attempts: 5,
        status: "archived",
        archived: true,
        archived_at: "2026-07-28T20:00:00.000Z"
      }
    });
  });

  it("increments callbacks without changing the no-response counter", () => {
    expect(contactAttemptUpdate({
      nextStatus: "call_back",
      totalAttempts: 2,
      noResponseAttempts: 2,
      callBackAttempts: 0,
      now: "2026-07-28T20:00:00.000Z"
    })).toEqual({
      actualStatus: "call_back",
      fields: { total_attempts: 3, call_back_attempts: 1 }
    });
  });
});
