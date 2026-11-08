import type { RecruitmentMenuId } from "./recruitment-menu-roles";
import { WORKFORCE_ACTIVE_INTERVIEW_STATUS_QUERY } from "./workforce-interview-lifecycle";

const leadMenus = new Set<RecruitmentMenuId>([
  "All Leads", "Archived Leads", "No Response / Call Back", "Interviews",
  "Unmapped", "Screening", "Documents", "Offers", "Hired"
]);

// Older/cached browser bundles did not identify the queue in lead requests.
// Resolve those requests from the queue-specific filters so they continue to
// receive the same permission check as the current client. Requests without a
// queue-specific filter are the All Leads queue.
export function resolveLeadMenu(url: URL): RecruitmentMenuId | null {
  const requested = url.searchParams.get("menu") as RecruitmentMenuId | null;
  if (requested) return leadMenus.has(requested) ? requested : null;
  if (url.searchParams.get("archive") === "archived") return "Archived Leads";
  if (url.searchParams.get("unmapped") === "true") return "Unmapped";

  const status = url.searchParams.get("status") ?? "";
  if (status === "no_response,call_back") return "No Response / Call Back";
  if (status === "__BLANK__,assigned,contacting,interested") return "Screening";
  if (status === "documents_pending") return "Documents";
  if (status === "selected,offer_pending,offered") return "Offers";
  if (status === "joined") return "Hired";
  if (status === WORKFORCE_ACTIVE_INTERVIEW_STATUS_QUERY) return "Interviews";
  if (status === "interview_scheduled,interview_rescheduled,interview_completed,interview_no_show,selected,joined,no_response,call_back,not_interested,not_fit,long_distance") {
    return "Interviews";
  }
  return "All Leads";
}

