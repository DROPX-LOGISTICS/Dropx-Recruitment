import { supabaseAdmin } from "./supabase-admin";

const INCIDENT_DAY_START = "2026-07-30T18:30:00.000Z";
const INCIDENT_DAY_END = "2026-07-31T18:29:59.999Z";
const BRIDGE_SOURCE = "google_sheet_bridge";
const RETAINED_SOURCE = "google_sheet_bridge_retained";
const PROTECTED_EVENTS = new Set([
  "field_update",
  "hr_document_uploaded",
  "hr_interview_forwarded",
  "hr_manager_feedback",
  "hr_offer_letter_generated",
  "hr_screening_profile",
  "workforce_joining_record"
]);

type IncidentWindow = {
  start: string;
  end: string;
  sourceRows: number;
  reportedInserted: number;
  reportedUpdated: number;
  runs: number;
};

type LeadRow = Record<string, any> & {
  id: string;
  company_id: string;
  meta_lead_id: string | null;
  normalized_phone: string | null;
  source: string;
  created_at: string;
  updated_at: string;
};

function chunks<T>(values: T[], size: number) {
  const output: T[][] = [];
  for (let start = 0; start < values.length; start += size) output.push(values.slice(start, start + size));
  return output;
}

function newer(left: string | null | undefined, right: string | null | undefined) {
  const leftTime = left ? new Date(left).getTime() : NaN;
  const rightTime = right ? new Date(right).getTime() : NaN;
  return Number.isFinite(leftTime) && (!Number.isFinite(rightTime) || leftTime > rightTime);
}

async function incidentWindow(companyId: string): Promise<IncidentWindow> {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  const result = await supabaseAdmin.from("recruitment_ingestion_runs")
    .select("status,cursor,inserted_count,updated_count,started_at,completed_at")
    .eq("company_id", companyId)
    .eq("source", BRIDGE_SOURCE)
    .eq("mode", "full_refresh_batch")
    .gte("started_at", INCIDENT_DAY_START)
    .lte("started_at", INCIDENT_DAY_END)
    .order("started_at", { ascending: true });
  if (result.error) throw new Error(result.error.message);
  const rows = result.data ?? [];
  if (!rows.length) throw new Error("The 31-Jul legacy refresh runs were not found.");
  const completed = rows.filter((row) => row.status === "completed");
  const start = rows.map((row) => row.started_at).filter(Boolean).sort()[0];
  const end = rows.map((row) => row.completed_at).filter(Boolean).sort().at(-1);
  if (!start || !end) throw new Error("The legacy refresh window is incomplete.");
  return {
    start,
    end,
    sourceRows: Math.max(0, ...rows.map((row) => Number((row.cursor as Record<string, unknown> | null)?.sourceRows || 0))),
    reportedInserted: completed.reduce((sum, row) => sum + Number(row.inserted_count || 0), 0),
    reportedUpdated: completed.reduce((sum, row) => sum + Number(row.updated_count || 0), 0),
    runs: rows.length
  };
}

async function incidentCount(companyId: string, window: IncidentWindow) {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  const result = await supabaseAdmin.from("recruitment_leads")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("source", BRIDGE_SOURCE)
    .gte("created_at", window.start)
    .lte("created_at", window.end);
  if (result.error) throw new Error(result.error.message);
  return result.count ?? 0;
}

async function eventCount(companyId: string, sourceSystem: string) {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  const result = await supabaseAdmin.from("recruitment_lead_source_events")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("source_system", sourceSystem);
  if (result.error) throw new Error(result.error.message);
  return result.count ?? 0;
}

async function fetchIncidentRows(companyId: string, window: IncidentWindow, limit: number) {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  const result = await supabaseAdmin.from("recruitment_leads")
    .select("*")
    .eq("company_id", companyId)
    .eq("source", BRIDGE_SOURCE)
    .gte("created_at", window.start)
    .lte("created_at", window.end)
    .order("id", { ascending: true })
    .limit(limit);
  if (result.error) throw new Error(result.error.message);
  return (result.data ?? []) as LeadRow[];
}

async function histories(companyId: string, leadIds: string[]) {
  if (!supabaseAdmin || !leadIds.length) return [] as Array<Record<string, any>>;
  const output: Array<Record<string, any>> = [];
  for (const ids of chunks(leadIds, 150)) {
    const result = await supabaseAdmin.from("recruitment_lead_history")
      .select("*").eq("company_id", companyId).in("lead_id", ids).order("created_at", { ascending: true });
    if (result.error) throw new Error(result.error.message);
    output.push(...(result.data ?? []));
  }
  return output;
}

