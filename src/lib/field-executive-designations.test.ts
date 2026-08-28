import { describe, expect, it } from "vitest";
import {
  designationKeys,
  hasFieldExecutiveCategory,
  isFieldExecutiveDesignation
} from "./field-executive-designations";

describe("field executive designation eligibility", () => {
  it("accepts the current and legacy onboarding categories", () => {
    expect(hasFieldExecutiveCategory(["field_executives"])).toBe(true);
    expect(hasFieldExecutiveCategory(["delivery_executives"])).toBe(true);
  });

  it("uses an active workforce role as the transition fallback", () => {
    const workforceKeys = new Set(["da", "delivery associate"]);
    expect(isFieldExecutiveDesignation({
      code: "DA",
      name: "Delivery Associate",
      onboarding_categories: ["employees"]
    }, workforceKeys)).toBe(true);
  });

  it("does not expose unrelated dashboard designations", () => {
    expect(isFieldExecutiveDesignation({
      code: "FIN",
      name: "Finance Manager",
      onboarding_categories: ["employees"]
    }, new Set(["da", "delivery associate"]))).toBe(false);
  });

  it("normalizes code and name keys", () => {
    expect(designationKeys({ code: " DA ", name: " Delivery Associate " }))
      .toEqual(["da", "delivery associate"]);
  });
});
