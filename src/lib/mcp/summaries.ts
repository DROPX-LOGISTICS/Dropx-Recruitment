import { applyLeadScope, canUseRecruitmentMenu, hasFullLeadAccess } from "@/lib/recruitment-api";
import type { MobileSessionContext } from "@/lib/mobile-session";
import {
  recruitmentMenuCatalog,
  type RecruitmentMenuId,
  type RecruitmentWorkspace
} from "@/lib/recruitment-menu-roles";
import { storedAdDelivery } from "@/lib/meta-ad-delivery";
import { currentRequisitionStatuses, remainingRequisitionOpenings } from "@/lib/hr-recruitment-overview";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { indiaDate, parseIsoDate } from "@/lib/mcp/dates";
import type { RecruitMcpAuthContext } from "@/lib/mcp/authorization";
import type { McpToolDefinition } from "@/lib/mcp/tools-policy";

function resolveStream(args: Record<string, unknown>): "workforce" | "hr" | null {
  const stream = String(args.stream ?? "").trim().toLowerCase();
  if (stream === "workforce" || stream === "hr") return stream;
  return null;
}

function scopedWorkspaces(session: MobileSessionContext, stream: "workforce" | "hr" | null): RecruitmentWorkspace[] {
  if (stream === "workforce" && session.workforce) return ["workforce"];
  if (stream === "hr" && session.hr) return ["hr"];
  const out: RecruitmentWorkspace[] = [];
  if (session.workforce) out.push("workforce");
  if (session.hr) out.push("hr");
  return out;
}

function dashboardScope(session: MobileSessionContext) {
  const fullAccess = hasFullLeadAccess(session);
  return {
    scopeLocationIds: fullAccess || session.allLocations ? null : session.locationIds,
    scopeRoleIds: fullAccess || !session.roleIds.length ? null : session.roleIds
  };
}

export function requireToolMenus(
  session: MobileSessionContext,
  tool: McpToolDefinition,
  args: Record<string, unknown> = {}
) {
  const stream = resolveStream(args);
  const workspaces = scopedWorkspaces(session, stream);
  const allowed = tool.menuIds.some((menuId) =>
    workspaces.some((workspace) => canUseRecruitmentMenu(session, menuId, "view", workspace))
  );
  if (!allowed) {
    throw Object.assign(new Error(`Permission denied for ${tool.menuIds.join(" / ")}.`), { code: -32003 });
  }
}

export async function summarizeRecruitScope(auth: RecruitMcpAuthContext) {
  const viewMenus = recruitmentMenuCatalog
    .filter((item) =>
      item.workspaces.some((workspace) => canUseRecruitmentMenu(auth, item.id as RecruitmentMenuId, "view", workspace))
    )
    .map((item) => item.id);
  return {
    asOf: indiaDate(),
    companyId: auth.companyId,
    profileId: auth.profileId,
    email: auth.email,
    displayName: auth.displayName,
    designationCode: auth.designationCode,
    accessTemplate: auth.accessTemplate,
    workforce: auth.workforce,
    hr: auth.hr,
    allLocations: auth.allLocations,
    locationScopeCount: auth.allLocations ? null : auth.locationIds.length,
    roleScopeCount: auth.roleIds.length || null,
    recruitmentFunction: auth.recruitmentFunction,
    viewMenus
  };
}

export async function summarizeDashboard(auth: RecruitMcpAuthContext, args: Record<string, unknown>) {
  if (!supabaseAdmin) throw Object.assign(new Error("Database unavailable."), { code: -32000 });
  requireToolMenus(auth, { menuIds: ["Dashboard"], name: "", description: "", inputSchema: {} }, args);
  const stream = resolveStream(args);
  const { scopeLocationIds, scopeRoleIds } = dashboardScope(auth);
  const staleBefore = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  const summary = await supabaseAdmin.rpc("recruitment_dashboard_summary_counts", {
    p_company_id: auth.companyId,
    p_stream: stream,
    p_scope_location_ids: scopeLocationIds,
    p_scope_role_ids: scopeRoleIds,
    p_filter_location_ids: null,
    p_filter_role_ids: null,
    p_stale_before: staleBefore
  }).single();
  if (summary.error) throw Object.assign(new Error(summary.error.message), { code: -32000 });
  const row = summary.data as {
    total: number;
    no_status: number;
    no_response: number;
    call_back: number;
    interviews: number;
    joined: number;
    pending_24h: number;
    unmapped: number;
  };
  return {
    asOf: indiaDate(),
    stream,
    metrics: {
      total: Number(row.total),
      noStatus: Number(row.no_status),
      noResponse: Number(row.no_response),
      callBack: Number(row.call_back),
      interviews: Number(row.interviews),
      joined: Number(row.joined),
      pending24h: Number(row.pending_24h),
      unmapped: Number(row.unmapped)
    }
  };
}

