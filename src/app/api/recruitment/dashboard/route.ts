import { storedAdDelivery } from "@/lib/meta-ad-delivery";
import { NextResponse } from "next/server";
import { applyLeadScope, canAccessLead, canUseRecruitmentMenu, hasFullLeadAccess, recruitmentSession, requiredEnv } from "@/lib/recruitment-api";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { currentRequisitionStatuses, remainingRequisitionOpenings } from "@/lib/hr-recruitment-overview";
import { loadMainDashboardStations } from "@/lib/main-dashboard-masters";
import { loadAllSupabaseRows } from "@/lib/supabase-pagination";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// Non-summary mode pages through every non-archived lead and every ad in scope (a company with
// ~20k leads needs ~20 sequential pages -- see the comment further down) and re-derives every
// metric/queue/station rollup in Node on each request. That's unavoidable without a much larger
// SQL-aggregation rewrite, but this dashboard is loaded on essentially every app open and every
// filter change, often by several people looking at the same station/cluster/role scope within
// minutes of each other -- and none of these numbers need to be more current than a couple of
// minutes old. A short TTL cache, keyed by the exact scope (company/stream/session's own
// location+role scope/station+cluster+role filters), means those repeated identical loads share
// one computed result instead of each re-scanning the same rows. Summary mode already does its
// own count-based query per request and is comparatively cheap, so it's left uncached here.
const dashboardCache = new Map<string, { expires: number; body: Promise<Record<string, unknown>> }>();
const DASHBOARD_CACHE_TTL_MS = 120_000;

type DashboardLead = {
  id: string;
  full_name: string | null;
  phone: string | null;
  status: string | null;
  final_status: string | null;
  lead_created_at: string | null;
  updated_at: string | null;
  callback_at: string | null;
  follow_up_at: string | null;
  location_id: string | null;
  role_id: string | null;
  ad_id: string | null;
  assigned_profile_id: string | null;
  recruitment_locations: { code: string; name: string; poc_name: string | null; poc_mobile: string | null } | null;
  recruitment_roles: { code: string; name: string; stream: string | null } | null;
};

type DashboardAd = {
  raw_payload?: unknown;
  id: string;
  ad_name: string | null;
  status: string | null;
  route_status: string | null;
  location_id: string | null;
  role_id: string | null;
  daily_budget: number | string | null;
  total_spend: number | string | null;
  created_on: string | null;
  last_synced_at: string | null;
  recruitment_locations: { id: string; code: string; name: string } | Array<{ id: string; code: string; name: string }> | null;
  recruitment_roles: { id: string; code: string; name: string; stream: string | null } | Array<{ id: string; code: string; name: string; stream: string | null }> | null;
};

type AdPendency = {
  adId: string | null;
  adName: string;
  adStatus: string;
  routeStatus: string;
  station: string;
  stationName: string;
  designation: string;
  designationName: string;
  totalLeads: number;
  pending: number;
  noStatus: number;
  noResponse: number;
  callBack: number;
  interviews: number;
  joined: number;
  stale24h: number;
  lifetimeTotalLeads: number;
  dailyBudget: number;
  totalSpend: number;
  createdOn: string | null;
  lastSyncedAt: string | null;
};

function related<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function adWithinScope(
  session: NonNullable<Awaited<ReturnType<typeof recruitmentSession>>>,
  ad: DashboardAd,
  stream: string | null,
  locationIds: string[] | null,
  roleIds: string[] | null
) {
  const role = related(ad.recruitment_roles);
  const location = related(ad.recruitment_locations);
  const adStream = String(role?.stream ?? "");
  if (stream && adStream !== stream) return false;
  if (!canAccessLead(session, {
    stream: adStream,
    location_id: location?.id ?? ad.location_id,
    role_id: role?.id ?? ad.role_id
  })) return false;
  if (locationIds && (!ad.location_id || !locationIds.includes(ad.location_id))) return false;
  if (roleIds && (!ad.role_id || !roleIds.includes(ad.role_id))) return false;
  return true;
}

function lower(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function ageHours(value: string | null, now: number) {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? Math.max(0, (now - parsed) / 3_600_000) : 0;
}

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function istDayBounds(now = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit"
  });
  const parts = Object.fromEntries(formatter.formatToParts(now).map((part) => [part.type, part.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return {
    date,
    start: new Date(`${date}T00:00:00+05:30`).getTime(),
    end: new Date(`${date}T23:59:59.999+05:30`).getTime()
  };
}

function ranked(map: Map<string, number>, limit = 30) {
  return [...map.entries()].map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label)).slice(0, limit);
}

