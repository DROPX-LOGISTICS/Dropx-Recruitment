import { describe, expect, it } from "vitest";
import { fieldDutyViewerScope } from "./field-duty-access";

const user = (functionName: "field_recruiter" | "manager" | "viewer", manager: string | null = null) => ({
  function: functionName,
  designationCode: null,
  trackPerformance: functionName === "field_recruiter",
  reportingManagerProfileId: manager
});

describe("fieldDutyViewerScope", () => {
  const configuredUsers = {
    manager: user("manager"),
    recruiter: user("field_recruiter", "manager"),
    outsider: user("field_recruiter")
  };

  it("keeps a view-only non-manager restricted to their own data", () => {
    expect(fieldDutyViewerScope({ profileId: "viewer", functionName: "viewer", fullScope: false, configuredUsers }))
      .toEqual({ visibility: "own", profileIds: ["viewer"] });
  });

  it("lets an explicitly permitted manager see only their reporting team", () => {
    expect(fieldDutyViewerScope({ profileId: "manager", functionName: "manager", fullScope: false, configuredUsers }))
      .toEqual({ visibility: "team", profileIds: ["manager", "recruiter"] });
  });

  it("uses an empty profile filter only for explicit all access", () => {
    expect(fieldDutyViewerScope({ profileId: "owner", functionName: "manager", fullScope: true, configuredUsers }))
      .toEqual({ visibility: "all", profileIds: [] });
  });

  it("never expands a field recruiter's personal history to other users", () => {
    expect(fieldDutyViewerScope({ profileId: "recruiter", functionName: "field_recruiter", fullScope: true, configuredUsers }))
      .toEqual({ visibility: "own", profileIds: ["recruiter"] });
  });
});
