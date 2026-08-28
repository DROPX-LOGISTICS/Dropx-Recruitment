import { NextResponse } from "next/server";
import { fieldDutyViewerScope } from "@/lib/field-duty-access";
import {
  buildManualPunchRemarks,
  canApproveManualPunch,
  canReviewManualPunchRequest,
  fieldDutyAttendance,
  minimumFieldDutyPunchSeparationMs,
  normalizeManualPunchReasonInput,
  parseManualPunchRemarks,
  recruitmentManualPunchPrefix,
  type FieldDutyPunchKind
} from "@/lib/manual-punch";
import { canUseRecruitmentMenu, recruitmentSession, requiredEnv } from "@/lib/recruitment-api";
import { loadWorkforceConfig } from "@/lib/recruitment-workforce-config";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const istDay = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit"
}).format(new Date());

const istClock = () => new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
}).format(new Date());

const finite = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : null;

const requestColumns = [
  "id", "profile_id", "full_name", "dropx_id", "biometric_id", "attendance_date", "requested_in_time", "requested_out_time",
  "request_kind", "reason_code", "reason_master_id", "duty_id", "duty_location_id", "status", "remarks",
  "requested_latitude", "requested_longitude", "requested_accuracy_meters", "evidence_path",
  "client_request_id", "review_remarks", "reviewed_by", "reviewed_at", "created_at"
].join(",");

function viewRequest(row: any, name?: string | null, reviewerName?: string | null) {
  const kind: FieldDutyPunchKind = row.request_kind === "field_duty_out" ? "out" : "in";
  return {
    id: row.id,
    profileId: row.profile_id,
    recruiterName: name || row.full_name || "Field recruiter",
    date: row.attendance_date,
    punchType: kind,
    requestedTime: String(kind === "out" ? row.requested_out_time : row.requested_in_time).slice(0, 8),
    reasonCode: row.recruitment_manual_punch_reasons?.code || row.reason_code,
    reasonLabel: row.recruitment_manual_punch_reasons?.name || null,
    dutyId: row.duty_id,
    locationId: row.duty_location_id,
    latitude: finite(row.requested_latitude),
    longitude: finite(row.requested_longitude),
    accuracy: finite(row.requested_accuracy_meters),
    evidencePath: row.evidence_path,
    clientRequestId: row.client_request_id,
    status: row.status,
    reviewRemarks: row.review_remarks,
    reviewedBy: row.reviewed_by,
    reviewerName: reviewerName || null,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
    ...parseManualPunchRemarks(row.remarks)
  };
}

async function resolveApprovalScope(companyId: string, session: NonNullable<Awaited<ReturnType<typeof recruitmentSession>>>) {
  const fullScope = canUseRecruitmentMenu(session, "Field Recruitment", "all", "workforce");
  const config = await loadWorkforceConfig(companyId);
  return fieldDutyViewerScope({
    profileId: session.profileId,
    functionName: session.recruitmentFunction,
    fullScope,
    configuredUsers: config.userFunctions
  });
}

function approvedPunchAt(day: string, time: unknown) {
  const clock = String(time ?? "").slice(0, 8);
  if (!/^\d{2}:\d{2}:\d{2}$/.test(clock)) throw new Error("The requested punch time is invalid.");
  return `${day}T${clock}+05:30`;
}

