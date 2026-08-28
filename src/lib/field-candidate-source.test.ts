import { describe, expect, it } from "vitest";
import { fieldContactResult, isFieldCandidateStatus, normalizeFieldCandidatePhone, publicAttemptResult } from "./field-candidate-source";

describe("field candidate source firewall", () => {
  it("normalizes Indian and plain mobile numbers to one identity", () => {
    expect(normalizeFieldCandidatePhone("+91 98765 43210")).toBe("9876543210");
    expect(normalizeFieldCandidatePhone("09876543210")).toBe("9876543210");
    expect(normalizeFieldCandidatePhone("123")).toBe("");
  });

  it("returns a clear system-duplicate result without exposing another owner", () => {
    expect(fieldContactResult({ accepted: false, code: "DUPLICATE_SYSTEM_LEAD", sourceCategory: "paid_or_system" })).toMatchObject({
      accepted: false,
      status: 409,
      code: "DUPLICATE_SYSTEM_LEAD"
    });
    expect(fieldContactResult({ accepted: false, code: "DUPLICATE_SYSTEM_LEAD" }).message).not.toMatch(/meta|telecaller|owner/i);
  });

  it("keeps recruiter-reported joining separate from verified joining", () => {
    expect(isFieldCandidateStatus("joining_reported")).toBe(true);
    expect(isFieldCandidateStatus("joined_verified")).toBe(false);
  });

  it("labels audit attempts for manager reconciliation", () => {
    expect(publicAttemptResult("duplicate_system")).toBe("Already in recruitment database");
    expect(publicAttemptResult("duplicate_field")).toBe("Already submitted in field sourcing");
  });
});
