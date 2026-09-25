import { describe, expect, it } from "vitest";
import {
  allowedHrFirstCallOutcomeCodes,
  defaultHrLifecycleRules,
  interviewDecisionTransition,
  validateHrTransition
} from "./hr-recruitment-lifecycle";

describe("HR recruitment lifecycle", () => {
  it("moves a successful first interview to round two", () => {
    expect(interviewDecisionTransition("advance", 1, 2)).toBe("round_2_pending");
  });

  it("moves the final successful interview to selection", () => {
    expect(interviewDecisionTransition("advance", 2, 2)).toBe("selected");
  });

  it("blocks recruiters from recording interviewer-only outcomes", () => {
    expect(() => validateHrTransition({
      currentCode: "interview_scheduled",
      nextCode: "interview_completed",
      actor: "recruiter",
      remarks: "Good fit",
      rules: defaultHrLifecycleRules
    })).toThrow(/assigned interviewer/i);
  });

  it("requires feedback for interviewer decisions", () => {
    expect(() => validateHrTransition({
      currentCode: "interview_scheduled",
      nextCode: "interview_completed",
      actor: "interviewer",
      remarks: "",
      rules: defaultHrLifecycleRules
    })).toThrow(/remark is required/i);
  });

  it("allows a governed no-show outcome", () => {
    expect(validateHrTransition({
      currentCode: "interview_scheduled",
      nextCode: "interview_no_show",
      actor: "interviewer",
      remarks: "Candidate did not join the call",
      rules: defaultHrLifecycleRules
    }).code).toBe("interview_no_show");
  });

  it("allows HR to mark a follow-up candidate as not fit", () => {
    expect(validateHrTransition({
      currentCode: "no_response",
      nextCode: "not_fit",
      actor: "recruiter",
      remarks: "Connected on follow-up and the role is not suitable",
      rules: defaultHrLifecycleRules
    }).code).toBe("not_fit");
    expect(validateHrTransition({
      currentCode: "call_back",
      nextCode: "not_fit",
      actor: "recruiter",
      remarks: "Candidate is outside the role criteria",
      rules: defaultHrLifecycleRules
    }).code).toBe("not_fit");
  });

  it("only presents first-call outcomes allowed from the current status", () => {
    expect(allowedHrFirstCallOutcomeCodes(defaultHrLifecycleRules, "no_response"))
      .toEqual(["profile_shared", "interview_scheduled", "no_response", "call_back", "not_fit", "not_interested"]);
    expect(allowedHrFirstCallOutcomeCodes(defaultHrLifecycleRules, "not_fit")).toEqual([]);
    expect(allowedHrFirstCallOutcomeCodes(defaultHrLifecycleRules, "not_interested")).toEqual([]);
  });

  it("offers Not interested and Profile shared as call outcomes for a new candidate", () => {
    const codes = allowedHrFirstCallOutcomeCodes(defaultHrLifecycleRules, "new");
    expect(codes).toContain("not_interested");
    expect(codes).toContain("profile_shared");
  });

  it("allows marking a candidate not interested from an active stage, and it is terminal", () => {
    expect(validateHrTransition({
      currentCode: "screening",
      nextCode: "not_interested",
      actor: "recruiter",
      remarks: "Candidate declined to proceed",
      rules: defaultHrLifecycleRules
    }).code).toBe("not_interested");
    const notInterested = defaultHrLifecycleRules.find((rule) => rule.code === "not_interested");
    expect(notInterested?.isTerminal).toBe(true);
    expect(notInterested?.allowedNextCodes).toEqual([]);
  });

  it("allows sharing a candidate's profile after screening, ahead of interview scheduling", () => {
    expect(validateHrTransition({
      currentCode: "screening",
      nextCode: "profile_shared",
      actor: "recruiter",
      remarks: "Shared with the hiring manager",
      rules: defaultHrLifecycleRules
    }).code).toBe("profile_shared");
    const profileShared = defaultHrLifecycleRules.find((rule) => rule.code === "profile_shared");
    expect(profileShared?.allowedNextCodes).toContain("interview_scheduled");
  });
});
