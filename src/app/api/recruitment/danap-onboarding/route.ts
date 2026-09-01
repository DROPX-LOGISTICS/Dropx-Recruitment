import { NextResponse } from "next/server";
import {
  DA_INAPP_SOURCE_ALIASES,
  addDaOwner,
  addDaStation,
  canOwnerAccessDaRecord,
  carryForwardDaOperations,
  daActionIsComplete,
  daFallbackOwnershipCandidates,
  daOwnershipStatus,
  daStationForOwnership,
  findDaValue,
  isDaInAppBatch,
  latestDaInAppBatch,
  normalizeDaIdentity,
  normalizeDaStation,
  parseDaInAppRecord,
  resolveDaContact,
  resolveDaVisibility,
  sortDaRecords,
  validateDaUpdate,
  type DaBatch,
  type DaImportRow,
  type DaOwnershipMaps
} from "@/lib/da-inapp-onboarding";
import {
  defaultHiringManagerFor,
  loadMainDashboardHiringManagers,
  loadMainDashboardStations
} from "@/lib/main-dashboard-masters";
import { canUseRecruitmentMenu, recruitmentSession, requiredEnv } from "@/lib/recruitment-api";
import { uploadRecruitmentDocument } from "@/lib/recruitment-documents";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { WORKFORCE_PROFILE_TABLE } from "@/lib/workforce-register";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const clean = (value: unknown) => String(value ?? "").trim();

async function allowedStations(companyId: string, session: NonNullable<Awaited<ReturnType<typeof recruitmentSession>>>) {
  let query = supabaseAdmin!.from("recruitment_locations")
    .select("id,code")
    .eq("company_id", companyId)
    .eq("is_active", true);
  if (!session.allLocations) {
    query = query.in("id", session.locationIds.length ? session.locationIds : ["00000000-0000-0000-0000-000000000000"]);
  }
  const result = await query;
  if (result.error) throw new Error(result.error.message);
  return (result.data ?? []).map((item) => normalizeDaStation(item.code));
}

async function systemStationDetails(companyId: string) {
  const [locations, contacts, mainStations, managers] = await Promise.all([
    supabaseAdmin!.from("recruitment_locations").select("id,code,name,cluster,poc_name,poc_mobile").eq("company_id", companyId).eq("is_active", true),
    supabaseAdmin!.from("recruitment_location_contacts").select("location_id,poc_name,poc_mobile").eq("company_id", companyId),
    loadMainDashboardStations(companyId),
    loadMainDashboardHiringManagers(companyId)
  ]);
  if (locations.error) throw new Error(locations.error.message);
  if (contacts.error) throw new Error(contacts.error.message);
  const contactByLocation = new Map((contacts.data ?? []).map((item) => [item.location_id, item]));
  const recruitmentByCode = new Map((locations.data ?? []).map((item) => [normalizeDaStation(item.code), item]));
  const details = new Map<string, { code: string; name: string; cluster: string; crmName: string; crmEmail: string; pocName: string; pocMobile: string }>();
  for (const station of mainStations) {
    const code = normalizeDaStation(station.code);
    const recruitment = recruitmentByCode.get(code);
    const contact = recruitment ? contactByLocation.get(recruitment.id) : null;
    const crm = managers.find((manager) =>
      ["CRM", "CLM", "CLUSTER_MANAGER", "CLUSTER_RECRUITMENT_MANAGER"].includes(clean(manager.roleCode).toUpperCase())
      && manager.locationScopeIds.includes(station.id)
    ) ?? defaultHiringManagerFor(station, "DA", managers);
    details.set(code, {
      code,
      name: clean(station.name || recruitment?.name || code),
      cluster: clean(station.cluster || recruitment?.cluster),
      crmName: clean(crm?.name || station.managerName),
      crmEmail: clean(crm?.email || station.managerEmail),
      pocName: clean(contact?.poc_name || recruitment?.poc_name),
      pocMobile: clean(contact?.poc_mobile || recruitment?.poc_mobile)
    });
  }
  for (const recruitment of locations.data ?? []) {
    const code = normalizeDaStation(recruitment.code);
    if (details.has(code)) continue;
    const contact = contactByLocation.get(recruitment.id);
    details.set(code, {
      code,
      name: clean(recruitment.name || code),
      cluster: clean(recruitment.cluster),
      crmName: "",
      crmEmail: "",
      pocName: clean(contact?.poc_name || recruitment.poc_name),
      pocMobile: clean(contact?.poc_mobile || recruitment.poc_mobile)
    });
  }
  return details;
}

