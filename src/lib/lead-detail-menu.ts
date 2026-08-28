import type { RecruitmentMenuId } from "./recruitment-menu-roles";

type LeadMenuContext = {
  stream?: string | null;
  status?: string | null;
  archived?: boolean | null;
};

/**
 * Compatibility for installed mobile builds that predate explicit queue
 * context on candidate-detail requests. The caller must still hold one of
 * the returned menu permissions and pass the normal lead scope check.
 */
export function legacyLeadDetailMenus(lead: LeadMenuContext): RecruitmentMenuId[] {
  if (lead.archived) return ["Archived Leads"];
  const status = String(lead.status ?? "");
  if (lead.stream === "hr") {
    if (["new", "assigned", "contacting", "interested", ""].includes(status)) {
      return ["All Leads", "Screening"];
    }
    if (["interview_scheduled", "interview_rescheduled", "interview_completed", "interview_no_show"].includes(status)) {
      return ["All Leads", "Interviews"];
    }
    if (status === "documents_pending") return ["All Leads", "Documents"];
    if (["selected", "offer_pending", "offered", "did_not_join"].includes(status)) {
      return ["All Leads", "Offers"];
    }
    if (status === "joined") return ["All Leads", "Hired"];
  }
  if (["no_response", "call_back"].includes(status)) {
    return ["All Leads", "No Response / Call Back"];
  }
  if (["interview_scheduled", "interview_rescheduled", "interview_completed", "interview_no_show", "selected", "joined"].includes(status)) {
    return ["All Leads", "Interviews"];
  }
  return ["All Leads"];
}
