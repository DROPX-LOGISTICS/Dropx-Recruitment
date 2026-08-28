import { NextResponse } from "next/server";
import {
  ConnectionProvider,
  getConnectionConfig,
  invalidateConnectionConfig
} from "@/lib/connection-config";
import { canUseRecruitmentMenu, recruitmentSession, requiredEnv } from "@/lib/recruitment-api";
import { discoverMetaFormIds, extractMetaFormIds } from "@/lib/meta-ingestion";
import {
  decodeGoogleCalendarCredential,
  encodeGoogleCalendarCredential,
  testGoogleCalendarConnection
} from "@/lib/hr-interview-invitations";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const providers: ConnectionProvider[] = ["meta", "indeed", "whatsapp", "google", "mobile"];
const publicFields: Record<ConnectionProvider, string[]> = {
  meta: ["ad_account_id", "page_id", "graph_version"],
  indeed: ["employer_name", "account_id", "advertiser_number", "notify_new_candidates"],
  whatsapp: [
    "phone_number_id", "waba_id", "graph_version", "otp_template",
    "new_lead_template", "reminder_template", "interview_template",
    "hr_candidate_interview_template", "hr_manager_interview_template"
  ],
  google: [
    "client_id", "allowed_domain", "calendar_id", "calendar_time_zone",
    "interview_duration_minutes", "offer_company_name", "offer_signatory_name",
    "offer_signatory_title", "offer_default_terms", "offer_validity_days",
    "offer_reference_prefix", "offer_statutory_terms", "offer_non_statutory_terms",
    "offer_non_statutory_incentive_terms", "interview_email_subject", "interview_email_intro"
  ],
  mobile: ["api_base_url", "sender_name"]
};
const secretFields: Record<ConnectionProvider, string[]> = {
  meta: ["access_token", "page_access_token", "app_secret", "verify_token"],
  indeed: ["webhook_secret", "api_token"],
  whatsapp: ["access_token", "app_secret", "verify_token"],
  google: ["client_secret", "calendar_refresh_token"],
  mobile: ["api_token"]
};

function providerValue(value: unknown): ConnectionProvider {
  const provider = String(value ?? "").trim().toLowerCase() as ConnectionProvider;
  if (!providers.includes(provider)) throw new Error("Unsupported connection provider.");
  return provider;
}

function selectedStrings(input: unknown, allowed: string[]) {
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
  return Object.fromEntries(allowed.map((key) => [key, String(source[key] ?? "").trim()]));
}

function selectedNonEmptyStrings(input: unknown, allowed: string[]) {
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
  return Object.fromEntries(
    allowed
      .filter((key) => Object.prototype.hasOwnProperty.call(source, key))
      .map((key) => [key, String(source[key] ?? "").trim()])
      .filter(([, value]) => value)
  );
}

async function connectionSession(request: Request, required: "view" | "edit") {
  const session = await recruitmentSession(request);
  if (!canUseRecruitmentMenu(session, "Connections", required)) return null;
  return session;
}

function actorEmail(session: Awaited<ReturnType<typeof recruitmentSession>>) {
  return session?.email ?? "";
}

