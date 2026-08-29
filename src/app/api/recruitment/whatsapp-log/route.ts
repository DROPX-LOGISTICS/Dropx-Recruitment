import { NextResponse } from "next/server";
import { canUseRecruitmentMenu, recruitmentSession, requiredEnv } from "@/lib/recruitment-api";
import { getConnectionConfig } from "@/lib/connection-config";
import {
  buildNotificationTemplate,
  enqueueLeadNotification,
  mergeNotificationContacts,
  notificationRulesFromConfig
} from "@/lib/recruitment-notifications";
import { normalizePhone } from "@/lib/recruitment-routing";
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

function chunks<T>(rows: T[], size = 500) {
  const result: T[][] = [];
  for (let index = 0; index < rows.length; index += size) result.push(rows.slice(index, index + size));
  return result;
}

async function logSession(request: Request, required: "view" | "edit") {
  const session = await recruitmentSession(request);
  const allowed = required === "view"
    ? canUseRecruitmentMenu(session, "WhatsApp Messages", "view")
    : canUseRecruitmentMenu(session, "WhatsApp Messages", "edit")
      || canUseRecruitmentMenu(session, "Connections", "edit");
  return allowed ? session : null;
}

function scopeMessageQuery(query: any, session: NonNullable<Awaited<ReturnType<typeof recruitmentSession>>>, stream: string, locationId: string) {
  let scoped = query;
  const impossibleId = "00000000-0000-0000-0000-000000000000";
  if (stream === "workforce" || stream === "hr") {
    scoped = session[stream] ? scoped.eq("recruitment_leads.stream", stream) : scoped.eq("lead_id", impossibleId);
  }
  if (!session.allLocations) {
    scoped = session.locationIds.length
      ? scoped.in("recruitment_leads.location_id", session.locationIds)
      : scoped.eq("lead_id", impossibleId);
  }
  if (session.roleIds.length) scoped = scoped.in("recruitment_leads.role_id", session.roleIds);
  if (locationId) {
    scoped = !session.allLocations && !session.locationIds.includes(locationId)
      ? scoped.eq("lead_id", impossibleId)
      : scoped.eq("recruitment_leads.location_id", locationId);
  }
  return scoped;
}

function applyWindow(query: any, from: string, to: string, trigger: string) {
  let next = query.gte("created_at", from).lte("created_at", to);
  if (["new_lead", "no_response", "interview"].includes(trigger)) next = next.eq("notification_trigger", trigger);
  return next;
}

