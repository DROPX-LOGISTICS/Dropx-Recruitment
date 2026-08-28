import type { MobileSessionContext } from "./mobile-session";
import { supabaseAdmin } from "./supabase-admin";

export const recruitmentManualPunchPrefix = "Recruitment field duty:";
export const minimumFieldDutyPunchSeparationMs = 5 * 60 * 1000;
export type FieldDutyPunchKind = "in" | "out";
export type FieldDutyLocation = {
  recruitmentLocationId: string | null;
  stationId: string | null;
  code: string | null;
  name: string;
  latitude: number | null;
  longitude: number | null;
  source: "biometric_device" | "manual_approved";
  deviceSerial: string | null;
  manualRequestId: string | null;
};

export function canApproveManualPunch(session: Pick<
  MobileSessionContext,
  "menuAccess" | "menuActions" | "readOnly" | "isPreview" | "isOwner" | "recruitmentFunction"
>) {
  if (session.readOnly === true || session.isPreview === true || session.recruitmentFunction === "field_recruiter") {
    return false;
  }
  if (session.isOwner === true) return true;
  const actions = session.menuActions?.workforce?.["Field Recruitment"];
  if (actions?.edit === true) return true;
  const level = session.menuAccess?.workforce?.["Field Recruitment"] ?? "none";
  return level === "edit" || level === "all";
}

export function canReviewManualPunchRequest(reviewerProfileId: unknown, requesterProfileId: unknown) {
  const reviewer = String(reviewerProfileId ?? "").trim();
  const requester = String(requesterProfileId ?? "").trim();
  return Boolean(reviewer && requester && reviewer !== requester);
}

export function normalizeManualPunchReasonInput(body: Record<string, unknown>) {
  const reasonCode = String(body.reasonCode ?? "").trim();
  const reasonDetail = String(body.reasonDetail ?? body.reason ?? "").trim();
  return { reasonCode, reasonDetail, legacy: !reasonCode && Boolean(reasonDetail) };
}

export function selectFieldDutyPunches(input: {
  biometricPunches: string[];
  approvedManualInAt?: string | null;
  approvedManualOutAt?: string | null;
  dutyStartedAt?: string | null;
}) {
  const biometric = input.biometricPunches
    .map((value) => ({ value, time: Date.parse(value) }))
    .filter((item) => Number.isFinite(item.time))
    .sort((left, right) => left.time - right.time);
  const manualInTime = input.approvedManualInAt ? Date.parse(input.approvedManualInAt) : NaN;
  const biometricIn = biometric[0] ?? null;
  const manualInIsEarlier = Number.isFinite(manualInTime)
    && (!biometricIn || manualInTime <= biometricIn.time);
  const punchInAt = manualInIsEarlier
    ? input.approvedManualInAt!
    : biometricIn?.value ?? null;
  const punchInTime = punchInAt ? Date.parse(punchInAt) : NaN;
  const dutyStartTime = input.dutyStartedAt ? Date.parse(input.dutyStartedAt) : NaN;
  const outAfter = Math.max(
    Number.isFinite(punchInTime) ? punchInTime : 0,
    Number.isFinite(dutyStartTime) ? dutyStartTime : 0
  ) + minimumFieldDutyPunchSeparationMs;
  // Field routes stay open until the recruiter explicitly closes the duty.
  // When devices record collection, road-start and return punches, the last
  // valid calculated punch is the provisional OUT—not the second punch.
  const biometricOut = biometric.filter((item) => item.value !== punchInAt && item.time >= outAfter).at(-1) ?? null;
  const manualOutTime = input.approvedManualOutAt ? Date.parse(input.approvedManualOutAt) : NaN;
  const manualOutValid = Number.isFinite(manualOutTime) && manualOutTime >= outAfter;
  const punchOutAt = biometricOut?.value ?? (manualOutValid ? input.approvedManualOutAt! : null);
  return {
    punchInAt,
    punchInSource: punchInAt && !manualInIsEarlier ? "biometric" : punchInAt ? "manual_approved" : "not_punched",
    punchOutAt,
    punchOutSource: biometricOut ? "biometric" : punchOutAt ? "manual_approved" : "not_punched"
  };
}