export async function GET(request: Request) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase is not configured.");
    const session = await connectionSession(request, "view");
    if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const result = await supabaseAdmin.rpc("recruitment_list_connection_settings", {
      p_company_id: requiredEnv("RECRUITMENT_COMPANY_ID")
    });
    if (result.error) throw result.error;
    const googleConfig = await getConnectionConfig("google");
    const googleCredential = decodeGoogleCalendarCredential(googleConfig?.secrets.client_secret);
    const origin = new URL(request.url).origin;
    return NextResponse.json({
      connections: (result.data ?? []).map((item: Record<string, unknown>) => {
        const storedPublicConfig = item.public_config && typeof item.public_config === "object"
          ? item.public_config as Record<string, unknown>
          : {};
        return {
          provider: item.provider,
          isEnabled: item.is_enabled,
          // Saved identifiers are deliberately not returned to the browser.
          publicConfig: {},
          configuredPublicKeys: Object.entries(storedPublicConfig)
            .filter(([, value]) => String(value ?? "").trim())
            .map(([key]) => key),
          configuredSecretKeys: item.provider === "google"
            ? [
                ...(googleCredential.clientSecret ? ["client_secret"] : []),
                ...(googleCredential.refreshToken ? ["calendar_refresh_token"] : [])
              ]
            : item.configured_secret_keys ?? [],
          connectionStatus: item.connection_status,
          lastTestedAt: item.last_tested_at,
          lastSuccessAt: item.last_success_at,
          lastError: item.connection_status === "failed" ? item.last_error : null,
          updatedBy: item.updated_by_email,
          updatedAt: item.updated_at
        };
      }),
      endpoints: {
        metaWebhook: `${origin}/api/webhooks/meta`,
        indeedWebhook: `${origin}/api/webhooks/indeed`,
        whatsappWebhook: `${origin}/api/webhooks/whatsapp`,
        googleOrigin: origin
      }
    });
  } catch (error) {
    console.error("Recruitment connection list failed", error);
    return NextResponse.json({ error: "Unable to load connection settings." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase is not configured.");
    const session = await connectionSession(request, "edit");
    if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const body = await request.json() as Record<string, unknown>;
    const provider = providerValue(body.provider);
    invalidateConnectionConfig(provider);
    const existing = await getConnectionConfig(provider);
    const publicPatch = selectedNonEmptyStrings(body.publicConfig, publicFields[provider]);
    const publicConfig = { ...(existing?.publicConfig ?? {}), ...publicPatch };
    const secrets = selectedStrings(body.secrets, secretFields[provider]);
    let secretPatch = Object.fromEntries(Object.entries(secrets).filter(([, value]) => value));
    if (provider === "google" && (secrets.client_secret || secrets.calendar_refresh_token)) {
      const current = decodeGoogleCalendarCredential(existing?.secrets.client_secret);
      secretPatch = {
        client_secret: encodeGoogleCalendarCredential({
          clientSecret: secrets.client_secret || current.clientSecret,
          refreshToken: secrets.calendar_refresh_token || current.refreshToken
        })
      };
    }
    const enabling = Boolean(body.isEnabled) && !existing?.isEnabled;
    let previousStatus = "not_tested";
    if (enabling) {
      const listed = await supabaseAdmin.rpc("recruitment_list_connection_settings", {
        p_company_id: requiredEnv("RECRUITMENT_COMPANY_ID")
      });
      if (listed.error) throw listed.error;
      previousStatus = String((listed.data ?? []).find((item: Record<string, unknown>) =>
        item.provider === provider)?.connection_status ?? "not_tested");
      if (Object.keys(publicPatch).length || Object.keys(secretPatch).length) {
        return NextResponse.json({
          error: "Save changed credentials while disabled, run Test connection, then enable without changing fields."
        }, { status: 409 });
      }
      if (previousStatus !== "connected") {
        return NextResponse.json({ error: "Run Test connection successfully before enabling." }, { status: 409 });
      }
      if (provider === "whatsapp") {
        const pending = await supabaseAdmin
          .from("recruitment_whatsapp_outbox")
          .select("id", { count: "exact", head: true })
          .eq("company_id", requiredEnv("RECRUITMENT_COMPANY_ID"))
          .in("status", ["queued", "retry"]);
        if (pending.error) throw pending.error;
        if ((pending.count ?? 0) > 0) {
          return NextResponse.json({
            error: `${pending.count} WhatsApp messages are already queued. Review System Health before enabling to prevent an unintended bulk send.`
          }, { status: 409 });
        }
      }
    }
    const result = await supabaseAdmin.rpc("recruitment_save_connection_setting", {
      p_company_id: requiredEnv("RECRUITMENT_COMPANY_ID"),
      p_provider: provider,
      p_is_enabled: Boolean(body.isEnabled),
      p_public_config: publicConfig,
      p_secrets: secretPatch,
      p_actor_profile_id: session.profileId,
      p_actor_email: actorEmail(session)
    });
    if (result.error) throw result.error;
    if (enabling && previousStatus === "connected") {
      const health = await supabaseAdmin.rpc("recruitment_update_connection_health", {
        p_company_id: requiredEnv("RECRUITMENT_COMPANY_ID"),
        p_provider: provider,
        p_status: "connected",
        p_message: "Enabled after a successful connection test.",
        p_actor_profile_id: session.profileId,
        p_actor_email: actorEmail(session)
      });
      if (health.error) throw health.error;
    }
    invalidateConnectionConfig(provider);
    return NextResponse.json({ saved: true });
  } catch (error) {
    console.error("Recruitment connection save failed", error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Unable to save connection settings."
    }, { status: 400 });
  }
}

async function graphJson(url: URL, token: string) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000)
  });
  const payload = await response.json() as {
    error?: { message?: string; code?: number; error_subcode?: number; type?: string };
    [key: string]: unknown
  };
  if (!response.ok || payload.error) {
    const suffix = payload.error?.code
      ? ` [Meta ${payload.error.code}${payload.error.error_subcode ? `/${payload.error.error_subcode}` : ""}]`
      : "";
    throw new Error(`${payload.error?.message || `Provider returned HTTP ${response.status}.`}${suffix}`);
  }
  return payload;
}

