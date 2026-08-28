import { NextResponse } from "next/server";
import {
  discoverMetaFormIds,
  discoverMetaPageFormIds,
  extractMetaFormIds,
  ingestMetaLeadgenValue,
  syncMetaAds
} from "@/lib/meta-ingestion";
import { fetchMetaFormLeadsSince, mergeMetaFormIds, type MetaFormLead } from "@/lib/meta-lead-poller";
import { getConnectionConfig } from "@/lib/connection-config";
import { requiredEnv } from "@/lib/recruitment-api";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const POLLER_VERSION = 2;
const SAFETY_OVERLAP_MS = 20 * 60 * 1000;
const UPGRADE_CATCHUP_MS = 6 * 60 * 60 * 1000;
const AD_SYNC_INTERVAL_MS = 30 * 60 * 1000;

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!supabaseAdmin) return NextResponse.json({ error: "Supabase is not configured." }, { status: 500 });
  const admin = supabaseAdmin;
  const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
  const startedAt = new Date();

  const previous = await admin.from("recruitment_ingestion_runs")
    .select("started_at,cursor")
    .eq("company_id", companyId)
    .eq("source", "meta_direct")
    .eq("status", "completed")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (previous.error) return NextResponse.json({ error: previous.error.message }, { status: 500 });
  const previousCursor = asRecord(previous.data?.cursor);
  const previousUsesSafePoller = Number(previousCursor.poller_version) >= POLLER_VERSION;
  const watermark = previousUsesSafePoller && previous.data?.started_at
    ? new Date(new Date(previous.data.started_at).getTime() - SAFETY_OVERLAP_MS)
    : new Date(startedAt.getTime() - UPGRADE_CATCHUP_MS);

  const run = await admin.from("recruitment_ingestion_runs").insert({
    company_id: companyId,
    source: "meta_direct",
    mode: "scheduled_poll",
    status: "running",
    cursor: { poller_version: POLLER_VERSION, watermark: watermark.toISOString() }
  }).select("id").single();
  if (run.error) return NextResponse.json({ error: run.error.message }, { status: 500 });
  const finishRun = async (values: Record<string, unknown>) => {
    await admin.from("recruitment_ingestion_runs").update({
      ...values,
      completed_at: new Date().toISOString()
    }).eq("company_id", companyId).eq("id", run.data.id);
  };

  const config = await getConnectionConfig("meta");
  if (!config?.isEnabled) {
    await finishRun({ status: "skipped", error: "Meta intake is disabled." });
    return NextResponse.json({ ok: true, skipped: "Meta intake is disabled." });
  }
  const accessToken = config.secrets.access_token;
  if (!accessToken) {
    await finishRun({ status: "failed", error_count: 1, error: "Meta access token is missing." });
    return NextResponse.json({ error: "Meta access token is missing." }, { status: 503 });
  }

  const graphVersion = config.publicConfig.graph_version || "v25.0";
  const latestAdSync = await admin.from("recruitment_ads")
    .select("last_synced_at")
    .eq("company_id", companyId)
    .not("last_synced_at", "is", null)
    .order("last_synced_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const latestAdSyncAt = latestAdSync.data?.last_synced_at
    ? new Date(latestAdSync.data.last_synced_at).getTime()
    : 0;
  const shouldSyncAds = Boolean(
    config.publicConfig.ad_account_id
    && (!Number.isFinite(latestAdSyncAt) || startedAt.getTime() - latestAdSyncAt >= AD_SYNC_INTERVAL_MS)
  );
  let adSync: { fetched: number; synced: number; skipped: number } | null = null;
  let adSyncError: string | null = null;
  const adSyncTask = shouldSyncAds
    ? syncMetaAds({
        accessToken,
        adAccountId: config.publicConfig.ad_account_id,
        graphVersion
      }).then((result) => { adSync = result; }).catch((error) => {
        adSyncError = error instanceof Error ? error.message : "Unknown Meta ad sync error";
      })
    : Promise.resolve();

  const [ads, sources] = await Promise.all([
    admin.from("recruitment_ads")
      .select("meta_form_id")
      .eq("company_id", companyId)
      .not("meta_form_id", "is", null)
      .limit(2000),
    admin.from("recruitment_lead_source_events")
      .select("payload")
      .eq("company_id", companyId)
      .order("received_at", { ascending: false })
      .limit(2000)
  ]);
  if (ads.error || sources.error) {
    const message = ads.error?.message || sources.error?.message || "Unable to read known Meta forms.";
    await finishRun({ status: "failed", error_count: 1, error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const knownFormIds = (ads.data ?? [])
    .map((row) => String(row.meta_form_id ?? "").trim())
    .filter(Boolean);
  const sourceFormIds = extractMetaFormIds((sources.data ?? []).map((row) => row.payload));
  const discoveryErrors: string[] = [];
  const discoveryTasks: Array<Promise<string[]>> = [];
  if (config.publicConfig.ad_account_id) {
    discoveryTasks.push(discoverMetaFormIds({
      accessToken,
      adAccountId: config.publicConfig.ad_account_id,
      graphVersion
    }));
  }
  if (config.publicConfig.page_id) {
    discoveryTasks.push(discoverMetaPageFormIds({
      accessToken,
      pageId: config.publicConfig.page_id,
      graphVersion
    }));
  }
  const discoveredGroups: string[][] = [];
  for (const result of await Promise.allSettled(discoveryTasks)) {
    if (result.status === "fulfilled") discoveredGroups.push(result.value);
    else discoveryErrors.push(result.reason instanceof Error ? result.reason.message : "Unknown Meta form discovery error");
  }
  const formIds = mergeMetaFormIds(knownFormIds, sourceFormIds, ...discoveredGroups);
  if (!formIds.length) {
    const message = [...discoveryErrors, "No Meta lead forms were found."].join(" | ");
    await adSyncTask;
    await finishRun({
      status: "failed",
      cursor: { poller_version: POLLER_VERSION, watermark: watermark.toISOString(), forms: 0, adSync, adSyncError },
      error_count: Math.max(1, discoveryErrors.length),
      error: message
    });
    console.error("Recruitment Meta cron failed", message);
    return NextResponse.json({ error: message }, { status: 503 });
  }

  const formResults: Array<{
    formId: string;
    leads: MetaFormLead[];
    pages: number;
    truncated: boolean;
    error: string | null;
  }> = [];
  let nextForm = 0;
  await Promise.all(Array.from({ length: Math.min(6, formIds.length) }, async () => {
    for (;;) {
      const index = nextForm++;
      if (index >= formIds.length) return;
      const formId = formIds[index];
      try {
        const result = await fetchMetaFormLeadsSince({
          formId,
          graphVersion,
          accessToken,
          since: watermark,
          maxPages: 50
        });
        formResults.push({ formId, leads: result.leads, pages: result.pages, truncated: result.truncated, error: null });
      } catch (error) {
        formResults.push({
          formId,
          leads: [],
          pages: 0,
          truncated: false,
          error: error instanceof Error ? error.message : "Unknown Meta form error"
        });
      }
    }
  }));

  const errors = formResults
    .filter((result) => result.error || result.truncated)
    .map((result) => `${result.formId}: ${result.error || "Polling exceeded 5,000 leads before reaching the watermark."}`);
  const seenLeadIds = new Set<string>();
  const fetchedLeads = formResults
    .flatMap(({ formId, leads }) => leads.map((lead) => ({ formId, lead })))
    .filter(({ lead }) => Boolean(lead.id) && !seenLeadIds.has(lead.id!) && Boolean(seenLeadIds.add(lead.id!)))
    .sort((left, right) => String(right.lead.created_time ?? "").localeCompare(String(left.lead.created_time ?? "")));

  const knownLeadIds = new Set<string>();
  const candidateIds = fetchedLeads.map(({ lead }) => lead.id!).filter(Boolean);
  for (let start = 0; start < candidateIds.length; start += 200) {
    const existing = await admin.from("recruitment_lead_source_events")
      .select("meta_lead_id,status")
      .eq("company_id", companyId)
      .in("meta_lead_id", candidateIds.slice(start, start + 200));
    if (existing.error) errors.push(`Replay lookup: ${existing.error.message}`);
    else for (const row of existing.data ?? []) {
      if (row.meta_lead_id && row.status === "processed") knownLeadIds.add(String(row.meta_lead_id));
    }
  }
  const pendingLeads = fetchedLeads.filter(({ lead }) => !knownLeadIds.has(lead.id!));

  let saved = 0;
  let duplicates = 0;
  let replays = knownLeadIds.size;
  let nextLead = 0;
  await Promise.all(Array.from({ length: Math.min(5, pendingLeads.length) }, async () => {
    for (;;) {
      const index = nextLead++;
      if (index >= pendingLeads.length) return;
      const { formId, lead } = pendingLeads[index];
      try {
        const result = await ingestMetaLeadgenValue({
          leadgen_id: lead.id,
          ad_id: lead.ad_id,
          form_id: lead.form_id || formId,
          created_time: lead.created_time
            ? Math.floor(new Date(lead.created_time).getTime() / 1000)
            : undefined
        }, "meta_poll");
        if (result.saved && !result.replay) saved++;
        if (result.duplicate && !result.replay) duplicates++;
        if (result.replay) replays++;
      } catch (error) {
        errors.push(`${formId}/${lead.id}: ${error instanceof Error ? error.message : "Unknown Meta ingestion error"}`);
      }
    }
  }));
  await adSyncTask;

  const discoveryUnavailable = discoveryTasks.length === 0 || discoveredGroups.length === 0;
  const intakeFailed = discoveryUnavailable || errors.length > 0;
  const status = intakeFailed ? 502 : 200;
  const summary = {
    ok: !intakeFailed,
    pollerVersion: POLLER_VERSION,
    watermark: watermark.toISOString(),
    forms: formIds.length,
    pages: formResults.reduce((total, result) => total + result.pages, 0),
    scanned: fetchedLeads.length,
    queued: pendingLeads.length,
    saved,
    duplicates,
    replays,
    adSync,
    adSyncError,
    discoveryErrors,
    discoveryUnavailable,
    errors: errors.slice(0, 20),
    generatedAt: new Date().toISOString()
  };
  await finishRun({
    status: intakeFailed ? "failed" : "completed",
    cursor: {
      poller_version: POLLER_VERSION,
      watermark: watermark.toISOString(),
      forms: formIds.length,
      pages: summary.pages,
      discovered_forms: discoveredGroups.flat().length,
      adSync,
      adSyncError
    },
    scanned_count: fetchedLeads.length,
    inserted_count: saved,
    duplicate_count: duplicates + replays,
    error_count: discoveryErrors.length + errors.length + (adSyncError ? 1 : 0),
    error: [...discoveryErrors, ...errors, ...(adSyncError ? [`Ad sync: ${adSyncError}`] : [])].slice(0, 20).join(" | ") || null
  });
  if (intakeFailed) console.error("Recruitment Meta cron partial failure", JSON.stringify(summary));
  else console.info("Recruitment Meta cron summary", JSON.stringify(summary));
  return NextResponse.json(summary, { status });
}
