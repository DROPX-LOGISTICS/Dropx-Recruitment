import { createHash } from "node:crypto";
import { getConnectionConfig } from "./connection-config";
import { enqueueStoredLeadWelcome } from "./recruitment-lead-welcome";
import {
  authoritativeRoleStream,
  canonicalApplicationKey,
  normalizeMetaFieldName,
  normalizePhone,
  parseAdRouteWithMasters
} from "./recruitment-routing";
import { supabaseAdmin } from "./supabase-admin";
import { resolveWorkforceLeadLocation } from "./workforce-pincode-routing";

export type LeadgenValue = {
  ad_id?: string;
  form_id?: string;
  leadgen_id?: string;
  page_id?: string;
  created_time?: number;
};

export function extractMetaFormIds(input: unknown) {
  const ids = new Set<string>();
  const visit = (value: unknown, depth: number) => {
    if (depth > 8 || value == null) return;
    if (Array.isArray(value)) {
      value.slice(0, 500).forEach((item) => visit(item, depth + 1));
      return;
    }
    if (typeof value !== "object") return;
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const normalized = normalizeMetaFieldName(key);
      if (["form_id", "formid", "meta_form_id", "lead_gen_form_id", "leadgen_form_id"].includes(normalized)) {
        const candidate = String(item ?? "").trim();
        if (/^\d{5,30}$/.test(candidate)) ids.add(candidate);
      } else {
        visit(item, depth + 1);
      }
    }
  };
  visit(input, 0);
  return [...ids];
}

