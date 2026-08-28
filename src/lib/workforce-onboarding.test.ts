import { describe, expect, it } from "vitest";
import { normalizeFieldExecutiveEmail, normalizeFieldExecutiveMobile, normalizeRecruitmentJoiningFields } from "./workforce-onboarding";

describe("field executive identity normalization", () => {
  it("canonicalizes Indian mobile values to the same ten-digit identity", () => {
    expect(normalizeFieldExecutiveMobile("+91 82812 73828")).toBe("8281273828");
    expect(normalizeFieldExecutiveMobile("8281273828")).toBe("8281273828");
  });

  it("normalizes email case and surrounding whitespace", () => {
    expect(normalizeFieldExecutiveEmail("  Jamsheer@Example.COM ")).toBe("jamsheer@example.com");
  });

  it("requires email while keeping pre-entered IDs optional because HO owns activation", () => {
    expect(normalizeRecruitmentJoiningFields({
      email: "  Candidate@Example.COM ",
      employeeId: " dx-1001 ",
      providerEmployeeId: ""
    })).toEqual({ email: "candidate@example.com", dropxEmployeeId: "DX-1001", amazonCompId: "" });
    expect(() => normalizeRecruitmentJoiningFields({ email: "", employeeId: "DX-1" })).toThrow("Email ID is required");
    expect(normalizeRecruitmentJoiningFields({ email: "candidate@example.com", employeeId: "" }))
      .toEqual({ email: "candidate@example.com", dropxEmployeeId: "", amazonCompId: "" });
  });
});