function csv(value: string | null) {
  return (value ?? "").split(",").map((part) => part.trim()).filter(Boolean);
}

export async function GET(request: Request) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase is not configured.");
    const session = await recruitmentSession(request);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const url = new URL(request.url);
    const stream = url.searchParams.get("stream");
    const workspace = stream === "hr" ? "hr" : "workforce";
    const stationCodes = csv(url.searchParams.get("station"));
    const clusters = csv(url.searchParams.get("cluster"));
    const roleCodes = csv(url.searchParams.get("role"));
    if (!canUseRecruitmentMenu(session, "Dashboard", "view", workspace)) return NextResponse.json({ error: "Dashboard view access is required." }, { status: 403 });
    const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
    const mainStations = await loadMainDashboardStations(companyId);
    const ownerByStationCode = new Map(mainStations.map((station) => [
      station.code,
      station.operationalOwner?.name ?? null
    ]));
    let locationIds: string[] | null = null;
    let roleIds: string[] | null = null;
    if (stationCodes.length || clusters.length) {
      let locations = supabaseAdmin.from("recruitment_locations").select("id").eq("company_id", companyId);
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
      locationIds = (resolved.data ?? []).map((row) => row.id);
    }
    if (roleCodes.length) {
      const resolved = await supabaseAdmin.from("recruitment_roles").select("id")
        .eq("company_id", companyId).in("code", roleCodes);
      if (resolved.error) throw new Error(resolved.error.message);
      roleIds = (resolved.data ?? []).map((row) => row.id);
    }
    const hasEmptyFilter = (locationIds !== null && !locationIds.length) || (roleIds !== null && !roleIds.length);
    if (url.searchParams.get("mode") === "summary") {
      if (hasEmptyFilter) {
        return NextResponse.json({
          metrics: { total: 0, noStatus: 0, noResponse: 0, callBack: 0, interviews: 0, joined: 0, pending24h: 0, unmapped: 0 },
          generatedAt: new Date().toISOString()
        });
      }
      // Mirrors applyLeadScope()'s own logic exactly (see recruitment-api.ts) rather than
      // re-deriving any permission decision in SQL: hasFullLeadAccess() bypasses the session's
      // own location/role scope entirely (both params stay null = "no restriction"); otherwise
      // session.allLocations opts out of the location restriction the same way, and an empty
      // session.roleIds means "no role restriction" (not "matches nothing" -- only an explicit
      // station/cluster/role *filter* resolving to zero ids means that, via hasEmptyFilter,
      // already handled above). The RPC (recruitment_dashboard_summary_counts) applies no
      // access control of its own; it only ever receives the scope this route already decided.
      const fullAccess = hasFullLeadAccess(session);
      const scopeLocationIds = fullAccess || session.allLocations ? null : session.locationIds;
      const scopeRoleIds = fullAccess || !session.roleIds.length ? null : session.roleIds;
      const staleBefore = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
      const summary = await supabaseAdmin!.rpc("recruitment_dashboard_summary_counts", {
        p_company_id: companyId,
        p_stream: stream === "workforce" || stream === "hr" ? stream : null,
        p_scope_location_ids: scopeLocationIds,
        p_scope_role_ids: scopeRoleIds,
        p_filter_location_ids: locationIds,
        p_filter_role_ids: roleIds,
        p_stale_before: staleBefore
      }).single();
      if (summary.error) throw new Error(summary.error.message);
      const row = summary.data as {
        total: number; no_status: number; no_response: number; call_back: number;
        interviews: number; joined: number; pending_24h: number; unmapped: number;
      };
      return NextResponse.json({
        metrics: {
          total: Number(row.total), noStatus: Number(row.no_status), noResponse: Number(row.no_response),
          callBack: Number(row.call_back), interviews: Number(row.interviews), joined: Number(row.joined),
          pending24h: Number(row.pending_24h), unmapped: Number(row.unmapped)
        },
        generatedAt: new Date().toISOString()
      });
    }
    // Cache key covers every input that changes the query or the result: the resolved
    // location/role filters (not just the raw station/cluster/role query params, since those
    // resolve through mainStations/ownerByStationCode which could themselves change) and the
    // requesting session's own effective lead scope (owner/all-locations bypass everything;
    // otherwise the specific location/role ids that scope their view) -- two users with
    // different scopes must never share a cached result. Sorting the id arrays before joining
    // means the same *set* of ids always produces the same key regardless of what order
    // Supabase happened to return them in.
    const scopeKey = JSON.stringify({
      companyId, stream,
      locationIds: locationIds ? [...locationIds].sort() : null,
      roleIds: roleIds ? [...roleIds].sort() : null,
      sessionOwner: session.isOwner,
      sessionAllLocations: session.allLocations,
      sessionLocationIds: [...session.locationIds].sort(),
      sessionRoleIds: [...session.roleIds].sort()
    });
    const cachedDashboard = dashboardCache.get(scopeKey);
    if (cachedDashboard && cachedDashboard.expires > Date.now()) {
      return NextResponse.json(await cachedDashboard.body);
    }
    const dashboardBody = (async (): Promise<Record<string, unknown>> => {
    const dashboardQuery = () => {
      let query: any = supabaseAdmin!.from("recruitment_leads")
        .select("id,full_name,phone,status,final_status,lead_created_at,updated_at,callback_at,follow_up_at,location_id,role_id,ad_id,assigned_profile_id,recruitment_locations(code,name,poc_name,poc_mobile),recruitment_roles(code,name,stream)")
        .eq("company_id", companyId).eq("archived", false);
      query = applyLeadScope(query, session, stream);
      if (locationIds) query = query.in("location_id", locationIds);
      if (roleIds) query = query.in("role_id", roleIds);
      return query;
    };
    // Leads and ads are paged sequentially, not with Promise.all, because a
    // company with ~20k active leads needs ~20 pages here - firing them all
    // at once opened ~20 concurrent joined/ordered queries against Supabase
    // simultaneously, which exhausted the connection pool and surfaced as
    // intermittent 500s / "canceling statement due to statement timeout" on
    // this route even though each page is fast on its own. Sequential paging
    // costs a bit of wall-clock time but stays within the pool's capacity.
    let rows: DashboardLead[] = [];
    if (!hasEmptyFilter) {
      rows = await loadAllSupabaseRows<DashboardLead>((from, to) =>
        dashboardQuery()
          .order("lead_created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(from, to) as any
      );
    }

    let ads: DashboardAd[] = [];
    if (!hasEmptyFilter) {
      const allAds = await loadAllSupabaseRows<DashboardAd>((from, to) =>
        supabaseAdmin!.from("recruitment_ads")
          .select("id,ad_name,status,raw_payload,route_status,location_id,role_id,daily_budget,total_spend,created_on,last_synced_at,recruitment_locations(id,code,name),recruitment_roles(id,code,name,stream)")
          .eq("company_id", companyId)
          .order("last_synced_at", { ascending: false })
          .range(from, to) as any
      );
      ads = allAds
        .map((ad) => storedAdDelivery(ad))
        .filter((ad) => adWithinScope(session, ad, stream, locationIds, roleIds));
    }

    let currentOpenRoles: Array<Record<string, unknown>> = [];
    const canViewOpenRoles = workspace === "hr" && canUseRecruitmentMenu(session, "Job Requisitions", "view", "hr");
    if (canViewOpenRoles && !hasEmptyFilter) {
      let requisitionQuery: any = supabaseAdmin.from("recruitment_job_requisitions")
        .select("id,requisition_code,title,status,priority,openings,filled_positions,target_joining_date,updated_at,location_id,role_id,recruitment_locations(code,name),recruitment_roles(code,name)")
        .eq("company_id", companyId)
        .in("status", [...currentRequisitionStatuses])
        .order("updated_at", { ascending: false })
        .limit(50);
      if (!session.isOwner && !session.allLocations) requisitionQuery = requisitionQuery.in("location_id", session.locationIds);
      if (!session.isOwner && session.roleIds.length) requisitionQuery = requisitionQuery.in("role_id", session.roleIds);
      if (locationIds) requisitionQuery = requisitionQuery.in("location_id", locationIds);
      if (roleIds) requisitionQuery = requisitionQuery.in("role_id", roleIds);
      const requisitions = await requisitionQuery;
      if (requisitions.error) throw new Error(requisitions.error.message);
      currentOpenRoles = (requisitions.data ?? []).map((item: any) => ({
        id: item.id,
        code: item.requisition_code,
        title: item.title,
        status: item.status,
        priority: item.priority,
        openings: Number(item.openings || 0),
        filled: Number(item.filled_positions || 0),
        remaining: remainingRequisitionOpenings(item.openings, item.filled_positions),
        targetJoiningDate: item.target_joining_date,
        updatedAt: item.updated_at,
        station: related(item.recruitment_locations),
        role: related(item.recruitment_roles)
      }));
    }

    const now = Date.now();
    const today = istDayBounds();
    const monthStartDate = `${today.date.slice(0, 8)}01`;
    const monthStart = new Date(`${monthStartDate}T00:00:00+05:30`).getTime();
    const monthLabel = new Intl.DateTimeFormat("en-IN", {
      month: "short", timeZone: "Asia/Kolkata"
    }).format(new Date());
    const metrics = { total: rows.length, noStatus: 0, noResponse: 0, callBack: 0, interviews: 0, joined: 0, pending24h: 0, unmapped: 0 };
    const queues = { noStatus: 0, retryDue: 0, callbackDue: 0, interviewsToday: 0, noStatus12h: 0, noStatus24h: 0, noStatus48h: 0 };
    const byStatus = new Map<string, number>();
    const byLocation = new Map<string, number>();
    const byRole = new Map<string, number>();
    const byCluster = new Map<string, number>();
    const designation = new Map<string, { location: string; role: string; total: number; noStatus: number; noResponse: number; callBack: number; interviews: number; stale: number }>();
    const adDesignation = new Map<string, AdPendency>();
    for (const ad of ads) {
      const location = related(ad.recruitment_locations);
      const role = related(ad.recruitment_roles);
      adDesignation.set(`ad:${ad.id}`, {
        adId: ad.id,
        adName: ad.ad_name?.trim() || "Unnamed ad",
        adStatus: lower(ad.status) || "not_active",
        routeStatus: lower(ad.route_status) || "unmapped",
        station: location?.code || "Unmapped",
        stationName: location?.name || location?.code || "Unmapped",
        designation: role?.code || "Unmapped",
        designationName: role?.name || role?.code || "Unmapped",
        totalLeads: 0,
        pending: 0,
        noStatus: 0,
        noResponse: 0,
        callBack: 0,
        interviews: 0,
        joined: 0,
        stale24h: 0,
        lifetimeTotalLeads: 0,
        dailyBudget: numberValue(ad.daily_budget),
        totalSpend: numberValue(ad.total_spend),
        createdOn: ad.created_on,
        lastSyncedAt: ad.last_synced_at
      });
    }
    const stations = new Map<string, {
      code: string; name: string; cluster: string; owner: string; ownerMobile: string;
      total: number; noStatus: number; pending: number; interviews: number; joined: number;
      stale: number; retryDue: number; callbackDue: number; interviewsToday: number;
      unassigned: number; updatedToday: number; responseMinutes: number; responseCount: number;
    }>();
    const attention: Array<{ id: string; name: string; phone: string | null; issue: string; priority: number }> = [];

    for (const lead of rows) {
      const status = lower(lead.status);
      const finalStatus = lower(lead.final_status);
      const createdAge = ageHours(lead.lead_created_at, now);
      const updatedAge = ageHours(lead.updated_at, now);
      const createdAt = lead.lead_created_at ? new Date(lead.lead_created_at).getTime() : NaN;
      const updatedAt = lead.updated_at ? new Date(lead.updated_at).getTime() : NaN;
      const isMtdLead = Number.isFinite(createdAt) && createdAt >= monthStart && createdAt <= now;
      const isJoined = status === "joined" || finalStatus === "joined";
      const joinedMtd = isJoined && Number.isFinite(updatedAt) && updatedAt >= monthStart && updatedAt <= now;
      const isNoStatus = !status || status === "new";
      const isPending = isNoStatus || status === "no_response" || status === "call_back";
      if (isNoStatus) metrics.noStatus++;
      if (status === "no_response") metrics.noResponse++;
      if (status === "call_back") metrics.callBack++;
      if (status.startsWith("interview_")) metrics.interviews++;
      if (status === "joined" || finalStatus === "joined") metrics.joined++;
      if (isPending && createdAge >= 24) metrics.pending24h++;
      if (!lead.location_id || !lead.role_id) metrics.unmapped++;
      if (isNoStatus) {
        queues.noStatus++;
        if (createdAge >= 12) queues.noStatus12h++;
        if (createdAge >= 24) queues.noStatus24h++;
        if (createdAge >= 48) queues.noStatus48h++;
      }
      if (status === "no_response" && updatedAge >= 5 / 60) queues.retryDue++;
      const callbackAt = lead.callback_at ? new Date(lead.callback_at).getTime() : NaN;
      if (status === "call_back" && Number.isFinite(callbackAt) && callbackAt <= now) queues.callbackDue++;
      const interviewAt = lead.follow_up_at ? new Date(lead.follow_up_at).getTime() : NaN;
      if (status.startsWith("interview_") && Number.isFinite(interviewAt) && interviewAt >= today.start && interviewAt <= today.end) queues.interviewsToday++;

      const statusLabel = status || "no_status";
      byStatus.set(statusLabel, (byStatus.get(statusLabel) ?? 0) + 1);
      const location = lead.recruitment_locations?.code ?? "Unmapped";
      const role = lead.recruitment_roles?.code ?? "Unmapped";
      const cluster = ownerByStationCode.get(location) ?? "Unmapped";
      byLocation.set(location, (byLocation.get(location) ?? 0) + 1);
      byRole.set(role, (byRole.get(role) ?? 0) + 1);
      byCluster.set(cluster, (byCluster.get(cluster) ?? 0) + 1);
      const key = `${location}|${role}`;
      const group = designation.get(key) ?? { location, role, total: 0, noStatus: 0, noResponse: 0, callBack: 0, interviews: 0, stale: 0 };
      group.total++;
      if (isNoStatus) group.noStatus++;
      if (status === "no_response") group.noResponse++;
      if (status === "call_back") group.callBack++;
      if (status.startsWith("interview_")) group.interviews++;
      if (isPending && createdAge >= 24) group.stale++;
      designation.set(key, group);

      const adKey = lead.ad_id && adDesignation.has(`ad:${lead.ad_id}`)
        ? `ad:${lead.ad_id}`
        : `unmapped:${location}|${role}`;
      const adGroup = adDesignation.get(adKey) ?? {
        adId: null,
        adName: "Unmapped ad",
        adStatus: "not_active",
        routeStatus: "unmapped",
        station: location,
        stationName: lead.recruitment_locations?.name ?? location,
        designation: role,
        designationName: lead.recruitment_roles?.name ?? role,
        totalLeads: 0,
        pending: 0,
        noStatus: 0,
        noResponse: 0,
        callBack: 0,
        interviews: 0,
        joined: 0,
        stale24h: 0,
        lifetimeTotalLeads: 0,
        dailyBudget: 0,
        totalSpend: 0,
        createdOn: null,
        lastSyncedAt: null
      };
      adGroup.lifetimeTotalLeads++;
      if (isMtdLead) {
        adGroup.totalLeads++;
        if (isPending) adGroup.pending++;
        if (isNoStatus) adGroup.noStatus++;
        if (status === "no_response") adGroup.noResponse++;
        if (status === "call_back") adGroup.callBack++;
        if (status.startsWith("interview_")) adGroup.interviews++;
        if (isPending && createdAge >= 24) adGroup.stale24h++;
      }
      if (joinedMtd) adGroup.joined++;
      adDesignation.set(adKey, adGroup);
      const station = stations.get(location) ?? {
        code: location,
        name: lead.recruitment_locations?.name ?? location,
        cluster,
        owner: lead.recruitment_locations?.poc_name ?? "",
        ownerMobile: lead.recruitment_locations?.poc_mobile ?? "",
        total: 0, noStatus: 0, pending: 0, interviews: 0, joined: 0,
        stale: 0, retryDue: 0, callbackDue: 0, interviewsToday: 0,
        unassigned: 0, updatedToday: 0, responseMinutes: 0, responseCount: 0
      };
      station.total++;
      if (isNoStatus) {
        station.noStatus++;
        if (!lead.assigned_profile_id) station.unassigned++;
      }
      if (isPending) station.pending++;
      if (status.startsWith("interview_")) station.interviews++;
      if (status === "joined" || finalStatus === "joined") station.joined++;
      if (isPending && createdAge >= 24) station.stale++;
      if (status === "no_response" && updatedAge >= 5 / 60) station.retryDue++;
      if (status === "call_back" && Number.isFinite(callbackAt) && callbackAt <= now) station.callbackDue++;
      if (status.startsWith("interview_") && Number.isFinite(interviewAt) && interviewAt >= today.start && interviewAt <= today.end) station.interviewsToday++;
      if (Number.isFinite(updatedAt) && updatedAt >= today.start && updatedAt <= today.end) station.updatedToday++;
      if (!isNoStatus && Number.isFinite(updatedAt) && Number.isFinite(createdAt) && updatedAt >= createdAt) {
        station.responseMinutes += Math.round((updatedAt - createdAt) / 60_000);
        station.responseCount++;
      }
      stations.set(location, station);

      if (attention.length < 120) {
        if (isNoStatus && createdAge >= 48) attention.push({ id: lead.id, name: lead.full_name || "Unnamed", phone: lead.phone, issue: "No status 48h+", priority: 100 });
        else if (status === "call_back" && Number.isFinite(callbackAt) && callbackAt <= now) attention.push({ id: lead.id, name: lead.full_name || "Unnamed", phone: lead.phone, issue: "Call Back due", priority: 80 });
        else if (status === "no_response" && updatedAge >= 1) attention.push({ id: lead.id, name: lead.full_name || "Unnamed", phone: lead.phone, issue: "No Response retry due", priority: 60 });
      }
    }

    const designationPendency = [...designation.values()]
      .sort((a, b) => (b.noStatus + b.noResponse + b.callBack) - (a.noStatus + a.noResponse + a.callBack))
      .slice(0, 100);
    const adDesignationPendency = [...adDesignation.values()]
      .sort((a, b) => b.pending - a.pending
        || Number(b.adStatus === "active") - Number(a.adStatus === "active")
        || a.adName.localeCompare(b.adName));
    attention.sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
    const stationHealth = [...stations.values()].map((station) => {
      const total = Math.max(1, station.total);
      const healthScore = Math.max(0, Math.min(100, Math.round(
        100
        - (station.noStatus / total) * 45
        - (station.stale / total) * 30
        + (station.interviews / total) * 15
        + (station.joined / total) * 10
      )));
      return {
        ...station,
        averageFirstResponseMinutes: station.responseCount ? Math.round(station.responseMinutes / station.responseCount) : null,
        healthScore,
        healthLabel: healthScore >= 75 ? "Good" : healthScore >= 50 ? "Watch" : "Critical",
        attentionScore: station.stale + station.retryDue * 3 + station.callbackDue * 4 + station.interviewsToday * 2
      };
    }).sort((a, b) => b.attentionScore - a.attentionScore || b.total - a.total);
    return {
      metrics,
      queues,
      statusBreakdown: ranked(byStatus, 50),
      locations: ranked(byLocation, 100),
      roles: ranked(byRole, 100),
      clusters: ranked(byCluster, 100),
      designationPendency,
      adDesignationPendency,
      stationHealth,
      attention: attention.slice(0, 50),
      currentOpenRoles,
      openRolesAccess: {
        view: canViewOpenRoles,
        edit: workspace === "hr" && canUseRecruitmentMenu(session, "Job Requisitions", "edit", "hr"),
        approve: workspace === "hr" && canUseRecruitmentMenu(session, "Job Requisitions", "all", "hr")
      },
      period: { kind: "mtd", from: monthStartDate, to: today.date, label: `${monthLabel} MTD` },
      health: {
        attended: rows.length - metrics.noStatus,
        attendedRate: rows.length ? Math.round(((rows.length - metrics.noStatus) / rows.length) * 1000) / 10 : 0,
        routedRate: rows.length ? Math.round(((rows.length - metrics.unmapped) / rows.length) * 1000) / 10 : 0,
        staleRate: rows.length ? Math.round((metrics.pending24h / rows.length) * 1000) / 10 : 0
      },
      filters: { stream: stream ?? "", stations: stationCodes, clusters, roles: roleCodes },
      generatedAt: new Date().toISOString()
    };
    })();
    // Evict on failure so one bad fetch doesn't keep every request for this scope failing for
    // the rest of the TTL -- the next request gets a clean retry instead.
    dashboardBody.catch(() => { if (dashboardCache.get(scopeKey)?.body === dashboardBody) dashboardCache.delete(scopeKey); });
    dashboardCache.set(scopeKey, { expires: Date.now() + DASHBOARD_CACHE_TTL_MS, body: dashboardBody });
    for (const [k, value] of dashboardCache) if (value.expires <= Date.now()) dashboardCache.delete(k);
    return NextResponse.json(await dashboardBody);
  } catch (error) {
    console.error("Recruitment dashboard failed", error);
    return NextResponse.json({ error: "Unable to load dashboard." }, { status: 500 });
  }
}
