import { describe, expect, it } from "vitest";
import {
  effectivePerformanceFunction,
  performanceActorIds,
  selectPerformanceMembers,
  type PerformanceMember
} from "./recruiter-performance-membership";

const members: PerformanceMember[] = [
  {
    profileId: "pooja", accessId: "access-pooja", name: "C. POOJA SREE", email: "pooja@example.com",
    function: "telecaller", reportingManagerProfileId: "manager", locationIds: ["koza"], active: true,
    workforceEnabled: true
  },
  {
    profileId: "shaheen", accessId: "access-shaheen", name: "SHAHEEN", email: "shaheen@example.com",
    function: "telecaller", reportingManagerProfileId: "manager", locationIds: ["koza"], active: true,
    workforceEnabled: true
  },
  {
    profileId: "shifa", accessId: "access-shifa", name: "SHIFA", email: "shifa@example.com",
    function: "telecaller", reportingManagerProfileId: "manager", locationIds: ["ktuo"], active: true,
    workforceEnabled: true
  },
  {
    profileId: "anees", accessId: "access-anees", name: "ANEES", email: "anees@example.com",
    function: "field_recruiter", reportingManagerProfileId: "manager", locationIds: ["koza"], active: true,
    workforceEnabled: true
  },
  {
    profileId: "maya", accessId: "access-maya", name: "MAYA", email: "maya@example.com",
    function: "influencer", reportingManagerProfileId: "manager", locationIds: ["koza"], active: true,
    workforceEnabled: true
  }
];

describe("selectPerformanceMembers", () => {
  it("pre-seeds every active telecaller independently of activity or legacy tracking flags", () => {
    expect(selectPerformanceMembers({
      members, viewerProfileId: "owner", viewerLocationIds: [], allLocations: true,
      personalOnly: false, view: "telecaller"
    }).map((member) => member.profileId)).toEqual(["pooja", "shaheen", "shifa"]);
  });

  it("strictly separates field recruiters from Telecaller Performance", () => {
    expect(selectPerformanceMembers({
      members, viewerProfileId: "owner", viewerLocationIds: [], allLocations: true,
      personalOnly: false, view: "telecaller"
    }).some((member) => member.profileId === "anees")).toBe(false);
    expect(selectPerformanceMembers({
      members, viewerProfileId: "owner", viewerLocationIds: [], allLocations: true,
      personalOnly: false, view: "combined"
    }).map((member) => member.profileId)).toContain("anees");
    expect(selectPerformanceMembers({
      members, viewerProfileId: "owner", viewerLocationIds: [], allLocations: true,
      personalOnly: false, view: "telecaller"
    }).some((member) => member.profileId === "maya")).toBe(false);
    expect(selectPerformanceMembers({
      members, viewerProfileId: "owner", viewerLocationIds: [], allLocations: true,
      personalOnly: false, view: "influencer"
    }).map((member) => member.profileId)).toEqual(["maya"]);
  });

  it("enforces personal view and manager scope while preserving configured reporting teams", () => {
    expect(selectPerformanceMembers({
      members, viewerProfileId: "shaheen", viewerLocationIds: ["koza"], allLocations: false,
      personalOnly: true, view: "telecaller"
    }).map((member) => member.profileId)).toEqual(["shaheen"]);
    expect(selectPerformanceMembers({
      members, viewerProfileId: "manager", viewerLocationIds: ["koza"], allLocations: false,
      personalOnly: false, view: "telecaller"
    }).map((member) => member.profileId)).toEqual(["pooja", "shaheen", "shifa"]);
  });

  it("removes inactive or disabled users without changing historical action attribution", () => {
    const changed = members.map((member) => member.profileId === "pooja"
      ? { ...member, active: false }
      : member);
    expect(selectPerformanceMembers({
      members: changed, viewerProfileId: "owner", viewerLocationIds: [], allLocations: true,
      personalOnly: false, view: "telecaller"
    }).map((member) => member.profileId)).toEqual(["shaheen", "shifa"]);
  });
});

describe("performance attribution", () => {
  it("includes legacy metadata attribution used by individual scorecards", () => {
    expect(performanceActorIds({
      actor_profile_id: null,
      actor_email: null,
      metadata: {
        telecaller_profile_id: "pooja",
        recruiter_profile_id: "pooja",
        field_recruiter_profile_id: "anees",
        influencer_profile_id: "maya"
      }
    }, new Map())).toEqual(["pooja", "anees", "maya"]);
  });

  it("deduplicates direct, metadata and email attribution", () => {
    expect(performanceActorIds({
      actor_profile_id: "shaheen",
      actor_email: "shaheen@example.com",
      metadata: { telecaller_profile_id: "shaheen" }
    }, new Map([["shaheen@example.com", "shaheen"]]))).toEqual(["shaheen"]);
  });

  it("matches every profile sharing a historical actor email so the active roster wins", () => {
    expect(performanceActorIds({
      actor_profile_id: "old-profile",
      actor_email: "shifa@example.com",
      metadata: null
    }, new Map([["shifa@example.com", ["old-profile", "shifa"]]]))).toEqual([
      "old-profile", "shifa"
    ]);
  });

  it("treats configured Telecaller Performance access as the effective function", () => {
    expect(effectivePerformanceFunction({
      configuredFunction: "viewer",
      canViewTelecallerPerformance: true
    })).toBe("telecaller");
    expect(effectivePerformanceFunction({
      configuredFunction: "viewer",
      canViewTelecallerPerformance: false
    })).toBe("viewer");
    expect(effectivePerformanceFunction({
      configuredFunction: "field_recruiter",
      canViewTelecallerPerformance: true
    })).toBe("field_recruiter");
  });
});