async function reflectApprovedPunchInAttendance(input: {
  companyId: string;
  request: any;
  approverProfileId: string;
  approverName: string;
  approvedAt: string;
}) {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  const row = input.request;
  const enrolmentId = String(row.biometric_id ?? "").trim();
  if (!enrolmentId) {
    throw new Error("This field recruiter's biometric enrolment ID is missing, so the approved time cannot be reflected in People/Attendance.");
  }
  const kind: FieldDutyPunchKind = row.request_kind === "field_duty_out" ? "out" : "in";
  const punchAt = approvedPunchAt(
    String(row.attendance_date),
    kind === "out" ? row.requested_out_time : row.requested_in_time
  );
  const current = await supabaseAdmin.from("attendance_daily")
    .select("in_time,out_time,punch_count,remark")
    .eq("company_id", input.companyId).eq("enrolment_id", enrolmentId)
    .eq("punch_date", row.attendance_date).maybeSingle();
  if (current.error) throw current.error;
  const inTime = kind === "in" ? punchAt : current.data?.in_time ?? null;
  const outTime = kind === "out" ? punchAt : current.data?.out_time ?? null;
  const inMs = inTime ? Date.parse(inTime) : NaN;
  const outMs = outTime ? Date.parse(outTime) : NaN;
  const workMinutes = Number.isFinite(inMs) && Number.isFinite(outMs) && outMs > inMs
    ? Math.floor((outMs - inMs) / 60000)
    : 0;
  const sourceText = `Manual ${kind.toUpperCase()} approved by ${input.approverName}`;
  const existingRemark = String(current.data?.remark ?? "").trim();
  const payload: Record<string, unknown> = {
    company_id: input.companyId,
    enrolment_id: enrolmentId,
    punch_date: row.attendance_date,
    worker_type: "field_executive",
    punch_count: Number(current.data?.punch_count ?? 0),
    work_minutes: workMinutes,
    status: "P",
    remark: [existingRemark, sourceText].filter(Boolean).filter((value, index, all) => all.indexOf(value) === index).join(" • "),
    updated_at: input.approvedAt
  };
  if (kind === "in") Object.assign(payload, {
    in_time: punchAt,
    in_source: "manual_approved",
    manual_in_request_id: row.id,
    manual_in_approved_by: input.approverProfileId,
    manual_in_approver_name: input.approverName,
    manual_in_approved_at: input.approvedAt
  });
  else Object.assign(payload, {
    out_time: punchAt,
    out_source: "manual_approved",
    manual_out_request_id: row.id,
    manual_out_approved_by: input.approverProfileId,
    manual_out_approver_name: input.approverName,
    manual_out_approved_at: input.approvedAt
  });
  const reflected = await supabaseAdmin.from("attendance_daily")
    .upsert(payload, { onConflict: "company_id,enrolment_id,punch_date" });
  if (reflected.error) throw reflected.error;
}

