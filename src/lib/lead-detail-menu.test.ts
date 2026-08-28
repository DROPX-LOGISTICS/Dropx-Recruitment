import { describe, expect, it } from "vitest";
import { legacyLeadDetailMenus } from "./lead-detail-menu";

describe("legacyLeadDetailMenus", () => {
  it("maps active HR candidates to the activity and screening queues", () => {
    expect(legacyLeadDetailMenus({ stream: "hr", status: "new" })).toEqual(["All Leads", "Screening"]);
  });

  it("maps HR lifecycle states to their least-privilege queues", () => {
    expect(legacyLeadDetailMenus({ stream: "hr", status: "interview_scheduled" })).toEqual(["All Leads", "Interviews"]);
    expect(legacyLeadDetailMenus({ stream: "hr", status: "documents_pending" })).toEqual(["All Leads", "Documents"]);
    expect(legacyLeadDetailMenus({ stream: "hr", status: "offered" })).toEqual(["All Leads", "Offers"]);
    expect(legacyLeadDetailMenus({ stream: "hr", status: "joined" })).toEqual(["All Leads", "Hired"]);
  });

  it("never expands archived candidates into an active queue", () => {
    expect(legacyLeadDetailMenus({ stream: "hr", status: "new", archived: true })).toEqual(["Archived Leads"]);
  });

  it("keeps workforce callback and interview compatibility scoped", () => {
    expect(legacyLeadDetailMenus({ stream: "workforce", status: "call_back" })).toEqual(["All Leads", "No Response / Call Back"]);
    expect(legacyLeadDetailMenus({ stream: "workforce", status: "interview_rescheduled" })).toEqual(["All Leads", "Interviews"]);
  });
});
