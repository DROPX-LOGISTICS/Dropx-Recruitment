import { NextResponse } from "next/server";
import { applyLeadScope, canUseRecruitmentMenu, recruitmentSession, requiredEnv } from "@/lib/recruitment-api";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { currentRequisitionStatuses, remainingRequisitionOpenings } from "@/lib/hr-recruitment-overview";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

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
  recruitment_locations: { code: string; name: string; cluster: string | null; poc_name: string | null; poc_mobile: string | null } | null;
  recruitment_roles: { code: string; name: string; stream: string | null } | null;
};

type DashboardAd = {
  id: string;
  ad_name: string | null;
  status: string | null;
  route_status: string | null;
  location_id: string | null;
  role_id: string | null;
  last_synced_at: string | null;
  recruitment_locations: { id: string; code: string; name: string; cluster: string | null } | Array<{ id: string; code: string; name: string; cluster: string | null }> | null;
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
  stale24h: number;
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
  if (adStream === "workforce" && !session.workforce) return false;
  if (adStream === "hr" && !session.hr) return false;
  if (!session.allLocations && (!location?.id || !session.locationIds.includes(location.id))) return false;
  if (session.roleIds.length && (!role?.id || !session.roleIds.includes(role.id))) return false;
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
    let locationIds: string[] | null = null;
    let roleIds: string[] | null = null;
    if (stationCodes.length || clusters.length) {
      let locations = supabaseAdmin.from("recruitment_locations").select("id").eq("company_id", companyId);
      if (stationCodes.length) locations = locations.in("code", stationCodes);
      if (clusters.length) locations = locations.in("cluster", clusters);
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
      const metricQuery = () => {
        let query: any = supabaseAdmin!.from("recruitment_leads")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId)
          .eq("archived", false);
        query = applyLeadScope(query, session, stream);
        if (locationIds) query = query.in("location_id", locationIds);
        if (roleIds) query = query.in("role_id", roleIds);
        return query;
      };
      const countOf = async (query: any) => {
        const result = await query;
        if (result.error) throw new Error(result.error.message);
        return result.count ?? 0;
      };
      const staleBefore = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
      const [total, noStatus, noResponse, callBack, interviews, joined, pending24h, unmapped] = await Promise.all([
        countOf(metricQuery()),
        countOf(metricQuery().in("status", ["", "new"])),
        countOf(metricQuery().eq("status", "no_response")),
        countOf(metricQuery().eq("status", "call_back")),
        countOf(metricQuery().like("status", "interview_%")),
        countOf(metricQuery().or("status.eq.joined,final_status.eq.joined")),
        countOf(metricQuery().in("status", ["", "new", "no_response", "call_back"]).lt("lead_created_at", staleBefore)),
        countOf(metricQuery().or("location_id.is.null,role_id.is.null"))
      ]);
      return NextResponse.json({
        metrics: { total, noStatus, noResponse, callBack, interviews, joined, pending24h, unmapped },
        generatedAt: new Date().toISOString()
      });
    }
    const dashboardQuery = () => {
      let query: any = supabaseAdmin!.from("recruitment_leads")
        .select("id,full_name,phone,status,final_status,lead_created_at,updated_at,callback_at,follow_up_at,location_id,role_id,ad_id,assigned_profile_id,recruitment_locations(code,name,cluster,poc_name,poc_mobile),recruitment_roles(code,name,stream)")
        .eq("company_id", companyId).eq("archived", false);
      query = applyLeadScope(query, session, stream);
      if (locationIds) query = query.in("location_id", locationIds);
      if (roleIds) query = query.in("role_id", roleIds);
      return query;
    };
    let rows: DashboardLead[] = [];
    if (!hasEmptyFilter) {
      let countQuery: any = supabaseAdmin!.from("recruitment_leads")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId).eq("archived", false);
      countQuery = applyLeadScope(countQuery, session, stream);
      if (locationIds) countQuery = countQuery.in("location_id", locationIds);
      if (roleIds) countQuery = countQuery.in("role_id", roleIds);
      const counted = await countQuery;
      if (counted.error) throw new Error(counted.error.message);
      const pages = Math.ceil((counted.count ?? 0) / 1000);
      const results = await Promise.all(Array.from({ length: pages }, (_, page) =>
        dashboardQuery()
          .order("lead_created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(page * 1000, page * 1000 + 999)
      ));
      const failed = results.find((result) => result.error);
      if (failed?.error) throw new Error(failed.error.message);
      rows = results.flatMap((result) => (result.data ?? []) as DashboardLead[]);
    }

    let ads: DashboardAd[] = [];
    if (!hasEmptyFilter) {
      const adCount = await supabaseAdmin.from("recruitment_ads")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId);
      if (adCount.error) throw new Error(adCount.error.message);
      const adPages = await Promise.all(Array.from({ length: Math.ceil((adCount.count ?? 0) / 1000) }, (_, page) =>
        supabaseAdmin!.from("recruitment_ads")
          .select("id,ad_name,status,route_status,location_id,role_id,last_synced_at,recruitment_locations(id,code,name,cluster),recruitment_roles(id,code,name,stream)")
          .eq("company_id", companyId)
          .order("last_synced_at", { ascending: false })
          .range(page * 1000, page * 1000 + 999)
      ));
      const failedAdPage = adPages.find((result) => result.error);
      if (failedAdPage?.error) throw new Error(failedAdPage.error.message);
      ads = adPages
        .flatMap((result) => (result.data ?? []) as DashboardAd[])
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
        stale24h: 0,
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
      const cluster = lead.recruitment_locations?.cluster ?? "Unmapped";
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
        stale24h: 0,
        lastSyncedAt: null
      };
      adGroup.totalLeads++;
      if (isPending) adGroup.pending++;
      if (isNoStatus) adGroup.noStatus++;
      if (status === "no_response") adGroup.noResponse++;
      if (status === "call_back") adGroup.callBack++;
      if (status.startsWith("interview_")) adGroup.interviews++;
      if (isPending && createdAge >= 24) adGroup.stale24h++;
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
      const updatedAt = lead.updated_at ? new Date(lead.updated_at).getTime() : NaN;
      const createdAt = lead.lead_created_at ? new Date(lead.lead_created_at).getTime() : NaN;
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
    return NextResponse.json({
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
      health: {
        attended: rows.length - metrics.noStatus,
        attendedRate: rows.length ? Math.round(((rows.length - metrics.noStatus) / rows.length) * 1000) / 10 : 0,
        routedRate: rows.length ? Math.round(((rows.length - metrics.unmapped) / rows.length) * 1000) / 10 : 0,
        staleRate: rows.length ? Math.round((metrics.pending24h / rows.length) * 1000) / 10 : 0
      },
      filters: { stream: stream ?? "", stations: stationCodes, clusters, roles: roleCodes },
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error("Recruitment dashboard failed", error);
    return NextResponse.json({ error: "Unable to load dashboard." }, { status: 500 });
  }
}
