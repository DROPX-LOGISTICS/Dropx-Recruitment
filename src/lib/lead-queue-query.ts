import { hrQueueStatusQuery } from "./hr-ats-product";
import { WORKFORCE_ACTIVE_INTERVIEW_STATUS_QUERY } from "./workforce-interview-lifecycle";
import { emptyRecruitFilters, type RecruitWorkspace } from "./recruitment-routes";

export const LEAD_QUEUE_MENUS = ["All Leads", "Archived Leads", "No Response / Call Back", "Interviews", "Unmapped", "Screening", "Documents", "Offers", "Hired"];

/** Keep the table and its dependent choices on exactly the same queue context. */
export function leadQueueQuery(menu: string, stream: RecruitWorkspace, filters: typeof emptyRecruitFilters, search: string, page = 1) {
  const params = new URLSearchParams({menu, stream, limit: "50", page: String(page)});
  if (stream === "workforce") params.set("sort", filters.sort);
  if (menu === "Archived Leads") params.set("archive", "archived");
  const status = filters.status || (menu === "No Response / Call Back" ? "no_response,call_back"
    : menu === "Interviews" && stream === "workforce" ? WORKFORCE_ACTIVE_INTERVIEW_STATUS_QUERY
    : stream === "hr" ? hrQueueStatusQuery(menu) : "");
  if (status) params.set("status", status);
  for (const key of ["adIds", "station", "cluster", "role"] as const) if (filters[key]) params.set(key, filters[key]);
  if (menu === "No Response / Call Back" && filters.updatedAge) params.set("updatedAge", filters.updatedAge);
  if (menu === "Interviews") {
    for (const key of ["interviewFrom", "interviewTo"] as const) if (filters[key]) params.set(key, filters[key]);
    if (stream === "hr" && filters.finalStatus) params.set("finalStatus", filters.finalStatus);
  }
  if (filters.stale24) params.set("stale24", "true");
  if (menu === "Unmapped") params.set("unmapped", "true");
  if (search.trim()) params.set("search", search.trim());
  return params;
}

// These are evaluated against the small aggregate in the browser; changing
// them must not start another network request or reload the candidate table.
export function leadFacetContext(params: URLSearchParams) {
  const context = new URLSearchParams(params);
  for (const key of ["station", "cluster", "role", "status", "finalStatus", "updatedAge", "page", "limit", "sort", "facets", "compact"]) context.delete(key);
  return context.toString();
}
