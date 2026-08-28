import { describe, expect, it } from "vitest";
import { loadAllSupabaseRows } from "./supabase-pagination";

describe("loadAllSupabaseRows", () => {
  it("loads every database page instead of silently stopping at 1,000 rows", async () => {
    const source = Array.from({ length: 3435 }, (_, index) => ({ id: index + 1 }));
    const ranges: Array<[number, number]> = [];
    const rows = await loadAllSupabaseRows(async (from, to) => {
      ranges.push([from, to]);
      return { data: source.slice(from, to + 1), error: null };
    });

    expect(rows).toHaveLength(3435);
    expect(rows.at(-1)?.id).toBe(3435);
    expect(ranges).toEqual([[0, 999], [1000, 1999], [2000, 2999], [3000, 3999]]);
  });

  it("surfaces database errors instead of returning partial manager totals", async () => {
    await expect(loadAllSupabaseRows(async () => ({ data: null, error: { message: "source unavailable" } })))
      .rejects.toThrow("source unavailable");
  });
});
