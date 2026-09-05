import { describe, expect, it } from "vitest";
import { assertRecruitWorkforceIdentity, parseOnboardingIdentity, recruitmentIdentityExceptionMetadata } from "./onboarding-identity";

const existing = {
  source_type: "employees",
  source_id: "employee-1",
  display_name: "Existing Person",
  designation_code: "SSA",
  designation_name: "Station Support Associate",
  profile_status: "active"
};

describe("Recruit to Workforce identity guard", () => {
  it("blocks the same designation", () => {
    expect(() => assertRecruitWorkforceIdentity(parseOnboardingIdentity({ exact_matches: [existing] }))).toThrow(/cannot be onboarded again/i);
  });

  it("flags a different designation for Workforce approval", () => {
    const evaluation = parseOnboardingIdentity({ other_matches: [existing] });
    expect(() => assertRecruitWorkforceIdentity(evaluation)).not.toThrow();
    expect(recruitmentIdentityExceptionMetadata(evaluation)).toMatchObject({ identity_exception_required: true });
  });
});