export async function summarizeLeadStatus(auth: RecruitMcpAuthContext, args: Record<string, unknown>) {
  if (!supabaseAdmin) throw Object.assign(new Error("Database unavailable."), { code: -32000 });
  requireToolMenus(auth, { menuIds: ["All Leads"], name: "", description: "", inputSchema: {} }, args);
  const stream = resolveStream(args);
  let query = supabaseAdmin
    .from("recruitment_leads")
    .select("status")
    .eq("company_id", auth.companyId)
    .eq("archived", false)
    .limit(8000);
  query = applyLeadScope(query, auth, stream);
  const result = await query;
  if (result.error) throw Object.assign(new Error(result.error.message), { code: -32000 });
  const byStatus = new Map<string, number>();
  for (const row of result.data ?? []) {
    const key = String(row.status ?? "unknown").trim() || "unknown";
    byStatus.set(key, (byStatus.get(key) ?? 0) + 1);
  }
  return {
    asOf: indiaDate(),
    stream,
    totalSampled: (result.data ?? []).length,
    truncated: (result.data ?? []).length >= 8000,
    byStatus: [...byStatus.entries()]
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count || a.status.localeCompare(b.status))
  };
}

export async function summarizeSlaQueues(auth: RecruitMcpAuthContext, args: Record<string, unknown>) {
  const dashboard = await summarizeDashboard(auth, args);
  return {
    asOf: dashboard.asOf,
    stream: dashboard.stream,
    queues: {
      noStatus: dashboard.metrics.noStatus,
      noResponse: dashboard.metrics.noResponse,
      callBack: dashboard.metrics.callBack,
      pending24h: dashboard.metrics.pending24h,
      interviews: dashboard.metrics.interviews
    }
  };
}

export async function summarizeInterviews(auth: RecruitMcpAuthContext, args: Record<string, unknown>) {
  if (!supabaseAdmin) throw Object.assign(new Error("Database unavailable."), { code: -32000 });
  requireToolMenus(auth, { menuIds: ["Interviews"], name: "", description: "", inputSchema: {} }, args);
  const to = parseIsoDate(args.to) ?? indiaDate();
  const from = parseIsoDate(args.from) ?? indiaDate(-7);
  if (from > to) throw Object.assign(new Error("Invalid from/to ISO dates."), { code: -32602 });
  let leadQuery = supabaseAdmin
    .from("recruitment_leads")
    .select("id,status,follow_up_at")
    .eq("company_id", auth.companyId)
    .eq("archived", false)
    .gte("follow_up_at", `${from}T00:00:00+05:30`)
    .lte("follow_up_at", `${to}T23:59:59.999+05:30`)
    .limit(3000);
  leadQuery = applyLeadScope(leadQuery, auth, "workforce");
  const leads = await leadQuery;
  if (leads.error) throw Object.assign(new Error(leads.error.message), { code: -32000 });
  const byOutcome = new Map<string, number>();
  for (const lead of leads.data ?? []) {
    const status = String(lead.status ?? "unknown").trim() || "unknown";
    byOutcome.set(status, (byOutcome.get(status) ?? 0) + 1);
  }
  return {
    asOf: to,
    from,
    to,
    interviewWindowLeadCount: (leads.data ?? []).length,
    byStatus: [...byOutcome.entries()].map(([status, count]) => ({ status, count }))
  };
}

