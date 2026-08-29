import { NextResponse } from "next/server";
import { canUseRecruitmentMenu, recruitmentSession, requiredEnv } from "@/lib/recruitment-api";
import { getConnectionConfig } from "@/lib/connection-config";
import { enqueueLeadNotification } from "@/lib/recruitment-notifications";
import {
  isRetryableNotificationStatus,
  maskRecruitmentPhone,
  outboxCoversReplayCandidate,
  replayCandidateForLead
} from "@/lib/recruitment-whatsapp-log";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const logStatuses = ["queued", "retry", "sending", "sent", "delivered", "read", "failed", "skipped"];
const replayStatuses = ["no_response", "interview_scheduled", "interview_rescheduled"];

function integer(value: string | null, fallback: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.floor(Number(value) || fallback)));
}

function cleanSearch(value: string | null) {
  return String(value ?? "").trim().replace(/[%_,()]/g, "").slice(0, 80);
}

function relation<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function chunks<T>(rows: T[], size = 200) {
  const result: T[][] = [];
  for (let index = 0; index < rows.length; index += size) result.push(rows.slice(index, index + size));
  return result;
}

async function logSession(request: Request, required: "view" | "edit") {
  const session = await recruitmentSession(request);
  return canUseRecruitmentMenu(session, "Connections", required) ? session : null;
}

function applyWindow(query: any, from: string, to: string, trigger: string) {
  let next = query.gte("created_at", from).lte("created_at", to);
  if (["new_lead", "no_response", "interview"].includes(trigger)) next = next.eq("notification_trigger", trigger);
  return next;
}

