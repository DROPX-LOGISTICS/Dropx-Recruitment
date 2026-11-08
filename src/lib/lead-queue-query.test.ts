import {describe, expect, it} from "vitest";
import {leadQueueQuery, leadFacetContext} from "./lead-queue-query";
import {emptyRecruitFilters} from "./recruitment-routes";
import {WORKFORCE_ACTIVE_INTERVIEW_STATUS_QUERY} from "./workforce-interview-lifecycle";

describe("lead queue and facet context parity", () => {
  it("keeps each checkbox, paging and sorting change local to the same aggregate", () => {
    const base = leadQueueQuery("All Leads", "workforce", emptyRecruitFilters, "");
    const next = leadQueueQuery("All Leads", "workforce", {...emptyRecruitFilters, station:"PMB", role:"DA", cluster:"Kerala", status:"new", sort:"nearest"}, "", 4);
    expect(leadFacetContext(next)).toBe(leadFacetContext(base));
    expect(next.get("station")).toBe("PMB");
  });
  it("uses the same default and override interview statuses as the table", () => {
    expect(leadQueueQuery("Interviews","workforce",emptyRecruitFilters,"").get("status")).toBe(WORKFORCE_ACTIVE_INTERVIEW_STATUS_QUERY);
    expect(leadQueueQuery("Interviews","workforce",{...emptyRecruitFilters,status:"joined"},"").get("status")).toBe("joined");
  });
  it("refetches when search, archive, ad, dates, workspace or queue change", () => {
    const base = leadFacetContext(leadQueueQuery("All Leads","workforce",emptyRecruitFilters,""));
    for (const params of [
      leadQueueQuery("All Leads","workforce",emptyRecruitFilters,"somewhere"),
      leadQueueQuery("Archived Leads","workforce",emptyRecruitFilters,""),
      leadQueueQuery("All Leads","hr",emptyRecruitFilters,""),
      leadQueueQuery("Unmapped","workforce",emptyRecruitFilters,""),
      leadQueueQuery("All Leads","workforce",{...emptyRecruitFilters,adIds:"abc"},""),
      leadQueueQuery("Interviews","workforce",{...emptyRecruitFilters,interviewFrom:"2026-11-07"},"")
    ]) expect(leadFacetContext(params)).not.toBe(base);
  });
  it("ignores hidden final/updated/date filters outside their relevant queue", () => {
    const params=leadQueueQuery("All Leads","workforce",{...emptyRecruitFilters,updatedAge:"never",interviewFrom:"2026-11-07",finalStatus:"selected"},"");
    expect(params.has("updatedAge")).toBe(false);
    expect(params.has("finalStatus")).toBe(false);
    expect(params.has("interviewFrom")).toBe(false);
  });
});
