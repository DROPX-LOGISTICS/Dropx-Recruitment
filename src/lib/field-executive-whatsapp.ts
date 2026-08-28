import { supabaseAdmin } from "./supabase-admin";

type WhatsAppTemplateComponent = {
  type?: string;
  text?: string;
  buttons?: Array<{ type?: string; text?: string; url?: string }>;
};

type TemplateVariable = {
  key: string;
  component: "header" | "body" | "button";
  position: number;
  buttonIndex?: number;
};

type FieldExecutiveOnboardingMessage = {
  companyId: string;
  fieldExecutiveId: string;
  fullName: string;
  mobile: string;
  dropxId: string;
  biometricId: string;
  dateOfJoin: string;
  locationCode: string;
  locationName: string;
  providerName: string;
  registrationToken: string;
  triggeredBy?: string | null;
};

function placeholderPositions(text?: string) {
  const positions = new Set<number>();
  for (const match of (text ?? "").matchAll(/\{\{(\d+)\}\}/g)) {
    positions.add(Number(match[1]));
  }
  return Array.from(positions).sort((first, second) => first - second);
}

function templateVariables(components: WhatsAppTemplateComponent[]) {
  const variables: TemplateVariable[] = [];
  components.forEach((component) => {
    const type = component.type?.toUpperCase();
    if (type === "HEADER" || type === "BODY") {
      const normalized = type.toLowerCase() as "header" | "body";
      placeholderPositions(component.text).forEach((position) => variables.push({
        key: `${normalized}.${position}`,
        component: normalized,
        position
      }));
    }
    if (type === "BUTTONS") {
      (component.buttons ?? []).forEach((button, buttonIndex) => {
        if (button.type?.toUpperCase() !== "URL") return;
        placeholderPositions(button.url).forEach((position) => variables.push({
          key: `button.${buttonIndex}.${position}`,
          component: "button",
          position,
          buttonIndex
        }));
      });
    }
  });
  return variables;
}

async function writeLog(payload: Record<string, unknown>) {
  if (!supabaseAdmin) return;
  await supabaseAdmin.from("whatsapp_message_logs").insert(payload);
}

/**
 * Uses the same shared WhatsApp profile, event configuration, template cache and
 * variable mappings as the original main-dashboard Field Executive onboarding.
 * A notification failure is logged but never rolls back a valid onboarding.
 */
