import { createHash, randomBytes, randomUUID } from "node:crypto";
import { sendFieldExecutiveOnboardingWhatsApp } from "./field-executive-whatsapp";
import { isFieldExecutiveDesignation } from "./field-executive-designations";
import { supabaseAdmin } from "./supabase-admin";
import { onboardingApplicationSource } from "./workforce-onboarding-review";
import { assertWorkforceDesignationRoute } from "./designation-register-routing";
import { canonicalWorkforceIdentity, WORKFORCE_PROFILE_TABLE } from "./workforce-register";
import { assertRecruitWorkforceIdentity, evaluateRecruitWorkforceIdentity, recruitmentIdentityExceptionMetadata } from "./onboarding-identity";

type OnboardingSession = {
  profileId: string;
  email: string | null;
  displayName: string | null;
  allLocations: boolean;
  locationIds: string[];
  roleIds: string[];
  recruitmentFunction: string;
};

type OnboardingInput = {
  leadId?: string | null;
  fullName?: string | null;
  mobileCountryCode?: string | null;
  mobile?: string | null;
  email?: string | null;
  joiningDate?: string | null;
  locationCode?: string | null;
  designation?: string | null;
  employeeId?: string | null;
  providerEmployeeId?: string | null;
  companyIdValue?: string | null;
  paymentRecommendation?: string | null;
  telecallerProfileId?: string | null;
  fieldRecruiterProfileId?: string | null;
};

const clean = (value: unknown, limit = 160) => String(value ?? "").trim().slice(0, limit);
const generatedDropxId = () => `FE-${Date.now().toString(36).toUpperCase()}`;

