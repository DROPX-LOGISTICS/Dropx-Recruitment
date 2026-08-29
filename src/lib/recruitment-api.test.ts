import { describe, expect, it, vi } from "vitest";
import { applyLeadScope, canAccessLead, canUseRecruitmentMenu } from "./recruitment-api";
import type { MobileSessionContext } from "./mobile-session";

function session(overrides: Partial<MobileSessionContext> = {}): MobileSessionContext {
  return {
    sessionId: "session",
    mobileUserId: "mobile",
    profileId: "profile",
    displayName: "User",
    email: "user@dropxlogistics.com",
    accessId: "access",
    workforce: true,
    hr: true,
    allLocations: true,
    manageMasters: true,
    manageAds: true,
    manageUsers: true,
    accessTemplate: "owner",
    menuPermissions: [],
    menuAccess: { workforce: {}, hr: {} },
    menuActions: { workforce: {}, hr: {} },
    adRequestActions: ["create","view_own","view_scoped","view_all","review","approve","reject","publish","complete","cancel_own"],
    recruitmentFunction: "manager",
    trackPerformance: true,
    reportingManagerProfileId: null,
    designationCode: "OWNER",
    isOwner: true,
    canPreviewUsers: true,
    isPreview: false,
    viewerProfileId: "profile",
    previewProfileId: null,
    readOnly: false,
    locationIds: ["station-1"],
    roleIds: ["role-1"],
    ...overrides
  };
}

describe("applyLeadScope", () => {
  it("does not let historical role rows restrict Owner/Admin all-lead access", () => {
    const query = { in: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() };
    applyLeadScope(query, session());
    expect(query.in).not.toHaveBeenCalled();
    expect(query.eq).not.toHaveBeenCalled();
  });

  it("keeps explicit stream filtering for a full-access user", () => {
    const query = { in: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() };
    applyLeadScope(query, session(), "hr");
    expect(query.eq).toHaveBeenCalledWith("stream", "hr");
    expect(query.in).not.toHaveBeenCalled();
  });

  it("keeps location and role restrictions for scoped users", () => {
    const query = { in: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() };
    applyLeadScope(query, session({
      allLocations: false,
      manageUsers: false,
      locationIds: ["station-2"],
      roleIds: ["role-2"]
    }));
    expect(query.in).toHaveBeenCalledWith("location_id", ["station-2"]);
    expect(query.in).toHaveBeenCalledWith("role_id", ["role-2"]);
  });

  it("lets full-access users open unmapped leads", () => {
    expect(canAccessLead(session(), {
      stream: null,
      location_id: null,
      role_id: null
    })).toBe(true);
  });

  it("enforces stream, location and role scope for non-admin users", () => {
    const scoped = session({
      manageUsers: false,
      allLocations: false,
      workforce: true,
      hr: false,
      locationIds: ["station-2"],
      roleIds: ["role-2"]
    });
    expect(canAccessLead(scoped, {
      stream: "workforce",
      location_id: "station-2",
      role_id: "role-2"
    })).toBe(true);
    expect(canAccessLead(scoped, {
      stream: "hr",
      location_id: "station-2",
      role_id: "role-2"
    })).toBe(false);
    expect(canAccessLead(scoped, {
      stream: "workforce",
      location_id: null,
      role_id: "role-2"
    })).toBe(false);
  });
});

describe("canUseRecruitmentMenu", () => {
  const scoped = session({
    isOwner: false,
    accessTemplate: "workforce",
    menuAccess: { workforce: { "All Leads": "edit" }, hr: {} },
    menuActions: {
      workforce: { "All Leads": { view: true, add: true, edit: false } },
      hr: {}
    }
  });

  it("uses the ticked action columns instead of treating every visible menu as editable", () => {
    expect(canUseRecruitmentMenu(scoped, "All Leads", "view", "workforce")).toBe(true);
    expect(canUseRecruitmentMenu(scoped, "All Leads", "add", "workforce")).toBe(true);
    expect(canUseRecruitmentMenu(scoped, "All Leads", "edit", "workforce")).toBe(false);
    expect(canUseRecruitmentMenu(scoped, "All Leads", "all", "workforce")).toBe(false);
  });

  it("keeps Owner access universal for safe View-as comparisons", () => {
    expect(canUseRecruitmentMenu(session(), "Connections", "all", "hr")).toBe(true);
  });

  it("lets recruitment users view the separate WhatsApp log without granting replay access", () => {
    expect(canUseRecruitmentMenu(scoped, "WhatsApp Messages", "view", "workforce")).toBe(true);
    expect(canUseRecruitmentMenu(scoped, "WhatsApp Messages", "edit", "workforce")).toBe(false);
  });

  it("gives telecallers their personal performance view without a manual role-menu grant", () => {
    const telecaller = session({ isOwner: false, recruitmentFunction: "telecaller", menuAccess: { workforce: {}, hr: {} } });
    expect(canUseRecruitmentMenu(telecaller, "Recruiter Performance", "view", "workforce")).toBe(true);
    expect(canUseRecruitmentMenu(telecaller, "Performance Center", "view", "workforce")).toBe(false);
  });

  it("gives field recruiters their own field workflow without granting manager visibility", () => {
    const fieldRecruiter = session({ isOwner: false, recruitmentFunction: "field_recruiter", menuAccess: { workforce: {}, hr: {} } });
    expect(canUseRecruitmentMenu(fieldRecruiter, "Field Recruitment", "view", "workforce")).toBe(true);
    expect(canUseRecruitmentMenu(fieldRecruiter, "Field Recruitment", "add", "workforce")).toBe(true);
    expect(canUseRecruitmentMenu(fieldRecruiter, "Performance Center", "view", "workforce")).toBe(false);
  });

  it("keeps recruitment influencers inside referral onboarding and their personal scorecard", () => {
    const influencer = session({
      isOwner: false,
      recruitmentFunction: "influencer",
      designationCode: "RINF",
      menuAccess: { workforce: { "All Leads": "all" }, hr: {} }
    });
    expect(canUseRecruitmentMenu(influencer, "Influencer Performance", "view", "workforce")).toBe(true);
    expect(canUseRecruitmentMenu(influencer, "Field Executive Onboarding", "add", "workforce")).toBe(true);
    expect(canUseRecruitmentMenu(influencer, "All Leads", "view", "workforce")).toBe(false);
    expect(canUseRecruitmentMenu(influencer, "Recruiter Performance", "view", "workforce")).toBe(false);
    expect(canUseRecruitmentMenu(influencer, "Field Recruitment", "view", "workforce")).toBe(false);
  });
});