export async function sendFieldExecutiveOnboardingWhatsApp(
  data: FieldExecutiveOnboardingMessage
) {
  if (!supabaseAdmin) return { status: "skipped" as const, reason: "Supabase is not configured." };
  const eventCode = "field_executive_onboarding";
  let recipient = data.mobile.replace(/\D/g, "");
  let templateName: string | null = null;
  let profileId: string | null = null;

  try {
    const [settings, config] = await Promise.all([
      supabaseAdmin.from("whatsapp_settings")
        .select("is_enabled")
        .eq("company_id", data.companyId)
        .eq("id", true)
        .maybeSingle(),
      supabaseAdmin.from("whatsapp_notification_configs")
        .select("is_enabled,whatsapp_profile_id,template_id,template_name,template_language,variable_mappings")
        .eq("company_id", data.companyId)
        .eq("event_code", eventCode)
        .maybeSingle()
    ]);
    if (settings.error) throw new Error(settings.error.message);
    if (config.error) throw new Error(config.error.message);
    if (!settings.data?.is_enabled || !config.data?.is_enabled) {
      const reason = "WhatsApp or Field Executive onboarding notification is disabled in Master.";
      await writeLog({
        event_code: eventCode,
        field_executive_id: data.fieldExecutiveId,
        recipient,
        template_name: config.data?.template_name,
        status: "skipped",
        error_message: reason
      });
      return { status: "skipped" as const, reason };
    }
    if (
      !config.data.whatsapp_profile_id
      || !config.data.template_id
      || !config.data.template_name
      || !config.data.template_language
    ) {
      throw new Error("Field Executive WhatsApp onboarding configuration is incomplete in Master.");
    }

    profileId = config.data.whatsapp_profile_id;
    templateName = config.data.template_name;
    const [profileResult, profileTokenResult, templateResult] = await Promise.all([
      supabaseAdmin.from("whatsapp_profiles")
        .select("id,profile_name,phone_number_id,graph_api_version,default_country_code,is_active")
        .eq("company_id", data.companyId)
        .eq("id", profileId)
        .single(),
      supabaseAdmin.rpc("get_whatsapp_profile_access_token", { profile_id: profileId }),
      supabaseAdmin.from("whatsapp_template_cache")
        .select("components")
        .eq("company_id", data.companyId)
        .eq("template_id", config.data.template_id)
        .eq("whatsapp_profile_id", profileId)
        .single()
    ]);
    if (profileResult.error) throw new Error(profileResult.error.message);
    if (profileTokenResult.error) throw new Error(profileTokenResult.error.message);
    if (templateResult.error) throw new Error(templateResult.error.message);
    const profile = profileResult.data;
    if (
      !profile?.is_active
      || !profile.phone_number_id
      || !profile.graph_api_version
      || !profileTokenResult.data
    ) {
      throw new Error("The WhatsApp profile selected in Master is incomplete or inactive.");
    }

    const registrationBase = (
      process.env.FIELD_EXECUTIVE_REGISTRATION_URL
      || "https://dashboard.dropxlogistics.com/register"
    ).replace(/\/$/, "");
    const values: Record<string, string> = {
      full_name: data.fullName,
      mobile: data.mobile,
      dropx_id: data.dropxId,
      biometric_id: data.biometricId,
      date_of_join: data.dateOfJoin,
      location_code: data.locationCode,
      location_name: data.locationName,
      provider_name: data.providerName,
      registration_link: `${registrationBase}/${encodeURIComponent(data.registrationToken)}`
    };
    const mappings = (config.data.variable_mappings ?? {}) as Record<string, string>;
    const variables = templateVariables(
      (templateResult.data.components ?? []) as WhatsAppTemplateComponent[]
    );
    const components: Array<Record<string, unknown>> = [];

    (["header", "body"] as const).forEach((componentType) => {
      const selected = variables
        .filter((variable) => variable.component === componentType)
        .sort((first, second) => first.position - second.position);
      if (!selected.length) return;
      components.push({
        type: componentType,
        parameters: selected.map((variable) => ({
          type: "text",
          text: values[mappings[variable.key]] ?? ""
        }))
      });
    });
    variables.filter((variable) => variable.component === "button").forEach((variable) => {
      components.push({
        type: "button",
        sub_type: "url",
        index: String(variable.buttonIndex ?? 0),
        parameters: [{
          type: "text",
          text: values[mappings[variable.key]] ?? ""
        }]
      });
    });

    const countryCode = String(profile.default_country_code ?? "91").replace(/\D/g, "") || "91";
    recipient = recipient.startsWith(countryCode) && recipient.length > 10
      ? recipient
      : `${countryCode}${recipient.slice(-10)}`;
    const requestPayload = {
      messaging_product: "whatsapp",
      to: recipient,
      type: "template",
      template: {
        name: templateName,
        language: { code: config.data.template_language },
        components
      }
    };
    const response = await fetch(
      `https://graph.facebook.com/${profile.graph_api_version}/${profile.phone_number_id}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${profileTokenResult.data}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(requestPayload)
      }
    );
    const provider = await response.json() as {
      messages?: Array<{ id?: string }>;
      error?: { message?: string };
    };
    if (!response.ok || provider.error) {
      throw new Error(provider.error?.message || `WhatsApp request failed with HTTP ${response.status}.`);
    }
    const providerMessageId = provider.messages?.[0]?.id ?? null;
    await writeLog({
      event_code: eventCode,
      field_executive_id: data.fieldExecutiveId,
      whatsapp_profile_id: profile.id,
      whatsapp_profile_name: profile.profile_name,
      recipient,
      template_name: templateName,
      status: "sent",
      provider_message_id: providerMessageId,
      request_payload: {
        template: templateName,
        mapped_variables: Object.keys(mappings),
        source: "recruitment_workforce_onboarding"
      },
      response_payload: provider
    });
    return { status: "sent" as const, providerMessageId };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unable to send WhatsApp onboarding message.";
    await writeLog({
      event_code: eventCode,
      field_executive_id: data.fieldExecutiveId,
      whatsapp_profile_id: profileId,
      recipient,
      template_name: templateName,
      status: "failed",
      error_message: reason,
      request_payload: { source: "recruitment_workforce_onboarding" }
    });
    return { status: "failed" as const, reason };
  }
}
