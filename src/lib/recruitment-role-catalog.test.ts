import { describe, expect, it } from "vitest";
import { workspaceRoleCatalog } from "./recruitment-role-catalog";

describe("workspaceRoleCatalog", () => {
  it("lists a newly added master designation without a code release", () => {
    expect(workspaceRoleCatalog([
      { code: "DA", name: "Delivery Associate", stream: "workforce" },
      { code: "NEWX", name: "Future Master Role", stream: "workforce" }
    ], "workforce")).toEqual([
      { code: "DA", name: "Delivery Associate", stream: "workforce" },
      { code: "NEWX", name: "Future Master Role", stream: "workforce" }
    ]);
  });

  it("keeps an observed legacy ad role visible while deduplicating the master", () => {
    expect(workspaceRoleCatalog(
      [{ code: "RINF", name: "Recruitment Influencer", stream: "workforce" }],
      "workforce",
      [
        { code: "rinf", name: "Old label", stream: "workforce" },
        { code: "RC", name: "Recruiter", stream: "hr" }
      ]
    )).toEqual([
      { code: "RINF", name: "Recruitment Influencer", stream: "workforce" }
    ]);
  });
});