export function normalizeFieldExecutiveMobile(value: unknown) {
  const digits = clean(value, 30).replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export function normalizeFieldExecutiveEmail(value: unknown) {
  return clean(value, 180).toLowerCase();
}

export function normalizeRecruitmentJoiningFields(input: Pick<OnboardingInput, "email"|"employeeId"|"providerEmployeeId">) {
  const email = normalizeFieldExecutiveEmail(input.email);
  const dropxEmployeeId = clean(input.employeeId, 100).toUpperCase();
  const amazonCompId = clean(input.providerEmployeeId, 100);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Email ID is required.");
  return { email, dropxEmployeeId, amazonCompId };
}

async function nextBiometricId(companyId: string) {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  const result = await supabaseAdmin
    .from(WORKFORCE_PROFILE_TABLE)
    .select("biometric_id")
    .eq("company_id", companyId)
    .not("biometric_id", "is", null);
  if (result.error) throw new Error(result.error.message);
  const used = new Set((result.data ?? [])
    .map((row) => Number(String(row.biometric_id ?? "").replace(/\D/g, "")))
    .filter((value) => Number.isInteger(value) && value > 0 && value < 9000));
  let next = Math.max(0, ...used) + 1;
  while (used.has(next)) next += 1;
  if (next > 999999) throw new Error("No six-digit biometric IDs remain available.");
  return String(next).padStart(6, "0");
}

async function generatedId(
  companyId: string,
  locationId: string,
  designation: string,
  type: "dropx" | "biometric"
) {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  let designationResult = await supabaseAdmin.from("designations")
    .select("id").eq("company_id", companyId).eq("is_active", true)
    .eq("name", designation).limit(1).maybeSingle();
  if (!designationResult.data && !designationResult.error) {
    designationResult = await supabaseAdmin.from("designations")
      .select("id").eq("company_id", companyId).eq("is_active", true)
      .eq("code", designation).limit(1).maybeSingle();
  }
  const stationResult = await supabaseAdmin.from("stations")
    .select("location_model_id").eq("company_id", companyId).eq("id", locationId).maybeSingle();
  const rpc = await supabaseAdmin.rpc(
    type === "dropx" ? "generate_dropx_worker_id" : "generate_biometric_worker_id",
    {
      p_category: "field_executive",
      p_company_id: companyId,
      p_designation_id: designationResult.data?.id ?? null,
      p_location_id: locationId,
      p_model_id: stationResult.data?.location_model_id ?? null
    }
  );
  if (!rpc.error && String(rpc.data ?? "").trim()) return String(rpc.data).trim();
  return type === "dropx" ? generatedDropxId() : nextBiometricId(companyId);
}

export async function createWorkforceFieldExecutive(
  companyId: string,
  session: OnboardingSession,
  input: OnboardingInput
) {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  let lead: any = null;
  if (input.leadId) {
    const result = await supabaseAdmin.from("recruitment_leads")
      .select("id,full_name,phone,email,status,stream,location_id,role_id,assigned_profile_id,recruitment_locations(code),recruitment_roles(name,code)")
      .eq("company_id", companyId).eq("id", input.leadId).maybeSingle();
    if (result.error) throw new Error(result.error.message);
    lead = result.data;
    if (!lead || lead.stream !== "workforce") throw new Error("Workforce lead was not found.");
    if (!session.allLocations && !session.locationIds.includes(lead.location_id)) {
      throw new Error("This lead is outside your assigned station access.");
    }
    if (session.roleIds.length && !session.roleIds.includes(lead.role_id)) {
      throw new Error("This lead is outside your assigned designation access.");
    }
  }

  const joiningFields = lead ? normalizeRecruitmentJoiningFields(input) : null;
  const fullName = clean(input.fullName || lead?.full_name, 120);
  const mobileCountryCode = clean(input.mobileCountryCode || "91", 5).replace(/\D/g, "") || "91";
  const mobile = normalizeFieldExecutiveMobile(input.mobile || lead?.phone);
  const email = joiningFields?.email || normalizeFieldExecutiveEmail(input.email || lead?.email);
  const joiningDate = clean(input.joiningDate, 20);
  const locationCode = clean(input.locationCode || lead?.recruitment_locations?.code, 30).toUpperCase();
  const designation = clean(input.designation || lead?.recruitment_roles?.name || lead?.recruitment_roles?.code, 100);
  if (!fullName) throw new Error("Full name is required.");
  if (!/^\d{10}$/.test(mobile)) throw new Error("Mobile number must contain exactly 10 digits.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(joiningDate)) throw new Error("Joining date is required.");
  if (!locationCode) throw new Error("Station is required.");
  if (!designation) throw new Error("Designation is required.");

  if (!session.allLocations) {
    const recruitmentLocation = await supabaseAdmin.from("recruitment_locations")
      .select("id,code").eq("company_id", companyId).eq("code", locationCode).eq("is_active", true).maybeSingle();
    if (recruitmentLocation.error) throw new Error(recruitmentLocation.error.message);
    if (!recruitmentLocation.data || !session.locationIds.includes(recruitmentLocation.data.id)) {
      throw new Error("You do not have access to the selected location.");
    }
  }

  const station = await supabaseAdmin.from("stations")
    .select("id,station_code,station_name,location_model_id,providers(name)").eq("company_id", companyId)
    .eq("station_code", locationCode).eq("is_active", true).maybeSingle();
  if (station.error) throw new Error(station.error.message);
  if (!station.data) throw new Error("Selected station is not available in the main dashboard.");
  let selectedDesignation = await supabaseAdmin.from("designations")
    .select("id,code,name,model_ids,onboarding_categories")
    .eq("company_id", companyId).eq("is_active", true)
    .eq("name", designation).limit(1).maybeSingle();
  if (!selectedDesignation.data && !selectedDesignation.error) {
    selectedDesignation = await supabaseAdmin.from("designations")
      .select("id,code,name,model_ids,onboarding_categories")
      .eq("company_id", companyId).eq("is_active", true)
      .eq("code", designation).limit(1).maybeSingle();
  }
  if (selectedDesignation.error) throw new Error(selectedDesignation.error.message);
  if (!selectedDesignation.data) throw new Error("Selected designation is not available in the main dashboard.");
  await assertWorkforceDesignationRoute(companyId, selectedDesignation.data.id);
  let workforceRoles = supabaseAdmin.from("recruitment_roles")
    .select("id,code,name")
    .eq("company_id", companyId)
    .eq("stream", "workforce")
    .eq("is_active", true);
  if (session.roleIds.length) workforceRoles = workforceRoles.in("id", session.roleIds);
  const workforceRoleResult = await workforceRoles;
  if (workforceRoleResult.error) throw new Error(workforceRoleResult.error.message);
  const workforceRoleKeys = new Set((workforceRoleResult.data ?? [])
    .flatMap((item) => [String(item.code ?? "").trim().toLowerCase(), String(item.name ?? "").trim().toLowerCase()])
    .filter(Boolean));
  if (!isFieldExecutiveDesignation(selectedDesignation.data, workforceRoleKeys)) {
    throw new Error("Selected designation is not enabled for Field Executive onboarding.");
  }
  const modelIds = Array.isArray(selectedDesignation.data.model_ids)
    ? selectedDesignation.data.model_ids.map(String)
    : [];
  if (modelIds.length && station.data.location_model_id && !modelIds.includes(station.data.location_model_id)) {
    throw new Error("Selected designation is not available for this location model.");
  }
  const designationName = selectedDesignation.data.name;

  const identityEvaluation = await evaluateRecruitWorkforceIdentity({
    client: supabaseAdmin,
    companyId,
    mobile,
    designationId: selectedDesignation.data.id,
    designationName
  });
  assertRecruitWorkforceIdentity(identityEvaluation);
  const identityExceptionMetadata = recruitmentIdentityExceptionMetadata(identityEvaluation);

  const [dropxId, biometricId] = await Promise.all([
    generatedId(companyId, station.data.id, designationName, "dropx"),
    generatedId(companyId, station.data.id, designationName, "biometric")
  ]);
  const registrationToken = randomBytes(32).toString("base64url");
  const registrationTokenHash = createHash("sha256").update(registrationToken).digest("hex");
  const now = new Date().toISOString();
  const workforceId = randomUUID();
  const inserted = await supabaseAdmin.from(WORKFORCE_PROFILE_TABLE).insert({
    ...canonicalWorkforceIdentity(workforceId, selectedDesignation.data.id),
    company_id: companyId,
    full_name: fullName,
    mobile_country_code: mobileCountryCode,
    mobile,
    email,
    date_of_join: joiningDate,
    location_id: station.data.id,
    designation: designationName,
    biometric_id: biometricId,
    dropx_id: dropxId,
    created_by: session.profileId,
    is_active: false,
    approval_required: true,
    onboarding_application_source: onboardingApplicationSource(session.recruitmentFunction),
    recruitment_lead_id: lead?.id ?? null,
    provider_id_status: joiningFields?.amazonCompId ? "created" : "pending",
    provider_employee_id: joiningFields?.amazonCompId || null,
    onboarding_token_hash: registrationTokenHash,
    onboarding_token_expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    onboarding_status: "pending",
    updated_at: now
  }).select("id,dropx_id,biometric_id,onboarding_status").single();
  if (inserted.error) {
    const message = inserted.error.message.toLowerCase();
    if (message.includes("duplicate") || message.includes("unique")) {
      throw new Error(inserted.error.message.includes("mobile")
        ? inserted.error.message
        : "This mobile, email, DropX ID, or biometric ID is already registered.");
    }
    throw new Error(inserted.error.message);
  }

  if (lead) {
    const telecallerProfileId = clean(input.telecallerProfileId, 80)
      || (session.recruitmentFunction === "telecaller" ? session.profileId : "")
      || lead.assigned_profile_id || "";
    const fieldRecruiterProfileId = clean(input.fieldRecruiterProfileId, 80)
      || (session.recruitmentFunction === "field_recruiter" ? session.profileId : "");
    const metadata = {
      field_executive_id: inserted.data.id,
      dropx_id: dropxId,
      biometric_id: biometricId,
      employee_id: dropxId,
      provider_employee_id: joiningFields?.amazonCompId || null,
      company_id_value: null,
      joining_date: joiningDate,
      telecaller_profile_id: telecallerProfileId || null,
      field_recruiter_profile_id: fieldRecruiterProfileId || null,
      onboarding_profile_id: session.profileId,
      payment_recommendation: clean(input.paymentRecommendation, 500) || null
    };
    const history = await supabaseAdmin.from("recruitment_lead_history").insert({
      company_id: companyId, lead_id: lead.id, event_type: "workforce_onboarding_requested",
      field_name: "onboarding_status", old_value: null, new_value: "pending",
      remarks: `Workforce onboarding requested by ${session.displayName || session.email || "recruitment user"}. Final activation is pending HO review.`,
      actor_profile_id: session.profileId, actor_email: session.email, metadata
    });
    if (history.error) throw new Error(history.error.message);
  }

  const onboardingEvent = await supabaseAdmin.from("workforce_onboarding_events").insert({
    company_id: companyId,
    field_executive_id: null,
    workforce_id: inserted.data.id,
    event_code: "onboarding_requested",
    from_status: null,
    to_status: "pending",
    remarks: "Associate invitation created; candidate submission and HO activation are pending.",
    actor_user_id: session.profileId,
    source_portal: "recruit",
    metadata: {
      source: onboardingApplicationSource(session.recruitmentFunction),
      actor_email: session.email,
      recruitment_lead_id: lead?.id ?? null,
      ...identityExceptionMetadata
    }
  });
  if (onboardingEvent.error) throw new Error(onboardingEvent.error.message);

  const providerRelation = Array.isArray(station.data.providers)
    ? station.data.providers[0]
    : station.data.providers;
  const notification = await sendFieldExecutiveOnboardingWhatsApp({
    companyId,
    fieldExecutiveId: inserted.data.id,
    fullName,
    mobile: `${mobileCountryCode}${mobile}`,
    dropxId,
    biometricId,
    dateOfJoin: joiningDate,
    locationCode: station.data.station_code,
    locationName: station.data.station_name ?? "",
    providerName: providerRelation?.name ?? "",
    registrationToken,
    triggeredBy: session.profileId
  });

  return {
    id: inserted.data.id,
    dropxId,
    biometricId,
    onboardingStatus: inserted.data.onboarding_status,
    station: station.data.station_code,
    registrationToken,
    notification,
    reused: false
  };
}
