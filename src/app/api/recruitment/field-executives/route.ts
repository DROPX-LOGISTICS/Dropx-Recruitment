import { NextResponse } from "next/server";
import { canUseRecruitmentMenu, recruitmentSession, requiredEnv } from "@/lib/recruitment-api";
import { loadWorkforceConfig, workforceTeamProfileIds } from "@/lib/recruitment-workforce-config";
import { createWorkforceFieldExecutive } from "@/lib/workforce-onboarding";
import { isFieldExecutiveDesignation } from "@/lib/field-executive-designations";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { assertWorkforceDesignationRoute, workforceDesignationIds } from "@/lib/designation-register-routing";
import {
  canApproveWorkforceProfileChanges,
  canCloseWorkforceInvitation,
  canRequestWorkforceProfileChange
} from "@/lib/workforce-profile-changes";
import { WORKFORCE_PROFILE_TABLE } from "@/lib/workforce-register";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const csv = (value: string | null) => (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
const clean = (value: unknown, limit = 180) => String(value ?? "").trim().slice(0, limit);
const profileChangeColumns = "id,field_executive_id,requested_by,status,current_values,proposed_values,reviewed_by,review_note,reviewed_at,created_at,updated_at";
const closureEventColumns = "field_executive_id,actor_user_id,remarks,metadata,created_at";

async function invitationCloseReasons(companyId: string) {
  const result = await supabaseAdmin!.from("workforce_invitation_close_reasons")
    .select("category,code,label,description,comment_required,display_order")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .order("display_order");
  if (result.error) throw new Error(result.error.message);
  return result.data ?? [];
}

async function invitationClosureEvents(companyId: string, fieldExecutiveIds: string[]) {
  if (!fieldExecutiveIds.length) return [] as any[];
  const result = await supabaseAdmin!.from("workforce_onboarding_events")
    .select(closureEventColumns)
    .eq("company_id", companyId)
    .eq("event_code", "invitation_cancelled")
    .in("field_executive_id", fieldExecutiveIds)
    .order("created_at", { ascending: false });
  if (result.error) throw new Error(result.error.message);
  return result.data ?? [];
}

async function profileChangeRequests(companyId: string, fieldExecutiveIds: string[]) {
  if (!fieldExecutiveIds.length) return [] as any[];
  const result = await supabaseAdmin!.from("workforce_profile_change_requests")
    .select(profileChangeColumns)
    .eq("company_id", companyId)
    .in("field_executive_id", fieldExecutiveIds)
    .order("created_at", { ascending: false });
  if (result.error) throw new Error(result.error.message);
  return result.data ?? [];
}

async function pendingApprovalQueue(companyId: string, enabled: boolean) {
  if (!enabled) return [] as any[];
  const result = await supabaseAdmin!.from("workforce_profile_change_requests")
    .select(profileChangeColumns)
    .eq("company_id", companyId)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(100);
  if (result.error) throw new Error(result.error.message);
  return result.data ?? [];
}

function latestRequestByExecutive(requests: any[]) {
  const output = new Map<string, any>();
  for (const request of requests) {
    if (!output.has(request.field_executive_id)) output.set(request.field_executive_id, request);
  }
  return output;
}

export async function GET(request: Request) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase is not configured.");
    const session = await recruitmentSession(request);
    if (!session || !canUseRecruitmentMenu(session, "Field Executive Onboarding", "view", "workforce")) return NextResponse.json({ error: "Field Executive Onboarding access is required." }, { status: 403 });
    const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
    const url = new URL(request.url);
    const requestedScope = url.searchParams.get("scope") || "mine";
    const page = Math.max(1, Number(url.searchParams.get("page") || 1));
    const limit = 50;
    const search = (url.searchParams.get("search") || "").trim();
    const statuses = csv(url.searchParams.get("status"));
    const stationCodes = csv(url.searchParams.get("station")).map((item) => item.toUpperCase());
    const designationFilters = csv(url.searchParams.get("designation"));
    const config = await loadWorkforceConfig(companyId);
    let creatorIds = [session.profileId];
    let scope = "mine";
    const fullScope = canUseRecruitmentMenu(session, "Field Executive Onboarding", "all", "workforce");
    const canViewTeam = fullScope || session.recruitmentFunction === "manager";
    if (requestedScope === "team" && canViewTeam) {
      creatorIds = workforceTeamProfileIds(session.profileId, config.userFunctions);
      scope = "team";
    } else if (requestedScope === "all" && fullScope) {
      creatorIds = [];
      scope = "all";
    }

    let stationIds: string[] = [];
    if (stationCodes.length) {
      const result = await supabaseAdmin.from("stations").select("id")
        .eq("company_id", companyId).in("station_code", stationCodes);
      if (result.error) throw new Error(result.error.message);
      stationIds = (result.data ?? []).map((item) => item.id);
      if (!stationIds.length) return NextResponse.json({ executives: [], total: 0, page, scope, facets: { statuses: [], stations: [], designations: [] } });
    }

    let query = supabaseAdmin.from(WORKFORCE_PROFILE_TABLE)
      .select("id,full_name,mobile_country_code,mobile,email,date_of_join,dropx_id,biometric_id,designation,is_active,onboarding_status,onboarding_submitted_at,onboarding_reviewed_at,onboarding_reviewed_by,onboarding_review_remarks,profile_return_remarks,location_id,created_by,created_at,updated_at,stations(station_code,station_name,cluster)", { count: "exact" })
      .eq("company_id", companyId);
    if (creatorIds.length) query = query.in("created_by", creatorIds);
    if (stationIds.length) query = query.in("location_id", stationIds);
    if (designationFilters.length) query = query.in("designation", designationFilters);
    if (statuses.length) {
      const active = statuses.includes("active");
      const inactive = statuses.includes("inactive");
      const onboarding = statuses.filter((item) => !["active", "inactive"].includes(item));
      if (active && !inactive && !onboarding.length) query = query.eq("is_active", true);
      else if (inactive && !active && !onboarding.length) {
        query = query.eq("is_active", false)
          .or("onboarding_status.is.null,onboarding_status.in.(inactive,rejected,cancelled)");
      }
      else if (onboarding.length) query = query.in("onboarding_status", onboarding);
    }
    if (search) {
      const safe = search.replace(/[,%()]/g, " ");
      query = query.or(`full_name.ilike.%${safe}%,mobile.ilike.%${safe}%,email.ilike.%${safe}%,dropx_id.ilike.%${safe}%,biometric_id.ilike.%${safe}%`);
    }
    const result = await query.order("created_at", { ascending: false }).range((page - 1) * limit, page * limit - 1);
    if (result.error) throw new Error(result.error.message);
    const canApproveChanges = canApproveWorkforceProfileChanges(session);
    const executiveIds = (result.data ?? []).map((item: any) => item.id);
    const [visibleRequests, approvalRequests, closureEvents, closeReasons] = await Promise.all([
      profileChangeRequests(companyId, executiveIds),
      pendingApprovalQueue(companyId, canApproveChanges),
      invitationClosureEvents(companyId, executiveIds),
      invitationCloseReasons(companyId)
    ]);
    const approvalExecutiveIds = [...new Set(approvalRequests.map((item: any) => item.field_executive_id).filter(Boolean))];
    const approvalExecutives = approvalExecutiveIds.length
      ? await supabaseAdmin.from(WORKFORCE_PROFILE_TABLE)
          .select("id,full_name,mobile_country_code,mobile,email,date_of_join,dropx_id,biometric_id,designation,is_active,onboarding_status,location_id,stations(station_code,station_name,cluster)")
          .eq("company_id", companyId)
          .in("id", approvalExecutiveIds)
      : { data: [], error: null };
    if (approvalExecutives.error) throw new Error(approvalExecutives.error.message);
    const profileIds = [...new Set([
      ...(result.data ?? []).map((item: any) => item.created_by),
      ...visibleRequests.map((item: any) => item.requested_by),
      ...approvalRequests.map((item: any) => item.requested_by),
      ...closureEvents.map((item: any) => item.actor_user_id)
    ].filter(Boolean))];
    const profiles = profileIds.length
      ? await supabaseAdmin.from("profiles").select("id,full_name,email").eq("company_id", companyId).in("id", profileIds)
      : { data: [], error: null };
    if (profiles.error) throw new Error(profiles.error.message);
    const profileMap = new Map((profiles.data ?? []).map((item) => [item.id, item]));
    const latestRequests = latestRequestByExecutive(visibleRequests);
    const latestClosures = new Map<string, any>();
    for (const event of closureEvents) {
      if (!latestClosures.has(event.field_executive_id)) latestClosures.set(event.field_executive_id, event);
    }
    const teamProfileIds = session.recruitmentFunction === "manager" || fullScope
      ? workforceTeamProfileIds(session.profileId, config.userFunctions)
      : [];
    const executives = (result.data ?? []).map((item: any) => ({
      ...item,
      initiatedBy: profileMap.get(item.created_by)?.full_name || profileMap.get(item.created_by)?.email || "DropX user",
      canRequestEdit: canRequestWorkforceProfileChange(session.profileId, item.created_by)
        && item.onboarding_status !== "cancelled"
        && latestRequests.get(item.id)?.status !== "pending",
      canCloseInvitation: canCloseWorkforceInvitation(session.profileId, item, {
        fullScope,
        teamProfileIds,
        allLocations: session.allLocations,
        locationIds: session.locationIds,
        readOnly: session.readOnly
      }),
      changeRequest: latestRequests.get(item.id) ?? null,
      closure: latestClosures.has(item.id) ? {
        ...latestClosures.get(item.id),
        closedBy: profileMap.get(latestClosures.get(item.id).actor_user_id)?.full_name
          || profileMap.get(latestClosures.get(item.id).actor_user_id)?.email
          || "DropX user"
      } : null
    }));
    const approvalExecutiveMap = new Map((approvalExecutives.data ?? []).map((item: any) => [item.id, item]));
    const approvalQueue = approvalRequests.flatMap((item: any) => {
      const executive = approvalExecutiveMap.get(item.field_executive_id);
      if (!executive) return [];
      const requester = profileMap.get(item.requested_by);
      return [{
        ...item,
        executive,
        requestedBy: requester?.full_name || requester?.email || "Recruitment user"
      }];
    });
    let allowedRecruitmentLocations = supabaseAdmin.from("recruitment_locations")
      .select("id,code").eq("company_id", companyId).eq("is_active", true);
    let allowedRecruitmentRoles = supabaseAdmin.from("recruitment_roles")
      .select("id,code,name").eq("company_id", companyId).eq("stream", "workforce").eq("is_active", true);
    if (!session.allLocations) allowedRecruitmentLocations = allowedRecruitmentLocations.in("id", session.locationIds);
    if (session.roleIds.length) allowedRecruitmentRoles = allowedRecruitmentRoles.in("id", session.roleIds);
    const [recruitmentLocations, recruitmentRoles] = await Promise.all([
      allowedRecruitmentLocations.order("code"),
      allowedRecruitmentRoles.order("name")
    ]);
    if (recruitmentLocations.error || recruitmentRoles.error) {
      throw new Error(recruitmentLocations.error?.message || recruitmentRoles.error?.message);
    }
    const permittedStationCodes = (recruitmentLocations.data ?? []).map((item) => item.code);
    const permittedRoleKeys = new Set((recruitmentRoles.data ?? [])
      .flatMap((item) => [String(item.code ?? "").toLowerCase(), String(item.name ?? "").toLowerCase()])
      .filter(Boolean));
    let stationsQuery = supabaseAdmin.from("stations")
      .select("id,station_code,station_name,cluster,location_model_id")
      .eq("company_id", companyId).eq("is_active", true);
    if (!session.allLocations) {
      if (!permittedStationCodes.length) {
        return NextResponse.json({
          executives, total: result.count ?? 0, page, scope,
          canViewTeam,
          canViewAll: fullScope,
          facets: { statuses: ["pending","submitted","under_review","returned","approved","rejected","cancelled","active","inactive"], stations: [], designations: [] },
          master: { locations: [], designations: [], invitationCloseReasons: closeReasons }
        });
      }
      stationsQuery = stationsQuery.in("station_code", permittedStationCodes);
    }
    const [stations, designationMaster, routedDesignationIds] = await Promise.all([
      stationsQuery.order("station_code"),
      supabaseAdmin.from("designations")
        .select("id,code,name,model_ids,onboarding_categories,profile_field_rules")
        .eq("company_id", companyId).eq("is_active", true).order("name"),
      workforceDesignationIds(companyId)
    ]);
    if (stations.error || designationMaster.error) throw new Error(stations.error?.message || designationMaster.error?.message);
    const masterLocations = (stations.data ?? []).map((item) => ({
      id: item.id,
      code: item.station_code,
      name: item.station_name,
      cluster: item.cluster,
      modelId: item.location_model_id
    }));
    const masterDesignations = (designationMaster.data ?? [])
      .filter((item) => routedDesignationIds.has(item.id) && isFieldExecutiveDesignation(item, permittedRoleKeys))
      .map((item) => ({
        id: item.id,
        code: item.code,
        name: item.name,
        modelIds: Array.isArray(item.model_ids) ? item.model_ids : [],
        profileFieldRules: item.profile_field_rules && typeof item.profile_field_rules === "object"
          ? item.profile_field_rules
          : {}
      }));
    return NextResponse.json({
      executives, total: result.count ?? 0, page, scope,
      canViewTeam,
      canViewAll: fullScope,
      canApproveChanges,
      approvalQueue,
      facets: {
        statuses: ["pending","submitted","under_review","returned","approved","rejected","cancelled","active","inactive"],
        stations: masterLocations.map((item) => item.code),
        designations: masterDesignations.map((item) => item.name)
      },
      master: { locations: masterLocations, designations: masterDesignations, invitationCloseReasons: closeReasons }
    });
  } catch (error) {
    console.error("Field Executive registry failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load Field Executives." }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await recruitmentSession(request);
    if (!session || !canUseRecruitmentMenu(session, "Field Executive Onboarding", "add", "workforce")) return NextResponse.json({ error: "Add access is required." }, { status: 403 });
    const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
    const body = await request.json();
    const created = await createWorkforceFieldExecutive(companyId, session, body);
    return NextResponse.json({ created, message: "Associate onboarding invitation created. Final activation is pending HO Workforce approval." });
  } catch (error) {
    console.error("Field Executive onboarding failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to create Field Executive." }, { status: 400 });
  }
}

