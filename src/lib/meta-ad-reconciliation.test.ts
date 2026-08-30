import { describe, expect, it } from "vitest";
import { findMetaRouteMismatch, leadingKnownStation } from "./meta-ad-reconciliation";

const stations = ["TLPA", "TLPB", "QLDA", "ERSE"];

describe("Meta ad route reconciliation", () => {
  it("finds station codes separated by underscores or spaces", () => {
    expect(leadingKnownStation("TLPA_DA_11082026", stations)).toBe("TLPA");
    expect(leadingKnownStation("TLPA DA AD", stations)).toBe("TLPA");
  });

  it("does not mistake a generic campaign name for a station", () => {
    expect(leadingKnownStation("Workforce Recruitment · Delivery Associate", stations)).toBeNull();
  });

  it("reports the TLPA ad linked to TLPB campaign objects", () => {
    expect(findMetaRouteMismatch({
      metaAdId: "120249462259440451",
      adName: "TLPA_DA_11082026",
      campaignName: "TLPB_DA_11082026",
      adsetName: "TLPB_DA_11082026",
      stationCodes: stations
    })).toMatchObject({
      adStation: "TLPA",
      campaignStation: "TLPB",
      adsetStation: "TLPB"
    });
  });

  it("accepts matching or generic campaign objects", () => {
    expect(findMetaRouteMismatch({
      metaAdId: "1",
      adName: "QLDA_DA_20260830",
      campaignName: "Workforce Recruitment · Delivery Associate",
      adsetName: "QLDA_DA_Local_15KM",
      stationCodes: stations
    })).toBeNull();
  });
});
