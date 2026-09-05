import { describe, expect, it } from "vitest";
import {
  canonicalApplicationKey,
  canonicalLeadKey,
  normalizePhone,
  parseAdRoute,
  parseAdRouteWithMasters
} from "./recruitment-routing";
import { extractMetaFormIds } from "./meta-ingestion";

describe("recruitment routing", () => {
  it("routes workforce roles from ad name only", () => {
    expect(parseAdRoute("SBPD_DA").roleCode).toBe("DA");
    expect(parseAdRoute("PEUA_ODCD_22062026").stream).toBe("workforce");
  });

  it("routes white-collar roles from ad name only", () => {
    expect(parseAdRoute("SBPD_RC Recruiter").stream).toBe("hr");
    expect(parseAdRoute("JUGD_STATION_MANAGER").roleCode).toBe("STM");
    expect(parseAdRoute("GNTF_SSA").stream).toBe("hr");
  });

  it("does not use campaign or ad-set metadata", () => {
    expect(parseAdRoute("SBPD_RC").roleCode).toBe("RC");
  });

  it("keeps existing Meta ad-name routing unchanged when Indeed is enabled", () => {
    expect(parseAdRoute("ERSE_DCD")).toMatchObject({ stationCode: "ERSE", roleCode: "DCD", stream: "workforce" });
    expect(parseAdRoute("SBPD_RC Recruiter")).toMatchObject({ stationCode: "SBPD", roleCode: "RC", stream: "hr" });
  });

  it("uses live designation aliases saved in the master", () => {
    expect(parseAdRouteWithMasters(
      "SBPD Talent Acquisition Executive July",
      [{ code: "SBPD" }, { code: "KLZA" }],
      [
        { code: "DA", name: "Delivery Associate", stream: "workforce", aliases: [] },
        { code: "RC", name: "Recruiter", stream: "hr", aliases: ["Talent Acquisition Executive"] }
      ]
    )).toEqual({
      adName: "SBPD Talent Acquisition Executive July",
      stationCode: "SBPD",
      roleCode: "RC",
      stream: "hr"
    });
  });

  it("routes a new master designation code without adding it to application code", () => {
    expect(parseAdRouteWithMasters(
      "ERSE_RINF_01092026",
      [{ code: "ERSE" }],
      [{ code: "RINF", name: "Recruitment Influencer", stream: "workforce", aliases: [] }]
    )).toEqual({
      adName: "ERSE_RINF_01092026",
      stationCode: "ERSE",
      roleCode: "RINF",
      stream: "workforce"
    });
  });

  it("routes station VEND ads to the workforce Vendor designation from the master", () => {
    const locations = [{ code: "ERSE" }, { code: "AWEZ" }];
    const roles = [
      { code: "VEND", name: "Vendor", stream: "workforce" as const, aliases: ["VENDOR"] }
    ];

    expect(parseAdRouteWithMasters("ERSE_VEND", locations, roles)).toEqual({
      adName: "ERSE_VEND",
      stationCode: "ERSE",
      roleCode: "VEND",
      stream: "workforce"
    });
    expect(parseAdRouteWithMasters("AWEZ_VEND_05092026", locations, roles)).toMatchObject({
      stationCode: "AWEZ",
      roleCode: "VEND",
      stream: "workforce"
    });
  });

  it("does not invent a station from campaign-like words", () => {
    expect(parseAdRouteWithMasters(
      "Kerala Summer Hiring Delivery Associate",
      [{ code: "SBPD" }, { code: "KLZA" }],
      [{ code: "DA", name: "Delivery Associate", stream: "workforce", aliases: [] }]
    ).stationCode).toBeNull();
  });

  it("normalizes Indian phone values", () => {
    expect(normalizePhone("p:+91 79024 28024")).toBe("7902428024");
  });

  it("prefers immutable Meta lead identity", () => {
    expect(canonicalLeadKey("l:123", "7902428024")).toBe("meta:l:123");
  });

  it("deduplicates repeated submissions to the same ad", () => {
    expect(canonicalApplicationKey("238512345", "+91 98765 43210", "lead-a"))
      .toBe("application:238512345:9876543210");
    expect(canonicalApplicationKey("238512345", "9876543210", "lead-b"))
      .toBe("application:238512345:9876543210");
    expect(canonicalApplicationKey("different-ad", "9876543210", "lead-b"))
      .not.toBe(canonicalApplicationKey("238512345", "9876543210", "lead-b"));
  });

  it("treats cosmetic ad-name differences as the same application", () => {
    expect(canonicalApplicationKey("SBPD_RC Recruiter", "+91 98765 43210", "lead-a"))
      .toBe(canonicalApplicationKey(" sbpd rc recruiter ", "9876543210", "lead-b"));
  });

  it("discovers Meta form IDs from preserved source payloads", () => {
    expect(extractMetaFormIds([
      { form_id: "1014288561117099" },
      { webhook: { meta_form_id: "985604101042491" } },
      { creative: { object_story_spec: { link_data: { call_to_action: { value: { lead_gen_form_id: "838279102221451" } } } } } },
      { form_id: "not-an-id" }
    ])).toEqual(["1014288561117099", "985604101042491", "838279102221451"]);
  });
});
