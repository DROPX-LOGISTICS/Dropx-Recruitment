import { createHash } from "node:crypto";
import Papa from "papaparse";
import { importedLeadShouldBeArchived } from "./archive-repair";
import { authoritativeRoleStream, canonicalApplicationKey, normalizePhone, parseAdRouteWithMasters } from "./recruitment-routing";
import { requiredEnv } from "./recruitment-api";
import { supabaseAdmin } from "./supabase-admin";

const DEFAULT_SOURCE_SHEET_ID = "1TQK61by7duJ0dpkoAlQbBC75OBKQzynaEsQNAJClPIk";
const HEADER_RANGE = "A1:AZ1";
const MAX_BATCH_SIZE = 500;

type SheetRow = Record<string, string>;
type BridgeMode = "incremental" | "full_refresh";
type BridgeOptions = { mode?: BridgeMode; startRow?: number; batchSize?: number };
type Route = {
  locationId: string | null;
  roleId: string | null;
  role: Record<string, unknown> | null;
  stream: "workforce" | "hr" | null;
  routeStatus: "mapped" | "unmapped";
};
type PreparedRow = {
  row: SheetRow;
  sourceRow: number;
  metaLeadId: string;
  adName: string;
  adId: string;
  route: Route;
  phone: string | null;
  normalizedPhone: string | null;
  canonicalKey: string;
  payloadHash: string;
  eventKey: string;
  sourceUpdatedAt: string | null;
};

function sheetUrl(range?: string, query?: string) {
  const id = process.env.RECRUITMENT_SOURCE_SHEET_ID?.trim() || DEFAULT_SOURCE_SHEET_ID;
  const url = new URL(`https://docs.google.com/spreadsheets/d/${id}/gviz/tq`);
  url.searchParams.set("tqx", "out:csv");
  url.searchParams.set("sheet", "LeadsDB");
  if (range) url.searchParams.set("range", range);
  if (query) url.searchParams.set("tq", query);
  return url;
}

async function csvText(url: URL) {
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(25_000) });
  if (!response.ok) throw new Error(`Google Sheet returned HTTP ${response.status}.`);
  return response.text();
}

function parseCsv(text: string) {
  const parsed = Papa.parse<string[]>(text.trim(), { skipEmptyLines: true });
  const blocking = parsed.errors.find((error) => error.code !== "UndetectableDelimiter");
  if (blocking) throw new Error(blocking.message);
  return parsed.data;
}

async function currentDataRows() {
  const rows = parseCsv(await csvText(sheetUrl(undefined, "select count(A)")));
  const value = rows.flat().map((item) => Number(String(item).replace(/[^\d]/g, "")))
    .find((item) => Number.isFinite(item) && item > 0);
  if (!value) throw new Error("Unable to determine the LeadsDB row count.");
  return value;
}

function status(value: string) {
  const key = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const aliases: Record<string, string> = {
    "": "", no_status: "", not_connected: "no_response", no_response: "no_response",
    call_back: "call_back", callback: "call_back", interested: "interested",
    interview_scheduled: "interview_scheduled", interview_rescheduled: "interview_rescheduled",
    interview_completed: "interview_completed", interview_no_show: "interview_no_show",
    selected: "selected", joined: "joined", not_interested: "not_interested",
    not_fit: "not_fit", long_distance: "long_distance", wrong_number: "wrong_number",
    rejected: "rejected", hold: "hold"
  };
  return aliases[key] ?? key;
}

function yes(value: string) {
  return ["yes", "true", "1"].includes(value.trim().toLowerCase());
}

function json(value: string) {
  if (!value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : { value };
  } catch {
    return { value };
  }
}

function timestamp(value: string) {
  const clean = value.trim();
  if (!clean) return null;
  const parsed = new Date(clean.replace(/\s+IST$/i, " GMT+0530"));
  if (!Number.isFinite(parsed.getTime())) return null;
  const year = parsed.getUTCFullYear();
  // LeadsDB contains a few spreadsheet/date-format corruptions (for example
  // five-digit years). They are not meaningful business timestamps and
  // PostgreSQL intentionally rejects JavaScript's extended-year ISO form.
  if (year < 2000 || year > 2100) return null;
  return parsed.toISOString();
}

function sourceTimestamp(row: SheetRow) {
  return timestamp(row.last_updated || "")
    || timestamp(row.synced_at || "")
    || timestamp(row.lead_time || "");
}

