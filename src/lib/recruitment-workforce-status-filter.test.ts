import { describe, expect, it } from "vitest";
import { workforceStatusFilterOptions } from "./recruitment-workforce-status-filter";

describe("workforceStatusFilterOptions", () => {
  it("prepends No Status exactly once and preserves configured outcomes", () => {
    const configured = [
      { code: "no_response", label: "No Response", requiresSchedule: false },
      { code: "__BLANK__", label: "Configured blank label" },
      { code: "call_back", label: "Call Back", requiresSchedule: true }
    ];

    const result = workforceStatusFilterOptions(configured);

    expect(result[0]).toEqual({ code: "__BLANK__", label: "No Status" });
    expect(result.filter((option) => option.code === "__BLANK__")).toHaveLength(1);
    expect(result.slice(1)).toEqual([
      { code: "no_response", label: "No Response", requiresSchedule: false },
      { code: "call_back", label: "Call Back", requiresSchedule: true }
    ]);
  });
});