async function requestedProfileValues(companyId: string, session: NonNullable<Awaited<ReturnType<typeof recruitmentSession>>>, body: any) {
  const fullName = clean(body.fullName, 120);
  const mobileCountryCode = clean(body.mobileCountryCode || "91", 5).replace(/\D/g, "") || "91";
  const mobile = clean(body.mobile, 30).replace(/\D/g, "").slice(-10);
  const email = clean(body.email, 180).toLowerCase();
  const joiningDate = clean(body.joiningDate, 20);
  const locationCode = clean(body.locationCode, 30).toUpperCase();
  const requestedDesignation = clean(body.designation, 100);
  if (!fullName) throw new Error("Full name is required.");
  if (!/^\d{10}$/.test(mobile)) throw new Error("Mobile number must contain exactly 10 digits.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(joiningDate)) throw new Error("Joining date is required.");
  if (!locationCode) throw new Error("Station is required.");
  if (!requestedDesignation) throw new Error("Designation is required.");

  const recruitmentLocation = await supabaseAdmin!.from("recruitment_locations")
    .select("id,code")
    .eq("company_id", companyId)
    .eq("code", locationCode)
    .eq("is_active", true)
    .maybeSingle();
  if (recruitmentLocation.error) throw new Error(recruitmentLocation.error.message);
  if (!recruitmentLocation.data || (!session.allLocations && !session.locationIds.includes(recruitmentLocation.data.id))) {
    throw new Error("You do not have access to the selected station.");
  }

  const station = await supabaseAdmin!.from("stations")
    .select("id,station_code,location_model_id")
    .eq("company_id", companyId)
    .eq("station_code", locationCode)
    .eq("is_active", true)
    .maybeSingle();
  if (station.error) throw new Error(station.error.message);
  if (!station.data) throw new Error("Selected station is not available in the main dashboard.");

  let allowedRecruitmentRoles = supabaseAdmin!.from("recruitment_roles")
    .select("id,code,name")
    .eq("company_id", companyId)
    .eq("stream", "workforce")
    .eq("is_active", true);
  if (session.roleIds.length) allowedRecruitmentRoles = allowedRecruitmentRoles.in("id", session.roleIds);
  const roles = await allowedRecruitmentRoles;
  if (roles.error) throw new Error(roles.error.message);
  const permittedRoleKeys = new Set((roles.data ?? [])
    .flatMap((item) => [String(item.code ?? "").toLowerCase(), String(item.name ?? "").toLowerCase()])
    .filter(Boolean));
  let designation = await supabaseAdmin!.from("designations")
    .select("id,code,name,model_ids,onboarding_categories")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .eq("name", requestedDesignation)
    .limit(1)
    .maybeSingle();
  if (!designation.data && !designation.error) {
    designation = await supabaseAdmin!.from("designations")
      .select("id,code,name,model_ids,onboarding_categories")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .eq("code", requestedDesignation)
      .limit(1)
      .maybeSingle();
  }
  if (designation.error) throw new Error(designation.error.message);
  if (!designation.data || !isFieldExecutiveDesignation(designation.data, permittedRoleKeys)) {
    throw new Error("Selected designation is not available for Workforce onboarding.");
  }
  await assertWorkforceDesignationRoute(companyId, designation.data.id);
  const modelIds = Array.isArray(designation.data.model_ids) ? designation.data.model_ids.map(String) : [];
  if (modelIds.length && station.data.location_model_id && !modelIds.includes(String(station.data.location_model_id))) {
    throw new Error("Selected designation is not available for this location model.");
  }

  return {
    full_name: fullName,
    mobile_country_code: mobileCountryCode,
    mobile,
    email,
    date_of_join: joiningDate,
    location_id: station.data.id,
    location_code: station.data.station_code,
    designation: designation.data.name
  };
}

export async function PATCH(request: Request) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase is not configured.");
    const session = await recruitmentSession(request);
    if (!session || !canUseRecruitmentMenu(session, "Field Executive Onboarding", "view", "workforce")) {
      return NextResponse.json({ error: "Field Executive Onboarding access is required." }, { status: 403 });
    }
    const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
    const body = await request.json();
    const action = clean(body.action, 40).toLowerCase();

    if (action === "close_invitation") {
      const fieldExecutiveId = clean(body.id, 80);
      const category = clean(body.category, 40).toLowerCase();
      const reasonCode = clean(body.reasonCode, 80).toUpperCase();
      const notes = clean(body.notes, 1000);
      if (!fieldExecutiveId) throw new Error("Workforce invitation is required.");
      if (!category || !reasonCode) throw new Error("Choose why this invitation is being closed.");

      const target = await supabaseAdmin.from(WORKFORCE_PROFILE_TABLE)
        .select("id,created_by,location_id,is_active,onboarding_status,onboarding_submitted_at")
        .eq("company_id", companyId)
        .eq("id", fieldExecutiveId)
        .maybeSingle();
      if (target.error) throw new Error(target.error.message);
      if (!target.data) throw new Error("Workforce invitation was not found.");
      const config = await loadWorkforceConfig(companyId);
      const fullScope = canUseRecruitmentMenu(session, "Field Executive Onboarding", "all", "workforce");
      const teamProfileIds = session.recruitmentFunction === "manager" || fullScope
        ? workforceTeamProfileIds(session.profileId, config.userFunctions)
        : [];
      if (!canCloseWorkforceInvitation(session.profileId, target.data, {
        fullScope,
        teamProfileIds,
        allLocations: session.allLocations,
        locationIds: session.locationIds,
        readOnly: session.readOnly
      })) {
        return NextResponse.json({ error: "You can only close your own pending invitation or an invitation within your configured management scope." }, { status: 403 });
      }

      const closed = await supabaseAdmin.rpc("close_pending_workforce_invitation", {
        p_company_id: companyId,
        p_field_executive_id: fieldExecutiveId,
        p_actor_id: session.profileId,
        p_category: category,
        p_reason_code: reasonCode,
        p_notes: notes || null
      });
      if (closed.error) throw new Error(closed.error.message);
      return NextResponse.json({
        closed: closed.data,
        message: "Invitation closed. The profile and decision history remain available for audit."
      });
    }

    if (action === "review_change") {
      if (!canApproveWorkforceProfileChanges(session)) {
        return NextResponse.json({ error: "Only a Business Head or Owner can approve profile corrections." }, { status: 403 });
      }
      const requestId = clean(body.requestId, 80);
      const decision = clean(body.decision, 20).toLowerCase();
      const reviewNote = clean(body.reviewNote, 1000);
      if (!requestId) throw new Error("Profile change request is required.");
      if (!["approved", "rejected"].includes(decision)) throw new Error("Choose Approve or Reject.");
      if (decision === "rejected" && !reviewNote) throw new Error("Enter a rejection reason.");

      const pending = await supabaseAdmin.from("workforce_profile_change_requests")
        .select("id,field_executive_id,status")
        .eq("company_id", companyId)
        .eq("id", requestId)
        .eq("status", "pending")
        .maybeSingle();
      if (pending.error) throw new Error(pending.error.message);
      if (!pending.data) throw new Error("Pending profile change request was not found.");
      const reviewed = await supabaseAdmin.rpc("review_workforce_profile_change_request", {
        p_company_id: companyId,
        p_request_id: requestId,
        p_approver_id: session.profileId,
        p_decision: decision,
        p_review_note: reviewNote || null
      });
      if (reviewed.error) throw new Error(reviewed.error.message);
      const event = await supabaseAdmin.from("workforce_onboarding_events").insert({
        company_id: companyId,
        field_executive_id: pending.data.field_executive_id,
        event_code: decision === "approved" ? "profile_change_approved" : "profile_change_rejected",
        from_status: "pending_change_approval",
        to_status: decision,
        remarks: reviewNote || `Profile correction ${decision} by ${session.displayName || session.email || "approver"}.`,
        actor_user_id: session.profileId,
        source_portal: "recruit",
        metadata: { change_request_id: requestId, approver_role: session.designationCode }
      });
      if (event.error) throw new Error(event.error.message);
      return NextResponse.json({ message: decision === "approved" ? "Profile correction approved and applied." : "Profile correction rejected." });
    }

    if (action !== "request_change") throw new Error("Profile change action is invalid.");
    const fieldExecutiveId = clean(body.id, 80);
    if (!fieldExecutiveId) throw new Error("Field Executive profile is required.");
    const target = await supabaseAdmin.from(WORKFORCE_PROFILE_TABLE)
      .select("id,full_name,mobile_country_code,mobile,email,date_of_join,location_id,designation,created_by,onboarding_status,stations(station_code)")
      .eq("company_id", companyId)
      .eq("id", fieldExecutiveId)
      .maybeSingle();
    if (target.error) throw new Error(target.error.message);
    if (!target.data) throw new Error("Field Executive profile was not found.");
    if (!canRequestWorkforceProfileChange(session.profileId, target.data.created_by)) {
      return NextResponse.json({ error: "You can only correct profiles that you initiated." }, { status: 403 });
    }

    const proposed = await requestedProfileValues(companyId, session, body);
    const [mobileDuplicate, emailDuplicate, pendingRequest] = await Promise.all([
      supabaseAdmin.from(WORKFORCE_PROFILE_TABLE).select("id").eq("company_id", companyId).eq("mobile", proposed.mobile).neq("id", fieldExecutiveId).limit(1),
      supabaseAdmin.from(WORKFORCE_PROFILE_TABLE).select("id").eq("company_id", companyId).ilike("email", proposed.email).neq("id", fieldExecutiveId).limit(1),
      supabaseAdmin.from("workforce_profile_change_requests").select("id").eq("company_id", companyId).eq("field_executive_id", fieldExecutiveId).eq("status", "pending").maybeSingle()
    ]);
    const duplicateError = mobileDuplicate.error || emailDuplicate.error || pendingRequest.error;
    if (duplicateError) throw new Error(duplicateError.message);
    if ((mobileDuplicate.data ?? []).length || (emailDuplicate.data ?? []).length) {
      throw new Error("The requested mobile number or email is already linked to another Workforce profile.");
    }
    if (pendingRequest.data) throw new Error("A profile correction is already waiting for approval.");

    const stationRelation = Array.isArray(target.data.stations) ? target.data.stations[0] : target.data.stations;
    const currentValues = {
      full_name: target.data.full_name,
      mobile_country_code: target.data.mobile_country_code,
      mobile: target.data.mobile,
      email: target.data.email,
      date_of_join: target.data.date_of_join,
      location_id: target.data.location_id,
      location_code: stationRelation?.station_code ?? null,
      designation: target.data.designation
    };
    if (JSON.stringify(currentValues) === JSON.stringify(proposed)) {
      throw new Error("Change at least one invitation detail before submitting.");
    }
    const inserted = await supabaseAdmin.from("workforce_profile_change_requests").insert({
      company_id: companyId,
      field_executive_id: fieldExecutiveId,
      requested_by: session.profileId,
      current_values: currentValues,
      proposed_values: proposed,
      status: "pending"
    }).select(profileChangeColumns).single();
    if (inserted.error) throw new Error(inserted.error.message);
    const event = await supabaseAdmin.from("workforce_onboarding_events").insert({
      company_id: companyId,
      field_executive_id: fieldExecutiveId,
      event_code: "profile_change_requested",
      from_status: target.data.onboarding_status ?? null,
      to_status: "pending_change_approval",
      remarks: `Invitation-detail correction requested by ${session.displayName || session.email || "recruitment user"}.`,
      actor_user_id: session.profileId,
      source_portal: "recruit",
      metadata: { change_request_id: inserted.data.id, approval_roles: ["BH", "BUSINESS_HEAD", "OWNER"] }
    });
    if (event.error) throw new Error(event.error.message);
    return NextResponse.json({ request: inserted.data, message: "Profile correction sent to the Business Head and Owner for approval." });
  } catch (error) {
    console.error("Field Executive profile change failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to process the profile correction." }, { status: 400 });
  }
}
