import { storedAdDelivery } from "@/lib/meta-ad-delivery";
import { NextResponse } from "next/server";
import { canAccessLead, canUseRecruitmentMenu, hasFullLeadAccess, recruitmentSession, requiredEnv } from "@/lib/recruitment-api";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { currentRequisitionStatuses, remainingRequisitionOpenings } from "@/lib/hr-recruitment-overview";
import { loadMainDashboardStations } from "@/lib/main-dashboard-masters";
import { loadAllSupabaseRows } from "@/lib/supabase-pagination";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// Database rollups avoid sending the entire lead registry over the network.
// Cached results remain scoped to the authenticated location/role permissions.
const dashboardCache = new Map<string, { expires: number; body: Promise<Record<string, unknown>> }>();
const DASHBOARD_CACHE_TTL_MS = 120_000;

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
    const mainStations = url.searchParams.get("mode") !== "summary" || clusters.length
      ? await loadMainDashboardStations(companyId) : [];
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
      sessionFullLeadAccess: hasFullLeadAccess(session),
      requisitionAccess: ["view","edit","all"].map(action=>canUseRecruitmentMenu(session,"Job Requisitions",action as "view"|"edit"|"all","hr")),
      sessionAllLocations: session.allLocations,
      sessionLocationIds: [...session.locationIds].sort(),
      sessionRoleIds: [...session.roleIds].sort()
    });
    const cachedDashboard = dashboardCache.get(scopeKey);
    if (cachedDashboard && cachedDashboard.expires > Date.now()) {
      return NextResponse.json(await cachedDashboard.body);
    }
    const dashboardBody = (async (): Promise<Record<string, unknown>> => {
    const fullAccess=hasFullLeadAccess(session);
    let rows:any[]=[];
    let attention:Array<{id:string;name:string;phone:string|null;issue:string;priority:number}>=[];
    if(!hasEmptyFilter) {
      const rollup=await supabaseAdmin!.rpc('recruitment_dashboard_rollups',{
        p_company_id:companyId,p_stream:stream==='workforce'||stream==='hr'?stream:null,
        p_scope_location_ids:fullAccess||session.allLocations?null:session.locationIds,
        p_scope_role_ids:fullAccess||!session.roleIds.length?null:session.roleIds,
        p_filter_location_ids:locationIds,p_filter_role_ids:roleIds
      });
      if(rollup.error)throw new Error(rollup.error.message);
      rows=rollup.data.groups;attention=rollup.data.attention;
    }
    const totalLeads=rows.reduce((sum,row)=>sum+Number(row.total),0);

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
    const metrics = { total: totalLeads, noStatus: 0, noResponse: 0, callBack: 0, interviews: 0, joined: 0, pending24h: 0, unmapped: 0 };
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
    for (const lead of rows) {
      const status=lead.s;
      const n=Number(lead.total);
      const c = Object.fromEntries(Object.entries(lead).filter(([,value])=>typeof value==='number').map(([key,value])=>[key,Number(value)]));
      metrics.noStatus+=c.no_status;metrics.noResponse+=c.no_response;metrics.callBack+=c.call_back;
      metrics.interviews+=c.interviews;metrics.joined+=c.joined;metrics.pending24h+=c.stale;
      if(!lead.location_id||!lead.role_id)metrics.unmapped+=n;
      queues.noStatus+=c.no_status;queues.noStatus12h+=c.no_status_12h;queues.noStatus24h+=c.no_status_24h;
      queues.noStatus48h+=c.no_status_48h;queues.retryDue+=c.retry_due;queues.callbackDue+=c.callback_due;queues.interviewsToday+=c.interviews_today;

      const statusLabel = status || "no_status";
      byStatus.set(statusLabel, (byStatus.get(statusLabel) ?? 0) + n);
      const location = lead.recruitment_locations?.code ?? "Unmapped";
      const role = lead.recruitment_roles?.code ?? "Unmapped";
      const cluster = ownerByStationCode.get(location) ?? "Unmapped";
      byLocation.set(location, (byLocation.get(location) ?? 0) + n);
      byRole.set(role, (byRole.get(role) ?? 0) + n);
      byCluster.set(cluster, (byCluster.get(cluster) ?? 0) + n);
      const key = `${location}|${role}`;
      const group = designation.get(key) ?? { location, role, total: 0, noStatus: 0, noResponse: 0, callBack: 0, interviews: 0, stale: 0 };
      group.total+=n;group.noStatus+=c.no_status;group.noResponse+=c.no_response;group.callBack+=c.call_back;
      group.interviews+=c.interviews;group.stale+=c.stale;
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
      adGroup.lifetimeTotalLeads+=n;adGroup.totalLeads+=n;adGroup.pending+=c.pending;
      adGroup.noStatus+=c.no_status;adGroup.noResponse+=c.no_response;adGroup.callBack+=c.call_back;
      adGroup.interviews+=c.interviews;adGroup.stale24h+=c.stale;adGroup.joined+=c.joined;
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
      station.total+=n;station.noStatus+=c.no_status;station.unassigned+=c.unassigned;
      station.pending+=c.pending;station.interviews+=c.interviews;station.joined+=c.joined;
      station.stale+=c.stale;station.retryDue+=c.retry_due;station.callbackDue+=c.callback_due;
      station.interviewsToday+=c.interviews_today;station.updatedToday+=c.updated_today;
      station.responseMinutes+=c.response_minutes;station.responseCount+=c.response_count;
      stations.set(location,station);
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
      period: { kind: "overall", from: null, to: today.date, label: "Overall" },
      health: {
        attended: totalLeads - metrics.noStatus,
        attendedRate: totalLeads ? Math.round(((totalLeads - metrics.noStatus) / totalLeads) * 1000) / 10 : 0,
        routedRate: totalLeads ? Math.round(((totalLeads - metrics.unmapped) / totalLeads) * 1000) / 10 : 0,
        staleRate: totalLeads ? Math.round((metrics.pending24h / totalLeads) * 1000) / 10 : 0
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
