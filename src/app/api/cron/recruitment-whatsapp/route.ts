import { NextResponse } from "next/server";
import { requiredEnv } from "@/lib/recruitment-api";
import { notificationRetryDecision } from "@/lib/recruitment-notification-delivery";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendWhatsAppTemplate } from "@/lib/whatsapp-provider";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

async function deliveryAudit(options: {
  companyId: string;
  leadId: string | null;
  eventType: string;
  remarks: string;
  metadata: Record<string, unknown>;
}) {
  if (!supabaseAdmin || !options.leadId) return;
  const result = await supabaseAdmin.from("recruitment_lead_history").insert({
    company_id: options.companyId,
    lead_id: options.leadId,
    event_type: options.eventType,
    remarks: options.remarks,
    actor_email: "system:whatsapp_delivery",
    metadata: options.metadata
  });
  if (result.error) console.error("WhatsApp delivery audit failed", result.error.message);
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!supabaseAdmin) return NextResponse.json({ error: "Supabase is not configured." }, { status: 500 });
  const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
  const now = new Date().toISOString();
  const queued = await supabaseAdmin.from("recruitment_whatsapp_outbox")
    .select("id,lead_id,phone,template_name,template_parameters,attempt_count,notification_trigger,recruitment_stream,notification_context")
    .eq("company_id", companyId).in("status", ["queued","retry"])
    .lte("next_attempt_at", now).order("next_attempt_at").limit(25);
  if (queued.error) return NextResponse.json({ error: queued.error.message }, { status: 500 });
  let sent = 0;
  let failed = 0;
  for (const item of queued.data ?? []) {
    const claimed = await supabaseAdmin.from("recruitment_whatsapp_outbox")
      .update({ status: "sending", attempt_count: Number(item.attempt_count || 0) + 1, updated_at: now })
      .eq("company_id", companyId).eq("id", item.id).in("status", ["queued","retry"]).select("id").maybeSingle();
    if (claimed.error || !claimed.data) continue;
    try {
      const provider = await sendWhatsAppTemplate({
        to: item.phone,
        templateName: item.template_name,
        parameters: Array.isArray(item.template_parameters) ? item.template_parameters : []
      });
      const saved = await supabaseAdmin.from("recruitment_whatsapp_outbox").update({
        status: "sent", provider_message_id: provider.messageId, provider_response: provider.payload,
        sent_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString()
      }).eq("company_id", companyId).eq("id", item.id);
      if (saved.error) throw new Error(saved.error.message);
      await deliveryAudit({
        companyId,
        leadId: item.lead_id,
        eventType: "whatsapp_notification_sent",
        remarks: `${item.template_name} accepted by WhatsApp.`,
        metadata: {
          outbox_id: item.id,
          trigger: item.notification_trigger,
          stream: item.recruitment_stream,
          provider_message_id: provider.messageId,
          attempt: Number(item.attempt_count || 0) + 1,
          context: item.notification_context
        }
      });
      sent++;
    } catch (error) {
      const attempts = Number(item.attempt_count || 0) + 1;
      const retry = notificationRetryDecision(attempts);
      const lastError = error instanceof Error ? error.message.slice(0, 2000) : "Unknown provider error";
      await supabaseAdmin.from("recruitment_whatsapp_outbox").update({
        status: retry.status,
        next_attempt_at: retry.nextAttemptAt,
        failed_at: retry.terminal ? new Date().toISOString() : null,
        last_error: lastError,
        updated_at: new Date().toISOString()
      }).eq("company_id", companyId).eq("id", item.id);
      await deliveryAudit({
        companyId,
        leadId: item.lead_id,
        eventType: retry.terminal ? "whatsapp_notification_failed" : "whatsapp_notification_retry",
        remarks: retry.terminal
          ? `${item.template_name} failed after ${attempts} attempts: ${lastError}`
          : `${item.template_name} retry ${attempts} scheduled: ${lastError}`,
        metadata: {
          outbox_id: item.id,
          trigger: item.notification_trigger,
          stream: item.recruitment_stream,
          attempt: attempts,
          next_attempt_at: retry.terminal ? null : retry.nextAttemptAt,
          context: item.notification_context
        }
      });
      failed++;
    }
  }
  const summary = {
    ok: true,
    scanned: queued.data?.length ?? 0,
    sent,
    failed,
    generatedAt: new Date().toISOString()
  };
  if (failed) console.error("Recruitment WhatsApp cron partial failure", JSON.stringify(summary));
  else console.info("Recruitment WhatsApp cron summary", JSON.stringify(summary));
  return NextResponse.json(summary);
}
