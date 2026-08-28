import { describe, expect, it } from "vitest";
import { fieldPointForEvaluation } from "./field-point-persistence";

describe("fieldPointForEvaluation", () => {
  it("removes database-managed values before an evaluation upsert", () => {
    expect(fieldPointForEvaluation({
      id: 123,
      created_at: "2026-08-10T05:00:00.000Z",
      received_at: "2026-08-10T05:00:01.000Z",
      sequence: 7,
      recorded_at: "2026-08-10T05:00:00.000Z",
      latitude: 11.4,
      longitude: 75.7
    })).toEqual({
      sequence: 7,
      recorded_at: "2026-08-10T05:00:00.000Z",
      latitude: 11.4,
      longitude: 75.7
    });
  });
});