function changed(existing: Record<string, unknown>, next: Record<string, unknown>) {
  const fields = [
    "full_name", "phone", "email", "city", "post_code", "status", "remarks",
    "follow_up_at", "callback_at", "final_status", "final_remarks", "work_email",
    "total_attempts", "no_response_attempts", "call_back_attempts", "archived", "archived_at"
  ];
  return fields.some((field) => String(existing[field] ?? "") !== String(next[field] ?? ""));
}

async function loadRoutes(companyId: string) {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  const [locations, roles] = await Promise.all([
    supabaseAdmin.from("recruitment_locations").select("id,code")
      .eq("company_id", companyId).eq("is_active", true),
    supabaseAdmin.from("recruitment_roles").select("id,code,name,stream,aliases")
      .eq("company_id", companyId).eq("is_active", true)
  ]);
  if (locations.error || roles.error) throw new Error(locations.error?.message || roles.error?.message);
  return { locations: locations.data ?? [], roles: roles.data ?? [] };
}

function resolveRoute(adName: string, masters: Awaited<ReturnType<typeof loadRoutes>>): Route {
  const parsed = parseAdRouteWithMasters(adName, masters.locations, masters.roles as any);
  const location = masters.locations.find((item) => item.code === parsed.stationCode);
  const role = masters.roles.find((item) => item.code === parsed.roleCode);
  return {
    locationId: location?.id ?? null,
    roleId: role?.id ?? null,
    role: role ?? null,
    stream: authoritativeRoleStream(role?.code, role?.stream ?? parsed.stream),
    routeStatus: location && role ? "mapped" : "unmapped"
  };
}

async function loadAds(companyId: string, adNames: string[], masters: Awaited<ReturnType<typeof loadRoutes>>) {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  const unique = [...new Set(adNames)];
  const existing = unique.length
    ? await supabaseAdmin.from("recruitment_ads").select("id,ad_name")
      .eq("company_id", companyId).in("ad_name", unique).order("created_at", { ascending: true })
    : { data: [], error: null };
  if (existing.error) throw new Error(existing.error.message);
  const ads = new Map<string, string>();
  for (const item of existing.data ?? []) if (!ads.has(item.ad_name)) ads.set(item.ad_name, item.id);
  const missing = unique.filter((name) => !ads.has(name));
  if (missing.length) {
    const now = new Date().toISOString();
    const inserted = await supabaseAdmin.from("recruitment_ads").insert(missing.map((adName) => {
      const route = resolveRoute(adName, masters);
      return {
        company_id: companyId, ad_name: adName, location_id: route.locationId,
        role_id: route.roleId, route_status: route.routeStatus, status: "unknown",
        raw_payload: { source: "LeadsDB bridge" }, last_synced_at: now
      };
    })).select("id,ad_name");
    if (inserted.error) throw new Error(inserted.error.message);
    for (const item of inserted.data ?? []) ads.set(item.ad_name, item.id);
  }
  return ads;
}

function leadValues(item: PreparedRow, companyId: string, now: string) {
  const importedStatus = status(item.row.call_status || "");
  const noResponseAttempts = Number(item.row.no_response_attempts || 0);
  const archived = importedLeadShouldBeArchived({
    sourceArchived: yes(item.row.archived), status: importedStatus,
    stream: item.route.stream, noResponseAttempts
  });
  const updatedAt = item.sourceUpdatedAt || now;
  return {
    company_id: companyId,
    meta_lead_id: item.metaLeadId,
    canonical_key: item.canonicalKey,
    normalized_phone: item.normalizedPhone,
    full_name: item.row.full_name || null,
    phone: item.phone,
    email: item.row.email || null,
    city: item.row.city || null,
    post_code: item.row.post_code || null,
    location_id: item.route.locationId,
    role_id: item.route.roleId,
    stream: item.route.stream,
    ad_id: item.adId,
    ad_name: item.adName,
    source: "google_sheet_bridge",
    status: importedStatus,
    remarks: item.row.remarks || null,
    follow_up_at: timestamp(item.row.follow_up_date || ""),
    callback_at: timestamp(item.row.callback_at || ""),
    final_status: item.row.final_status || null,
    final_remarks: item.row.final_remarks || null,
    work_email: item.row.work_email || null,
    questionnaire: json(item.row.raw_extra || ""),
    duplicate_count: Math.max(1, Number(item.row.duplicate_count || 1)),
    total_attempts: Number(item.row.total_attempts || 0),
    no_response_attempts: noResponseAttempts,
    call_back_attempts: Number(item.row.call_back_attempts || 0),
    archived,
    archived_at: archived ? timestamp(item.row.archived_at || "") || updatedAt : null,
    lead_created_at: timestamp(item.row.lead_time || "") || updatedAt,
    updated_at: updatedAt
  };
}