export async function GET(request: Request) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase is not configured.");
    const session = await recruitmentSession(request);
    const url = new URL(request.url);
    const approvalScope = url.searchParams.get("scope") === "approval";
    const personalAccess = session?.recruitmentFunction === "field_recruiter"
      && canUseRecruitmentMenu(session, "Field Recruitment", "view", "workforce");
    if (!session || (approvalScope ? !canApproveManualPunch(session) : !personalAccess)) {
      return NextResponse.json({ error: "Manual punch access is not available for this account." }, { status: 403 });
    }
    const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
    const reasons = await supabaseAdmin.from("recruitment_manual_punch_reasons")
      .select("id,code,name,punch_type,requires_evidence,sort_order")
      .eq("company_id", companyId).eq("is_active", true).order("sort_order");
    if (reasons.error) throw reasons.error;

    let query = supabaseAdmin.from("attendance_regularization_requests")
      .select(requestColumns)
      .eq("company_id", companyId).eq("profile_type", "field_executive")
      .in("request_kind", ["field_duty_in", "field_duty_out"])
      .ilike("remarks", `${recruitmentManualPunchPrefix}%`)
      .order("created_at", { ascending: false }).limit(250);
    if (approvalScope) {
      const scope = await resolveApprovalScope(companyId, session);
      const profileIds = scope.profileIds.filter((profileId) => profileId !== session.profileId);
      if (scope.visibility === "all") query = query.neq("profile_id", session.profileId);
      else if (profileIds.length) query = query.in("profile_id", profileIds);
      else query = query.eq("profile_id", "00000000-0000-0000-0000-000000000000");
    } else {
      query = query.eq("profile_id", session.profileId);
    }
    const status = String(url.searchParams.get("status") ?? "").trim();
    if (status) query = query.eq("status", status);
    const result = await query;
    if (result.error) throw result.error;

    const profileIds = [...new Set((result.data ?? []).flatMap((row: any) => [row.profile_id, row.reviewed_by]).filter(Boolean))];
    const profiles = profileIds.length
      ? await supabaseAdmin.from("profiles").select("id,full_name,email").eq("company_id", companyId).in("id", profileIds)
      : { data: [], error: null };
    if (profiles.error) throw profiles.error;
    const names = new Map((profiles.data ?? []).map((profile: any) => [profile.id, profile.full_name || profile.email]));
    return NextResponse.json({
      canApprove: canApproveManualPunch(session),
      reasons: reasons.data ?? [],
      requests: (result.data ?? []).map((row: any) => viewRequest(row, names.get(row.profile_id), names.get(row.reviewed_by)))
    });
  } catch (error) {
    console.error("Manual punch request read failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load manual punch requests." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase is not configured.");
    const session = await recruitmentSession(request);
    if (!session || session.readOnly || session.isPreview || session.recruitmentFunction !== "field_recruiter"
      || !canUseRecruitmentMenu(session, "Field Recruitment", "add", "workforce")) {
      return NextResponse.json({ error: "Only the signed-in field recruiter can request a manual punch." }, { status: 403 });
    }
    const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
    const day = istDay();
    const body = await request.json();
    const punchType = String(body.punchType ?? "in") as FieldDutyPunchKind;
    if (!(["in", "out"] as string[]).includes(punchType)) {
      return NextResponse.json({ error: "Choose manual IN or manual OUT." }, { status: 400 });
    }
    const clientRequestId = String(body.clientRequestId ?? "").trim();
    if (!clientRequestId || clientRequestId.length > 100) {
      return NextResponse.json({ error: "A valid client request ID is required for safe retry." }, { status: 400 });
    }
    const existingRetry = await supabaseAdmin.from("attendance_regularization_requests")
      .select(requestColumns).eq("company_id", companyId).eq("profile_id", session.profileId)
      .eq("client_request_id", clientRequestId).maybeSingle();
    if (existingRetry.error) throw existingRetry.error;
    if (existingRetry.data) return NextResponse.json({ request: viewRequest(existingRetry.data, session.displayName), replayed: true });

    let locationName = String(body.locationName ?? "").trim();
    let locationId = String(body.locationId ?? "").trim() || null;
    if (punchType === "in" && !locationId && locationName.length < 2) {
      return NextResponse.json({ error: "Select an assigned location or enter the new duty location." }, { status: 400 });
    }
    const latitude = finite(body.latitude);
    const longitude = finite(body.longitude);
    const accuracy = finite(body.accuracy);
    if (Boolean(body.isMocked)) {
      return NextResponse.json({ error: "Mock location is not allowed for a manual punch request." }, { status: 400 });
    }
    if (latitude == null || longitude == null || Math.abs(latitude) > 90 || Math.abs(longitude) > 180
      || (latitude === 0 && longitude === 0) || accuracy == null || accuracy <= 0 || accuracy > 100) {
      return NextResponse.json({ error: "A fresh GPS fix with 100 metre accuracy or better is required." }, { status: 400 });
    }

    const reasonInput = normalizeManualPunchReasonInput(body);
    let reasonQuery = supabaseAdmin.from("recruitment_manual_punch_reasons")
      .select("id,code,name,punch_type,requires_evidence")
      .eq("company_id", companyId).eq("is_active", true)
      .in("punch_type", [punchType, "both"]);
    if (reasonInput.reasonCode) reasonQuery = reasonQuery.eq("code", reasonInput.reasonCode);
    const reasonMaster = await reasonQuery.order("sort_order", { ascending: true }).limit(1).maybeSingle();
    if (reasonMaster.error) throw reasonMaster.error;
    if (!reasonMaster.data || ![punchType, "both"].includes(reasonMaster.data.punch_type)) {
      return NextResponse.json({ error: "Select an active reason configured for this punch type." }, { status: 400 });
    }
    const evidencePath = String(body.evidencePath ?? "").trim() || null;
    if (reasonMaster.data.requires_evidence && !evidencePath) {
      return NextResponse.json({ error: "Evidence is required for the selected reason." }, { status: 400 });
    }
    const reasonDetail = reasonInput.reasonDetail;
    const reason = reasonDetail ? `${reasonMaster.data.name}: ${reasonDetail}` : reasonMaster.data.name;

    const duty = await supabaseAdmin.from("recruitment_field_duties")
      .select("id,status,started_at,duty_date,primary_location_id,primary_location_name,primary_location_code")
      .eq("company_id", companyId)
      .eq("recruiter_profile_id", session.profileId).eq("duty_date", day).maybeSingle();
    if (duty.error) throw duty.error;
    if (punchType === "out" && (!duty.data || duty.data.status !== "active")) {
      return NextResponse.json({ error: "Manual OUT requires an active field duty started today." }, { status: 409 });
    }
    if (punchType === "out" && duty.data && Date.now() < Date.parse(duty.data.started_at) + minimumFieldDutyPunchSeparationMs) {
      return NextResponse.json({ error: "Manual OUT cannot be requested immediately after duty start." }, { status: 409 });
    }
    if (punchType === "out" && duty.data) {
      // OUT belongs to the station locked by the verified/approved IN. Never
      // trust a different location supplied by the phone at day closure.
      locationId = duty.data.primary_location_id ?? null;
      locationName = duty.data.primary_location_name || duty.data.primary_location_code || "Locked duty location";
    }
    const attendance = await fieldDutyAttendance(companyId, session.profileId, day, duty.data?.started_at);
    const pending = punchType === "out" ? attendance.manualOutRequest : attendance.manualInRequest;
    if (pending?.status === "pending") {
      return NextResponse.json({ error: `A manual ${punchType.toUpperCase()} request is already pending today.` }, { status: 409 });
    }
    if (punchType === "in" && attendance.verified) {
      return NextResponse.json({ error: "A valid IN punch already exists for today." }, { status: 409 });
    }
    if (punchType === "out" && (!attendance.verified || !attendance.punchInAt)) {
      return NextResponse.json({ error: "A verified IN is required before manual OUT can be requested." }, { status: 409 });
    }
    if (punchType === "out" && attendance.punchOutVerified) {
      return NextResponse.json({ error: "A valid OUT punch already exists for today." }, { status: 409 });
    }

    const clock = istClock();
    const remarks = buildManualPunchRemarks({ reason, locationName: locationName || "Assigned duty location", latitude, longitude, accuracy });
    const saved = await supabaseAdmin.from("attendance_regularization_requests").insert({
      company_id: companyId,
      profile_type: "field_executive",
      profile_id: session.profileId,
      dropx_id: session.designationCode || "FREC",
      biometric_id: attendance.biometricId,
      full_name: session.displayName,
      attendance_date: day,
      current_in_time: attendance.punchInAt ? new Date(attendance.punchInAt).toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour12: false }) : null,
      current_out_time: attendance.punchOutAt ? new Date(attendance.punchOutAt).toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour12: false }) : null,
      requested_in_time: clock,
      requested_out_time: clock,
      request_kind: `field_duty_${punchType}`,
      duty_id: punchType === "out" ? duty.data?.id : null,
      reason_master_id: reasonMaster.data.id,
      duty_location_id: locationId,
      requested_latitude: latitude,
      requested_longitude: longitude,
      requested_accuracy_meters: accuracy,
      evidence_path: evidencePath,
      client_request_id: clientRequestId,
      reason_code: punchType === "out" ? "missed_out" : "missed_in",
      remarks,
      status: "pending",
      updated_at: new Date().toISOString()
    }).select(requestColumns).single();
    if (saved.error) throw saved.error;
    return NextResponse.json({ request: viewRequest(saved.data, session.displayName) }, { status: 201 });
  } catch (error) {
    console.error("Manual punch request create failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to submit the manual punch request." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase is not configured.");
    const session = await recruitmentSession(request);
    if (!session || !canApproveManualPunch(session)) {
      return NextResponse.json({ error: "Configured Field Recruitment approval access is required." }, { status: 403 });
    }
    const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
    const body = await request.json();
    const id = String(body.id ?? "").trim();
    const action = String(body.action ?? "").trim();
    const reviewRemarks = String(body.remarks ?? "").trim();
    if (!id || !["approve", "reject"].includes(action)) {
      return NextResponse.json({ error: "Choose approve or reject for a valid request." }, { status: 400 });
    }
    if (action === "reject" && reviewRemarks.length < 3) {
      return NextResponse.json({ error: "Add a reason before rejecting the request." }, { status: 400 });
    }
    const current = await supabaseAdmin.from("attendance_regularization_requests")
      .select(requestColumns)
      .eq("company_id", companyId).eq("id", id).eq("profile_type", "field_executive")
      .in("request_kind", ["field_duty_in", "field_duty_out"]).maybeSingle();
    if (current.error) throw current.error;
    if (!current.data) return NextResponse.json({ error: "Manual punch request was not found." }, { status: 404 });
    const currentRow = current.data as any;
    if (!canReviewManualPunchRequest(session.profileId, currentRow.profile_id)) {
      return NextResponse.json({ error: "You cannot review your own manual punch request." }, { status: 403 });
    }
    const scope = await resolveApprovalScope(companyId, session);
    if (scope.visibility !== "all" && !scope.profileIds.includes(currentRow.profile_id)) {
      return NextResponse.json({ error: "This request is outside your configured team scope." }, { status: 403 });
    }
    if (currentRow.status !== "pending") {
      return NextResponse.json({ error: "This request has already been reviewed." }, { status: 409 });
    }
    if (currentRow.attendance_date > istDay()) {
      return NextResponse.json({ error: "Future-dated punch requests cannot be approved." }, { status: 409 });
    }
    if (currentRow.request_kind === "field_duty_out") {
      const dutyResult = currentRow.duty_id
        ? await supabaseAdmin.from("recruitment_field_duties").select("started_at,duty_date,status")
          .eq("company_id", companyId).eq("id", currentRow.duty_id).maybeSingle()
        : { data: null, error: null };
      if (dutyResult.error) throw dutyResult.error;
      const duty = dutyResult.data;
      if (!duty || duty.duty_date !== currentRow.attendance_date || duty.status !== "active") {
        return NextResponse.json({ error: "The linked duty is missing, closed, or on another day." }, { status: 409 });
      }
    }

    const now = new Date().toISOString();
    const status = action === "approve" ? "approved" : "rejected";
    const saved = await supabaseAdmin.from("attendance_regularization_requests").update({
      status,
      review_remarks: reviewRemarks || (action === "approve" ? "Approved for field duty" : null),
      reviewed_by: session.profileId,
      reviewed_at: now,
      updated_at: now
    }).eq("company_id", companyId).eq("id", id).eq("status", "pending")
      .select(requestColumns).single();
    if (saved.error) throw saved.error;
    const savedRequest = saved.data as any;
    if (status === "approved") {
      try {
        await reflectApprovedPunchInAttendance({
          companyId,
          request: savedRequest,
          approverProfileId: session.profileId,
          approverName: session.displayName || session.email || "Configured approver",
          approvedAt: now
        });
      } catch (reflectionError) {
        await supabaseAdmin.from("attendance_regularization_requests").update({
          status: "pending", review_remarks: null, reviewed_by: null, reviewed_at: null, updated_at: now
        }).eq("company_id", companyId).eq("id", id).eq("status", "approved").eq("reviewed_at", now);
        throw reflectionError;
      }
    }
    const decision = await supabaseAdmin.from("recruitment_manual_punch_decisions").insert({
      company_id: companyId,
      request_id: id,
      action: status,
      decided_by_profile_id: session.profileId,
      comments: savedRequest.review_remarks,
      decided_at: now
    });
    if (decision.error) throw decision.error;
    if (status === "approved" && savedRequest.request_kind === "field_duty_out" && savedRequest.duty_id) {
      const linked = await supabaseAdmin.from("recruitment_field_duties").update({
        punch_out_request_id: id, updated_at: now
      }).eq("company_id", companyId).eq("id", savedRequest.duty_id).eq("status", "active");
      if (linked.error) throw linked.error;
    }
    return NextResponse.json({ request: savedRequest });
  } catch (error) {
    console.error("Manual punch review failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to review the manual punch request." }, { status: 500 });
  }
}