export function buildManualPunchRemarks(input: {
  reason: string;
  locationName: string;
  latitude?: number | null;
  longitude?: number | null;
  accuracy?: number | null;
}) {
  const gps = Number.isFinite(input.latitude) && Number.isFinite(input.longitude)
    ? `${Number(input.latitude).toFixed(6)},${Number(input.longitude).toFixed(6)}${
      Number.isFinite(input.accuracy) ? ` (${Math.round(Number(input.accuracy))}m accuracy)` : ""
    }`
    : "Unavailable";
  return `${recruitmentManualPunchPrefix} ${input.reason.trim()}\nLocation: ${input.locationName.trim()}\nGPS: ${gps}`;
}

export function parseManualPunchRemarks(value: unknown) {
  const text = String(value ?? "");
  const lines = text.split("\n");
  return {
    reason: lines[0]?.startsWith(recruitmentManualPunchPrefix)
      ? lines[0].slice(recruitmentManualPunchPrefix.length).trim()
      : lines[0]?.trim() || "",
    locationName: lines.find((line) => line.startsWith("Location:"))?.slice(9).trim() || "",
    gps: lines.find((line) => line.startsWith("GPS:"))?.slice(4).trim() || ""
  };
}

function cleanEnrolmentId(value: unknown) {
  const digits = String(value ?? "").trim().replace(/\D/g, "");
  return digits ? digits.replace(/^0+/, "") || "0" : "";
}

async function recruiterBiometricId(companyId: string, profileId: string) {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  const profile = await supabaseAdmin.from("profiles")
    .select("employee_id,email,mobile,phone")
    .eq("company_id", companyId).eq("id", profileId).maybeSingle();
  if (profile.error) throw profile.error;
  if (!profile.data) return null;

  const employeeCode = String(profile.data.employee_id ?? "").trim();
  if (employeeCode) {
    const employee = await supabaseAdmin.from("employees")
      .select("biometric_id")
      .eq("company_id", companyId).eq("employee_code", employeeCode).maybeSingle();
    if (employee.error) throw employee.error;
    if (employee.data?.biometric_id) return String(employee.data.biometric_id);
  }

  const email = String(profile.data.email ?? "").trim();
  if (email) {
    const employee = await supabaseAdmin.from("employees")
      .select("biometric_id").eq("company_id", companyId).ilike("email", email).maybeSingle();
    if (employee.error) throw employee.error;
    if (employee.data?.biometric_id) return String(employee.data.biometric_id);
    const executive = await supabaseAdmin.from("field_executives")
      .select("biometric_id").eq("company_id", companyId).ilike("email", email).maybeSingle();
    if (executive.error) throw executive.error;
    if (executive.data?.biometric_id) return String(executive.data.biometric_id);
  }
  return null;
}

const finiteNumber = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : null;

export function resolveBiometricStationId(input: {
  punchLocationId?: string | null;
  deviceId?: string | null;
  deviceSerial?: string | null;
  deviceMasterLocationId?: string | null;
}) {
  const deviceIdentityPresent = Boolean(String(input.deviceId ?? "").trim() || String(input.deviceSerial ?? "").trim());
  const deviceMasterLocationId = String(input.deviceMasterLocationId ?? "").trim();
  if (deviceIdentityPresent) return deviceMasterLocationId || null;
  return String(input.punchLocationId ?? "").trim() || null;
}

async function activeBiometricDevice(companyId: string, punch: { device_id?: string | null; device_serial?: string | null }) {
  if (!supabaseAdmin) return null;
  const deviceId = String(punch.device_id ?? "").trim();
  const deviceSerial = String(punch.device_serial ?? "").trim();
  if (deviceId) {
    const byId = await supabaseAdmin.from("biometric_devices").select("id,location_id,device_serial")
      .eq("company_id", companyId).eq("is_active", true).eq("id", deviceId).maybeSingle();
    if (byId.error) throw byId.error;
    if (byId.data) return byId.data;
  }
  if (deviceSerial) {
    const bySerial = await supabaseAdmin.from("biometric_devices").select("id,location_id,device_serial")
      .eq("company_id", companyId).eq("is_active", true).eq("device_serial", deviceSerial).maybeSingle();
    if (bySerial.error) throw bySerial.error;
    if (bySerial.data) return bySerial.data;
  }
  return null;
}

