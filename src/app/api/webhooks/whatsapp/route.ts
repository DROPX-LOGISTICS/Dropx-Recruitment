import { NextResponse } from "next/server";
import { verifyMetaSignature } from "@/lib/meta-signature";
import { requiredEnv } from "@/lib/recruitment-api";
import { providerDeliveryState } from "@/lib/recruitment-notification-delivery";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getConnectionConfig } from "@/lib/connection-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const managed = await getConnectionConfig("whatsapp");
  const verifyToken = managed?.isEnabled
    ? managed.secrets.verify_token
    : process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  const valid = url.searchParams.get("hub.mode") === "subscribe"
    && url.searchParams.get("hub.verify_token") === verifyToken
    && url.searchParams.get("hub.challenge");
  return valid ? new Response(String(valid), { status: 200 }) : new Response("Verification failed.", { status: 403 });
}

export async function POST(request: Request) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase is not configured.");
    const rawBody = await request.text();
    const managed = await getConnectionConfig("whatsapp");
    const appSecret = managed?.isEnabled
      ? managed.secrets.app_secret
      : process.env.WHATSAPP_APP_SECRET?.trim() || process.env.META_APP_SECRET?.trim();
    if (!appSecret) return NextResponse.json({ received: false, error: "Webhook signature is not configured." }, { status: 503 });
    if (!verifyMetaSignature(rawBody, request.headers.get("x-hub-signature-256"), appSecret)) {
      return NextResponse.json({ received: false, error: "Invalid signature." }, { status: 401 });
    }
    const payload = JSON.parse(rawBody) as any;
    const statuses = (payload.entry ?? []).flatMap((entry: any) => entry.changes ?? [])
      .flatMap((change: any) => change.value?.statuses ?? []);
    let updated = 0;
    for (const status of statuses) {
      const providerId = String(status.id ?? "");
      if (!providerId) continue;
      const value = providerDeliveryState(status.status);
      if (!value) continue;
      const providerTime = Number(status.timestamp || 0) > 0
        ? new Date(Number(status.timestamp) * 1000).toISOString()
        : new Date().toISOString();
      const update: Record<string, unknown> = { status: value, provider_response: payload, updated_at: new Date().toISOString() };
      if (value === "delivered" || value === "read") update.delivered_at = providerTime;
      if (value === "failed") {
        update.failed_at = providerTime;
        update.last_error = JSON.stringify(status.errors ?? []).slice(0, 2000);
      }
      const result = await supabaseAdmin.from("recruitment_whatsapp_outbox").update(update)
        .eq("company_id", requiredEnv("RECRUITMENT_COMPANY_ID")).eq("provider_message_id", providerId)
        .select("id,lead_id,notification_trigger,recruitment_stream,notification_context");
      if (result.error) throw new Error(result.error.message);
      updated += result.data?.length ?? 0;
      for (const item of result.data ?? []) {
        if (!item.lead_id) continue;
        const audit = await supabaseAdmin.from("recruitment_lead_history").insert({
          company_id: requiredEnv("RECRUITMENT_COMPANY_ID"),
          lead_id: item.lead_id,
          event_type: value === "failed" ? "whatsapp_notification_failed" : `whatsapp_notification_${value}`,
          remarks: value === "failed"
            ? `WhatsApp reported delivery failure: ${JSON.stringify(status.errors ?? []).slice(0, 1000)}`
            : `WhatsApp reported ${value}.`,
          actor_email: "system:whatsapp_webhook",
          metadata: {
            outbox_id: item.id,
            trigger: item.notification_trigger,
            stream: item.recruitment_stream,
            provider_message_id: providerId,
            provider_timestamp: providerTime,
            context: item.notification_context
          }
        });
        if (audit.error) console.error("WhatsApp webhook audit failed", audit.error.message);
      }
    }
    return NextResponse.json({ received: true, statuses: statuses.length, updated });
  } catch (error) {
    console.error("WhatsApp webhook failed", error);
    return NextResponse.json({ received: false }, { status: 400 });
  }
}