async function latestRows(companyId: string) {
  // Include legacy/generic batches whose filename identifies the DA report.
  // Classification used to happen only by the exact source code, which meant a
  // newly uploaded file could be ignored while an older DA batch stayed live.
  const batchColumns = "id,source_type,file_name,status,message,report_from,report_to,row_count,imported_row_count,skipped_row_count,created_at";
  const [typedBatches, filenameBatches] = await Promise.all([
    supabaseAdmin!.from("report_import_batches")
      .select(batchColumns)
      .eq("company_id", companyId)
      .in("source_type", [...DA_INAPP_SOURCE_ALIASES])
      .order("created_at", { ascending: false })
      .limit(100),
    supabaseAdmin!.from("report_import_batches")
      .select(batchColumns)
      .eq("company_id", companyId)
      .ilike("file_name", "%onboard%")
      .order("created_at", { ascending: false })
      .limit(100)
  ]);
  if (typedBatches.error) throw new Error(typedBatches.error.message);
  if (filenameBatches.error) throw new Error(filenameBatches.error.message);
  const batchRows = [...new Map(
    [...(typedBatches.data ?? []), ...(filenameBatches.data ?? [])]
      .filter((batch) => isDaInAppBatch(batch as DaBatch))
      .map((batch) => [batch.id, batch as DaBatch])
  ).values()];
  if (!batchRows.length) return { batch: null as DaBatch | null, rows: [] as DaImportRow[] };
  const rows = await supabaseAdmin!.from("report_import_rows")
    .select("id,batch_id,source_type,station_code,work_date,raw_data,normalized_data,created_at")
    .eq("company_id", companyId)
    .in("batch_id", batchRows.map((batch) => batch.id))
    .order("created_at", { ascending: false })
    .limit(20000);
  if (rows.error) throw new Error(rows.error.message);
  const latest = latestDaInAppBatch(batchRows, (rows.data ?? []) as DaImportRow[]);
  return {
    batch: latest.batch,
    rows: latest.batch ? carryForwardDaOperations(latest.rows, latest.historyRows) : []
  };
}

async function loadOwnershipMaps(companyId: string): Promise<DaOwnershipMaps> {
  const executives = await supabaseAdmin!.from(WORKFORCE_PROFILE_TABLE)
    .select("id,created_by,full_name,email,mobile,dropx_id,biometric_id,location_id,stations(station_code)")
    .eq("company_id", companyId);
  if (executives.error) throw new Error(executives.error.message);
  const rows = executives.data ?? [];
  const ids = rows.map((item) => item.id);
  const mappings = ids.length
    ? await supabaseAdmin!.from("field_executive_provider_mappings")
        .select("field_executive_id,provider_member_id")
        .in("field_executive_id", ids)
    : { data: [], error: null };
  if (mappings.error) throw new Error(mappings.error.message);
  const maps: DaOwnershipMaps = {
    stableOwners: new Map(),
    contactOwners: new Map(),
    fallbackOwners: new Map(),
    stableStations: new Map(),
    contactStations: new Map(),
    fallbackStations: new Map()
  };
  const executiveDetails = new Map<string, { owner: string; station: string }>();
  for (const item of rows) {
    const relatedStation = Array.isArray(item.stations) ? item.stations[0] : item.stations;
    const station = normalizeDaStation(relatedStation?.station_code);
    const owner = clean(item.created_by);
    executiveDetails.set(item.id, { owner, station });
    addDaOwner(maps.stableOwners, item.dropx_id, item.created_by);
    addDaOwner(maps.stableOwners, item.biometric_id, item.created_by);
    addDaOwner(maps.contactOwners, item.email, item.created_by);
    addDaOwner(maps.contactOwners, item.mobile, item.created_by);
    addDaStation(maps.stableStations!, item.dropx_id, station);
    addDaStation(maps.stableStations!, item.biometric_id, station);
    addDaStation(maps.contactStations!, item.email, station);
    addDaStation(maps.contactStations!, item.mobile, station);
    const digits = normalizeDaIdentity(item.mobile).replace(/\D/g, "");
    if (digits) {
      addDaOwner(maps.contactOwners, digits.slice(-10), item.created_by);
      addDaStation(maps.contactStations!, digits.slice(-10), station);
    }
    for (const candidate of daFallbackOwnershipCandidates(item.email, item.full_name)) {
      addDaOwner(maps.fallbackOwners!, candidate, item.created_by);
      addDaStation(maps.fallbackStations!, candidate, station);
    }
  }
  for (const item of mappings.data ?? []) {
    const details = executiveDetails.get(item.field_executive_id);
    addDaOwner(maps.stableOwners, item.provider_member_id, details?.owner);
    addDaStation(maps.stableStations!, item.provider_member_id, details?.station);
  }
  return maps;
}

