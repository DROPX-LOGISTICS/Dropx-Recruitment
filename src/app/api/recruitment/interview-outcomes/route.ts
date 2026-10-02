import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { applyLeadScope, canUseRecruitmentMenu, recruitmentSession, requiredEnv } from "@/lib/recruitment-api";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const OUTCOME_STATUSES = new Set(["joined", "interview_no_show", "no_response", "not_interested", "interview_rescheduled"]);

function istDate(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
}

function startOfIstDay(value: string) { return `${value}T00:00:00.000+05:30`; }
function endOfIstDay(value: string) { return `${value}T23:59:59.999+05:30`; }
function text(value: unknown) { return String(value ?? "").trim(); }
function relation<T>(value: T | T[] | null | undefined) { return Array.isArray(value) ? value[0] ?? null : value ?? null; }
function dateTime(value: string | null) { return value ? new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : ""; }

function outcomeFor(status: string, scheduledAt: string | null, now = Date.now()) {
  const needsUpdate = ["interview_scheduled", "interview_rescheduled"].includes(status)
    && Boolean(scheduledAt && new Date(scheduledAt).getTime() <= now);
  if (status === "joined") return { code: "reported", label: "Reported", needsUpdate: false };
  if (status === "interview_no_show") return { code: "did_not_report", label: "Did not report", needsUpdate: false };
  if (status === "no_response") return { code: "not_responding", label: "Not responding", needsUpdate: false };
  if (status === "not_interested") return { code: "not_interested", label: "Not interested", needsUpdate: false };
  if (status === "interview_rescheduled") return { code: "rescheduled", label: needsUpdate ? "Rescheduled · update pending" : "Rescheduled", needsUpdate };
  if (needsUpdate) return { code: "update_pending", label: "Update pending", needsUpdate: true };
  return { code: "scheduled", label: "Scheduled", needsUpdate: false };
}

function sourceFor(metadata: Record<string, unknown> | null | undefined) {
  const source = text(metadata?.source_portal || metadata?.source).toLowerCase();
  if (source === "ops_pulse" || source === "ops") return "Station / OpsPulse";
  if (source.includes("mobile")) return "Recruit mobile";
  if (source) return "Recruit";
  return "Recruit / imported";
}

