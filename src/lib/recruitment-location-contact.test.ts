import { describe, expect, it } from "vitest";
import { mergeRecruitmentLocationContact } from "./recruitment-location-contact";

describe("Recruitment station contact merge", () => {
  it("does not let blank projected values hide preserved contact details", () => {
    expect(mergeRecruitmentLocationContact(
      { address: " ", poc_name: "", poc_mobile: "", latitude: null, longitude: null },
      { address: "Station address", poc_name: "Station POC", poc_mobile: "9000000000", latitude: 11.2, longitude: 75.7 }
    )).toEqual({
      address: "Station address",
      poc_name: "Station POC",
      poc_mobile: "9000000000",
      latitude: 11.2,
      longitude: 75.7
    });
  });

  it("keeps non-blank Station Contacts values ahead of legacy values", () => {
    expect(mergeRecruitmentLocationContact(
      { poc_name: "Current POC", poc_mobile: "9111111111" },
      { poc_name: "Legacy POC", poc_mobile: "9222222222" }
    )).toMatchObject({ poc_name: "Current POC", poc_mobile: "9111111111" });
  });
});
