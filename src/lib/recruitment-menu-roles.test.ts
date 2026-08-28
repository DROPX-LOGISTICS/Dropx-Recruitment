import { describe, expect, it } from "vitest";
import {
  emptyRecruitmentMenuAccess,
  matchUniversalRole,
  recruitmentWorkspacesFromMenuAccess,
  restrictRecruitmentPermissionSetToUserWorkspaces,
} from "./recruitment-menu-roles";

describe("matchUniversalRole", () => {
  const roles = [
    { id: "role-admin", code: "ADMIN" },
    { id: "role-telecaller", code: "TELE_CALLER" }
  ];

  it("uses the universal role id when it is present", () => {
    expect(matchUniversalRole(roles, "role-telecaller", "ADMIN")?.id)
      .toBe("role-telecaller");
  });

  it("falls back to the universal role code for migrated profiles", () => {
    expect(matchUniversalRole(roles, null, "tele_caller")?.id)
      .toBe("role-telecaller");
  });

  it("does not invent access for an unknown role", () => {
    expect(matchUniversalRole(roles, null, "unknown")).toBeNull();
  });
});

describe("restrictRecruitmentPermissionSetToUserWorkspaces", () => {
  const permission = {
    workspaces: ["workforce", "hr"],
    webMenuIds: ["Dashboard", "Recruiter Performance"],
    mobileMenuIds: ["Dashboard", "Field Recruitment"],
    adRequestActions: ["view_own"],
    menuAccess: { workforce: { Dashboard: "view", "Recruiter Performance": "all" }, hr: { Dashboard: "view" } },
    menuActions: {
      workforce: { Dashboard: { view: true, add: false, edit: false }, "Recruiter Performance": { view: true, add: true, edit: true } },
      hr: { Dashboard: { view: true, add: false, edit: false } }
    },
    configured: true
  } as const;

  it("keeps only explicitly enabled workspaces", () => {
    const result = restrictRecruitmentPermissionSetToUserWorkspaces(permission as any, { workforce: true, hr: false });
    expect(result.workspaces).toEqual(["workforce"]);
    expect(result.menuAccess.hr).toEqual({});
    expect(result.menuAccess.workforce["Recruiter Performance"]).toBe("all");
  });
});

describe("emptyRecruitmentMenuAccess", () => {
  it("starts both workspaces with no implicit menu permissions", () => {
    expect(emptyRecruitmentMenuAccess()).toEqual({ workforce: {}, hr: {} });
  });

  it("derives section access only from menus that were granted", () => {
    expect(recruitmentWorkspacesFromMenuAccess({
      workforce: { Dashboard: "view" },
      hr: {}
    })).toEqual(["workforce"]);
    expect(recruitmentWorkspacesFromMenuAccess({
      workforce: {},
      hr: { Screening: "edit" }
    })).toEqual(["hr"]);
    expect(recruitmentWorkspacesFromMenuAccess({ workforce: {}, hr: {} })).toEqual([]);
  });
});