async function targetCandidates(companyId: string, incident: LeadRow[], window: IncidentWindow) {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  const output: LeadRow[] = [];
  const phones = [...new Set(incident.map((row) => row.normalized_phone).filter(Boolean))] as string[];
  for (const values of chunks(phones, 150)) {
    const result = await supabaseAdmin.from("recruitment_leads").select("*")
      .eq("company_id", companyId).in("normalized_phone", values);
    if (result.error) throw new Error(result.error.message);
    output.push(...((result.data ?? []) as LeadRow[]));
  }
  const incidentIds = new Set(incident.map((row) => row.id));
  return output.filter((row) => !incidentIds.has(row.id) && (
    row.source !== BRIDGE_SOURCE || row.created_at < window.start || row.created_at > window.end
  ));
}

function chooseTarget(source: LeadRow, candidates: LeadRow[]) {
  return candidates
    .filter((candidate) => source.normalized_phone && candidate.normalized_phone === source.normalized_phone)
    .sort((left, right) => {
      const score = (candidate: LeadRow) =>
        (candidate.location_id === source.location_id ? 8 : 0) +
        (candidate.role_id === source.role_id ? 4 : 0) +
        (candidate.stream === source.stream ? 2 : 0) +
        (!candidate.archived ? 1 : 0) +
        (candidate.source !== BRIDGE_SOURCE ? 1 : 0);
      return score(right) - score(left) || new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime();
    })[0] ?? null;
}

function mergeUpdate(source: LeadRow, target: LeadRow) {
  if (!newer(source.updated_at, target.updated_at)) return null;
  const preferText = (field: string) => String(source[field] ?? "").trim() ? source[field] : target[field];
  const preferValue = (field: string) => source[field] ?? target[field];
  return {
    full_name: preferText("full_name"),
    phone: preferText("phone"),
    email: preferText("email"),
    city: preferText("city"),
    post_code: preferText("post_code"),
    status: preferText("status"),
    remarks: preferText("remarks"),
    follow_up_at: preferValue("follow_up_at"),
    callback_at: preferValue("callback_at"),
    final_status: preferText("final_status"),
    final_remarks: preferText("final_remarks"),
    work_email: preferText("work_email"),
    assigned_profile_id: preferValue("assigned_profile_id"),
    last_updated_by: preferValue("last_updated_by"),
    total_attempts: Math.max(Number(source.total_attempts || 0), Number(target.total_attempts || 0)),
    no_response_attempts: Math.max(Number(source.no_response_attempts || 0), Number(target.no_response_attempts || 0)),
    call_back_attempts: Math.max(Number(source.call_back_attempts || 0), Number(target.call_back_attempts || 0)),
    archived: Boolean(source.archived || target.archived),
    archived_at: source.archived_at ?? target.archived_at,
    duplicate_count: Math.max(1, Number(source.duplicate_count || 1) + Number(target.duplicate_count || 1)),
    updated_at: source.updated_at
  };
}

export async function previewLegacyLeadRollback(companyId: string) {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  const window = await incidentWindow(companyId);
  const [remaining, snapshots, retained] = await Promise.all([
    incidentCount(companyId, window),
    eventCount(companyId, "legacy_rollback_snapshot"),
    eventCount(companyId, "legacy_rollback_retained")
  ]);
  return { window, remaining, snapshots, retained, processed: snapshots + retained };
}

