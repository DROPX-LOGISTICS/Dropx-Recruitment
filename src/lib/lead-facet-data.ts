import { hasFullLeadAccess, type recruitmentSession } from "./recruitment-api";
import { supabaseAdmin } from "./supabase-admin";
import type { LeadFacetGroup } from "./lead-facets";

/** Only aggregate requests with identical authorized scope share in-flight work. */
const inFlight = new Map<string, Promise<LeadFacetGroup[]>>();
export function leadFacetArguments(session: NonNullable<Awaited<ReturnType<typeof recruitmentSession>>>, url: URL, companyId: string, stream: "workforce" | "hr") {
  const params = url.searchParams;
  const filters: Record<string, string> = {};
  for (const key of ["menu", "archive", "adIds", "stale24", "unmapped"]) {
    const value = params.get(key);
    if (value) filters[key] = value;
  }
  for (const key of ["leadFrom", "leadTo", "interviewFrom", "interviewTo"]) {
    const value = params.get(key);
    if (value) filters[key] = `${value}T${key.endsWith("From") ? "00:00:00.000" : "23:59:59.999"}+05:30`;
  }
  const search = params.get("search")?.replace(/[%(),]/g, " ").trim();
  if (search) filters.search = search;
  const full = hasFullLeadAccess(session);
  return {
    p_company_id: companyId, p_stream: stream,
    p_location_ids: full || session.allLocations ? null : [...session.locationIds].sort(),
    p_role_ids: full || !session.roleIds.length ? null : [...session.roleIds].sort(),
    p_filters: filters
  };
}

export async function loadLeadFacetSummary(session: NonNullable<Awaited<ReturnType<typeof recruitmentSession>>>, url: URL, companyId: string, stream: "workforce" | "hr") {
  const args = leadFacetArguments(session, url, companyId, stream);
  const key = JSON.stringify(args);
  const existing = inFlight.get(key);
  if (existing) return existing;
  const pending = (async () => {
    if (!supabaseAdmin) throw new Error("Supabase is not configured.");
    const {data, error} = await supabaseAdmin.rpc("recruitment_lead_facet_summary", args);
    if (error) throw new Error(error.message);
    return (data ?? []) as LeadFacetGroup[];
  })();
  inFlight.set(key, pending);
  try { return await pending; }
  finally { if (inFlight.get(key) === pending) inFlight.delete(key); }
}