function workbookResponse(rows: unknown[][]) {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  worksheet["!freeze"] = { xSplit: 0, ySplit: 1 };
  worksheet["!autofilter"] = rows[0]?.length ? { ref: XLSX.utils.encode_range({ r: 0, c: 0 }, { r: Math.max(0, rows.length - 1), c: rows[0].length - 1 }) } : undefined;
  worksheet["!cols"] = (rows[0] ?? []).map((_, column) => ({ wch: Math.min(46, Math.max(12, ...rows.slice(0, 500).map((row) => String(row[column] ?? "").length))) }));
  XLSX.utils.book_append_sheet(workbook, worksheet, "Interview outcomes");
  const bytes = XLSX.write(workbook, { type: "buffer", bookType: "xlsx", compression: true });
  return new Response(bytes, { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="DropX_Interview_Outcomes_${istDate()}.xlsx"`, "Cache-Control": "private, no-store" } });
}

export async function GET(request: Request) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase is not configured.");
    const session = await recruitmentSession(request);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!canUseRecruitmentMenu(session, "Reports", "view", "workforce")) return NextResponse.json({ error: "Reports view access is required." }, { status: 403 });
    const url = new URL(request.url);
    const today = istDate();
    const from = url.searchParams.get("from") || `${today.slice(0, 8)}01`;
    const to = url.searchParams.get("to") || today;
    const station = text(url.searchParams.get("station")).toUpperCase();
    const format = url.searchParams.get("format");
    if (format === "xlsx" && !canUseRecruitmentMenu(session, "Reports", "edit", "workforce")) return NextResponse.json({ error: "Reports download permission is required." }, { status: 403 });
    const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");

    let leadQuery: any = supabaseAdmin.from("recruitment_leads")
      .select("id,full_name,phone,email,status,final_status,remarks,final_remarks,follow_up_at,updated_at,last_updated_by,location_id,role_id,recruitment_locations(code,name),recruitment_roles(code,name)")
      .eq("company_id", companyId).eq("stream", "workforce").eq("archived", false)
      .gte("follow_up_at", startOfIstDay(from)).lte("follow_up_at", endOfIstDay(to));
    leadQuery = applyLeadScope(leadQuery, session, "workforce");
    if (station) {
      const location = await supabaseAdmin.from("recruitment_locations").select("id").eq("company_id", companyId).eq("code", station).maybeSingle();
      if (location.error) throw new Error(location.error.message);
      leadQuery = location.data ? leadQuery.eq("location_id", location.data.id) : leadQuery.eq("location_id", "00000000-0000-0000-0000-000000000000");
    }
    const leads = await leadQuery.order("follow_up_at", { ascending: false }).limit(3000);
    if (leads.error) throw new Error(leads.error.message);
    const leadIds = (leads.data ?? []).map((lead: any) => lead.id);
    const histories: any[] = [];
    for (let start = 0; start < leadIds.length; start += 200) {
      const history = await supabaseAdmin.from("recruitment_lead_history")
        .select("id,lead_id,event_type,new_value,remarks,actor_profile_id,actor_email,metadata,created_at")
        .eq("company_id", companyId).in("lead_id", leadIds.slice(start, start + 200)).order("created_at", { ascending: false });
      if (history.error) throw new Error(history.error.message);
      histories.push(...(history.data ?? []));
    }
    const latestByLead = new Map<string, any>();
    for (const event of histories) {
      if (latestByLead.has(event.lead_id)) continue;
      const next = text(event.new_value).toLowerCase();
      if (OUTCOME_STATUSES.has(next) || event.event_type === "interview_outcome") latestByLead.set(event.lead_id, event);
    }
    const actorIds = [...new Set((leads.data ?? []).flatMap((lead: any) => [lead.last_updated_by, latestByLead.get(lead.id)?.actor_profile_id]).filter(Boolean))];
    const profiles = actorIds.length ? await supabaseAdmin.from("profiles").select("id,full_name,email,mobile,mobile_country_code,employee_id").in("id", actorIds) : { data: [], error: null };
    if (profiles.error) throw new Error(profiles.error.message);
    const profileById = new Map((profiles.data ?? []).map((profile: any) => [profile.id, profile]));
    const now = Date.now();
    const rows = (leads.data ?? []).map((lead: any) => {
      const location = relation(lead.recruitment_locations) as { code?: string; name?: string } | null;
      const role = relation(lead.recruitment_roles) as { code?: string; name?: string } | null;
      const outcome = outcomeFor(text(lead.status).toLowerCase(), lead.follow_up_at, now);
      const event = latestByLead.get(lead.id);
      const actor = profileById.get(event?.actor_profile_id || lead.last_updated_by) as any;
      return {
        id: lead.id,
        candidate: lead.full_name || "Unnamed candidate",
        phone: lead.phone || "",
        stationCode: location?.code || "Unmapped",
        stationName: location?.name || "Unmapped",
        designation: role?.name || role?.code || "Unmapped",
        scheduledAt: lead.follow_up_at,
        outcome: outcome.code,
        outcomeLabel: outcome.label,
        needsUpdate: outcome.needsUpdate,
        updatedBy: actor?.full_name || event?.actor_email || "System / imported",
        updaterContact: actor?.mobile || actor?.email || "",
        source: sourceFor(event?.metadata),
        updatedAt: event?.created_at || lead.updated_at,
        remarks: event?.remarks || lead.final_remarks || lead.remarks || ""
      };
    });
    const stationMap = new Map<string, any>();
    const summary: Record<string, number> = { scheduled: rows.length, reported: 0, didNotReport: 0, notResponding: 0, notInterested: 0, rescheduled: 0, updatePending: 0, upcoming: 0 };
    for (const row of rows) {
      if (row.outcome === "reported") summary.reported++;
      else if (row.outcome === "did_not_report") summary.didNotReport++;
      else if (row.outcome === "not_responding") summary.notResponding++;
      else if (row.outcome === "not_interested") summary.notInterested++;
      else if (row.outcome === "rescheduled") summary.rescheduled++;
      if (row.needsUpdate) summary.updatePending++;
      else if (["scheduled", "rescheduled"].includes(row.outcome)) summary.upcoming++;
      const item = stationMap.get(row.stationCode) ?? { stationCode: row.stationCode, stationName: row.stationName, scheduled: 0, reported: 0, didNotReport: 0, notResponding: 0, notInterested: 0, rescheduled: 0, updatePending: 0, upcoming: 0 };
      item.scheduled++;
      if (row.outcome === "reported") item.reported++;
      else if (row.outcome === "did_not_report") item.didNotReport++;
      else if (row.outcome === "not_responding") item.notResponding++;
      else if (row.outcome === "not_interested") item.notInterested++;
      else if (row.outcome === "rescheduled") item.rescheduled++;
      if (row.needsUpdate) item.updatePending++;
      else if (["scheduled", "rescheduled"].includes(row.outcome)) item.upcoming++;
      stationMap.set(row.stationCode, item);
    }
    const locations = [...stationMap.values()].sort((left, right) => right.updatePending - left.updatePending || right.scheduled - left.scheduled || left.stationCode.localeCompare(right.stationCode));
    if (format === "xlsx") {
      return workbookResponse([["Candidate", "Mobile", "Station Code", "Station", "Designation", "Interview scheduled", "Outcome", "Updated by", "Updater contact", "Updated from", "Updated at", "Remarks"], ...rows.map((row: any) => [row.candidate, row.phone, row.stationCode, row.stationName, row.designation, dateTime(row.scheduledAt), row.outcomeLabel, row.updatedBy, row.updaterContact, row.source, dateTime(row.updatedAt), row.remarks])]);
    }
    return NextResponse.json({ from, to, summary, locations, rows, canDownload: canUseRecruitmentMenu(session, "Reports", "edit", "workforce") });
  } catch (error) {
    console.error("Interview outcome report failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load interview outcomes." }, { status: 500 });
  }
}