export async function applyLegacyLeadRollbackBatch(companyId: string, batchSize = 150) {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  const window = await incidentWindow(companyId);
  const incident = await fetchIncidentRows(companyId, window, Math.min(200, Math.max(10, batchSize)));
  if (!incident.length) return { ...(await previewLegacyLeadRollback(companyId)), done: true, batch: { deleted: 0, retained: 0, merged: 0, protected: 0 } };

  const sourceHistories = await histories(companyId, incident.map((row) => row.id));
  const historiesByLead = new Map<string, Array<Record<string, any>>>();
  for (const row of sourceHistories) {
    const values = historiesByLead.get(String(row.lead_id)) ?? [];
    values.push(row);
    historiesByLead.set(String(row.lead_id), values);
  }
  const candidates = await targetCandidates(companyId, incident, window);
  const candidateById = new Map(candidates.map((row) => [row.id, row]));
  const targetForSource = new Map<string, LeadRow | null>();
  for (const source of incident) targetForSource.set(source.id, chooseTarget(source, candidates));
  const targetHistory = await histories(companyId, [...new Set([...targetForSource.values()].filter(Boolean).map((row) => row!.id))]);
  const copiedHistoryIds = new Set(targetHistory.map((row) => String((row.metadata as Record<string, unknown> | null)?.rollback_source_history_id || "")).filter(Boolean));
  const snapshots: Array<Record<string, unknown>> = [];
  const retainedSnapshots: Array<Record<string, unknown>> = [];
  const retainedIds: string[] = [];
  const deleteIds: string[] = [];
  const historyCopies: Array<Record<string, unknown>> = [];
  const mergedTargets = new Map<string, LeadRow>();
  let deleted = 0;
  let retained = 0;
  let merged = 0;
  let protectedCount = 0;

  for (const source of incident) {
    const sourceHistory = historiesByLead.get(source.id) ?? [];
    const protectedUpdate = sourceHistory.some((row) => PROTECTED_EVENTS.has(String(row.event_type)));
    const target = targetForSource.get(source.id) ?? null;
    if (!target || protectedUpdate) {
      const reason = protectedUpdate ? "protected_workflow_update" : "no_preexisting_identity_match";
      retainedSnapshots.push({
        company_id: companyId,
        lead_id: source.id,
        event_key: `legacy-rollback-retained:${source.id}`,
        source_system: "legacy_rollback_retained",
        source_sheet: "LeadsDB",
        meta_lead_id: source.meta_lead_id,
        ad_name: source.ad_name,
        payload: { reason, sourceLead: source, sourceHistory },
        payload_hash: null,
        status: "processed",
        processed_at: new Date().toISOString()
      });
      retainedIds.push(source.id);
      retained++;
      if (protectedUpdate) protectedCount++;
      continue;
    }

    snapshots.push({
      company_id: companyId,
      lead_id: target.id,
      event_key: `legacy-rollback-snapshot:${source.id}`,
      source_system: "legacy_rollback_snapshot",
      source_sheet: "LeadsDB",
      meta_lead_id: source.meta_lead_id,
      ad_name: source.ad_name,
      payload: { sourceLead: source, targetLeadBefore: target, sourceHistory },
      payload_hash: null,
      status: "processed",
      processed_at: new Date().toISOString()
    });

    const currentTarget = mergedTargets.get(target.id) ?? candidateById.get(target.id) ?? target;
    const update = mergeUpdate(source, currentTarget);
    if (update) {
      mergedTargets.set(target.id, { ...currentTarget, ...update });
      merged++;
    }
    for (const history of sourceHistory) {
      if (copiedHistoryIds.has(String(history.id))) continue;
      const { id: _id, lead_id: _leadId, ...copy } = history;
      historyCopies.push({
        ...copy,
        lead_id: target.id,
        metadata: { ...(history.metadata ?? {}), rollback_source_history_id: history.id }
      });
    }
    deleteIds.push(source.id);
    deleted++;
  }

  if (retainedSnapshots.length) {
    const result = await supabaseAdmin.from("recruitment_lead_source_events")
      .upsert(retainedSnapshots, { onConflict: "company_id,event_key" });
    if (result.error) throw new Error(result.error.message);
  }
  if (retainedIds.length) {
    const result = await supabaseAdmin.from("recruitment_leads").update({ source: RETAINED_SOURCE })
      .eq("company_id", companyId).in("id", retainedIds);
    if (result.error) throw new Error(result.error.message);
  }
  if (snapshots.length) {
    const result = await supabaseAdmin.from("recruitment_lead_source_events")
      .upsert(snapshots, { onConflict: "company_id,event_key" });
    if (result.error) throw new Error(result.error.message);
  }
  if (mergedTargets.size) {
    const result = await supabaseAdmin.from("recruitment_leads")
      .upsert([...mergedTargets.values()], { onConflict: "id" });
    if (result.error) throw new Error(result.error.message);
  }
  for (const rows of chunks(historyCopies, 200)) {
    const result = await supabaseAdmin.from("recruitment_lead_history").insert(rows);
    if (result.error) throw new Error(result.error.message);
  }
  if (deleteIds.length) {
    const removed = await supabaseAdmin.from("recruitment_leads").delete()
      .eq("company_id", companyId).in("id", deleteIds);
    if (removed.error) throw new Error(removed.error.message);
  }

  const progress = await previewLegacyLeadRollback(companyId);
  return { ...progress, done: progress.remaining === 0, batch: { deleted, retained, merged, protected: protectedCount } };
}
