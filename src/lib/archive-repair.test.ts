import { describe, expect, it } from "vitest";
import {
  archiveRepairReason,
  importedLeadShouldBeArchived,
  noResponseArchiveThreshold
} from "./archive-repair";

describe("archive repair eligibility", () => {
  it.each([
    "",
    "new",
    "call_back",
    "interview_scheduled",
    "selected",
    "document_issue"
  ])("restores the open status %s", (status) => {
    expect(archiveRepairReason({ id: "lead", status, stream: "workforce" }))
      .toBe("open_status_archived");
  });

  it("restores premature no-response archives using stream thresholds", () => {
    expect(archiveRepairReason({
      id: "workforce",
      status: "no_response",
      stream: "workforce",
      no_response_attempts: 4
    })).toBe("premature_no_response_archive");
    expect(archiveRepairReason({
      id: "hr",
      status: "no_response",
      stream: "hr",
      no_response_attempts: 2
    })).toBe("premature_no_response_archive");
    expect(noResponseArchiveThreshold("workforce")).toBe(5);
    expect(noResponseArchiveThreshold("hr")).toBe(3);
  });

  it("preserves legitimate terminal archives", () => {
    for (const status of [
      "archived",
      "closed",
      "joined",
      "not_interested",
      "not_fit",
      "long_distance",
      "wrong_number",
      "rejected",
      "did_not_join",
      "invalid"
    ]) {
      expect(archiveRepairReason({ id: status, status, stream: "workforce" }))
        .toBeNull();
    }
    expect(archiveRepairReason({
      id: "attempted",
      status: "no_response",
      stream: "workforce",
      no_response_attempts: 5
    })).toBeNull();
  });

  it("does not let source duplicate flags archive open canonical leads", () => {
    expect(importedLeadShouldBeArchived({
      sourceArchived: true,
      status: "",
      stream: "workforce",
      noResponseAttempts: 0
    })).toBe(false);
    expect(importedLeadShouldBeArchived({
      sourceArchived: true,
      status: "call_back",
      stream: "workforce",
      noResponseAttempts: 0
    })).toBe(false);
    expect(importedLeadShouldBeArchived({
      sourceArchived: true,
      status: "not_interested",
      stream: "workforce",
      noResponseAttempts: 0
    })).toBe(true);
  });
});
