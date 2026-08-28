import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { fieldContactResult, normalizeFieldCandidatePhone } from "@/lib/field-candidate-source";
import { fieldDutyViewerScope } from "@/lib/field-duty-access";
import { assignedLocationAllowed, lockedFieldDutyLocation, normalizeFieldHotspots } from "@/lib/field-duty-location";
import { classifyFieldPointBatch } from "@/lib/field-point-ingestion";
import { fieldPointForEvaluation } from "@/lib/field-point-persistence";
import { calculateFieldRouteMetrics, fieldPointCoordinatesAreValid, fieldTrackingPointIsUsable } from "@/lib/field-route";
import { fieldDutyAttendance } from "@/lib/manual-punch";
import { canUseRecruitmentMenu, recruitmentSession, requiredEnv } from "@/lib/recruitment-api";
import { loadWorkforceConfig } from "@/lib/recruitment-workforce-config";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { loadAllSupabaseRows } from "@/lib/supabase-pagination";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const istDay = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit"
}).format(new Date());
const finite = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : null;
const validDay = (value: string | null, fallback: string) => /^\d{4}-\d{2}-\d{2}$/.test(value ?? "") ? String(value) : fallback;
const chunks = <T,>(values:T[], size=300) => Array.from({length:Math.ceil(values.length/size)},(_,index)=>values.slice(index*size,index*size+size));

function dutyWithLiveMetrics(duty: any, points: any[]) {
  const metrics = calculateFieldRouteMetrics(points);
  return {
    ...duty,
    // Maps and distance cards use only the server-accepted route. Raw points
    // remain in the audit table and are never presented as official movement.
    points: metrics.acceptedPoints,
    distance_meters: metrics.distanceMeters,
    raw_distance_meters: metrics.rawDistanceMeters,
    accepted_distance_meters: metrics.distanceMeters,
    gps_point_count: metrics.validPointCount,
    gps_total_point_count: metrics.totalPointCount,
    gps_coverage_percent: metrics.coveragePercent,
    gps_confidence_percent: metrics.confidencePercent,
    gps_stationary_point_count: metrics.stationaryPointCount,
    gps_rejected_segment_count: metrics.rejectedSegmentCount,
    stationary_duration_seconds: metrics.stationaryDurationSeconds,
    stops: metrics.stops,
    tracking_algorithm_version: metrics.algorithmVersion,
    last_gps_at: metrics.lastPointAt
  };
}

function pointHash(previousHash: string, dutyId: string, point: any) {
  return createHash("sha256").update([
    previousHash,
    dutyId,
    String(point.sequence ?? ""),
    String(point.recorded_at ?? point.recordedAt ?? ""),
    String(point.latitude ?? ""),
    String(point.longitude ?? ""),
    String(point.accuracy_meters ?? point.accuracy ?? ""),
    String(point.speed_mps ?? point.speed ?? ""),
    String(Boolean(point.is_mocked ?? point.isMocked))
  ].join("|")).digest("hex");
}

function evaluatedPointRows(companyId: string, dutyId: string, points: any[], metrics: ReturnType<typeof calculateFieldRouteMetrics>) {
  let previousHash = "DROPX_ROUTE_V2";
  return points.map((point, index) => {
    const evaluation = metrics.evaluations[index];
    const hash = pointHash(previousHash, dutyId, point);
    const row = {
      ...fieldPointForEvaluation(point),
      company_id: companyId,
      duty_id: dutyId,
      previous_hash: previousHash,
      point_hash: hash,
      quality_class: evaluation?.quality ?? "unusable",
      decision: evaluation?.decision ?? "rejected",
      motion_state: evaluation?.motionState ?? "gps_degraded",
      rejection_codes: evaluation?.rejectionCodes ?? ["evaluation_missing"],
      accepted_distance_meters: evaluation?.acceptedDistanceMeters ?? 0,
      algorithm_version: metrics.algorithmVersion
    };
    previousHash = hash;
    return row;
  });
}

