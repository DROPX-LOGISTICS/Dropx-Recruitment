import { describe, expect, it } from "vitest";
import { resolveMetaDailyBudgetTarget } from "./meta-budget";

describe("resolveMetaDailyBudgetTarget", () => {
  it("uses the campaign when Meta reports a live campaign daily budget", () => {
    expect(resolveMetaDailyBudgetTarget({
      campaign: { id: "campaign-1", daily_budget: "20000" },
      adset: { id: "adset-1" }
    })).toEqual({ target: { id: "campaign-1", source: "campaign" }, reason: "daily" });
  });

  it("uses the ad set when the campaign does not own the daily budget", () => {
    expect(resolveMetaDailyBudgetTarget({
      campaign: { id: "campaign-1" },
      adset: { id: "adset-1", daily_budget: "15000" }
    })).toEqual({ target: { id: "adset-1", source: "adset" }, reason: "daily" });
  });

  it("does not silently turn a lifetime budget into a daily budget", () => {
    expect(resolveMetaDailyBudgetTarget({
      campaign: { id: "campaign-1", lifetime_budget: "500000" },
      adset: { id: "adset-1" }
    })).toEqual({ target: null, reason: "lifetime" });
  });

  it("falls back to the saved owner only when Meta returns no budget mode", () => {
    expect(resolveMetaDailyBudgetTarget({
      fallback: { source: "adset", adsetId: "saved-adset" }
    })).toEqual({ target: { id: "saved-adset", source: "adset" }, reason: "daily" });
  });
});