async function ingestRows(rows: Array<{ row: SheetRow; sourceRow: number }>, companyId: string) {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  const masters = await loadRoutes(companyId);
  const validRows = rows.filter(({ row }) => Boolean(row.lead_id?.trim()));
  const ads = await loadAds(companyId, validRows.map(({ row }) => row.ad_name?.trim() || "Unknown ad"), masters);
  const prepared: PreparedRow[] = [];
  let rejected = rows.length - validRows.length;
  for (const { row, sourceRow } of validRows) {
    const metaLeadId = row.lead_id.trim();
    const adName = row.ad_name?.trim() || "Unknown ad";
    const phone = row.phone?.trim() || null;
    const normalizedPhone = normalizePhone(phone);
    // The legacy dashboard is a candidate-status source, not a second
    // application ledger. A phone-level key prevents the same candidate from
    // being inserted again merely because the legacy ad name differs.
    const canonicalKey = normalizedPhone
      ? `legacy-candidate:${normalizedPhone}`
      : canonicalApplicationKey(adName, phone, metaLeadId);
    const adId = ads.get(adName);
    if (!canonicalKey || !adId) { rejected++; continue; }
    const payloadHash = createHash("sha256").update(JSON.stringify(row)).digest("hex");
    prepared.push({
      row, sourceRow, metaLeadId, adName, adId, route: resolveRoute(adName, masters),
      phone, normalizedPhone, canonicalKey, payloadHash,
      eventKey: `leadsdb:${metaLeadId}:${payloadHash.slice(0, 24)}`,
      sourceUpdatedAt: sourceTimestamp(row)
    });
  }
  if (!prepared.length) return { inserted: 0, updated: 0, unchanged: 0, duplicates: 0, rejected, errors: 0, messages: [] as string[] };

  const leadSelect = "id,meta_lead_id,canonical_key,normalized_phone,duplicate_count,updated_at,full_name,phone,email,city,post_code,status,remarks,follow_up_at,callback_at,final_status,final_remarks,work_email,total_attempts,no_response_attempts,call_back_attempts,archived,archived_at,location_id,role_id,stream,ad_id,ad_name,source,questionnaire";
  const phoneValues = [...new Set(prepared.map((item) => item.normalizedPhone).filter(Boolean))] as string[];
  const [byMeta, byCanonical, byPhone] = await Promise.all([
    supabaseAdmin.from("recruitment_leads").select(leadSelect)
      .eq("company_id", companyId).in("meta_lead_id", [...new Set(prepared.map((item) => item.metaLeadId))]),
    supabaseAdmin.from("recruitment_leads").select(leadSelect)
      .eq("company_id", companyId).in("canonical_key", [...new Set(prepared.map((item) => item.canonicalKey))]),
    phoneValues.length
      ? supabaseAdmin.from("recruitment_leads").select(leadSelect)
          .eq("company_id", companyId).in("normalized_phone", phoneValues)
      : Promise.resolve({ data: [], error: null })
  ]);
  if (byMeta.error || byCanonical.error || byPhone.error) throw new Error(byMeta.error?.message || byCanonical.error?.message || byPhone.error?.message);
  const metaMap = new Map((byMeta.data ?? []).map((item) => [String(item.meta_lead_id), item]));
  const canonicalMap = new Map((byCanonical.data ?? []).map((item) => [String(item.canonical_key), item]));
  const phoneMap = new Map<string, Array<Record<string, any>>>();
  for (const item of byPhone.data ?? []) {
    const key = String(item.normalized_phone || "");
    if (!key) continue;
    const values = phoneMap.get(key) ?? [];
    values.push(item);
    phoneMap.set(key, values);
  }
  const phoneMatch = (item: PreparedRow) => (item.normalizedPhone ? phoneMap.get(item.normalizedPhone) : undefined)
    ?.sort((left, right) => {
      const score = (candidate: Record<string, any>) =>
        (candidate.location_id === item.route.locationId ? 8 : 0) +
        (candidate.role_id === item.route.roleId ? 4 : 0) +
        (candidate.stream === item.route.stream ? 2 : 0) +
        (!candidate.archived ? 1 : 0) +
        (candidate.source !== "google_sheet_bridge" ? 1 : 0);
      return score(right) - score(left) || new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime();
    })[0];
  const now = new Date().toISOString();
  const writes = new Map<string, Record<string, unknown>>();
  const leadByCanonical = new Map<string, string>();
  const changedItems: PreparedRow[] = [];
  const workingById = new Map<string, Record<string, any>>();
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  let duplicates = 0;

  for (const item of prepared) {
    const matched = metaMap.get(item.metaLeadId) ?? canonicalMap.get(item.canonicalKey) ?? phoneMatch(item);
    const existing = matched ? workingById.get(String(matched.id)) ?? matched : null;
    const values = leadValues(item, companyId, now);
    if (!existing) {
      const pending = writes.get(item.canonicalKey);
      if (!pending) {
        inserted++;
        writes.set(item.canonicalKey, values);
        changedItems.push(item);
      } else {
        duplicates++;
        if (new Date(String(values.updated_at)).getTime() >= new Date(String(pending.updated_at)).getTime()) {
          writes.set(item.canonicalKey, values);
          changedItems.push(item);
        }
      }
      continue;
    }
    leadByCanonical.set(item.canonicalKey, String(existing.id));
    if (existing.meta_lead_id && existing.meta_lead_id !== item.metaLeadId) duplicates++;
    const sourceTime = item.sourceUpdatedAt ? new Date(item.sourceUpdatedAt).getTime() : NaN;
    const existingTime = existing.updated_at ? new Date(existing.updated_at).getTime() : NaN;
    const sourceCanWin = Number.isFinite(sourceTime) && (!Number.isFinite(existingTime) || sourceTime >= existingTime);
    if (sourceCanWin && changed(existing, values)) {
      const nextValues = {
        ...values,
        canonical_key: String(existing.canonical_key || item.canonicalKey),
        meta_lead_id: existing.meta_lead_id || item.metaLeadId,
        normalized_phone: existing.normalized_phone || values.normalized_phone,
        location_id: existing.location_id ?? values.location_id,
        role_id: existing.role_id ?? values.role_id,
        stream: existing.stream ?? values.stream,
        ad_id: existing.ad_id ?? values.ad_id,
        ad_name: existing.ad_name || values.ad_name,
        source: existing.source || values.source,
        questionnaire: existing.questionnaire ?? values.questionnaire,
        duplicate_count: Math.max(Number(existing.duplicate_count || 1), Number(values.duplicate_count || 1))
      };
      writes.set(String(existing.canonical_key || item.canonicalKey), nextValues);
      workingById.set(String(existing.id), { ...existing, ...nextValues });
      changedItems.push(item);
      updated++;
    } else {
      unchanged++;
    }
  }

  let upserted: Array<{ id: string; canonical_key: string }> = [];
  if (writes.size) {
    const result = await supabaseAdmin.from("recruitment_leads")
      .upsert([...writes.values()], { onConflict: "company_id,canonical_key" })
      .select("id,canonical_key");
    if (result.error) throw new Error(result.error.message);
    upserted = result.data ?? [];
    for (const item of upserted) leadByCanonical.set(item.canonical_key, item.id);
  }

  const eventRows = prepared.map((item) => ({
    company_id: companyId,
    lead_id: leadByCanonical.get(item.canonicalKey) ?? null,
    event_key: item.eventKey,
    source_system: "google_sheet_bridge",
    source_sheet: item.row.source_sheet || "LeadsDB",
    source_row: item.sourceRow,
    meta_lead_id: item.metaLeadId,
    ad_name: item.adName,
    payload: item.row,
    payload_hash: item.payloadHash,
    status: "processed",
    processed_at: now
  }));
  const events = await supabaseAdmin.from("recruitment_lead_source_events")
    .upsert(eventRows, { onConflict: "company_id,event_key", ignoreDuplicates: true });
  if (events.error) throw new Error(events.error.message);

  if (changedItems.length) {
    const historyRows = changedItems.map((item) => ({
      company_id: companyId,
      lead_id: leadByCanonical.get(item.canonicalKey),
      event_type: "source_sync",
      field_name: "legacy_lead",
      new_value: status(item.row.call_status || ""),
      remarks: "Reconciled from the legacy LeadsDB without sending notifications.",
      actor_email: "system:google_sheet_bridge",
      metadata: { sourceRow: item.sourceRow, sourceUpdatedAt: item.sourceUpdatedAt, payloadHash: item.payloadHash }
    })).filter((item) => Boolean(item.lead_id));
    if (historyRows.length) {
      const history = await supabaseAdmin.from("recruitment_lead_history").insert(historyRows);
      if (history.error) throw new Error(history.error.message);
    }
  }
  return { inserted, updated, unchanged, duplicates, rejected, errors: 0, messages: [] as string[] };
}

