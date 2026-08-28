import { describe, expect, it } from "vitest";
import { buildLeadAttemptRows, formatRecruitmentIstDateTime } from "./lead-attempt-report";

describe("lead attempt report", () => {
  it("formats timestamps in India time", () => {
    expect(formatRecruitmentIstDateTime("2026-08-25T04:32:26.680Z")).toContain("10:02:26 am");
  });

  it("keeps every attempt and sorts them ascending", () => {
    const rows = buildLeadAttemptRows([
      { lead_id: "lead-1", created_at: "2026-08-25T05:00:00Z", new_value: "not_fit" },
      { lead_id: "lead-1", created_at: "2026-08-25T04:30:00Z", new_value: "no_response" }
    ], [{ id: "lead-1", full_name: "Candidate" }]);
    expect(rows).toHaveLength(2);
    expect(rows[0][9]).toBe("no_response");
    expect(rows[1][9]).toBe("not_fit");
  });
});
