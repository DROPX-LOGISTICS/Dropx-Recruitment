import { describe, expect, it } from "vitest";
import {
  activateRecruitmentUserWorkspace,
  activeCompanyUserOptions,
  isRecruitmentUserWorkspaceEnabled
} from "./recruitment-user-workspaces";

describe("recruitment user workspace activation", () => {
  it("adds Workforce without removing an existing HR activation", () => {
    expect(activateRecruitmentUserWorkspace({ can_access_hr: true }, "workforce")).toEqual({
      can_access_workforce: true,
      can_access_hr: true
    });
  });

  it("adds HR without removing an existing Workforce activation", () => {
    expect(activateRecruitmentUserWorkspace({ can_access_workforce: true }, "hr")).toEqual({
      can_access_workforce: true,
      can_access_hr: true
    });
  });

  it("reports each workspace from its own saved activation", () => {
    const access = { can_access_workforce: true, can_access_hr: false };
    expect(isRecruitmentUserWorkspaceEnabled(access, "workforce")).toBe(true);
    expect(isRecruitmentUserWorkspaceEnabled(access, "hr")).toBe(false);
  });
});

describe("activeCompanyUserOptions", () => {
  it("lists every active main-dashboard user without requiring Recruitment role menus", () => {
    expect(activeCompanyUserOptions([
      { id: "2", full_name: "Workforce User", employee_id: "D2", is_active: true },
      { id: "1", full_name: "Unconfigured Role User", email: "user@example.com", is_active: true },
      { id: "3", full_name: "Inactive User", employee_id: "D3", is_active: false }
    ])).toEqual([
      ["1", "Unconfigured Role User — user@example.com"],
      ["2", "Workforce User — D2"]
    ]);
  });
});
