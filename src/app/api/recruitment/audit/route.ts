import { NextResponse } from "next/server";
import { canUseRecruitmentMenu, recruitmentSession, requiredEnv } from "@/lib/recruitment-api";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

type SystemLogEvent = {
  id: string;
  source: string;
  entity: string;
  subject: string;
  action: string;
  change: string;
  actor: string;
  created_at: string;
};

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown, fallback = "—") {
  const result = String(value ?? "").trim();
  return result || fallback;
}

export async function GET(request: Request) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase is not configured.");
    const session = await recruitmentSession(request);
    if (!canUseRecruitmentMenu(session, "Audit", "view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
    const [leadHistory, connectionHistory, requisitionHistory, adRequests] = await Promise.all([
      supabaseAdmin.from("recruitment_lead_history")
        .select("id,lead_id,event_type,field_name,old_value,new_value,remarks,actor_profile_id,actor_email,created_at,recruitment_leads(full_name,phone)")
        .eq("company_id", companyId).order("created_at", { ascending: false }).limit(500),
      supabaseAdmin.from("recruitment_connection_audit")
        .select("id,provider,action,changed_fields,outcome,message,actor_profile_id,actor_email,created_at")
        .eq("company_id", companyId).order("created_at", { ascending: false }).limit(300),
      supabaseAdmin.from("recruitment_requisition_events")
        .select("id,requisition_id,event_type,summary,metadata,actor_profile_id,actor_email,created_at,recruitment_job_requisitions(requisition_code,title)")
        .eq("company_id", companyId).order("created_at", { ascending: false }).limit(300),
      supabaseAdmin.from("recruitment_ad_requests")
        .select("id,request_id,request_type,status,requested_by,requested_at,created_at,raw_payload,recruitment_locations(code),recruitment_roles(code,name)")
        .eq("company_id", companyId).order("updated_at", { ascending: false }).limit(250)
    ]);
    const failed = [leadHistory, connectionHistory, requisitionHistory, adRequests].find((result) => result.error);
    if (failed?.error) throw failed.error;

    const events: SystemLogEvent[] = [];
    for (const item of leadHistory.data ?? []) {
      const actor = text(item.actor_email, "System");
      if (!item.actor_profile_id && (actor === "System" || actor.toLowerCase().startsWith("system:"))) continue;
      const lead = one(item.recruitment_leads);
      events.push({
        id: `candidate:${item.id}`,
        source: "Candidates",
        entity: "Candidate",
        subject: text(lead?.full_name, text(lead?.phone, item.lead_id)),
        action: item.event_type,
        change: text(item.remarks, item.field_name ? `${item.field_name}: ${text(item.old_value)} → ${text(item.new_value)}` : `${text(item.old_value)} → ${text(item.new_value)}`),
        actor,
        created_at: item.created_at
      });
    }
    for (const item of connectionHistory.data ?? []) {
      const changed = Array.isArray(item.changed_fields) ? item.changed_fields.join(", ") : "";
      events.push({
        id: `configuration:${item.id}`,
        source: item.provider === "access" ? "Users & Access" : item.provider === "mobile" ? "User Roles" : "Connections & Masters",
        entity: text(item.provider, "Configuration"),
        subject: text(item.provider, "Configuration"),
        action: item.action,
        change: text(item.message, changed || text(item.outcome, "Configuration changed")),
        actor: text(item.actor_email, "System"),
        created_at: item.created_at
      });
    }
    for (const item of requisitionHistory.data ?? []) {
      const requisition = one(item.recruitment_job_requisitions);
      events.push({
        id: `requisition:${item.id}`,
        source: "Job Requisitions",
        entity: "Requisition",
        subject: requisition ? `${text(requisition.requisition_code)} · ${text(requisition.title)}` : item.requisition_id,
        action: item.event_type,
        change: item.summary,
        actor: text(item.actor_email, "System"),
        created_at: item.created_at
      });
    }
    for (const item of adRequests.data ?? []) {
      const raw = record(item.raw_payload);
      const lifecycle = Array.isArray(raw.lifecycleHistory) ? raw.lifecycleHistory : [];
      const location = one(item.recruitment_locations);
      const role = one(item.recruitment_roles);
      const subject = [item.request_id, location?.code, role?.code || role?.name].filter(Boolean).join(" · ");
      if (!lifecycle.length) {
        events.push({
          id: `ad-request:${item.id}:created`, source: "Advertising Requests", entity: text(item.request_type), subject,
          action: "submitted", change: `Request created as ${text(item.status)}.`, actor: text(item.requested_by, "System"),
          created_at: item.requested_at || item.created_at
        });
      }
      lifecycle.forEach((entry, index) => {
        const change = record(entry);
        events.push({
          id: `ad-request:${item.id}:${index}`,
          source: "Advertising Requests",
          entity: text(item.request_type),
          subject,
          action: text(change.action, "updated"),
          change: text(change.remarks, `${text(change.from)} → ${text(change.to)}`),
          actor: text(change.actorEmail, text(change.actorName, text(item.requested_by, "System"))),
          created_at: text(change.at, item.requested_at || item.created_at)
        });
      });
    }

    events.sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at));
    return NextResponse.json({
      events: events.slice(0, 1000),
      sources: [...new Set(events.map((event) => event.source))].sort(),
      actions: [...new Set(events.map((event) => event.action))].sort()
    });
  } catch (error) {
    console.error("Recruitment system logs failed", error);
    return NextResponse.json({ error: "Unable to load system logs." }, { status: 500 });
  }
}
