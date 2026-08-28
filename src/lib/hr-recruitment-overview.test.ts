import { describe, expect, it } from "vitest";
import {
  isCurrentRequisitionStatus,
  normalizeCandidateLocation,
  remainingRequisitionOpenings
} from "./hr-recruitment-overview";

describe("HR recruitment overview", () => {
  it("normalizes editable candidate city and Indian PIN details", () => {
    expect(normalizeCandidateLocation("  Perumbavoor  ", " 683542 ")).toEqual({
      city: "Perumbavoor",
      postCode: "683542"
    });
    expect(normalizeCandidateLocation("", "")).toEqual({ city: null, postCode: null });
  });

  it("rejects an invalid PIN before updating the candidate", () => {
    expect(() => normalizeCandidateLocation("Kochi", "6820")).toThrow("6-digit PIN");
  });

  it("calculates remaining vacancies without returning a negative number", () => {
    expect(remainingRequisitionOpenings(12, 5)).toBe(7);
    expect(remainingRequisitionOpenings(2, 4)).toBe(0);
  });

  it("keeps only active/current requisition states in the HR overview", () => {
    expect(isCurrentRequisitionStatus("open")).toBe(true);
    expect(isCurrentRequisitionStatus("on_hold")).toBe(true);
    expect(isCurrentRequisitionStatus("closed")).toBe(false);
  });
});
