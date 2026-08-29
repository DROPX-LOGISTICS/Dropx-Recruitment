import { supabaseAdmin } from "./supabase-admin";
import { getConnectionConfig } from "./connection-config";

export async function whatsappConfig() {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  const managed = await getConnectionConfig("whatsapp");
  let accessToken = managed?.isEnabled ? managed.secrets.access_token ?? "" : "";
  let phoneNumberId = managed?.isEnabled ? managed.publicConfig.phone_number_id ?? "" : "";
  let graphVersion = managed?.isEnabled
    ? managed.publicConfig.graph_version || "v25.0"
    : process.env.META_GRAPH_VERSION?.trim() || "v25.0";
  if (!accessToken || !phoneNumberId) {
    accessToken = process.env.WHATSAPP_ACCESS_TOKEN?.trim() ?? accessToken;
    phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() ?? phoneNumberId;
  }
  if (!phoneNumberId && managed?.publicConfig.phone_number_id) {
    phoneNumberId = managed.publicConfig.phone_number_id;
  }
  if (!accessToken || !phoneNumberId) {
    const result = await supabaseAdmin.rpc("recruitment_get_whatsapp_config");
    if (!result.error) {
      const row = result.data?.[0];
      accessToken = row?.access_token ?? accessToken;
      phoneNumberId = row?.phone_number_id ?? phoneNumberId;
      graphVersion = row?.graph_version ?? graphVersion;
    }
  }
  if (!accessToken || !phoneNumberId) {
    throw new Error("WhatsApp provider is not configured.");
  }
  return { accessToken, phoneNumberId, graphVersion };
}

export async function sendWhatsAppTemplate(options: {
  to: string;
  templateName: string;
  parameters: readonly unknown[];
}) {
  const config = await whatsappConfig();
  const response = await fetch(`https://graph.facebook.com/${config.graphVersion}/${config.phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: options.to,
      type: "template",
      template: {
        name: options.templateName,
        language: { code: "en" },
        components: [{
          type: "body",
          parameters: options.parameters.map((value) => ({
            type: "text",
            text: String(value ?? "-").replace(/\s+/g, " ").trim().slice(0, 900) || "-"
          }))
        }]
      }
    })
  });
  const payload = await response.json() as { messages?: Array<{ id?: string }>; error?: { message?: string; code?: number } };
  if (!response.ok || payload.error) {
    const error = new Error(payload.error?.message || `WhatsApp request failed with HTTP ${response.status}.`);
    (error as Error & { provider?: unknown }).provider = payload;
    throw error;
  }
  return { messageId: payload.messages?.[0]?.id ?? null, payload };
}