async function biometricDutyLocation(companyId: string, punch: {
  location_id?: string | null;
  device_id?: string | null;
  device_serial?: string | null;
} | null): Promise<FieldDutyLocation | null> {
  if (!supabaseAdmin || !punch) return null;
  const device = await activeBiometricDevice(companyId, punch);
  const stationId = resolveBiometricStationId({
    punchLocationId: punch.location_id,
    deviceId: punch.device_id,
    deviceSerial: punch.device_serial,
    deviceMasterLocationId: device?.location_id
  });
  if (!stationId) return null;
  const station = await supabaseAdmin.from("stations")
    .select("id,station_code,station_name,latitude,longitude")
    .eq("company_id", companyId).eq("id", stationId).eq("is_active", true).maybeSingle();
  if (station.error) throw station.error;
  if (!station.data?.station_code) return null;
  const recruitmentLocation = await supabaseAdmin.from("recruitment_locations")
    .select("id,code,name,latitude,longitude")
    .eq("company_id", companyId).ilike("code", station.data.station_code).eq("is_active", true).maybeSingle();
  if (recruitmentLocation.error) throw recruitmentLocation.error;
  if (!recruitmentLocation.data) return null;
  return {
    recruitmentLocationId: recruitmentLocation.data.id,
    stationId: station.data.id,
    code: recruitmentLocation.data.code || station.data.station_code,
    name: recruitmentLocation.data.name || station.data.station_name || station.data.station_code,
    latitude: finiteNumber(recruitmentLocation.data.latitude ?? station.data.latitude),
    longitude: finiteNumber(recruitmentLocation.data.longitude ?? station.data.longitude),
    source: "biometric_device",
    deviceSerial: String(device?.device_serial ?? punch.device_serial ?? "").trim() || null,
    manualRequestId: null
  };
}

async function approvedManualDutyLocation(companyId: string, request: any): Promise<FieldDutyLocation | null> {
  if (!supabaseAdmin || !request || request.status !== "approved") return null;
  const recruitmentLocationId = String(request.duty_location_id ?? "").trim() || null;
  if (recruitmentLocationId) {
    const location = await supabaseAdmin.from("recruitment_locations")
      .select("id,code,name,latitude,longitude")
      .eq("company_id", companyId).eq("id", recruitmentLocationId).eq("is_active", true).maybeSingle();
    if (location.error) throw location.error;
    if (location.data) {
      const station = await supabaseAdmin.from("stations").select("id,latitude,longitude")
        .eq("company_id", companyId).ilike("station_code", location.data.code).eq("is_active", true).maybeSingle();
      if (station.error) throw station.error;
      return {
        recruitmentLocationId: location.data.id,
        stationId: station.data?.id ?? null,
        code: location.data.code,
        name: location.data.name || location.data.code,
        latitude: finiteNumber(request.requested_latitude ?? location.data.latitude ?? station.data?.latitude),
        longitude: finiteNumber(request.requested_longitude ?? location.data.longitude ?? station.data?.longitude),
        source: "manual_approved",
        deviceSerial: null,
        manualRequestId: request.id
      };
    }
  }
  return {
    recruitmentLocationId: null,
    stationId: null,
    code: null,
    name: String(request.locationName ?? "Approved unlisted duty location").trim() || "Approved unlisted duty location",
    latitude: finiteNumber(request.requested_latitude),
    longitude: finiteNumber(request.requested_longitude),
    source: "manual_approved",
    deviceSerial: null,
    manualRequestId: request.id
  };
}

