import { describe, expect, it } from "vitest";
import { leadAge } from "./lead-age";

const now = Date.parse("2026-09-12T12:00:00Z");

describe("lead age", () => {
  it.each([
    ["2026-09-12T11:59:30Z", { label: "Now", tone: "fresh" }],
    ["2026-09-12T11:55:00Z", { label: "5m", tone: "fresh" }],
    ["2026-09-12T11:30:00Z", { label: "30m", tone: "aging" }],
    ["2026-09-11T12:01:00Z", { label: "23h 59m", tone: "aging" }],
    ["2026-09-11T12:00:00Z", { label: "1d", tone: "old" }],
    ["2026-09-10T10:00:00Z", { label: "2d 2h", tone: "old" }]
  ])("formats %s compactly", (receivedAt, expected) => {
    expect(leadAge(receivedAt, now)).toEqual(expected);
  });

  it("does not invent an age when intake time is missing", () => {
    expect(leadAge(null, now)).toBeNull();
  });
});
