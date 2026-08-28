export type ArchiveRepairLead = {
  id: string;
  status?: string | null;
  stream?: string | null;
  source?: string | null;
  no_response_attempts?: number | null;
};

export type ArchiveRepairReason =
  | "open_status_archived"
  | "premature_no_response_archive";

const openStatuses = new Set([
  "",
  "new",
  "unmapped",
  "assigned",
  "contacting",
  "call_back",
  "interested",
  "interview_scheduled",
  "interview_rescheduled",
  "interview_completed",
  "interview_no_show",
  "selected",
  "documents_pending",
  "document_issue",
  "offer_pending",
  "offered",
  "hold"
]);

export function noResponseArchiveThreshold(stream?: string | null) {
  return stream === "hr" ? 3 : 5;
}

export function archiveRepairReason(
  lead: ArchiveRepairLead
): ArchiveRepairReason | null {
  const status = String(lead.status ?? "").trim().toLowerCase();
  if (openStatuses.has(status)) return "open_status_archived";
  if (
    status === "no_response" &&
    Number(lead.no_response_attempts || 0) <
      noResponseArchiveThreshold(lead.stream)
  ) {
    return "premature_no_response_archive";
  }
  return null;
}

export function importedLeadShouldBeArchived(options: {
  sourceArchived: boolean;
  status?: string | null;
  stream?: string | null;
  noResponseAttempts?: number | null;
}) {
  if (!options.sourceArchived) return false;
  return archiveRepairReason({
    id: "source-row",
    status: options.status,
    stream: options.stream,
    no_response_attempts: options.noResponseAttempts
  }) === null;
}
