import { withLeadProximity } from "@/lib/lead-proximity-data";
import { compareLeadProximity } from "@/lib/lead-proximity";
import { NextResponse } from "next/server";
import { applyLeadScope, canUseRecruitmentMenu, recruitmentSession, requiredEnv } from "@/lib/recruitment-api";
import { buildDependentLeadFacets, facetSelections } from "@/lib/lead-facets";
import { loadLeadFacetSummary } from "@/lib/lead-facet-data";
import { resolveLeadMenu } from "@/lib/lead-queue-menu";
import { loadMetaReceivedTimes } from "@/lib/lead-meta-intake";
import { loadMainDashboardStations } from "@/lib/main-dashboard-masters";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { loadAllSupabaseRows } from "@/lib/supabase-pagination";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";


function csv(value: string | null) {
  return (value ?? "").split(",").map((part) => part.trim()).filter(Boolean);
}

function startOfIstDay(value: string) {
  return `${value}T00:00:00.000+05:30`;
}

function endOfIstDay(value: string) {
  return `${value}T23:59:59.999+05:30`;
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
    const adIds = csv(url.searchParams.get("adIds"));
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
    const nearest = stream === "workforce" && url.searchParams.get("sort") === "nearest";
    const compact = url.searchParams.get("compact") === "true";
    if ((stream !== "workforce" && stream !== "hr") || !menu
      || !canUseRecruitmentMenu(session, menu, "view", stream)) {
      return NextResponse.json({ error: "View access to this Recruitment queue is required." }, { status: 403 });
    }
    url.searchParams.set("menu", menu);
    const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
    const mainStations = clusters.length || includeFacets
      ? await loadMainDashboardStations(companyId)
      : [];
    const operationalOwnerByStationCode = new Map(mainStations.map((station) => [
      station.code,
      station.operationalOwner?.name ?? null
    ]));
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
    const includeMetaIntake = stream === "workforce" && !compact;
    const leadSelect = compact
        ? "id,full_name,phone,city,post_code,status,remarks,updated_at,callback_at,follow_up_at,recruitment_locations(code,name,latitude,longitude),recruitment_roles(code,name)"
        : "id, full_name, phone, email, city, post_code, ad_name, source, status, remarks, stream, archived, location_id, role_id, lead_created_at, updated_at, last_updated_by, callback_at, follow_up_at, duplicate_count, total_attempts, no_response_attempts, call_back_attempts, assigned_profile_id, assigned_profile:profiles!recruitment_leads_assigned_profile_id_fkey(id,full_name,email), last_updated_profile:profiles!recruitment_leads_last_updated_by_fkey(id,full_name,email), recruitment_locations(code,name,latitude,longitude), recruitment_roles(code,name)";
    let query: any = supabaseAdmin.from("recruitment_leads").select(leadSelect, {count:"exact"}).eq("company_id",companyId);
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
      // recruitment_leads.status defaults to '' (empty string, not null) until
      // a first call is logged. The HR lifecycle filter sends the literal
      // "new" code (see hrLifecycleFilterOptions), so without this expansion
      // those blank-status leads are visible with no status filter applied
      // but silently disappear the moment "New profile" is selected.
      if (statuses.includes("new") && !statuses.includes("")) statuses.push("");
      query = statuses.length > 1 ? query.in("status", statuses) : query.eq("status", statuses[0]);
    }
    if (adIds.length) query = query.in("ad_id", adIds);
    if (finalStatus) query = query.in("final_status", csv(finalStatus));
    if (leadFrom) query = query.gte("lead_created_at", startOfIstDay(leadFrom));
    if (leadTo) query = query.lte("lead_created_at", endOfIstDay(leadTo));
    if (interviewFrom) query = query.gte("follow_up_at", startOfIstDay(interviewFrom));
    if (interviewTo) query = query.lte("follow_up_at", endOfIstDay(interviewTo));
    if (stationCodes.length || clusters.length) {
      let locations = supabaseAdmin.from("recruitment_locations").select("id")
        .eq("company_id", requiredEnv("RECRUITMENT_COMPANY_ID"));
      const ownerStationCodes = clusters.length
        ? mainStations
            .filter((station) => station.operationalOwner && clusters.includes(station.operationalOwner.name))
            .map((station) => station.code)
        : null;
      const resolvedStationCodes = ownerStationCodes
        ? (stationCodes.length ? stationCodes.filter((code) => ownerStationCodes.includes(code)) : ownerStationCodes)
        : stationCodes;
      locations = resolvedStationCodes.length
        ? locations.in("code", resolvedStationCodes)
        : locations.eq("id", "00000000-0000-0000-0000-000000000000");
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
    let result: {data:any[];count:number|null;error:any};
    if(nearest) {
      // Sort before pagination, across the filtered authorised queue. A narrow
      // candidate projection keeps this bounded and avoids expanding every profile.
      query=query.select('id,post_code,lead_created_at,recruitment_locations(code,latitude,longitude)').order('id');
      const ordered = await loadAllSupabaseRows<any>((start,end)=>
        query.range(start,end),{maxRows:50000});
      const ranked=(await withLeadProximity(ordered)).sort(compareLeadProximity);
      const ids=ranked.slice(from,from+limit).map(row=>row.id);
      const loaded=ids.length?await query.select(leadSelect).in('id',ids).range(0,limit-1):{data:[],error:null};
      const byId=new Map((loaded.data??[]).map((row:any)=>[row.id,row]));
      result={data:ids.map(id=>byId.get(id)).filter(Boolean) as any[],count:ranked.length,error:loaded.error};
    } else {
      result=await query.order("lead_created_at",{ascending:false}).order("id",{ascending:false}).range(from,from+limit-1);
    }
    if (result.error) throw new Error(result.error.message);
    if(stream==='workforce'&&!compact)result.data=await withLeadProximity(result.data??[]);

    // Compatibility for older clients: use the compact aggregate, never download
    // the entire queue to calculate filter choices.
    const facets = includeFacets ? buildDependentLeadFacets(
      await loadLeadFacetSummary(session, url, companyId, stream),
      facetSelections(url.searchParams),
      operationalOwnerByStationCode
    ) : null;

    const receivedTimes = includeMetaIntake
      ? await loadMetaReceivedTimes(companyId, (result.data ?? []).map((lead: any) => lead.id))
      : null;
    const leads = receivedTimes
      ? (result.data ?? []).map((lead: any) => ({ ...lead, meta_received_at: receivedTimes.get(lead.id) ?? null }))
      : result.data ?? [];
    return NextResponse.json({ leads, total: result.count ?? 0, page, limit, facets });
  } catch (error) {
    console.error("Recruitment leads failed", error);
    return NextResponse.json({ error: "Unable to load leads." }, { status: 500 });
  }
}