export async function runSheetBridge(options: BridgeOptions = {}) {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
  const mode = options.mode ?? "incremental";
  const sourceRows = await currentDataRows();
  const lastSheetRow = sourceRows + 1;
  let startRow = Math.max(2, Number(options.startRow || 0));
  if (mode === "incremental" && !options.startRow) {
    const previous = await supabaseAdmin.from("recruitment_ingestion_runs").select("cursor")
      .eq("company_id", companyId).eq("source", "google_sheet_bridge").eq("status", "completed")
      .order("completed_at", { ascending: false }).limit(1).maybeSingle();
    if (previous.error) throw new Error(previous.error.message);
    const previousNext = Number((previous.data?.cursor as Record<string, unknown> | null)?.nextRow ?? 0);
    startRow = previousNext > 1 ? previousNext : Math.max(2, lastSheetRow - 19 + 1);
  }
  const batchSize = Math.min(MAX_BATCH_SIZE, Math.max(25, Number(options.batchSize || (mode === "full_refresh" ? 400 : 100))));
  const endRow = Math.min(lastSheetRow, startRow + batchSize - 1);
  const nextRow = endRow + 1;
  const done = startRow > lastSheetRow || nextRow > lastSheetRow;
  const run = await supabaseAdmin.from("recruitment_ingestion_runs").insert({
    company_id: companyId,
    source: "google_sheet_bridge",
    mode: mode === "full_refresh" ? "full_refresh_batch" : "incremental",
    status: "running",
    cursor: { startRow, nextRow: startRow, sourceRows }
  }).select("id").single();
  if (run.error) throw new Error(run.error.message);
  try {
    let outcome = { inserted: 0, updated: 0, unchanged: 0, duplicates: 0, rejected: 0, errors: 0, messages: [] as string[] };
    let scanned = 0;
    if (startRow <= lastSheetRow) {
      const [headerText, dataText] = await Promise.all([
        csvText(sheetUrl(HEADER_RANGE)),
        csvText(sheetUrl(`A${startRow}:AZ${endRow}`))
      ]);
      const headers = parseCsv(headerText)[0] ?? [];
      const values = parseCsv(dataText);
      const rows = values.map((value, index) => ({
        row: Object.fromEntries(headers.map((header, column) => [header, value?.[column] ?? ""])),
        sourceRow: startRow + index
      }));
      scanned = rows.length;
      outcome = await ingestRows(rows, companyId);
    }
    const completedAt = new Date().toISOString();
    const completed = await supabaseAdmin.from("recruitment_ingestion_runs").update({
      status: "completed",
      cursor: { startRow, nextRow, sourceRows, done },
      scanned_count: scanned,
      inserted_count: outcome.inserted,
      updated_count: outcome.updated,
      duplicate_count: outcome.duplicates,
      rejected_count: outcome.rejected,
      error_count: outcome.errors,
      completed_at: completedAt,
      error: outcome.messages.slice(0, 20).join(" | ") || null
    }).eq("company_id", companyId).eq("id", run.data.id);
    if (completed.error) throw new Error(completed.error.message);
    return {
      ok: outcome.errors === 0, mode, sourceRows, startRow, endRow, nextRow,
      done, scanned, inserted: outcome.inserted, updated: outcome.updated,
      unchanged: outcome.unchanged, duplicates: outcome.duplicates,
      rejected: outcome.rejected, errors: outcome.errors,
      messages: outcome.messages.slice(0, 20), completedAt
    };
  } catch (error) {
    await supabaseAdmin.from("recruitment_ingestion_runs").update({
      status: "failed", error_count: 1,
      error: error instanceof Error ? error.message : "Unknown bridge failure",
      completed_at: new Date().toISOString()
    }).eq("company_id", companyId).eq("id", run.data.id);
    throw error;
  }
}