async function graphTry(url: URL, token: string) {
  try {
    return await graphJson(url, token);
  } catch {
    return null;
  }
}

function findWhatsappAccountIds(input: unknown) {
  const ids = new Set<string>();
  const visit = (value: unknown, parentKey = "", depth = 0) => {
    if (depth > 8 || value == null) return;
    if (Array.isArray(value)) return value.forEach((item) => visit(item, parentKey, depth + 1));
    if (typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (
      typeof record.id === "string" &&
      /whatsapp.*business.*account|owned_whatsapp_business_accounts/i.test(parentKey)
    ) ids.add(record.id);
    Object.entries(record).forEach(([key, item]) => visit(item, key, depth + 1));
  };
  visit(input);
  return [...ids];
}

async function whatsappTemplates(
  config: NonNullable<Awaited<ReturnType<typeof getConnectionConfig>>>,
  token: string,
  phoneId: string
) {
  const graphVersion = config.publicConfig.graph_version || "v25.0";
  const accountIds = new Set<string>();
  if (config.publicConfig.waba_id) accountIds.add(config.publicConfig.waba_id);
  const discoveryUrls = [
    new URL(`https://graph.facebook.com/${graphVersion}/${phoneId}?fields=whatsapp_business_account`),
    new URL(`https://graph.facebook.com/${graphVersion}/${phoneId}/whatsapp_business_account?fields=id,name`),
    new URL(`https://graph.facebook.com/${graphVersion}/me?fields=businesses{owned_whatsapp_business_accounts{id,name}}`)
  ];
  const debugUrl = new URL(`https://graph.facebook.com/${graphVersion}/debug_token`);
  debugUrl.searchParams.set("input_token", token);
  const debugPayload = await graphTry(debugUrl, token) as {
    data?: { granular_scopes?: Array<{ scope?: string; target_ids?: string[] }> };
  } | null;
  for (const scope of debugPayload?.data?.granular_scopes ?? []) {
    if (!String(scope.scope ?? "").includes("whatsapp")) continue;
    (scope.target_ids ?? []).forEach((id) => accountIds.add(String(id)));
  }
  for (const url of discoveryUrls) {
    const payload = await graphTry(url, token);
    findWhatsappAccountIds(payload).forEach((id) => accountIds.add(id));
  }
  const businessesUrl = new URL(`https://graph.facebook.com/${graphVersion}/me/businesses`);
  businessesUrl.searchParams.set("fields", "id,name");
  businessesUrl.searchParams.set("limit", "100");
  const businesses = await graphTry(businessesUrl, token) as {
    data?: Array<{ id?: string }>;
  } | null;
  for (const business of businesses?.data ?? []) {
    if (!business.id) continue;
    for (const edge of ["owned_whatsapp_business_accounts", "client_whatsapp_business_accounts"]) {
      const edgeUrl = new URL(`https://graph.facebook.com/${graphVersion}/${business.id}/${edge}`);
      edgeUrl.searchParams.set("fields", "id,name");
      edgeUrl.searchParams.set("limit", "100");
      const payload = await graphTry(edgeUrl, token);
      findWhatsappAccountIds({ [edge]: payload }).forEach((id) => accountIds.add(id));
    }
  }
  const assignedUrl = new URL(`https://graph.facebook.com/${graphVersion}/me/assigned_whatsapp_business_accounts`);
  assignedUrl.searchParams.set("fields", "id,name");
  assignedUrl.searchParams.set("limit", "100");
  const assigned = await graphTry(assignedUrl, token);
  findWhatsappAccountIds({ owned_whatsapp_business_accounts: assigned }).forEach((id) => accountIds.add(id));
  for (const accountId of accountIds) {
    const url = new URL(`https://graph.facebook.com/${graphVersion}/${accountId}/message_templates`);
    url.searchParams.set("fields", "name,status,category,language");
    url.searchParams.set("limit", "250");
    const payload = await graphTry(url, token) as { data?: Array<Record<string, unknown>> } | null;
    const templates = (payload?.data ?? []).filter((item) =>
      String(item.status ?? "").toUpperCase() === "APPROVED");
    if (templates.length) return { accountId, templates };
  }
  return { accountId: [...accountIds][0] ?? null, templates: [] };
}

async function testProvider(provider: ConnectionProvider, config: NonNullable<Awaited<ReturnType<typeof getConnectionConfig>>>) {
  if (provider === "meta") {
    const token = config.secrets.access_token;
    if (!token) throw new Error("Meta access token is not configured.");
    const graphVersion = config.publicConfig.graph_version || "v25.0";
    const account = config.publicConfig.ad_account_id?.replace(/^act_/, "");
    const path = account ? `act_${account}` : "me";
    const debugUrl = new URL(`https://graph.facebook.com/${graphVersion}/debug_token`);
    debugUrl.searchParams.set("input_token", token);
    const debug = await graphTry(debugUrl, token) as {
      data?: {
        app_id?: string;
        user_id?: string;
        is_valid?: boolean;
        expires_at?: number;
        data_access_expires_at?: number;
        scopes?: string[];
      };
    } | null;
    if (debug?.data?.is_valid === false) {
      throw new Error("The saved Meta access token is invalid or expired. Replace it with a new System User token.");
    }
    const scopes = new Set(debug?.data?.scopes ?? []);
    const missingReadScopes = ["ads_read", "leads_retrieval"].filter((scope) => !scopes.has(scope));
    if (debug?.data?.scopes && missingReadScopes.length) {
      throw new Error(
        `The Meta token is missing ${missingReadScopes.join(" and ")}. Generate a System User token for app ${debug.data.app_id || "shown in Meta"} with ads_read, leads_retrieval and ads_management.`
      );
    }
    const url = new URL(`https://graph.facebook.com/${graphVersion}/${path}`);
    url.searchParams.set("fields", account ? "id,name,account_status" : "id,name");
    let payload: Record<string, unknown>;
    try {
      payload = await graphJson(url, token);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Meta authorization failed.";
      if (/cannot call api for app/i.test(message)) {
        throw new Error(
          `Meta app ${debug?.data?.app_id || "in the saved token"} cannot act for user ${debug?.data?.user_id || "in the saved token"}. Replace the personal token with a System User token generated for that same app, then assign the DropX ad account and Facebook Page to that System User with full control.`
        );
      }
      throw error;
    }
    const forms = await supabaseAdmin!
      .from("recruitment_ads")
      .select("meta_form_id")
      .eq("company_id", requiredEnv("RECRUITMENT_COMPANY_ID"))
      .not("meta_form_id", "is", null)
      .limit(25);
    if (forms.error) throw forms.error;
    let formId = (forms.data ?? []).map((item) => String(item.meta_form_id ?? "").trim()).find(Boolean);
    if (!formId) {
      const sources = await supabaseAdmin!
        .from("recruitment_lead_source_events")
        .select("payload")
        .eq("company_id", requiredEnv("RECRUITMENT_COMPANY_ID"))
        .order("received_at", { ascending: false })
        .limit(500);
      if (sources.error) throw sources.error;
      formId = extractMetaFormIds((sources.data ?? []).map((item) => item.payload))[0];
    }
    if (!formId && account) {
      formId = (await discoverMetaFormIds({
        accessToken: token,
        adAccountId: account,
        graphVersion
      }))[0];
    }
    if (!formId) {
      return {
        status: "warning",
        message: `Meta account connected${payload.name ? `: ${payload.name}` : ""}, but no saved lead form is available for an intake test.`
      };
    }
    const leadUrl = new URL(`https://graph.facebook.com/${graphVersion}/${formId}/leads`);
    leadUrl.searchParams.set("fields", "id,created_time");
    leadUrl.searchParams.set("limit", "1");
    await graphJson(leadUrl, token);
    return {
      status: "connected",
      message: `Meta connected${payload.name ? `: ${payload.name}` : ""}; direct lead retrieval verified${scopes.has("ads_management") ? " and ad pause/budget control is authorised" : ". Add ads_management before using pause or budget controls"}.`
    };
  }
  if (provider === "whatsapp") {
    const token = config.secrets.access_token;
    const phoneId = config.publicConfig.phone_number_id;
    if (!token || !phoneId) throw new Error("WhatsApp access token and Phone Number ID are required.");
    const graphVersion = config.publicConfig.graph_version || "v25.0";
    const url = new URL(`https://graph.facebook.com/${graphVersion}/${phoneId}`);
    url.searchParams.set("fields", "display_phone_number,verified_name,quality_rating");
    const payload = await graphJson(url, token);
    const discovered = await whatsappTemplates(config, token, phoneId);
    const requiredTemplates = [
      config.publicConfig.new_lead_template || "job_application_number",
      config.publicConfig.reminder_template || "job_application_reminder",
      config.publicConfig.interview_template || "job_location_share"
    ];
    const approvedNames = new Set(discovered.templates.map((item) => String(item.name ?? "")));
    const missingRecruitmentTemplates = requiredTemplates.filter((name) => !approvedNames.has(name));
    if (missingRecruitmentTemplates.length) {
      return {
        status: "warning",
        message: `WhatsApp connected${payload.display_phone_number ? `: ${payload.display_phone_number}` : ""}, but these approved recruitment templates were not found: ${missingRecruitmentTemplates.join(", ")}.`
      };
    }
    const authTemplates = discovered.templates.filter((item) =>
      String(item.category ?? "").toUpperCase() === "AUTHENTICATION");
    if (!authTemplates.length) {
      return {
        status: "connected",
        message: `WhatsApp connected${payload.display_phone_number ? `: ${payload.display_phone_number}` : ""}; all three legacy recruitment templates are approved. Candidate notifications are ready. Mobile OTP remains unavailable until an Authentication template is approved.`
      };
    }
    return {
      status: "connected",
      message: `WhatsApp connected${payload.display_phone_number ? `: ${payload.display_phone_number}` : ""}; all three legacy recruitment templates are approved. Approved OTP template: ${String(authTemplates[0].name)}.`
    };
  }
  if (provider === "indeed") {
    if (!config.secrets.webhook_secret?.trim()) {
      throw new Error("Indeed Apply shared secret is required before enabling direct intake.");
    }
    if (!config.secrets.api_token?.trim()) {
      throw new Error("Indeed Apply API token / client ID is required before enabling direct intake.");
    }
    const mappings = await supabaseAdmin!.from("recruitment_indeed_job_mappings")
      .select("id", { count: "exact", head: true })
      .eq("company_id", requiredEnv("RECRUITMENT_COMPANY_ID"))
      .eq("is_active", true);
    if (mappings.error) throw new Error(mappings.error.message);
    if (!(mappings.count ?? 0)) {
      throw new Error("Add at least one active Indeed job mapping before enabling direct intake.");
    }
    return {
      status: "connected",
      message: `Indeed Apply receiver and ${mappings.count} HR job mapping${mappings.count === 1 ? " is" : "s are"} ready. Enable after Indeed validates the POST URL. Candidate WhatsApp is off unless explicitly enabled.`
    };
  }
  if (provider === "google") {
    const clientId = config.publicConfig.client_id;
    if (!clientId?.endsWith(".apps.googleusercontent.com")) {
      throw new Error("Enter a valid Google OAuth web client ID.");
    }
    const response = await fetch("https://accounts.google.com/.well-known/openid-configuration", {
      cache: "no-store",
      signal: AbortSignal.timeout(15_000)
    });
    if (!response.ok) throw new Error("Google identity service is not reachable.");
    const calendar = await testGoogleCalendarConnection();
    return {
      status: calendar.ready ? "connected" : "warning",
      message: calendar.message
    };
  }
  const token = config.secrets.api_token;
  if (!token) throw new Error("Mobile API token is not configured.");
  const baseUrl = config.publicConfig.api_base_url;
  if (!baseUrl) return { status: "warning", message: "Token is saved. Add an API base URL for a live health test." };
  const response = await fetch(new URL("/health", baseUrl), {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error(`Mobile API health check returned HTTP ${response.status}.`);
  return { status: "connected", message: "Mobile API connected." };
}

export async function POST(request: Request) {
  let session: Awaited<ReturnType<typeof recruitmentSession>> = null;
  let provider: ConnectionProvider | null = null;
  try {
    if (!supabaseAdmin) throw new Error("Supabase is not configured.");
    session = await connectionSession(request, "edit");
    if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const body = await request.json() as Record<string, unknown>;
    provider = providerValue(body.provider);
    invalidateConnectionConfig(provider);
    const config = await getConnectionConfig(provider);
    if (!config) throw new Error("Save this connection before testing it.");
    const result = await testProvider(provider, config);
    const update = await supabaseAdmin.rpc("recruitment_update_connection_health", {
      p_company_id: requiredEnv("RECRUITMENT_COMPANY_ID"),
      p_provider: provider,
      p_status: result.status,
      p_message: result.message,
      p_actor_profile_id: session.profileId,
      p_actor_email: actorEmail(session)
    });
    if (update.error) throw update.error;
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Connection test failed.";
    if (supabaseAdmin && session && provider) {
      await supabaseAdmin.rpc("recruitment_update_connection_health", {
        p_company_id: requiredEnv("RECRUITMENT_COMPANY_ID"),
        p_provider: provider,
        p_status: "failed",
        p_message: message,
        p_actor_profile_id: session.profileId,
        p_actor_email: actorEmail(session)
      });
    }
    return NextResponse.json({ status: "failed", error: message }, { status: 400 });
  }
}