export async function GET(request: Request) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase is not configured.");
    const session = await logSession(request, "view");
    if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
    const url = new URL(request.url);
    const page = integer(url.searchParams.get("page"), 1, 1, 100_000);
    const limit = integer(url.searchParams.get("limit"), 50, 10, 100);
    const status = String(url.searchParams.get("status") ?? "").trim().toLowerCase();
    const trigger = String(url.searchParams.get("trigger") ?? "").trim().toLowerCase();
    const stream = String(url.searchParams.get("stream") ?? "").trim().toLowerCase();
    const locationId = String(url.searchParams.get("locationId") ?? "").trim();
    const search = cleanSearch(url.searchParams.get("search"));
    const fromDate = new Date(url.searchParams.get("from") || Date.now() - 30 * 24 * 60 * 60_000);
    const toDate = new Date(url.searchParams.get("to") || Date.now());
    const from = Number.isFinite(fromDate.getTime()) ? fromDate.toISOString() : new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString();
    const to = Number.isFinite(toDate.getTime()) ? toDate.toISOString() : new Date().toISOString();

    const messageSelect = (includeReadAt: boolean) => `
        id,lead_id,phone,template_name,notification_trigger,recruitment_stream,status,attempt_count,
        provider_message_id,created_at,updated_at,sent_at,delivered_at,${includeReadAt ? "read_at," : ""}failed_at,last_error,
        recruitment_leads!inner(full_name,status,stream,location_id,role_id,recruitment_locations(code,name),recruitment_roles(code,name))
      `;
    const loadRows = async (includeReadAt: boolean) => {
      let query = scopeMessageQuery(applyWindow(supabaseAdmin!.from("recruitment_whatsapp_outbox")
        .select(messageSelect(includeReadAt), { count: "exact" })
        .eq("company_id", companyId), from, to, trigger), session, stream, locationId);
      if (logStatuses.includes(status)) query = query.eq("status", status);
      if (search) query = query.or(`phone.ilike.%${search}%,template_name.ilike.%${search}%`);
      return query.order("created_at", { ascending: false }).range((page - 1) * limit, page * limit - 1);
    };
    let rows = await loadRows(true);
    if (rows.error && /read_at|schema cache/i.test(rows.error.message)) rows = await loadRows(false);
    if (rows.error) throw new Error(rows.error.message);

    const summaryEntries = await Promise.all(logStatuses.map(async (item) => {
      const result = await scopeMessageQuery(applyWindow(supabaseAdmin!.from("recruitment_whatsapp_outbox")
        .select("id,recruitment_leads!inner(id,stream,location_id,role_id)", { count: "exact", head: true })
        .eq("company_id", companyId).eq("status", item), from, to, trigger), session, stream, locationId);
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

async function replayLeads(companyId: string, session: NonNullable<Awaited<ReturnType<typeof recruitmentSession>>>) {
  const leads: any[] = [];
  for (const stream of ["workforce", "hr"]) {
    if (!session[stream as "workforce" | "hr"]) continue;
    if (!session.allLocations && !session.locationIds.length) continue;
    for (const status of replayStatuses) {
      for (let start = 0; ; start += 1000) {
        let query = supabaseAdmin!.from("recruitment_leads")
          .select("id,phone,full_name,status,stream,location_id,no_response_attempts,follow_up_at,recruitment_roles(name)")
          .eq("company_id", companyId).eq("stream", stream).eq("archived", false).eq("status", status)
          .order("lead_created_at", { ascending: false }).range(start, start + 999);
        if (!session.allLocations) {
          query = query.in("location_id", session.locationIds);
        }
        if (session.roleIds.length) query = query.in("role_id", session.roleIds);
        const page = await query;
        if (page.error) throw new Error(page.error.message);
        leads.push(...(page.data ?? []));
        if ((page.data?.length ?? 0) < 1000) break;
      }
    }
  }
  return leads.map((lead) => ({ lead, candidate: replayCandidateForLead(lead) }))
    .filter((item): item is { lead: any; candidate: NonNullable<ReturnType<typeof replayCandidateForLead>> } => Boolean(item.candidate));
}

async function prepareReplayCandidates(companyId: string, eligible: Awaited<ReturnType<typeof replayLeads>>) {
  const locationIds = [...new Set(eligible.map((item) => item.lead.location_id).filter(Boolean))] as string[];
  const [connection, contacts, locations] = await Promise.all([
    getConnectionConfig("whatsapp"),
    locationIds.length
      ? supabaseAdmin!.from("recruitment_location_contacts")
          .select("location_id,address,latitude,longitude,poc_name,poc_mobile")
          .eq("company_id", companyId).in("location_id", locationIds)
      : Promise.resolve({ data: [], error: null }),
    locationIds.length
      ? supabaseAdmin!.from("recruitment_locations")
          .select("id,address,latitude,longitude,poc_name,poc_mobile")
          .eq("company_id", companyId).in("id", locationIds)
      : Promise.resolve({ data: [], error: null })
  ]);
  if (contacts.error || locations.error) throw new Error(contacts.error?.message || locations.error?.message);
  const rules = notificationRulesFromConfig(connection?.publicConfig ?? {});
  const contactByLocation = new Map((contacts.data ?? []).map((item: any) => [item.location_id, item]));
  const locationById = new Map((locations.data ?? []).map((item: any) => [item.id, item]));
  return eligible.map((item) => {
    try {
      if (!normalizePhone(item.lead.phone)) throw new Error("Candidate mobile number is missing or invalid.");
      const rule = rules.find((row) => row.stream === item.lead.stream && row.trigger === item.candidate.trigger);
      if (!rule) throw new Error("Notification rule is missing in Master.");
      const station = mergeNotificationContacts(
        contactByLocation.get(item.lead.location_id),
        locationById.get(item.lead.location_id)
      );
      const preparedTemplate = buildNotificationTemplate(item.candidate.trigger, {
        ...item.lead,
        recruitment_roles: relation(item.lead.recruitment_roles),
        recruitment_locations: station
      }, rule);
      return { ...item, preparedTemplate, blockedReason: "" };
    } catch (error) {
      return {
        ...item,
        preparedTemplate: null,
        blockedReason: error instanceof Error ? error.message : "Candidate or Master data is incomplete."
      };
    }
  });
}

export async function POST(request: Request) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase is not configured.");
    const session = await logSession(request, "edit");
    if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const apply = body.action === "apply";
    const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
    const eligible = await replayLeads(companyId, session);
    const prepared = await prepareReplayCandidates(companyId, eligible);
    const leadIds = eligible.map((item) => item.lead.id);
    // Keep every coverage slice comfortably below Supabase's default row cap.
    // A candidate can have several historical attempts, so 500 lead IDs can
    // legitimately return more than 1,000 outbox rows and hide valid coverage.
    const outboxPages = await Promise.all(chunks(leadIds, 100).map((ids) =>
      supabaseAdmin!.from("recruitment_whatsapp_outbox")
        .select("id,lead_id,template_name,notification_trigger,notification_context,status,created_at")
        .eq("company_id", companyId).in("lead_id", ids).order("created_at", { ascending: false })
    ));
    const failedPage = outboxPages.find((page) => page.error);
    if (failedPage?.error) throw new Error(failedPage.error.message);
    const outboxRows = outboxPages.flatMap((page) => page.data ?? []);
    const outboxByLead = new Map<string, any[]>();
    for (const row of outboxRows) outboxByLead.set(row.lead_id, [...(outboxByLead.get(row.lead_id) ?? []), row]);

    const actions = prepared.map((item) => {
      const matching = (outboxByLead.get(item.lead.id) ?? []).find((row) =>
        outboxCoversReplayCandidate(row, item.candidate));
      const action = matching
        ? (isRetryableNotificationStatus(matching.status) ? "retry" : "covered")
        : item.preparedTemplate ? "queue" : "blocked";
      return { ...item, matching, action };
    });
    const maxActions = 200;
    const actionable = actions.filter((item) => item.action === "queue" || item.action === "retry");
    const blockedActions = actions.filter((item) => item.action === "blocked");
    const blockedReasons = Object.entries(blockedActions.reduce<Record<string, number>>((counts, item) => {
      const reason = item.blockedReason || "Candidate or Master data is incomplete.";
      counts[reason] = (counts[reason] ?? 0) + 1;
      return counts;
    }, {})).map(([reason, count]) => ({ reason, count }));
    let queued = 0;
    let retried = 0;
    let blocked = 0;
    const issues: Array<{ leadId: string; candidate: string; trigger: string; reason: string }> = [];
    if (apply) {
      const processItem = async (item: (typeof actionable)[number]) => {
          if (item.action === "retry") {
            const saved = await supabaseAdmin!.from("recruitment_whatsapp_outbox").update({
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
              const audit = await supabaseAdmin!.from("recruitment_lead_history").insert({
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
            return;
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
            anchor: item.candidate.anchor,
            preparedTemplate: item.preparedTemplate ?? undefined
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
      };
      for (const batch of chunks(actionable.slice(0, maxActions), 25)) {
        await Promise.all(batch.map(processItem));
      }
    }
    return NextResponse.json({
      mode: apply ? "applied" : "preview",
      eligible: eligible.length,
      covered: actions.filter((item) => item.action === "covered").length,
      missing: actions.filter((item) => item.action === "queue").length,
      retryable: actions.filter((item) => item.action === "retry").length,
      blockedCandidates: blockedActions.length,
      blockedReasons,
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
