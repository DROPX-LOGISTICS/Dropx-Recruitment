import { describe, expect, it } from "vitest";
import {
  isValidMetaAudienceRadius,
  metaAudienceAdSetName,
  metaAudienceRadiusLabel
} from "./meta-audience-radius";

describe("Meta audience radius options", () => {
  it("supports exact whole-kilometre choices from 15 through 80", () => {
    expect(isValidMetaAudienceRadius(15)).toBe(true);
    expect(isValidMetaAudienceRadius("47")).toBe(true);
    expect(isValidMetaAudienceRadius(80)).toBe(true);
    expect(isValidMetaAudienceRadius(14)).toBe(false);
    expect(isValidMetaAudienceRadius(80.5)).toBe(false);
    expect(isValidMetaAudienceRadius(81)).toBe(false);
  });

  it("gives wide campaigns accurate labels and generated Meta names", () => {
    expect(metaAudienceRadiusLabel(60)).toContain("2–3 districts");
    expect(metaAudienceAdSetName("KOZA_DA", 80)).toBe("KOZA_DA_MultiDistrict_80KM");
    expect(metaAudienceAdSetName("KOZA_DA", 47)).toBe("KOZA_DA_Regional_47KM");
  });
});
