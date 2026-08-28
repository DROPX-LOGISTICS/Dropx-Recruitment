import { describe, expect, it } from "vitest";
import {
  matchingMetaFormsForDesignation,
  recommendedMetaFormForDesignation,
  requireMetaFormForDesignation,
  scoreMetaFormForDesignation
} from "./meta-form-matching";

const forms = [
  { id: "clm", name: "CLM - Cluster Manager", status: "ACTIVE", createdTime: "2026-07-01T00:00:00Z" },
  { id: "dcd-old", name: "DCD-COMPANY VEHICLE - Driver cum DA", status: "ACTIVE", createdTime: "2026-07-01T00:00:00Z" },
  { id: "dcd-new", name: "DCD Company Vehicle Application", status: "ACTIVE", createdTime: "2026-08-01T00:00:00Z" },
  { id: "dcd-archived", name: "DCD old form", status: "ARCHIVED", createdTime: "2026-06-01T00:00:00Z" },
  { id: "ptda", name: "PTDA Part Time Delivery Associate", status: "ACTIVE", createdTime: null },
  { id: "da", name: "DA - Delivery Associate", status: "ACTIVE", createdTime: null }
];

describe("Meta instant-form designation matching", () => {
  it("matches DCD forms and never falls back to the first CLM form", () => {
    const matched = matchingMetaFormsForDesignation(forms, { code: "DCD", name: "Driver cum DA" });
    expect(matched.map((item) => item.id)).toEqual(["dcd-old", "dcd-new"]);
    expect(matched.some((item) => item.id === "clm")).toBe(false);
    expect(matched.some((item) => item.id === "dcd-archived")).toBe(false);
  });

  it("does not confuse a short DA code with DCD or PTDA", () => {
    expect(scoreMetaFormForDesignation(forms[1], { code: "DA", name: "Delivery Associate" })).toBe(0);
    expect(scoreMetaFormForDesignation(forms[4], { code: "DA", name: "Delivery Associate" })).toBe(0);
    expect(scoreMetaFormForDesignation(forms[5], { code: "DA", name: "Delivery Associate" })).toBeGreaterThan(0);
  });

  it("does not auto-pick when equally strong matching forms exist", () => {
    const equalMatches = [
      { id: "one", name: "DCD Application One", status: "ACTIVE" },
      { id: "two", name: "DCD Application Two", status: "ACTIVE" }
    ];
    expect(recommendedMetaFormForDesignation(equalMatches, { code: "DCD", name: "Driver cum DA" })).toBeNull();
  });

  it("blocks an unrelated or inactive form on the server", () => {
    expect(() => requireMetaFormForDesignation("clm", forms, { code: "DCD", name: "Driver cum DA" }))
      .toThrow("does not match DCD");
    expect(() => requireMetaFormForDesignation("dcd-archived", forms, { code: "DCD", name: "Driver cum DA" }))
      .toThrow("active Meta instant form");
    expect(requireMetaFormForDesignation("dcd-new", forms, { code: "DCD", name: "Driver cum DA" }).id)
      .toBe("dcd-new");
  });
});