export async function GET(request: Request) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase is not configured.");
    if (!await logSession(request, "view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
    const url = new URL(request.url);
    const page = integer(url.searchParams.get("page"), 1, 1, 100_000);
    const limit = integer(url.searchParams.get("limit"), 50, 10, 100);
    const status = String(url.searchParams.get("status") ?? "").trim().toLowerCase();
    const trigger = String(url.searchParams.get("trigger") ?? "").trim().toLowerCase();
    const search = cleanSearch(url.searchParams.get("search"));
    const fromDate = new Date(url.searchParams.get("from") || Date.now() - 30 * 24 * 60 * 60_000);
    const toDate = new Date(url.searchParams.get("to") || Date.now());
    const from = Number.isFinite(fromDate.getTime()) ? fromDate.toISOString() : new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString();
    const to = Number.isFinite(toDate.getTime()) ? toDate.toISOString() : new Date().toISOString();

    const messageSelect = (includeReadAt: boolean) => `
        id,lead_id,phone,template_name,notification_trigger,recruitment_stream,status,attempt_count,
        provider_message_id,created_at,updated_at,sent_at,delivered_at,${includeReadAt ? "read_at," : ""}failed_at,last_error,
        recruitment_leads(full_name,status,recruitment_locations(code,name),recruitment_roles(code,name))
      `;
    const loadRows = async (includeReadAt: boolean) => {
      let query = applyWindow(supabaseAdmin!.from("recruitment_whatsapp_outbox")
        .select(messageSelect(includeReadAt), { count: "exact" })
        .eq("company_id", companyId), from, to, trigger);
      if (logStatuses.includes(status)) query = query.eq("status", status);
      if (search) query = query.or(`phone.ilike.%${search}%,template_name.ilike.%${search}%`);
      return query.order("created_at", { ascending: false }).range((page - 1) * limit, page * limit - 1);
    };
    let rows = await loadRows(true);
    if (rows.error && /read_at|schema cache/i.test(rows.error.message)) rows = await loadRows(false);
    if (rows.error) throw new Error(rows.error.message);

    const summaryEntries = await Promise.all(logStatuses.map(async (item) => {
      const result = await applyWindow(supabaseAdmin!.from("recruitment_whatsapp_outbox")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId).eq("status", item), from, to, trigger);
      if (result.error) throw new Error(result.error.message);
      return [item, result.count ?? 0] as const;
    }));
    const whatsapp = await getConnectionConfig("whatsapp");
    return NextResponse.json({
      messages: (rows.data ?? []).map((item: any) => {
        const lead = relation(item.recruitment_leads) as any;
        const location = relation(lead?.recruitment_locations) as any;
        const role = relation(lead?.recruitment_roles) as any;
        return {
          id: item.id,
          leadId: item.lead_id,
          candidate: lead?.full_name || "Unknown candidate",
          phone: maskRecruitmentPhone(item.phone),
          candidateStatus: lead?.status || "",
          station: location?.code || "—",
          role: role?.code || "—",
          templateName: item.template_name,
          trigger: item.notification_trigger || "",
          stream: item.recruitment_stream || "",
          status: item.status,
          attemptCount: item.attempt_count,
          providerReference: item.provider_message_id ? `…${String(item.provider_message_id).slice(-8)}` : "—",
          createdAt: item.created_at,
          sentAt: item.sent_at,
          deliveredAt: item.delivered_at,
          readAt: item.read_at || (item.status === "read" ? item.updated_at : null),
          failedAt: item.failed_at,
          updatedAt: item.updated_at,
          lastError: item.last_error
        };
      }),
      summary: Object.fromEntries(summaryEntries),
      tracking: {
        appSecretConfigured: Boolean(whatsapp?.secrets.app_secret?.trim()),
        verifyTokenConfigured: Boolean(whatsapp?.secrets.verify_token?.trim())
      },
      pagination: { page, limit, total: rows.count ?? 0 },
      window: { from, to },
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error("Recruitment WhatsApp log failed", error);
    return NextResponse.json({ error: "Unable to load the WhatsApp message log." }, { status: 500 });
  }
}

async function replayLeads(companyId: string) {
  const leads: any[] = [];
  for (let start = 0; ; start += 1000) {
    const page = await supabaseAdmin!.from("recruitment_leads")
      .select("id,phone,full_name,status,stream,location_id,no_response_attempts,follow_up_at,recruitment_roles(name)")
      .eq("company_id", companyId).eq("archived", false).in("status", replayStatuses)
      .order("id").range(start, start + 999);
    if (page.error) throw new Error(page.error.message);
    leads.push(...(page.data ?? []));
    if ((page.data?.length ?? 0) < 1000) break;
  }
  return leads.map((lead) => ({ lead, candidate: replayCandidateForLead(lead) }))
    .filter((item): item is { lead: any; candidate: NonNullable<ReturnType<typeof replayCandidateForLead>> } => Boolean(item.candidate));
}

export async function POST(request: Request) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase is not configured.");
    if (!await logSession(request, "edit")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const apply = body.action === "apply";
    const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
    const eligible = await replayLeads(companyId);
    const leadIds = eligible.map((item) => item.lead.id);
    const outboxRows: any[] = [];
    const historyRows: any[] = [];
    for (const ids of chunks(leadIds)) {
      const [outbox, history] = await Promise.all([
        supabaseAdmin.from("recruitment_whatsapp_outbox")
          .select("id,lead_id,template_name,notification_trigger,notification_context,status,created_at")
          .eq("company_id", companyId).in("lead_id", ids).order("created_at", { ascending: false }),
        supabaseAdmin.from("recruitment_lead_history")
          .select("lead_id,new_value,created_at")
          .eq("company_id", companyId).in("lead_id", ids)
          .in("event_type", ["status_change", "contact_attempt"])
          .in("new_value", replayStatuses).order("created_at", { ascending: false })
      ]);
      if (outbox.error || history.error) throw new Error(outbox.error?.message || history.error?.message);
      outboxRows.push(...(outbox.data ?? []));
      historyRows.push(...(history.data ?? []));
    }
    const outboxByLead = new Map<string, any[]>();
    for (const row of outboxRows) outboxByLead.set(row.lead_id, [...(outboxByLead.get(row.lead_id) ?? []), row]);
    const latestEventByLead = new Map<string, string>();
    for (const row of historyRows) if (!latestEventByLead.has(row.lead_id)) latestEventByLead.set(row.lead_id, row.created_at);

    const actions = eligible.map((item) => {
      const matching = (outboxByLead.get(item.lead.id) ?? []).find((row) =>
        outboxCoversReplayCandidate(row, item.candidate, latestEventByLead.get(item.lead.id)));
      return { ...item, matching, action: matching ? (isRetryableNotificationStatus(matching.status) ? "retry" : "covered") : "queue" };
    });
    const maxActions = 50;
    const actionable = actions.filter((item) => item.action !== "covered");
    let queued = 0;
    let retried = 0;
    let blocked = 0;
    const issues: Array<{ leadId: string; candidate: string; trigger: string; reason: string }> = [];
    if (apply) {
      for (const item of actionable.slice(0, maxActions)) {
        if (item.action === "retry") {
          const saved = await supabaseAdmin.from("recruitment_whatsapp_outbox").update({
            status: "retry",
            attempt_count: 0,
            next_attempt_at: new Date().toISOString(),
            failed_at: null,
            last_error: "Requeued by the Recruit WhatsApp message audit.",
            updated_at: new Date().toISOString()
          }).eq("company_id", companyId).eq("id", item.matching.id).in("status", ["failed", "skipped"]).select("id").maybeSingle();
          if (saved.error) throw new Error(saved.error.message);
          if (saved.data) {
            retried++;
            const audit = await supabaseAdmin.from("recruitment_lead_history").insert({
              company_id: companyId,
              lead_id: item.lead.id,
              event_type: "whatsapp_notification_requeued",
              remarks: `${item.matching.template_name} requeued by the Recruit message audit.`,
              actor_email: "system:notification_audit",
              metadata: {
                outbox_id: item.matching.id,
                trigger: item.candidate.trigger,
                source: "recruit_whatsapp_log"
              }
            });
            if (audit.error) throw new Error(audit.error.message);
          }
          continue;
        }
        const result = await enqueueLeadNotification({
          companyId,
          lead: {
            id: item.lead.id,
            phone: item.lead.phone,
            full_name: item.lead.full_name,
            stream: item.lead.stream,
            location_id: item.lead.location_id,
            recruitment_roles: relation(item.lead.recruitment_roles) as { name?: string | null } | null
          },
          trigger: item.candidate.trigger,
          anchor: item.candidate.anchor
        });
        if (result.queued) queued++;
        else {
          blocked++;
          issues.push({
            leadId: item.lead.id,
            candidate: item.lead.full_name || "Unknown candidate",
            trigger: item.candidate.trigger,
            reason: result.reason || "Notification could not be queued."
          });
        }
      }
    }
    return NextResponse.json({
      mode: apply ? "applied" : "preview",
      eligible: eligible.length,
      covered: actions.filter((item) => item.action === "covered").length,
      missing: actions.filter((item) => item.action === "queue").length,
      retryable: actions.filter((item) => item.action === "retry").length,
      queued,
      retried,
      blocked,
      remaining: apply ? Math.max(0, actionable.length - maxActions) : actionable.length,
      issues: issues.slice(0, 25),
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error("Recruitment WhatsApp replay audit failed", error);
    return NextResponse.json({ error: "Unable to audit missing WhatsApp messages." }, { status: 500 });
  }
}