export async function fieldDutyAttendance(companyId: string, profileId: string, day: string, dutyStartedAt?: string | null) {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  const biometricId = await recruiterBiometricId(companyId, profileId);
  let biometricPunches: Array<{
    punch_time: string;
    device_serial: string | null;
    device_id: string | null;
    location_id: string | null;
    enrolment_id: string;
  }> = [];
  if (biometricId) {
    const ids = [...new Set([String(biometricId).trim(), cleanEnrolmentId(biometricId)].filter(Boolean))];
    const punch = await supabaseAdmin.from("attendance_punches")
      .select("punch_time,device_serial,device_id,location_id,enrolment_id")
      .eq("company_id", companyId).eq("punch_date", day).eq("calculated", true)
      .in("enrolment_id", ids).order("punch_time", { ascending: true }).limit(20);
    if (punch.error) throw punch.error;
    biometricPunches = punch.data ?? [];
  }

  const request = await supabaseAdmin.from("attendance_regularization_requests")
    .select("id,status,attendance_date,requested_in_time,requested_out_time,reason_code,request_kind,duty_location_id,requested_latitude,requested_longitude,requested_accuracy_meters,remarks,review_remarks,reviewed_by,reviewed_at,created_at")
    .eq("company_id", companyId).eq("profile_type", "field_executive")
    .eq("profile_id", profileId).eq("attendance_date", day)
    .ilike("remarks", `${recruitmentManualPunchPrefix}%`)
    .order("created_at", { ascending: false }).limit(20);
  if (request.error) throw request.error;
  const reviewerIds = [...new Set((request.data ?? []).map((row) => row.reviewed_by).filter(Boolean))] as string[];
  const reviewers = reviewerIds.length
    ? await supabaseAdmin.from("profiles").select("id,full_name,email").eq("company_id", companyId).in("id", reviewerIds)
    : { data: [], error: null };
  if (reviewers.error) throw reviewers.error;
  const reviewerNames = new Map((reviewers.data ?? []).map((profile) => [profile.id, profile.full_name || profile.email]));
  const requests = (request.data ?? []).map((row) => ({
    ...row,
    reviewerName: reviewerNames.get(row.reviewed_by) ?? null,
    ...parseManualPunchRemarks(row.remarks)
  }));
  const manualInRequest = requests.find((row) => row.request_kind === "field_duty_in" || row.reason_code === "missed_in") ?? null;
  const manualOutRequest = requests.find((row) => row.request_kind === "field_duty_out" || row.reason_code === "missed_out") ?? null;
  const manualInAt = manualInRequest?.status === "approved"
    ? `${day}T${String(manualInRequest.requested_in_time ?? "09:00:00").slice(0, 8)}+05:30`
    : null;
  const manualOutAt = manualOutRequest?.status === "approved"
    ? `${day}T${String(manualOutRequest.requested_out_time ?? "").slice(0, 8)}+05:30`
    : null;
  const selected = selectFieldDutyPunches({
    biometricPunches: biometricPunches.map((row) => row.punch_time),
    approvedManualInAt: manualInAt,
    approvedManualOutAt: manualOutAt,
    dutyStartedAt
  });
  const selectedBiometricIn = selected.punchInSource === "biometric"
    ? biometricPunches.find((row) => row.punch_time === selected.punchInAt) ?? biometricPunches[0] ?? null
    : null;
  const dutyLocation = selected.punchInSource === "biometric"
    ? await biometricDutyLocation(companyId, selectedBiometricIn)
    : await approvedManualDutyLocation(companyId, manualInRequest);
  return {
    verified: Boolean(selected.punchInAt),
    source: selected.punchInAt ? selected.punchInSource : manualInRequest?.status === "pending" ? "manual_pending" : "not_punched",
    punchInAt: selected.punchInAt,
    punchOutVerified: Boolean(selected.punchOutAt),
    punchOutAt: selected.punchOutAt,
    punchOutSource: selected.punchOutSource,
    biometricId,
    deviceSerial: selectedBiometricIn?.device_serial ?? null,
    dutyLocation,
    dutyLocationError: selected.punchInSource === "biometric" && !dutyLocation
      ? "The biometric device is not mapped to an active station and Recruitment location. Update Device Master before starting duty."
      : null,
    manualRequest: manualInRequest,
    manualInRequest,
    manualOutRequest
  };
}
