import { describe, expect, it } from "vitest";
import { canSubmitFieldTravel, canSubmitTravelForDutyDay, fieldTravelStatus, fieldTravelSubmissionDay, maskBankAccount, validateTravelApprovalChain } from "./field-travel";

describe("field recruiter travel eligibility", () => {
  it("allows only the real signed-in FREC identity", () => {
    expect(canSubmitFieldTravel({ recruitmentFunction: "field_recruiter", readOnly: false, isPreview: false })).toBe(true);
    expect(canSubmitFieldTravel({ recruitmentFunction: "telecaller", readOnly: false, isPreview: false })).toBe(false);
    expect(canSubmitFieldTravel({ recruitmentFunction: "field_recruiter", readOnly: true, isPreview: true })).toBe(false);
  });

  it("masks bank accounts and maps canonical payment states", () => {
    expect(maskBankAccount("123456789012")).toBe("••••••••9012");
    expect(fieldTravelStatus({ status: "pending", approval_status: "PENDING_REPORTING_APPROVAL" })).toBe("pending_reporting_approval");
    expect(fieldTravelStatus({ status: "processed", bank_status: "SUCCESS" })).toBe("paid");
    expect(fieldTravelStatus({ status: "rejected" })).toBe("rejected");
  });

  it("requires two configured approvers and rejects self approval", () => {
    expect(validateTravelApprovalChain({ recruiterProfileId: "r", locationApproverProfileId: "l", reportingApproverProfileId: "b" }))
      .toEqual({ locationApproverProfileId: "l", reportingApproverProfileId: "b" });
    expect(() => validateTravelApprovalChain({ recruiterProfileId: "r", locationApproverProfileId: "r", reportingApproverProfileId: "b" }))
      .toThrow("cannot validate");
    expect(() => validateTravelApprovalChain({ recruiterProfileId: "r", locationApproverProfileId: "l", reportingApproverProfileId: "l" }))
      .toThrow("two different");
  });

  it("allows a field expense only on the duty day in India", () => {
    const nearMidnightUtc = new Date("2026-08-04T19:15:00.000Z");
    expect(fieldTravelSubmissionDay(nearMidnightUtc)).toBe("2026-08-05");
    expect(canSubmitTravelForDutyDay("2026-08-05", nearMidnightUtc)).toBe(true);
    expect(canSubmitTravelForDutyDay("2026-08-04", nearMidnightUtc)).toBe(false);
  });
});