async function persistRouteEvaluation(companyId: string, dutyId: string, points: any[], metrics: ReturnType<typeof calculateFieldRouteMetrics>, now: string) {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  if (points.length) {
    const evaluated = await supabaseAdmin.from("recruitment_field_location_points")
      .upsert(evaluatedPointRows(companyId, dutyId, points, metrics), { onConflict: "duty_id,recorded_at" });
    if (evaluated.error) throw evaluated.error;
  }
  const riskScore = Math.min(100, metrics.mockedPointCount * 40 + metrics.rejectedSegmentCount * 10 + metrics.weakPointCount * 2);
  const updated = await supabaseAdmin.from("recruitment_field_duties").update({
    distance_meters: metrics.distanceMeters,
    raw_distance_meters: metrics.rawDistanceMeters,
    accepted_distance_meters: metrics.distanceMeters,
    gps_point_count: metrics.validPointCount,
    gps_coverage_percent: metrics.coveragePercent,
    gps_confidence_percent: metrics.confidencePercent,
    gps_stationary_point_count: metrics.stationaryPointCount,
    tracking_algorithm_version: metrics.algorithmVersion,
    tracking_review_status: riskScore >= 40 ? "review_required" : "auto_approved",
    integrity_risk_score: riskScore,
    updated_at: now
  }).eq("company_id", companyId).eq("id", dutyId);
  if (updated.error) throw updated.error;
}

async function dutyDetail(companyId: string, dutyId: string) {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  const [duty, contacts, visits, points] = await Promise.all([
    supabaseAdmin.from("recruitment_field_duties")
      .select("*,profiles!recruitment_field_duties_recruiter_profile_id_fkey(full_name,email)")
      .eq("company_id", companyId).eq("id", dutyId).single(),
    supabaseAdmin.from("recruitment_field_contacts")
      .select("*,recruitment_locations(code,name),recruitment_roles(code,name)")
      .eq("company_id", companyId).eq("duty_id", dutyId).order("created_at"),
    supabaseAdmin.from("recruitment_field_visits")
      .select("*,recruitment_locations(code,name)")
      .eq("company_id", companyId).eq("duty_id", dutyId).order("started_at"),
    supabaseAdmin.from("recruitment_field_location_points")
      .select("id,sequence,recorded_at,latitude,longitude,accuracy_meters,speed_mps,is_mocked,altitude_meters,speed_accuracy_mps,heading_degrees,heading_accuracy_degrees,provider,activity_type,activity_confidence,battery_percent,is_charging,app_version,platform")
      .eq("company_id", companyId).eq("duty_id", dutyId).order("recorded_at")
  ]);
  const error = duty.error ?? contacts.error ?? visits.error ?? points.error;
  if (error) throw error;
  return dutyWithLiveMetrics({ ...duty.data, contacts: contacts.data ?? [], visits: visits.data ?? [] }, points.data ?? []);
}