export async function discoverMetaFormIds(options: {
  accessToken: string;
  adAccountId: string;
  graphVersion: string;
}) {
  const account = options.adAccountId.replace(/^act_/, "");
  let next: string | null = `https://graph.facebook.com/${options.graphVersion}/act_${encodeURIComponent(account)}/ads`;
  const formIds = new Set<string>();
  for (let page = 0; next && page < 20; page++) {
    const endpoint = new URL(next);
    if (page === 0) {
      endpoint.searchParams.set("fields", "id,name,creative{id,object_story_spec}");
      endpoint.searchParams.set("limit", "100");
    }
    const response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${options.accessToken}` },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000)
    });
    const payload = await response.json() as {
      data?: unknown[];
      paging?: { next?: string };
      error?: { message?: string };
    };
    if (!response.ok || payload.error) {
      throw new Error(payload.error?.message || `Meta ads request returned HTTP ${response.status}.`);
    }
    extractMetaFormIds(payload.data ?? []).forEach((id) => formIds.add(id));
    next = payload.paging?.next ?? null;
  }
  return [...formIds];
}

export async function discoverMetaPageFormIds(options: {
  accessToken: string;
  pageId: string;
  graphVersion: string;
}) {
  let next: string | null = `https://graph.facebook.com/${options.graphVersion}/${encodeURIComponent(options.pageId)}/leadgen_forms`;
  const formIds = new Set<string>();
  for (let page = 0; next && page < 50; page++) {
    const endpoint = new URL(next);
    if (page === 0) {
      endpoint.searchParams.set("fields", "id,name,status");
      endpoint.searchParams.set("limit", "100");
    }
    const response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${options.accessToken}` },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000)
    });
    const payload = await response.json() as {
      data?: Array<{ id?: string }>;
      paging?: { next?: string };
      error?: { message?: string };
    };
    if (!response.ok || payload.error) {
      throw new Error(payload.error?.message || `Meta Page forms request returned HTTP ${response.status}.`);
    }
    for (const form of payload.data ?? []) {
      const id = String(form.id ?? "").trim();
      if (/^\d{5,30}$/.test(id)) formIds.add(id);
    }
    next = payload.paging?.next ?? null;
  }
  return [...formIds];
}

type MetaAdSyncRow = {
  id?: string;
  name?: string;
  status?: string;
  configured_status?: string;
  effective_status?: string;
  created_time?: string;
  creative?: { image_url?: string; thumbnail_url?: string; object_story_spec?: unknown };
  adset?: { id?: string; name?: string; daily_budget?: string; lifetime_budget?: string };
  campaign?: { id?: string; name?: string; daily_budget?: string; lifetime_budget?: string };
  insights?: { data?: Array<{ spend?: string; reach?: string; impressions?: string }> };
};

export async function syncMetaAds(options: {
  accessToken: string;
  adAccountId: string;
  graphVersion: string;
}) {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  const admin = supabaseAdmin;
  const account = options.adAccountId.replace(/^act_/, "");
  let next: string | null = `https://graph.facebook.com/${options.graphVersion}/act_${encodeURIComponent(account)}/ads`;
  const ads: MetaAdSyncRow[] = [];
  for (let page = 0; next && page < 20; page++) {
    const endpoint = new URL(next);
    if (page === 0) {
      endpoint.searchParams.set("limit", "100");
      endpoint.searchParams.set(
        "fields",
        "id,name,status,configured_status,effective_status,created_time,creative{id,thumbnail_url,image_url,object_story_spec},adset{id,name,daily_budget,lifetime_budget},campaign{id,name,daily_budget,lifetime_budget},insights.date_preset(maximum){spend,reach,impressions}"
      );
    }
    const response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${options.accessToken}` },
      cache: "no-store",
      signal: AbortSignal.timeout(25_000)
    });
    const payload = await response.json() as {
      data?: MetaAdSyncRow[];
      paging?: { next?: string };
      error?: { message?: string };
    };
    if (!response.ok || payload.error) {
      throw new Error(payload.error?.message || `Meta ads sync returned HTTP ${response.status}.`);
    }
    ads.push(...(payload.data ?? []));
    next = payload.paging?.next ?? null;
  }

  let synced = 0;
  let skipped = 0;
  let nextAd = 0;
  await Promise.all(Array.from({ length: Math.min(8, ads.length) }, async () => {
    for (;;) {
      const index = nextAd++;
      if (index >= ads.length) return;
      const ad = ads[index];
      if (!ad.id || !ad.name) {
        skipped++;
        continue;
      }
      const route = await resolveMasters(ad.name);
      const insight = ad.insights?.data?.[0] ?? {};
      const campaign = ad.campaign ?? {};
      const adset = ad.adset ?? {};
      const budgetMinor = campaign.daily_budget || campaign.lifetime_budget
        || adset.daily_budget || adset.lifetime_budget || "0";
      const budget = Number.isFinite(Number(budgetMinor)) ? Number(budgetMinor) / 100 : 0;
      const effective = String(ad.effective_status || ad.configured_status || ad.status || "unknown").toUpperCase();
      const state = effective === "ACTIVE"
        ? "ACTIVE"
        : ["PAUSED", "ADSET_PAUSED", "CAMPAIGN_PAUSED"].includes(effective) ? "PAUSED" : effective;
      const adRecord = {
        company_id: companyId(),
        meta_ad_id: ad.id,
        ...(extractMetaFormIds(ad.creative).at(0)
          ? { meta_form_id: extractMetaFormIds(ad.creative).at(0) }
          : {}),
        ad_name: ad.name,
        adset_name: adset.name || null,
        campaign_name: campaign.name || null,
        location_id: route.locationId,
        role_id: route.roleId,
        route_status: route.routeStatus,
        status: state,
        daily_budget: budget || null,
        total_spend: Number(insight.spend || 0),
        poster_url: ad.creative?.image_url || ad.creative?.thumbnail_url || null,
        raw_payload: {
          ...ad,
          reach: Number(insight.reach || 0),
          impressions: Number(insight.impressions || 0),
          budget_source: campaign.daily_budget || campaign.lifetime_budget ? "campaign" : "adset",
          adset_id: adset.id || null,
          campaign_id: campaign.id || null
        },
        created_on: ad.created_time ? new Date(ad.created_time).toISOString() : null,
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      const existing = await admin.from("recruitment_ads").select("id")
        .eq("company_id", companyId()).eq("meta_ad_id", ad.id).limit(1).maybeSingle();
      if (existing.error) throw new Error(existing.error.message);
      const saved = existing.data?.id
        ? await admin.from("recruitment_ads").update(adRecord)
            .eq("company_id", companyId()).eq("id", existing.data.id)
        : await admin.from("recruitment_ads").insert(adRecord);
      if (saved.error) throw new Error(saved.error.message);
      synced++;
    }
  }));
  return { fetched: ads.length, synced, skipped };
}

type MetaLead = {
  id?: string;
  created_time?: string;
  ad_id?: string;
  form_id?: string;
  field_data?: Array<{ name?: string; values?: string[] }>;
  error?: { message?: string };
};

type MetaAd = {
  id?: string;
  name?: string;
  adset?: { name?: string };
  campaign?: { name?: string };
  error?: { message?: string };
};

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function companyId() {
  return required("RECRUITMENT_COMPANY_ID");
}

export async function getMetaConfig() {
  const managed = await getConnectionConfig("meta");
  if (managed?.isEnabled) {
    return {
      accessToken: managed.secrets.access_token || "",
      appSecret: managed.secrets.app_secret || "",
      verifyToken: managed.secrets.verify_token || "",
      graphVersion: managed.publicConfig.graph_version || "v25.0"
    };
  }
  return {
    accessToken: process.env.META_ACCESS_TOKEN?.trim() || "",
    appSecret: process.env.META_APP_SECRET?.trim() || "",
    verifyToken: process.env.META_WEBHOOK_VERIFY_TOKEN?.trim() || "",
    graphVersion: process.env.META_GRAPH_VERSION?.trim() || "v25.0"
  };
}

async function graphGet<T>(path: string, fields: string) {
  const config = await getMetaConfig();
  if (!config.accessToken) throw new Error("Meta access token is not configured.");
  const url = new URL(`https://graph.facebook.com/${config.graphVersion}/${path}`);
  url.searchParams.set("fields", fields);
  url.searchParams.set("access_token", config.accessToken);
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
  const payload = await response.json() as T & { error?: { message?: string } };
  if (!response.ok || payload.error) {
    throw new Error(payload.error?.message || `Meta Graph request failed with HTTP ${response.status}.`);
  }
  return payload;
}

export async function getFreshMetaAdPoster(metaAdId: string) {
  const ad = await graphGet<{
    creative?: { image_url?: string; thumbnail_url?: string };
  }>(metaAdId, "creative{id,image_url,thumbnail_url}");
  const posterUrl = ad.creative?.image_url?.trim() || ad.creative?.thumbnail_url?.trim();
  if (!posterUrl) throw new Error("Meta did not return a poster for this ad.");
  const parsed = new URL(posterUrl);
  if (parsed.protocol !== "https:") throw new Error("Meta returned an invalid poster URL.");
  return parsed.toString();
}

function fieldMap(lead: MetaLead) {
  return Object.fromEntries((lead.field_data ?? []).map((field) => [
    normalizeMetaFieldName(field.name),
    (field.values ?? []).join(", ").trim()
  ]));
}

function first(fields: Record<string, string>, names: string[]) {
  for (const name of names) {
    const value = fields[normalizeMetaFieldName(name)]?.trim();
    if (value) return value;
  }
  return null;
}

async function resolveMasters(adName: string) {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  const [locations, roles] = await Promise.all([
    supabaseAdmin.from("recruitment_locations").select("id,code")
      .eq("company_id", companyId()).eq("is_active", true),
    supabaseAdmin.from("recruitment_roles").select("id,code,name,stream,aliases")
      .eq("company_id", companyId()).eq("is_active", true)
  ]);
  if (locations.error || roles.error) throw new Error(locations.error?.message || roles.error?.message);
  const parsed = parseAdRouteWithMasters(adName, locations.data ?? [], roles.data ?? []);
  const location = (locations.data ?? []).find((item) => item.code === parsed.stationCode);
  const role = (roles.data ?? []).find((item) => item.code === parsed.roleCode);
  return {
    parsed,
    locationId: location?.id ?? null,
    roleId: role?.id ?? null,
    stream: authoritativeRoleStream(role?.code, role?.stream ?? parsed.stream),
    routeStatus: location && role ? "mapped" : "unmapped"
  };
}

const adUpsertLocks = new Map<string, Promise<{ id: string; adName: string; route: Awaited<ReturnType<typeof resolveMasters>> }>>();

async function upsertAdUnlocked(value: LeadgenValue, lead: MetaLead) {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  const metaAdId = lead.ad_id || value.ad_id;
  const metaAd = metaAdId
    ? await graphGet<MetaAd>(metaAdId, "id,name,adset{name},campaign{name}")
    : {};
  const adName = metaAd.name?.trim() || metaAdId || "Unknown ad";
  const route = await resolveMasters(adName);
  const adRecord = {
    company_id: companyId(),
    meta_ad_id: metaAdId || null,
    meta_form_id: lead.form_id || value.form_id || null,
    ad_name: adName,
    adset_name: metaAd.adset?.name || null,
    campaign_name: metaAd.campaign?.name || null,
    location_id: route.locationId,
    role_id: route.roleId,
    route_status: route.routeStatus,
    raw_payload: metaAd,
    last_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  let existing = metaAdId
    ? await supabaseAdmin.from("recruitment_ads").select("id")
        .eq("company_id", companyId()).eq("meta_ad_id", metaAdId).limit(1).maybeSingle()
    : await supabaseAdmin.from("recruitment_ads").select("id")
        .eq("company_id", companyId()).eq("ad_name", adName).limit(1).maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  const result = existing.data?.id
    ? await supabaseAdmin.from("recruitment_ads").update(adRecord)
        .eq("company_id", companyId()).eq("id", existing.data.id).select("id").single()
    : await supabaseAdmin.from("recruitment_ads").insert(adRecord).select("id").single();
  if (result.error) throw new Error(result.error.message);
  return { id: result.data.id as string, adName, route };
}

async function upsertAd(value: LeadgenValue, lead: MetaLead) {
  const lockKey = String(lead.ad_id || value.ad_id || lead.form_id || value.form_id || lead.id || value.leadgen_id || "unknown");
  const prior = adUpsertLocks.get(lockKey) ?? Promise.resolve(null as never);
  const task = prior.catch(() => null as never).then(() => upsertAdUnlocked(value, lead));
  adUpsertLocks.set(lockKey, task);
  try {
    return await task;
  } finally {
    if (adUpsertLocks.get(lockKey) === task) adUpsertLocks.delete(lockKey);
  }
}

export async function ingestMetaLeadgenValue(value: LeadgenValue, sourceSystem = "meta_webhook") {
  if (!supabaseAdmin || !value.leadgen_id) return { saved: false, duplicate: false, replay: false };
  const metaLeadId = value.leadgen_id.trim();
  const eventKey = `meta:${metaLeadId}`;
  const replay = await supabaseAdmin.from("recruitment_lead_source_events").select("id,lead_id,status")
    .eq("company_id", companyId()).eq("event_key", eventKey).maybeSingle();
  if (replay.error) throw new Error(replay.error.message);
  if (replay.data) {
    if (replay.data.status === "lead_saved" && replay.data.lead_id) {
      await enqueueStoredLeadWelcome(String(replay.data.lead_id));
      const completed = await supabaseAdmin.from("recruitment_lead_source_events").update({
        status: "processed",
        processed_at: new Date().toISOString(),
        error: null
      }).eq("company_id", companyId()).eq("id", replay.data.id);
      if (completed.error) throw new Error(completed.error.message);
    }
    return { saved: true, duplicate: true, replay: true };
  }

  const lead = await graphGet<MetaLead>(value.leadgen_id, "id,created_time,ad_id,form_id,field_data");
  const fields = fieldMap(lead);
  const phone = first(fields, ["phone", "phone_number", "mobile", "mobile_number", "contact_number"]);
  const normalizedPhone = normalizePhone(phone);
  const resolvedMetaLeadId = lead.id?.trim() || metaLeadId;
  const ad = await upsertAd(value, lead);
  const postCode = first(fields, ["post_code", "post code", "postal_code", "pincode"]);
  const pincodeRoute = await resolveWorkforceLeadLocation({
    companyId: companyId(),
    postCode,
    stream: ad.route.stream,
    advertisedLocationId: ad.route.locationId,
    advertisedStationCode: ad.route.parsed.stationCode
  });
  // The ad name is the recruitment routing source of truth. Campaign, ad-set,
  // and Meta ad IDs may change while the actual recruitment application stays
  // the same.
  const key = canonicalApplicationKey(ad.adName, phone, resolvedMetaLeadId);
  if (!key) throw new Error(`Lead ${value.leadgen_id} has no usable identity.`);

  const now = new Date().toISOString();
  const sourcePayload = { webhook: value, lead, fields };
  const payloadHash = createHash("sha256").update(JSON.stringify(sourcePayload)).digest("hex");
  let existing = await supabaseAdmin.from("recruitment_leads").select("id, duplicate_count, meta_lead_id")
    .eq("company_id", companyId()).eq("meta_lead_id", resolvedMetaLeadId).maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (!existing.data) {
    existing = await supabaseAdmin.from("recruitment_leads").select("id, duplicate_count, meta_lead_id")
      .eq("company_id", companyId()).eq("canonical_key", key).maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
  }
  if (!existing.data && normalizedPhone) {
    existing = await supabaseAdmin.from("recruitment_leads").select("id, duplicate_count, meta_lead_id")
      .eq("company_id", companyId()).eq("normalized_phone", normalizedPhone)
      .order("archived", { ascending: true })
      .order("updated_at", { ascending: false })
      .limit(1).maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
  }

  let leadId = existing.data?.id as string | undefined;
  const isDifferentOccurrence = Boolean(
    existing.data && existing.data.meta_lead_id !== resolvedMetaLeadId
  );
  if (leadId && isDifferentOccurrence) {
    const duplicate = await supabaseAdmin.from("recruitment_leads").update({
      duplicate_count: Number(existing.data?.duplicate_count || 1) + 1,
      ...(ad.route.stream === "workforce" && pincodeRoute.locationId
        ? { location_id: pincodeRoute.locationId }
        : {}),
      updated_at: now
    }).eq("company_id", companyId()).eq("id", leadId);
    if (duplicate.error) throw new Error(duplicate.error.message);
  } else {
    const inserted = await supabaseAdmin.from("recruitment_leads").upsert({
      company_id: companyId(),
      meta_lead_id: resolvedMetaLeadId,
      canonical_key: key,
      normalized_phone: normalizedPhone,
      full_name: first(fields, ["full_name", "full name", "name"]),
      phone,
      email: first(fields, ["email", "email_address"]),
      city: first(fields, ["city"]),
      post_code: postCode,
      location_id: pincodeRoute.locationId,
      role_id: ad.route.roleId,
      stream: ad.route.stream,
      ad_id: ad.id,
      ad_name: ad.adName,
      source: "meta",
      status: ad.route.routeStatus === "unmapped" ? "unmapped" : "",
      questionnaire: fields,
      duplicate_count: 1,
      lead_created_at: lead.created_time
        ? new Date(lead.created_time).toISOString()
        : value.created_time
          ? new Date(value.created_time * 1000).toISOString()
          : now,
      updated_at: now
    }, { onConflict: "company_id,canonical_key" }).select("id").single();
    if (inserted.error) throw new Error(inserted.error.message);
    leadId = inserted.data.id as string;
  }

  const event = await supabaseAdmin.from("recruitment_lead_source_events").upsert({
    company_id: companyId(),
    lead_id: leadId,
    event_key: eventKey,
    source_system: sourceSystem,
    meta_lead_id: resolvedMetaLeadId,
    ad_name: ad.adName,
    payload: sourcePayload,
    payload_hash: payloadHash,
    status: existing.data ? "processed" : "lead_saved",
    processed_at: existing.data ? now : null
  }, { onConflict: "company_id,event_key", ignoreDuplicates: true });
  if (event.error) throw new Error(event.error.message);

  const history = await supabaseAdmin.from("recruitment_lead_history").upsert({
    company_id: companyId(),
    lead_id: leadId,
    event_type: "source_ingest",
    field_name: "source",
    old_value: null,
    new_value: "meta",
    remarks: `Meta lead received from ${ad.adName}.`,
    actor_email: `system:${sourceSystem}`,
    metadata: {
      source_system: sourceSystem,
      meta_lead_id: resolvedMetaLeadId,
      form_id: lead.form_id || value.form_id || null,
      ad_id: lead.ad_id || value.ad_id || null,
      ad_name: ad.adName,
      duplicate: isDifferentOccurrence,
      pincode_routing: {
        post_code: pincodeRoute.postCode,
        station_code: pincodeRoute.stationCode,
        source: pincodeRoute.source,
        advertised_station_code: ad.route.parsed.stationCode
      }
    },
    source_event_key: `${eventKey}:audit`
  }, { onConflict: "company_id,source_event_key", ignoreDuplicates: true });
  if (history.error) throw new Error(history.error.message);

  if (!existing.data) {
    await enqueueStoredLeadWelcome(leadId!);
    const completed = await supabaseAdmin.from("recruitment_lead_source_events").update({
      status: "processed",
      processed_at: new Date().toISOString(),
      error: null
    }).eq("company_id", companyId()).eq("event_key", eventKey);
    if (completed.error) throw new Error(completed.error.message);
  }
  return { saved: true, duplicate: isDifferentOccurrence, replay: false };
}
