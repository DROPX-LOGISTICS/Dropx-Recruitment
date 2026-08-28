import { NextResponse } from "next/server";
import { applyLeadScope, canUseRecruitmentMenu, recruitmentSession, requiredEnv } from "@/lib/recruitment-api";
import type { RecruitmentMenuId } from "@/lib/recruitment-menu-roles";
import { buildLeadFacets } from "@/lib/lead-facets";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { WORKFORCE_ACTIVE_INTERVIEW_STATUS_QUERY } from "@/lib/workforce-interview-lifecycle";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const leadMenus = new Set<RecruitmentMenuId>([
  "All Leads", "Archived Leads", "No Response / Call Back", "Interviews",
  "Unmapped", "Screening", "Documents", "Offers", "Hired"
]);

// Older/cached browser bundles did not identify the queue in lead requests.
// Resolve those requests from the queue-specific filters so they continue to
// receive the same permission check as the current client. Requests without a
// queue-specific filter are the All Leads queue.
function resolveLeadMenu(url: URL): RecruitmentMenuId | null {
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

function csv(value: string | null) {
  return (value ?? "").split(",").map((part) => part.trim()).filter(Boolean);
}

function startOfIstDay(value: string) {
  return `${value}T00:00:00.000+05:30`;
}

function endOfIstDay(value: string) {
  return `${value}T23:59:59.999+05:30`;
}

function relation<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

export async function GET(request: Request) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase is not configured.");
    const session = await recruitmentSession(request);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const url = new URL(request.url);
    const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
    const limit = Math.min(100, Math.max(10, Number(url.searchParams.get("limit") ?? 50)));
    const stream = url.searchParams.get("stream");
    const menu = resolveLeadMenu(url);
    const status = url.searchParams.get("status");
    const finalStatus = url.searchParams.get("finalStatus");
    const archive = url.searchParams.get("archive") ?? "active";
    const search = url.searchParams.get("search")?.trim();
    const stationCodes = csv(url.searchParams.get("station"));
    const clusters = csv(url.searchParams.get("cluster"));
    const roleCodes = csv(url.searchParams.get("role"));
    const updatedAge = csv(url.searchParams.get("updatedAge"));
    const leadFrom = url.searchParams.get("leadFrom");
    const leadTo = url.searchParams.get("leadTo");
    const interviewFrom = url.searchParams.get("interviewFrom");
    const interviewTo = url.searchParams.get("interviewTo");
    const stale24 = url.searchParams.get("stale24") === "true";
    const unmapped = url.searchParams.get("unmapped") === "true";
    const includeFacets = url.searchParams.get("facets") === "true";
    const compact = url.searchParams.get("compact") === "true";
    if ((stream !== "workforce" && stream !== "hr") || !menu
      || !canUseRecruitmentMenu(session, menu, "view", stream)) {
      return NextResponse.json({ error: "View access to this Recruitment queue is required." }, { status: 403 });
    }
    const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
    let structuredInterviewIds: string[] | null = null;
    if (stream === "hr" && menu === "Interviews") {
      // Only first-class interview assignments belong in the HR interview
      // queue. Legacy sheet statuses had no assignee or real schedule and must
      // not reappear as current interviews. The history fallback exists only
      // during the atomic migration/deployment window.
      const assigned = await supabaseAdmin.from("recruitment_hr_interviews")
        .select("lead_id")
        .eq("company_id", companyId)
        .neq("status", "cancelled")
        .limit(10_000);
      if (assigned.error && !/relation .* does not exist|schema cache/i.test(assigned.error.message)) {
        throw new Error(assigned.error.message);
      }
      if (!assigned.error) {
        structuredInterviewIds = [...new Set((assigned.data ?? []).map((row) => row.lead_id).filter(Boolean))];
      } else {
        const scheduled = await supabaseAdmin.from("recruitment_lead_history")
          .select("lead_id")
          .eq("company_id", companyId)
          .eq("event_type", "hr_interview_forwarded")
          .limit(10_000);
        if (scheduled.error) throw new Error(scheduled.error.message);
        structuredInterviewIds = [...new Set((scheduled.data ?? []).map((row) => row.lead_id).filter(Boolean))];
      }
    }
    let query: any = supabaseAdmin
      .from("recruitment_leads")
      .select(compact
        ? "id,full_name,phone,city,post_code,status,remarks,updated_at,callback_at,follow_up_at,recruitment_locations(code,name),recruitment_roles(code,name)"
        : "id, full_name, phone, email, city, post_code, ad_name, source, status, remarks, stream, archived, location_id, role_id, lead_created_at, updated_at, last_updated_by, callback_at, follow_up_at, duplicate_count, total_attempts, no_response_attempts, call_back_attempts, assigned_profile_id, assigned_profile:profiles!recruitment_leads_assigned_profile_id_fkey(id,full_name,email), last_updated_profile:profiles!recruitment_leads_last_updated_by_fkey(id,full_name,email), recruitment_locations(code,name), recruitment_roles(code,name)", { count: "exact" })
      .eq("company_id", companyId);
    if (archive === "archived") query = query.eq("archived", true);
    else if (archive !== "all") query = query.eq("archived", false);
    query = applyLeadScope(query, session, stream);
    if (structuredInterviewIds) {
      query = structuredInterviewIds.length
        ? query.in("id", structuredInterviewIds)
        : query.eq("id", "00000000-0000-0000-0000-000000000000");
    }
    if (status) {
      const statuses = csv(status);
      if (statuses.includes("__BLANK__")) statuses.splice(statuses.indexOf("__BLANK__"), 1, "", "new");
      query = statuses.length > 1 ? query.in("status", statuses) : query.eq("status", statuses[0]);
    }
    if (finalStatus) query = query.in("final_status", csv(finalStatus));
    if (leadFrom) query = query.gte("lead_created_at", startOfIstDay(leadFrom));
    if (leadTo) query = query.lte("lead_created_at", endOfIstDay(leadTo));
    if (interviewFrom) query = query.gte("follow_up_at", startOfIstDay(interviewFrom));
    if (interviewTo) query = query.lte("follow_up_at", endOfIstDay(interviewTo));
    if (stationCodes.length || clusters.length) {
      let locations = supabaseAdmin.from("recruitment_locations").select("id")
        .eq("company_id", requiredEnv("RECRUITMENT_COMPANY_ID"));
      if (stationCodes.length) locations = locations.in("code", stationCodes);
      if (clusters.length) locations = locations.in("cluster", clusters);
      const resolved = await locations;
      if (resolved.error) throw new Error(resolved.error.message);
      const ids = (resolved.data ?? []).map((row) => row.id);
      query = ids.length
        ? query.in("location_id", ids)
        : query.eq("id", "00000000-0000-0000-0000-000000000000");
    }
    if (roleCodes.length) {
      const roles = await supabaseAdmin.from("recruitment_roles").select("id")
        .eq("company_id", requiredEnv("RECRUITMENT_COMPANY_ID")).in("code", roleCodes);
      if (roles.error) throw new Error(roles.error.message);
      const ids = (roles.data ?? []).map((row) => row.id);
      query = ids.length
        ? query.in("role_id", ids)
        : query.eq("id", "00000000-0000-0000-0000-000000000000");
    }
    if (stale24) {
      query = query.in("status", ["", "new", "no_response", "call_back"])
        .lt("lead_created_at", new Date(Date.now() - 24 * 60 * 60_000).toISOString());
    }
    if (unmapped) {
      query = query.or("location_id.is.null,role_id.is.null");
    }
    if (updatedAge.length) {
      const now = Date.now();
      const thresholds: Record<string, number> = {
        lt30: now - 30 * 60_000,
        gt60: now - 60 * 60_000,
        gt120: now - 120 * 60_000,
        gt24h: now - 24 * 60 * 60_000,
        gt2d: now - 48 * 60 * 60_000
      };
      if (updatedAge.length === 1 && updatedAge[0] === "never") query = query.is("updated_at", null);
      else {
        const oldest = updatedAge.filter((item) => item in thresholds)
          .sort((a, b) => thresholds[b] - thresholds[a])[0];
        if (oldest?.startsWith("gt")) query = query.lte("updated_at", new Date(thresholds[oldest]).toISOString());
        if (oldest === "lt30") query = query.gte("updated_at", new Date(thresholds.lt30).toISOString());
      }
    }
    if (search) {
      // Preserve underscores because DropX ad names use them as routing
      // delimiters (for example SBPD_RC). Strip only PostgREST separators.
      const safe = search.replace(/[%(),]/g, " ").trim();
      if (safe) query = query.or(`full_name.ilike.%${safe}%,phone.ilike.%${safe}%,email.ilike.%${safe}%,city.ilike.%${safe}%,post_code.ilike.%${safe}%,ad_name.ilike.%${safe}%`);
    }
    const from = (page - 1) * limit;
    const result = await query
      .order("lead_created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + limit - 1);
    if (result.error) throw new Error(result.error.message);

    let facets = null;
    if (includeFacets) {
      const facetQuery = () => {
        let scoped: any = supabaseAdmin!
          .from("recruitment_leads")
          .select("id,status,final_status,full_name,phone,email,city,post_code,ad_name,updated_at,lead_created_at,follow_up_at,location_id,role_id,recruitment_locations(code,cluster),recruitment_roles(code)")
          .eq("company_id", companyId);
        if (archive === "archived") scoped = scoped.eq("archived", true);
        else if (archive !== "all") scoped = scoped.eq("archived", false);
        scoped = applyLeadScope(scoped, session, stream);
        if (structuredInterviewIds) scoped = structuredInterviewIds.length
          ? scoped.in("id", structuredInterviewIds)
          : scoped.eq("id", "00000000-0000-0000-0000-000000000000");
        return scoped;
      };
      let facetCountQuery: any = supabaseAdmin.from("recruitment_leads")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId);
      if (archive === "archived") facetCountQuery = facetCountQuery.eq("archived", true);
      else if (archive !== "all") facetCountQuery = facetCountQuery.eq("archived", false);
      facetCountQuery = applyLeadScope(facetCountQuery, session, stream);
      if (structuredInterviewIds) facetCountQuery = structuredInterviewIds.length
        ? facetCountQuery.in("id", structuredInterviewIds)
        : facetCountQuery.eq("id", "00000000-0000-0000-0000-000000000000");
      const facetCount = await facetCountQuery;
      if (facetCount.error) throw new Error(facetCount.error.message);
      const facetPages = Math.ceil((facetCount.count ?? 0) / 1000);
      const facetResults = await Promise.all(Array.from({ length: facetPages }, (_, facetPage) =>
        facetQuery().order("id", { ascending: true }).range(facetPage * 1000, facetPage * 1000 + 999)
      ));
      const facetFailure = facetResults.find((item) => item.error);
      if (facetFailure?.error) throw new Error(facetFailure.error.message);
      const selectedStatuses = status ? csv(status).flatMap((item) => item === "__BLANK__" ? ["", "new"] : [item]) : [];
      const selectedFinalStatuses = finalStatus ? csv(finalStatus) : [];
      const interviewStart = interviewFrom ? new Date(startOfIstDay(interviewFrom)).getTime() : null;
      const interviewEnd = interviewTo ? new Date(endOfIstDay(interviewTo)).getTime() : null;
      const now = Date.now();
      const safeSearch = search?.replace(/[%(),]/g, " ").trim().toLowerCase() ?? "";
      const commonRows = facetResults.flatMap((item) => item.data ?? []).filter((row: any) => {
        const normalizedStatus = String(row.status ?? "");
        if (selectedStatuses.length && !selectedStatuses.includes(normalizedStatus)) return false;
        if (selectedFinalStatuses.length && !selectedFinalStatuses.includes(String(row.final_status ?? ""))) return false;
        if (stale24 && (
          !["", "new", "no_response", "call_back"].includes(normalizedStatus) ||
          !row.lead_created_at ||
          new Date(row.lead_created_at).getTime() >= now - 24 * 60 * 60_000
        )) return false;
        if (unmapped && row.location_id && row.role_id) return false;
        if (interviewStart !== null || interviewEnd !== null) {
          const interviewAt = row.follow_up_at ? new Date(row.follow_up_at).getTime() : NaN;
          if (!Number.isFinite(interviewAt)) return false;
          if (interviewStart !== null && interviewAt < interviewStart) return false;
          if (interviewEnd !== null && interviewAt > interviewEnd) return false;
        }
        if (updatedAge.length) {
          const updatedAt = row.updated_at ? new Date(row.updated_at).getTime() : null;
          if (updatedAge.length === 1 && updatedAge[0] === "never" && updatedAt !== null) return false;
          const thresholds: Record<string, number> = {
            lt30: now - 30 * 60_000,
            gt60: now - 60 * 60_000,
            gt120: now - 120 * 60_000,
            gt24h: now - 24 * 60 * 60_000,
            gt2d: now - 48 * 60 * 60_000
          };
          const oldest = updatedAge.filter((item) => item in thresholds)
            .sort((a, b) => thresholds[b] - thresholds[a])[0];
          if (oldest === "lt30" && (updatedAt === null || updatedAt < thresholds.lt30)) return false;
          if (oldest?.startsWith("gt") && (updatedAt === null || updatedAt > thresholds[oldest])) return false;
        }
        if (safeSearch) {
          const searchable = [row.full_name, row.phone, row.email, row.city, row.post_code, row.ad_name]
            .map((value) => String(value ?? "").toLowerCase());
          if (!searchable.some((value) => value.includes(safeSearch))) return false;
        }
        return true;
      }).map((row: any) => {
        const location = relation(row.recruitment_locations) as { code?: string; cluster?: string } | null;
        const role = relation(row.recruitment_roles) as { code?: string } | null;
        return {
          locationCode: location?.code ?? null,
          cluster: location?.cluster ?? null,
          roleCode: role?.code ?? null
        };
      });
      facets = buildLeadFacets(commonRows, { stationCodes, clusters, roleCodes });
    }

    return NextResponse.json({ leads: result.data ?? [], total: result.count ?? 0, page, limit, facets });
  } catch (error) {
    console.error("Recruitment leads failed", error);
    return NextResponse.json({ error: "Unable to load leads." }, { status: 500 });
  }
}