export async function summarizeAds(auth: RecruitMcpAuthContext, args: Record<string, unknown>) {
  if (!supabaseAdmin) throw Object.assign(new Error("Database unavailable."), { code: -32000 });
  requireToolMenus(auth, { menuIds: ["Active Ads"], name: "", description: "", inputSchema: {} }, args);
  const stream = resolveStream(args);
  const [ads, roles] = await Promise.all([
    supabaseAdmin
      .from("recruitment_ads")
      .select("id,status,route_status,location_id,role_id,raw_payload")
      .eq("company_id", auth.companyId)
      .limit(5000),
    supabaseAdmin.from("recruitment_roles").select("id,stream").eq("company_id", auth.companyId)
  ]);
  if (ads.error) throw Object.assign(new Error(ads.error.message), { code: -32000 });
  if (roles.error) throw Object.assign(new Error(roles.error.message), { code: -32000 });
  const streamByRoleId = new Map((roles.data ?? []).map((row) => [row.id, String(row.stream ?? "")]));
  const byStatus = new Map<string, number>();
  const byRoute = new Map<string, number>();
  let inScope = 0;
  for (const row of ads.data ?? []) {
    const delivered = storedAdDelivery(row as any);
    const roleStream = row.role_id ? streamByRoleId.get(row.role_id) ?? "" : "";
    if (stream && roleStream && roleStream !== stream) continue;
    if (!auth.allLocations && row.location_id && !auth.locationIds.includes(row.location_id)) continue;
    if (auth.roleIds.length && row.role_id && !auth.roleIds.includes(row.role_id)) continue;
    inScope += 1;
    const status = String(delivered.status ?? "unknown").trim() || "unknown";
    const route = String(delivered.route_status ?? "unknown").trim() || "unknown";
    byStatus.set(status, (byStatus.get(status) ?? 0) + 1);
    byRoute.set(route, (byRoute.get(route) ?? 0) + 1);
  }
  return {
    asOf: indiaDate(),
    stream,
    totalInScope: inScope,
    byStatus: [...byStatus.entries()].map(([status, count]) => ({ status, count })),
    byRouteStatus: [...byRoute.entries()].map(([routeStatus, count]) => ({ routeStatus, count }))
  };
}

export async function summarizeUnmapped(auth: RecruitMcpAuthContext, args: Record<string, unknown>) {
  if (!supabaseAdmin) throw Object.assign(new Error("Database unavailable."), { code: -32000 });
  requireToolMenus(auth, { menuIds: ["Unmapped"], name: "", description: "", inputSchema: {} }, args);
  const stream = resolveStream(args);
  let query = supabaseAdmin
    .from("recruitment_leads")
    .select("id", { count: "exact", head: true })
    .eq("company_id", auth.companyId)
    .eq("archived", false)
    .or("location_id.is.null,role_id.is.null");
  query = applyLeadScope(query, auth, stream);
  const result = await query;
  if (result.error) throw Object.assign(new Error(result.error.message), { code: -32000 });
  return { asOf: indiaDate(), stream, unmappedCount: result.count ?? 0 };
}

export async function summarizeRequisitions(auth: RecruitMcpAuthContext) {
  if (!supabaseAdmin) throw Object.assign(new Error("Database unavailable."), { code: -32000 });
  requireToolMenus(auth, { menuIds: ["Job Requisitions"], name: "", description: "", inputSchema: {} });
  let query = supabaseAdmin
    .from("recruitment_job_requisitions")
    .select("status,openings,filled_positions")
    .eq("company_id", auth.companyId)
    .in("status", [...currentRequisitionStatuses]);
  if (!auth.isOwner && !auth.allLocations) query = query.in("location_id", auth.locationIds);
  if (!auth.isOwner && auth.roleIds.length) query = query.in("role_id", auth.roleIds);
  const result = await query;
  if (result.error) throw Object.assign(new Error(result.error.message), { code: -32000 });
  const byStatus = new Map<string, number>();
  let remainingOpenings = 0;
  for (const row of result.data ?? []) {
    const status = String(row.status ?? "unknown");
    byStatus.set(status, (byStatus.get(status) ?? 0) + 1);
    remainingOpenings += remainingRequisitionOpenings(row.openings, row.filled_positions);
  }
  return {
    asOf: indiaDate(),
    openRequisitions: (result.data ?? []).length,
    remainingOpenings,
    byStatus: [...byStatus.entries()].map(([status, count]) => ({ status, count }))
  };
}

const REPORT_CATALOG = [
  { id: "leadattempts", label: "Lead attempt history" },
  { id: "interviewoutcomes", label: "Interview outcomes" },
  { id: "adspend", label: "Meta ad spend" },
  { id: "hrperformance", label: "HR user performance" }
] as const;

export async function summarizeReportsSnapshot(auth: RecruitMcpAuthContext, args: Record<string, unknown>) {
  requireToolMenus(auth, { menuIds: ["Reports"], name: "", description: "", inputSchema: {} }, args);
  const stream = resolveStream(args);
  const workspaces = scopedWorkspaces(auth, stream);
  const canDownload = workspaces.some((workspace) => canUseRecruitmentMenu(auth, "Reports", "edit", workspace));
  return {
    asOf: indiaDate(),
    stream,
    canDownloadReports: canDownload,
    availableReports: REPORT_CATALOG.map((item) => ({
      id: item.id,
      label: item.label,
      viewAllowed: workspaces.some((workspace) => canUseRecruitmentMenu(auth, "Reports", "view", workspace))
    })),
    note: "MCP exposes report availability only. Download XLSX exports from Recruit UI."
  };
}
