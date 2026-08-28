import { describe, expect, it } from "vitest";
import { workforceFunctionFor, type WorkforceUserFunction } from "./recruitment-workforce-config";

describe("workforceFunctionFor", () => {
  it("uses the designation saved in Master instead of deriving incentive access from the function name", () => {
    const configured: Record<string, WorkforceUserFunction> = {
      "profile-1": {
        function: "telecaller",
        designationCode: "TELE_CALLER",
        trackPerformance: true,
        reportingManagerProfileId: null
      }
    };

    expect(workforceFunctionFor("profile-1", "workforce", false, configured)).toEqual(
      expect.objectContaining({
        function: "telecaller",
        designationCode: "TELE_CALLER",
        trackPerformance: true
      })
    );
  });

  it("resolves legacy access-id aliases without hardcoding a user or designation", () => {
    const configured: Record<string, WorkforceUserFunction> = {
      "access-1": {
        function: "telecaller",
        designationCode: "TELE_CALLER",
        trackPerformance: true,
        reportingManagerProfileId: "manager-1"
      }
    };

    expect(
      workforceFunctionFor("profile-1", "workforce", false, configured, ["access-1"])
    ).toEqual(configured["access-1"]);
  });

  it("resolves Pooja's effective telecaller function from the canonical User Access identity", () => {
    const configured: Record<string, WorkforceUserFunction> = {
      "access-pooja": {
        function: "telecaller",
        designationCode: "TC",
        trackPerformance: false,
        reportingManagerProfileId: "manager-1"
      }
    };

    expect(workforceFunctionFor(
      "profile-pooja", "workforce", false, configured, ["access-pooja"], "TC", "Executive"
    )).toEqual(configured["access-pooja"]);
  });

  it("keeps owner and administrator fallback separate from incentive eligibility", () => {
    expect(workforceFunctionFor("owner-1", "owner", true, {})).toEqual({
      function: "manager",
      designationCode: null,
      trackPerformance: false,
      reportingManagerProfileId: null
    });
  });

  it("derives field recruiter access from the universal FREC role", () => {
    expect(
      workforceFunctionFor("profile-1", "workforce", false, {}, [], "FREC", "Field Recruiter")
    ).toEqual({
      function: "field_recruiter",
      designationCode: "FREC",
      trackPerformance: true,
      reportingManagerProfileId: null
    });
  });

  it("derives a separate influencer function from the canonical RINF role", () => {
    expect(workforceFunctionFor(
      "profile-influencer", "workforce", false, {}, [], "RINF", "Recruitment Influencer"
    )).toEqual({
      function: "influencer",
      designationCode: "RINF",
      trackPerformance: true,
      reportingManagerProfileId: null
    });
  });

  it("normalizes an existing field recruiter mapping to the universal FREC identity", () => {
    const configured: Record<string, WorkforceUserFunction> = {
      "profile-1": {
        function: "field_recruiter",
        designationCode: "FIELD_RECRUITER",
        trackPerformance: false,
        reportingManagerProfileId: "manager-1"
      }
    };

    expect(
      workforceFunctionFor(
        "profile-1",
        "workforce",
        false,
        configured,
        [],
        "FREC",
        "Field Recruiter"
      )
    ).toEqual({
      function: "field_recruiter",
      designationCode: "FREC",
      trackPerformance: true,
      reportingManagerProfileId: "manager-1"
    });
  });
});