export async function GET(request: Request) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase is not configured.");
    const session = await recruitmentSession(request);
    if (!session || (!canUseRecruitmentMenu(session, "Field Recruitment", "view", "workforce")
      && !canUseRecruitmentMenu(session, "Performance Center", "view", "workforce"))) {
      return NextResponse.json({ error: "Field Recruitment view access is required." }, { status: 403 });
    }
    const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
    const url = new URL(request.url);
    const day = validDay(url.searchParams.get("date"), istDay());
    const rangeRequested = url.searchParams.has("from") || url.searchParams.has("to");

    if (session.recruitmentFunction !== "field_recruiter" || rangeRequested) {
      const from = validDay(url.searchParams.get("from"), day);
      const to = validDay(url.searchParams.get("to"), day);
      if (from > to || (new Date(`${to}T00:00:00Z`).getTime()-new Date(`${from}T00:00:00Z`).getTime())/86_400_000 > 366) {
        return NextResponse.json({ error:"Choose a valid field-performance period of up to 366 days." }, { status:400 });
      }
      const fullScope = canUseRecruitmentMenu(session, "Field Recruitment", "all", "workforce")
        || canUseRecruitmentMenu(session, "Performance Center", "all", "workforce");
      const workforceConfig = await loadWorkforceConfig(companyId);
      const viewerScope = fieldDutyViewerScope({
        profileId: session.profileId,
        functionName: session.recruitmentFunction,
        fullScope,
        configuredUsers: workforceConfig.userFunctions
      });
      const visibleProfileIds = viewerScope.profileIds;
      const dutyQuery = () => {
        let query = supabaseAdmin!.from("recruitment_field_duties")
          .select("*,profiles!recruitment_field_duties_recruiter_profile_id_fkey(full_name,email)")
          .eq("company_id", companyId).gte("duty_date", from).lte("duty_date", to);
        if (viewerScope.visibility !== "all") {
          query = visibleProfileIds.length
            ? query.in("recruiter_profile_id", visibleProfileIds)
            : query.eq("recruiter_profile_id", "00000000-0000-0000-0000-000000000000");
        }
        return query;
      };
      const duties = await loadAllSupabaseRows<any>((pageFrom,pageTo)=>dutyQuery()
        .order("duty_date", { ascending:false }).order("started_at", { ascending:false })
        .order("id", { ascending:false }).range(pageFrom,pageTo) as any);
      const ids = duties.map((item) => item.id);
      const idGroups=chunks(ids);
      const [contactGroups,visitGroups,pointGroups]=ids.length?await Promise.all([
        Promise.all(idGroups.map((dutyIds)=>loadAllSupabaseRows<any>((pageFrom,pageTo)=>supabaseAdmin!.from("recruitment_field_contacts")
          .select("*,recruitment_locations(code,name),recruitment_roles(code,name)")
          .eq("company_id",companyId).in("duty_id",dutyIds).order("created_at").order("id").range(pageFrom,pageTo) as any))),
        Promise.all(idGroups.map((dutyIds)=>loadAllSupabaseRows<any>((pageFrom,pageTo)=>supabaseAdmin!.from("recruitment_field_visits")
          .select("*,recruitment_locations(code,name)")
          .eq("company_id",companyId).in("duty_id",dutyIds).order("started_at").order("id").range(pageFrom,pageTo) as any))),
        Promise.all(idGroups.map((dutyIds)=>loadAllSupabaseRows<any>((pageFrom,pageTo)=>supabaseAdmin!.from("recruitment_field_location_points")
          .select("id,duty_id,sequence,recorded_at,latitude,longitude,accuracy_meters,speed_mps,is_mocked,quality_class,decision,motion_state,rejection_codes,accepted_distance_meters,algorithm_version")
          .eq("company_id",companyId).in("duty_id",dutyIds).order("recorded_at").order("id").range(pageFrom,pageTo) as any)))
      ]):[[],[],[]];
      const contacts=contactGroups.flat();
      const visits=visitGroups.flat();
      const points=pointGroups.flat();
      const byDuty = new Map<string, any[]>();
      for (const item of contacts) byDuty.set(item.duty_id, [...(byDuty.get(item.duty_id) ?? []), item]);
      const visitsByDuty = new Map<string, any[]>();
      for (const item of visits) visitsByDuty.set(item.duty_id, [...(visitsByDuty.get(item.duty_id) ?? []), item]);
      const pointsByDuty = new Map<string, any[]>();
      for (const item of points) pointsByDuty.set(item.duty_id, [...(pointsByDuty.get(item.duty_id) ?? []), item]);
      const configuredRecruiterIds = Object.entries(workforceConfig.userFunctions)
        .filter(([, item]) => item.function === "field_recruiter")
        .map(([profileId]) => profileId)
        .filter((profileId) => viewerScope.visibility === "all" || visibleProfileIds.includes(profileId));
      const recruiterProfiles = configuredRecruiterIds.length
        ? await supabaseAdmin.from("profiles").select("id,full_name,email").in("id", configuredRecruiterIds)
        : { data: [], error: null };
      if (recruiterProfiles.error) throw recruiterProfiles.error;
      return NextResponse.json({
        from, to,
        visibility: viewerScope.visibility,
        readOnly: true,
        recruiters: recruiterProfiles.data ?? [],
        duties: duties.map((item) => dutyWithLiveMetrics({
          ...item,
          contacts: byDuty.get(item.id) ?? [],
          visits: visitsByDuty.get(item.id) ?? [],
        }, pointsByDuty.get(item.id) ?? []))
      });
    }

    const current = await supabaseAdmin.from("recruitment_field_duties")
      .select("id,started_at").eq("company_id", companyId).eq("recruiter_profile_id", session.profileId)
      .eq("duty_date", day).maybeSingle();
    if (current.error) throw current.error;
    const locationQuery = supabaseAdmin.from("recruitment_locations").select("id,code,name,latitude,longitude")
      .eq("company_id", companyId).eq("is_active", true).order("code");
    const [locations, roles] = await Promise.all([
      locationQuery,
      supabaseAdmin.from("recruitment_roles").select("id,code,name")
        .eq("company_id", companyId).eq("stream", "workforce").eq("is_active", true).order("code")
    ]);
    if (locations.error || roles.error) throw locations.error ?? roles.error;
    const attendance = await fieldDutyAttendance(companyId, session.profileId, day, current.data?.started_at);
    return NextResponse.json({
      date: day,
      attendance,
      duty: current.data ? await dutyDetail(companyId, current.data.id) : null,
      locations: locations.data ?? [],
      roles: roles.data ?? []
    });
  } catch (error) {
    console.error("Field duty read failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load field duty." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase is not configured.");
    const session = await recruitmentSession(request);
    if (!session || session.readOnly || session.isPreview || session.recruitmentFunction !== "field_recruiter"
      || !canUseRecruitmentMenu(session, "Field Recruitment", "add", "workforce")) {
      return NextResponse.json({ error: "Only the signed-in field recruiter can update field duty." }, { status: 403 });
    }
    const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
    const body = await request.json();
    const action = String(body.action ?? "");
    const now = new Date().toISOString();

    if (action === "start") {
      const recordedAt = String(body.recordedAt ?? now);
      if (!fieldTrackingPointIsUsable({
        recordedAt,
        latitude: body.latitude,
        longitude: body.longitude,
        accuracy: body.accuracy,
        speed: body.speed,
        isMocked: body.isMocked
      }, { nowMs: Date.now(), maximumAgeMs: 10_000, maximumAccuracyMeters: 25 })) {
        return NextResponse.json({
          error: Boolean(body.isMocked)
            ? "Mock location is not allowed. Turn off the mock-location app and retry."
            : "A fresh GPS fix with 25 metre accuracy or better is required to start field duty. Move to an open area and retry."
        }, { status: 400 });
      }
      const existing = await supabaseAdmin.from("recruitment_field_duties")
        .select("id").eq("company_id", companyId)
        .eq("recruiter_profile_id", session.profileId)
        .eq("duty_date", istDay()).maybeSingle();
      if (existing.error) throw existing.error;
      if (existing.data) {
        return NextResponse.json({ duty: await dutyDetail(companyId, existing.data.id) });
      }
      const attendance = await fieldDutyAttendance(companyId, session.profileId, istDay());
      if (!attendance.verified || !attendance.punchInAt) {
        return NextResponse.json({
          error: attendance.manualRequest?.status === "pending"
            ? "Your manual punch request is waiting for approval."
            : "Biometric punch-in or an approved manual punch is required before field duty can start."
        }, { status: 409 });
      }
      if (!attendance.dutyLocation) {
        return NextResponse.json({
          error: attendance.dutyLocationError || "The verified IN punch has no approved duty location. Ask your manager to map the biometric device or review the manual IN location."
        }, { status: 409 });
      }
      const result = await supabaseAdmin.from("recruitment_field_duties").insert({
        company_id: companyId,
        recruiter_profile_id: session.profileId,
        duty_date: istDay(),
        punch_in_at: attendance.punchInAt,
        punch_in_source: attendance.source,
        started_at: now,
        status: "active",
        start_latitude: finite(body.latitude),
        start_longitude: finite(body.longitude),
        primary_location_id: attendance.dutyLocation.recruitmentLocationId,
        primary_station_id: attendance.dutyLocation.stationId,
        primary_location_code: attendance.dutyLocation.code,
        primary_location_name: attendance.dutyLocation.name,
        primary_location_source: attendance.dutyLocation.source,
        primary_location_latitude: attendance.dutyLocation.latitude,
        primary_location_longitude: attendance.dutyLocation.longitude,
        punch_in_device_serial: attendance.dutyLocation.deviceSerial,
        punch_in_request_id: attendance.dutyLocation.manualRequestId,
        updated_at: now
      }).select("id").single();
      if (result.error) throw result.error;
      if (fieldPointCoordinatesAreValid(body.latitude, body.longitude)) {
        const initialPoint = await supabaseAdmin.from("recruitment_field_location_points").upsert({
          company_id: companyId,
          duty_id: result.data.id,
          recorded_at: recordedAt,
          latitude: finite(body.latitude),
          longitude: finite(body.longitude),
          accuracy_meters: finite(body.accuracy),
          speed_mps: finite(body.speed),
          is_mocked: Boolean(body.isMocked),
          // Client sequence is intentionally not persisted. It can restart
          // after Android recreates the process and is therefore unsuitable
          // as a database uniqueness key.
          sequence: null,
          monotonic_ms: finite(body.monotonicMs),
          altitude_meters: finite(body.altitude),
          speed_accuracy_mps: finite(body.speedAccuracy),
          heading_degrees: finite(body.heading),
          heading_accuracy_degrees: finite(body.headingAccuracy),
          provider: String(body.provider ?? "").trim() || null,
          activity_type: String(body.activityType ?? "").trim() || null,
          activity_confidence: finite(body.activityConfidence),
          battery_percent: finite(body.batteryPercent),
          is_charging: typeof body.isCharging === "boolean" ? body.isCharging : null,
          app_version: String(body.appVersion ?? "").trim() || null,
          platform: String(body.platform ?? "").trim() || null
        }, { onConflict: "duty_id,recorded_at", ignoreDuplicates: true });
        if (initialPoint.error) throw initialPoint.error;
      }
      return NextResponse.json({ duty: await dutyDetail(companyId, result.data.id) });
    }

    const dutyId = String(body.dutyId ?? "");
    const owned = await supabaseAdmin.from("recruitment_field_duties")
      .select("id,status,started_at,ended_at,punch_out_at,punch_in_at,primary_location_id,primary_location_name,primary_location_code")
      .eq("company_id", companyId).eq("id", dutyId)
      .eq("recruiter_profile_id", session.profileId).single();
    if (owned.error || !owned.data) return NextResponse.json({ error: "Duty session was not found." }, { status: 404 });
    if (action === "points") {
      const earliestAllowed = Date.parse(owned.data.started_at) - 5 * 60_000;
      const latestAllowed = owned.data.status === "active"
        ? Date.now() + 10 * 60_000
        : Date.parse(String(owned.data.ended_at ?? owned.data.punch_out_at ?? owned.data.started_at)) + 5 * 60_000;
      const classified = classifyFieldPointBatch(Array.isArray(body.points) ? body.points : [], {
        companyId,
        dutyId,
        earliestAllowedMs: earliestAllowed,
        latestAllowedMs: latestAllowed
      });
      const points = classified.accepted.map((point) => point.row);
      if (points.length) {
        const saved = await supabaseAdmin.from("recruitment_field_location_points")
          .upsert(points, { onConflict: "duty_id,recorded_at", ignoreDuplicates: true });
        if (saved.error) throw saved.error;
      }
      const stored = await supabaseAdmin.from("recruitment_field_location_points")
        .select("id,sequence,recorded_at,latitude,longitude,accuracy_meters,speed_mps,is_mocked,monotonic_ms,altitude_meters,speed_accuracy_mps,heading_degrees,heading_accuracy_degrees,provider,activity_type,activity_confidence,battery_percent,is_charging,app_version,platform")
        .eq("company_id", companyId).eq("duty_id", dutyId).order("recorded_at");
      if (stored.error) throw stored.error;
      const metrics = calculateFieldRouteMetrics(stored.data ?? []);
      await persistRouteEvaluation(companyId, dutyId, stored.data ?? [], metrics, now);
      return NextResponse.json({
        received: points.length,
        accepted: metrics.acceptedPointCount,
        acknowledgedPointIds: classified.acknowledgedPointIds,
        rejectedPointIds: classified.rejectedPointIds,
        rejectionReasons: classified.rejectionReasons,
        metrics: {
          distanceMeters: metrics.distanceMeters,
          rawDistanceMeters: metrics.rawDistanceMeters,
          validPointCount: metrics.validPointCount,
          acceptedPointCount: metrics.acceptedPointCount,
          totalPointCount: metrics.totalPointCount,
          coveragePercent: metrics.coveragePercent,
          confidencePercent: metrics.confidencePercent,
          stationaryPointCount: metrics.stationaryPointCount,
          stationaryDurationSeconds: metrics.stationaryDurationSeconds,
          stops: metrics.stops,
          rejectedSegmentCount: metrics.rejectedSegmentCount,
          lastPointAt: metrics.lastPointAt,
          algorithmVersion: metrics.algorithmVersion,
          acceptedPoints: metrics.acceptedPoints,
          routeSegments: metrics.routeSegments
        }
      });
    }

    if (owned.data.status !== "active") return NextResponse.json({ error: "This duty is already closed." }, { status: 409 });
    const lockedLocation = lockedFieldDutyLocation(owned.data);

    if (action === "visit") {
      const saved = await supabaseAdmin.from("recruitment_field_visits").insert({
        company_id: companyId, duty_id: dutyId,
        location_id: lockedLocation.locationId,
        location_name: lockedLocation.locationName,
        visit_type: String(body.visitType ?? "field_sourcing"),
        started_at: body.startedAt || now,
        ended_at: body.endedAt || now,
        latitude: finite(body.latitude), longitude: finite(body.longitude),
        notes: String(body.notes ?? "").trim() || null
      }).select("id").single();
      if (saved.error) throw saved.error;
      return NextResponse.json({ visitId: saved.data.id });
    }

    if (action === "contact") {
      const digits = normalizeFieldCandidatePhone(body.phone);
      if (String(body.fullName ?? "").trim().length < 2 || digits.length !== 10) {
        return NextResponse.json({ error: "Enter the person’s name and a valid 10-digit mobile number." }, { status: 400 });
      }
      const roleId = String(body.roleId ?? "").trim();
      const outcome = String(body.outcome ?? "").trim();
      if (!roleId) return NextResponse.json({ error: "Select the role discussed." }, { status: 400 });
      if (!["interested", "follow_up", "interview_scheduled", "not_interested"].includes(outcome)) {
        return NextResponse.json({ error: "Choose a supported contact outcome." }, { status: 400 });
      }
      const role = await supabaseAdmin.from("recruitment_roles").select("id")
        .eq("company_id", companyId).eq("id", roleId).eq("stream", "workforce").eq("is_active", true).maybeSingle();
      if (role.error) throw role.error;
      if (!role.data) return NextResponse.json({ error: "The selected workforce role is no longer active." }, { status: 400 });
      const saved = await supabaseAdmin.rpc("recruitment_create_field_contact_v1", {
        p_company_id: companyId,
        p_duty_id: dutyId,
        p_actor_profile_id: session.profileId,
        p_visit_id: body.visitId || null,
        p_full_name: String(body.fullName).trim(),
        p_normalized_phone: digits,
        p_location_id: lockedLocation.locationId,
        p_role_id: roleId,
        p_vehicle_type: body.vehicleType || null,
        p_rate_card_offered: String(body.rateCardOffered ?? "").trim(),
        p_outcome: outcome,
        p_follow_up_at: body.followUpAt || null,
        p_notes: String(body.notes ?? "").trim(),
        p_latitude: finite(body.latitude),
        p_longitude: finite(body.longitude)
      });
      if (saved.error) throw saved.error;
      const result = fieldContactResult(saved.data);
      if (!result.accepted) {
        return NextResponse.json({ error: result.message, code: result.code }, { status: result.status });
      }
      return NextResponse.json({
        contactId: result.contactId,
        source: "field_sourcing",
        sourceValidated: true,
        message: "Unique field-sourced candidate added."
      });
    }

    if (action === "end") {
      const attendance = await fieldDutyAttendance(companyId, session.profileId, istDay(), owned.data.started_at);
      if (!attendance.punchOutVerified || !attendance.punchOutAt) {
        return NextResponse.json({
          error: attendance.manualOutRequest?.status === "pending"
            ? "Manual OUT is waiting for approval. Duty and GPS tracking remain active."
            : attendance.manualOutRequest?.status === "rejected"
              ? "Manual OUT was rejected. Complete biometric OUT or submit a new manual OUT request."
              : "A later calculated biometric OUT or approved manual OUT is required before duty can be closed.",
          code: "OUT_PUNCH_REQUIRED",
          attendance
        }, { status: 409 });
      }
      const points = await supabaseAdmin.from("recruitment_field_location_points")
        .select("id,sequence,recorded_at,latitude,longitude,accuracy_meters,speed_mps,is_mocked,monotonic_ms,altitude_meters,speed_accuracy_mps,heading_degrees,heading_accuracy_degrees,provider,activity_type,activity_confidence,battery_percent,is_charging,app_version,platform")
        .eq("company_id", companyId).eq("duty_id", dutyId).order("recorded_at");
      const contacts = await supabaseAdmin.from("recruitment_field_contacts")
        .select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("duty_id", dutyId);
      if (points.error || contacts.error) throw points.error ?? contacts.error;
      if (!contacts.count && !String(body.zeroActivityReason ?? "").trim()) {
        return NextResponse.json({ error: "Add at least one person, or explain why no field contacts were recorded." }, { status: 400 });
      }
      const hotspots = normalizeFieldHotspots(body.hotspots);
      if (hotspots.length) {
        const existing = await supabaseAdmin.from("recruitment_field_visits")
          .select("location_name,visit_type").eq("company_id", companyId).eq("duty_id", dutyId)
          .like("visit_type", "hotspot_%");
        if (existing.error) throw existing.error;
        const existingKeys = new Set((existing.data ?? []).map((item) => `${item.visit_type}:${String(item.location_name ?? "").toLowerCase()}`));
        const rows = hotspots.filter((item: { name: string; type: string }) => !existingKeys.has(`hotspot_${item.type}:${item.name.toLowerCase()}`)).map((item: { name: string; type: string }) => ({
          company_id: companyId,
          duty_id: dutyId,
          location_name: item.name,
          visit_type: `hotspot_${item.type}`,
          started_at: now,
          ended_at: now
        }));
        if (rows.length) {
          const hotspotSaved = await supabaseAdmin.from("recruitment_field_visits").insert(rows);
          if (hotspotSaved.error) throw hotspotSaved.error;
        }
      }
      const metrics = calculateFieldRouteMetrics(points.data ?? []);
      await persistRouteEvaluation(companyId, dutyId, points.data ?? [], metrics, now);
      const workedMinutes = Math.max(0, Math.round((Date.parse(attendance.punchOutAt) - Date.parse(owned.data.punch_in_at || owned.data.started_at)) / 60_000));
      const tomorrowLocationIds = (Array.isArray(body.tomorrowLocationIds) ? body.tomorrowLocationIds : [])
        .map((value: unknown) => String(value)).filter((id: string) => assignedLocationAllowed(session, id));
      const saved = await supabaseAdmin.from("recruitment_field_duties").update({
        ended_at: now, submitted_at: now, status: "completed",
        punch_out_at: attendance.punchOutAt,
        punch_out_source: attendance.punchOutSource,
        worked_minutes: Number.isFinite(workedMinutes) ? workedMinutes : null,
        end_latitude: finite(body.latitude), end_longitude: finite(body.longitude),
        distance_meters: metrics.distanceMeters,
        raw_distance_meters: metrics.rawDistanceMeters,
        accepted_distance_meters: metrics.distanceMeters,
        gps_point_count: metrics.validPointCount,
        gps_coverage_percent: metrics.coveragePercent,
        gps_confidence_percent: metrics.confidencePercent,
        gps_stationary_point_count: metrics.stationaryPointCount,
        tracking_algorithm_version: metrics.algorithmVersion,
        tomorrow_location_ids: tomorrowLocationIds,
        tomorrow_target: finite(body.tomorrowTarget),
        expected_joinees: finite(body.expectedJoinees),
        challenges: String(body.challenges ?? "").trim() || null,
        tomorrow_plan: String(body.tomorrowPlan ?? "").trim() || null,
        remarks: String(body.remarks ?? "").trim() || null,
        zero_activity_reason: String(body.zeroActivityReason ?? "").trim() || null,
        updated_at: now
      }).eq("company_id", companyId).eq("id", dutyId);
      if (saved.error) throw saved.error;
      return NextResponse.json({ duty: await dutyDetail(companyId, dutyId) });
    }
    return NextResponse.json({ error: "Unsupported field duty action." }, { status: 400 });
  } catch (error) {
    console.error("Field duty mutation failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to update field duty." }, { status: 500 });
  }
}