async function signedCertificate(certificate: Record<string, unknown> | null) {
  const bucket = clean(certificate?.storage_bucket);
  const path = clean(certificate?.storage_path);
  if (!bucket || !path) return null;
  const result = await supabaseAdmin!.storage.from(bucket).createSignedUrl(path, 15 * 60);
  return result.error ? null : result.data.signedUrl;
}

async function updaterNames(companyId: string, profileIds: string[]) {
  const ids = [...new Set(profileIds.filter(Boolean))];
  if (!ids.length) return new Map<string, string>();
  const profiles = await supabaseAdmin!.from("profiles").select("id,full_name,email").eq("company_id", companyId).in("id", ids);
  if (profiles.error) throw new Error(profiles.error.message);
  return new Map((profiles.data ?? []).map((profile) => [profile.id, clean(profile.full_name || profile.email || profile.id)]));
}

export async function GET(request: Request) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase is not configured.");
    const session = await recruitmentSession(request);
    if (!session || !canUseRecruitmentMenu(session, "DA In-app Onboarding", "view", "workforce")) {
      return NextResponse.json({ error: "DA In-app Onboarding access is required." }, { status: 403 });
    }
    const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
    const url = new URL(request.url);
    const status = clean(url.searchParams.get("status")) || "pending";
    const selectedStations = new Set(clean(url.searchParams.get("station")).split(",").map(normalizeDaStation).filter(Boolean));
    const selectedClusters = new Set(clean(url.searchParams.get("cluster")).split(",").map((item) => item.trim().toLowerCase()).filter(Boolean));
    const sort = clean(url.searchParams.get("sort")) || "oldest";
    const search = clean(url.searchParams.get("search")).toLowerCase();
    const page = Math.max(1, Number(url.searchParams.get("page") || 1));
    const visibility = resolveDaVisibility(session);
    const [latest, ownership, permitted, systemStations] = await Promise.all([
      latestRows(companyId),
      loadOwnershipMaps(companyId),
      visibility === "permitted_locations" ? allowedStations(companyId, session) : Promise.resolve([] as string[]),
      systemStationDetails(companyId)
    ]);
    const latestBatch = latest.batch;
    const parsed = latestBatch
      ? latest.rows.map((row) => {
          const parsedRow = parseDaInAppRecord(row, latestBatch);
          const fallbackCandidates = daFallbackOwnershipCandidates(parsedRow.rabbitId, parsedRow.daName);
          const stationCode = parsedRow.station || daStationForOwnership(parsedRow.identityCandidates, ownership, fallbackCandidates);
          const station = systemStations.get(stationCode);
          return {
            ...parsedRow,
            station: stationCode,
            stationName: station?.name || stationCode || "Unmapped",
            cluster: station?.cluster || "Unmapped",
            crmName: station?.crmName || "",
            crmEmail: station?.crmEmail || "",
            contact: resolveDaContact(parsedRow.candidatePhone, station ? { pocName: station.pocName, pocMobile: station.pocMobile } : null),
            ownershipStatus: daOwnershipStatus(parsedRow.identityCandidates, ownership, fallbackCandidates)
          };
        })
      : [];
    const accessibleBase = parsed
      .filter((row) => visibility !== "permitted_locations" || (row.station ? permitted.includes(row.station) : session.allLocations))
      .filter((row) => visibility !== "mine" || canOwnerAccessDaRecord(
        session.profileId,
        row.identityCandidates,
        ownership,
        daFallbackOwnershipCandidates(row.rabbitId, row.daName)
      ));
    const updatedByName = await updaterNames(companyId, accessibleBase.map((row) => row.updatedById));
    const accessible = accessibleBase.map((row) => ({ ...row, updatedBy: updatedByName.get(row.updatedById) || row.updatedBy }));
    const filtered = accessible.filter((row) => {
      if (status !== "all" && row.clearanceStatus !== status) return false;
      if (selectedStations.size && !selectedStations.has(row.station)) return false;
      if (selectedClusters.size && !selectedClusters.has(row.cluster.toLowerCase())) return false;
      if (search && !`${row.daName} ${row.rabbitId} ${row.transporterId} ${row.station} ${row.stationName} ${row.cluster} ${row.crmName} ${row.contact.phone} ${row.sourceReason}`.toLowerCase().includes(search)) return false;
      return true;
    });
    const sorted = sortDaRecords(filtered, sort);
    const limit = 100;
    const visible = sorted.slice((page - 1) * limit, page * limit);
    const records = await Promise.all(visible.map(async (row) => ({
      ...row,
      certificateUrl: await signedCertificate(row.certificate)
    })));
    const pending = accessible.filter((row) => row.clearanceStatus === "pending");
    return NextResponse.json({
      records,
      total: filtered.length,
      page,
      source: latestBatch ? {
        fileName: latestBatch.file_name,
        uploadedAt: latestBatch.created_at,
        importedCases: parsed.length,
        status: latestBatch.status || "Completed",
        message: latestBatch.message || "",
        sourceType: latestBatch.source_type,
        reportedRows: Number(latestBatch.row_count ?? latestBatch.imported_row_count ?? parsed.length),
        skippedRows: Number(latestBatch.skipped_row_count ?? 0)
      } : null,
      metrics: {
        pending: pending.length,
        cleared: accessible.filter((row) => row.clearanceStatus === "cleared").length,
        videoPending: accessible.filter((row) => row.videoStatus === "pending").length,
        nhda: accessible.filter((row) => row.dependency === "nhda").length,
        nsta: accessible.filter((row) => row.dependency === "nhda").length,
        oldestPending: pending.length ? Math.max(...pending.map((row) => row.agingDays)) : 0,
        missingContact: accessible.filter((row) => row.contact.source === "missing").length,
        unmatched: accessible.filter((row) => row.ownershipStatus === "unmatched").length,
        ambiguous: accessible.filter((row) => row.ownershipStatus === "ambiguous").length
      },
      stations: [...new Set(accessible.map((row) => row.station).filter(Boolean))].sort(),
      stationOptions: [...new Map(accessible.filter((row) => row.station).map((row) => [row.station, { code: row.station, name: row.stationName, cluster: row.cluster }])).values()].sort((left, right) => left.code.localeCompare(right.code)),
      clusters: [...new Set(accessible.map((row) => row.cluster).filter((item) => item && item !== "Unmapped"))].sort(),
      sort,
      visibility,
      scope: visibility === "mine" ? "mine" : visibility === "all" ? "all" : "permitted",
      canViewTeam: visibility !== "mine",
      canViewAll: visibility === "all"
    });
  } catch (error) {
    console.error("DA In-App onboarding load failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load DA In-App onboarding." }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase is not configured.");
    const session = await recruitmentSession(request);
    if (!session || !canUseRecruitmentMenu(session, "DA In-app Onboarding", "edit", "workforce")) {
      return NextResponse.json({ error: "Edit access is required." }, { status: 403 });
    }
    const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
    const form = await request.formData();
    const id = clean(form.get("id"));
    const videoStatus = clean(form.get("videoStatus"));
    let subStatus = clean(form.get("subStatus"));
    const remarks = clean(form.get("remarks")).slice(0, 1000);
    if (!id) throw new Error("Choose a DA In-App onboarding record.");
    const existing = await supabaseAdmin.from("report_import_rows")
      .select("id,batch_id,source_type,station_code,work_date,raw_data,normalized_data,created_at")
      .eq("company_id", companyId)
      .eq("id", id)
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    if (!existing.data) throw new Error("DA In-App onboarding record was not found.");
    const row = existing.data as DaImportRow;
    const batchResult = await supabaseAdmin.from("report_import_batches")
      .select("id,source_type,file_name,report_to,created_at")
      .eq("company_id", companyId)
      .eq("id", row.batch_id)
      .maybeSingle();
    if (batchResult.error) throw new Error(batchResult.error.message);
    if (!batchResult.data || !isDaInAppBatch(batchResult.data as DaBatch)) {
      throw new Error("DA In-App onboarding record was not found.");
    }
    const parsedRecord = parseDaInAppRecord(row, batchResult.data as DaBatch);
    const dependency = parsedRecord.dependency;
    if (dependency === "video_verification") subStatus = videoStatus === "done" ? "completed" : "pending";
    const ownership = await loadOwnershipMaps(companyId);
    const fallbackCandidates = daFallbackOwnershipCandidates(parsedRecord.rabbitId, parsedRecord.daName);
    const station = normalizeDaStation(row.station_code || findDaValue(row.raw_data ?? {}, ["station code", "station_code", "station", "location code"]))
      || daStationForOwnership(parsedRecord.identityCandidates, ownership, fallbackCandidates);
    const visibility = resolveDaVisibility(session);
    if (visibility === "mine") {
      if (!canOwnerAccessDaRecord(session.profileId, parsedRecord.identityCandidates, ownership, fallbackCandidates)) {
        throw new Error("This DA was not initiated by your login.");
      }
    } else if (visibility === "permitted_locations") {
      const permitted = await allowedStations(companyId, session);
      if ((station && !permitted.includes(station)) || (!station && !session.allLocations)) {
        throw new Error("This station is outside your access.");
      }
    }
    const normalized = row.normalized_data && typeof row.normalized_data === "object" ? row.normalized_data : {};
    let certificate = normalized.ops_nhda_certificate ?? normalized.ops_nsda_certificate ?? normalized.ops_nsta_certificate ?? null;
    const file = form.get("certificate");
    const pendingCertificate = file instanceof File && file.size > 0;
    const validation = validateDaUpdate({
      dependency,
      subStatus,
      videoStatus,
      hasCertificate: Boolean(certificate || pendingCertificate)
    });
    if (validation) throw new Error(validation);
    if (pendingCertificate) {
      if (dependency !== "nhda") throw new Error("An NHDA certificate can only be attached to an NHDA course action.");
      if (file.size > 10 * 1024 * 1024) throw new Error("NHDA certificate must be 10 MB or smaller.");
      if (!/\.(pdf|png|jpe?g)$/i.test(file.name)) throw new Error("Upload the NHDA certificate as PDF, PNG, JPG, or JPEG.");
      const uploaded = await uploadRecruitmentDocument({
        companyId,
        leadId: `da-inapp-${id}`,
        documentType: "nhda-certificate",
        fileName: file.name,
        contentType: file.type || "application/octet-stream",
        bytes: await file.arrayBuffer()
      });
      certificate = { file_name: uploaded.name, storage_bucket: "recruitment-documents", storage_path: uploaded.path };
    }
    const updatedAt = new Date().toISOString();
    const clearanceStatus = daActionIsComplete(dependency, subStatus) ? "cleared" : "pending";
    const result = await supabaseAdmin.from("report_import_rows").update({
      normalized_data: {
        ...normalized,
        ops_action_item: remarks || null,
        ops_remarks: remarks || null,
        ops_dependency: dependency,
        ops_sub_status: subStatus,
        ops_clearance_status: clearanceStatus,
        ops_video_verification_status: videoStatus,
        ops_nhda_certificate: certificate,
        ops_cleared_at: clearanceStatus === "cleared" ? updatedAt : null,
        ops_updated_by: session.profileId,
        ops_updated_by_email: session.email,
        ops_updated_at: updatedAt
      }
    }).eq("company_id", companyId).eq("id", id);
    if (result.error) throw new Error(result.error.message);
    return NextResponse.json({ message: "DA In-App onboarding status updated." });
  } catch (error) {
    console.error("DA In-App onboarding update failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to update DA In-App onboarding." }, { status: 400 });
  }
}
