import { NextResponse } from "next/server";
import { canUseRecruitmentMenu, hasFullLeadAccess, recruitmentSession, requiredEnv } from "@/lib/recruitment-api";
import { loadUniversalRecruitmentPermissions, matchUniversalRole } from "@/lib/recruitment-menu-roles";
import {
  effectivePerformanceFunction,
  performanceActorIds,
  selectPerformanceMembers,
  type PerformanceMember,
  type PerformanceView
} from "@/lib/recruiter-performance-membership";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { loadAllSupabaseRows } from "@/lib/supabase-pagination";
import { loadWorkforceConfig, workforceFunctionFor } from "@/lib/recruitment-workforce-config";
import { influencerCandidateStage, influencerMilestoneProgress } from "@/lib/influencer-program";
import { WORKFORCE_PROFILE_TABLE } from "@/lib/workforce-register";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

type LeadRow = {
  id: string;
  assigned_profile_id: string | null;
  full_name: string | null;
  phone: string | null;
  status: string;
  final_status: string | null;
  location_id: string | null;
  role_id: string | null;
  lead_created_at: string | null;
  updated_at: string | null;
  recruitment_locations: { code?: string | null; name?: string | null } | null;
  recruitment_roles: { code?: string | null; name?: string | null } | null;
};

type HistoryRow = {
  id?: string;
  lead_id: string;
  event_type: string;
  new_value: string | null;
  actor_profile_id: string | null;
  actor_email: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type FieldExecutiveRow = {
  id:string; full_name:string; mobile:string; email:string; date_of_join:string;
  dropx_id:string|null; biometric_id:string|null; designation:string|null;
  onboarding_status:string|null; is_active:boolean; created_by:string|null;
  created_at:string; updated_at:string|null;
  stations:{station_code?:string|null}|null;
};

function istDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function dateDaysAgo(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function validDate(value: string | null, fallback: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value ?? "") ? String(value) : fallback;
}

function chunks<T>(values: T[], size = 400) {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) =>
    values.slice(index * size, index * size + size)
  );
}

function cleanId(value: unknown) {
  return String(value ?? "").trim().toUpperCase();
}

function dayDifference(from: string, to: string) {
  return Math.floor((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86400000);
}

function istTimestamp(date: string, end = false) {
  return new Date(`${date}T${end ? "23:59:59.999" : "00:00:00.000"}+05:30`).toISOString();
}

export async function GET(request: Request) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase is not configured.");
    const session = await recruitmentSession(request);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const url = new URL(request.url);
    const requestedView = url.searchParams.get("view");
    const view: PerformanceView = requestedView === "combined"
      ? "combined"
      : requestedView === "influencer"
        ? "influencer"
        : "telecaller";
    const canViewTelecallers = canUseRecruitmentMenu(session, "Recruiter Performance", "view", "workforce")
      || canUseRecruitmentMenu(session, "Performance Center", "view", "workforce");
    const canViewCombined = canUseRecruitmentMenu(session, "Performance Center", "view", "workforce");
    const canViewInfluencers = canUseRecruitmentMenu(session, "Influencer Performance", "view", "workforce")
      || canViewCombined;
    if ((view === "telecaller" && !canViewTelecallers)
      || (view === "influencer" && !canViewInfluencers)
      || (view === "combined" && !canViewCombined)) {
      return NextResponse.json({ error: "Recruiter Performance access is required." }, { status: 403 });
    }

    const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
    const workforceConfig = await loadWorkforceConfig(companyId);
    const to = validDate(url.searchParams.get("to"), istDate());
    const from = validDate(url.searchParams.get("from"), to);
    if (from > to || dayDifference(from, to) > 366) {
      return NextResponse.json({ error: "Choose a valid date range of up to 366 days." }, { status: 400 });
    }

    if (!session.allLocations && !session.locationIds.length) {
      return NextResponse.json({
        from, to, users: [], lifecycle: [],
        totals: { handled:0, attempts:0, interviews:0, completed:0, selected:0, joined:0, retained30:0, deliveries:0 },
        opsSync: { available:true, matchedAssociates:0, latestActivityDate:null }
      });
    }
    const unrestrictedLeadScope = hasFullLeadAccess(session);
    const leadQuery = () => {
      let query = supabaseAdmin!
        .from("recruitment_leads")
        .select("id,assigned_profile_id,full_name,phone,status,final_status,location_id,role_id,lead_created_at,updated_at,recruitment_locations(code,name),recruitment_roles(code,name)")
        .eq("company_id", companyId)
        .eq("stream", "workforce");
      if (!unrestrictedLeadScope && !session.allLocations) query = query.in("location_id", session.locationIds);
      if (!unrestrictedLeadScope && session.roleIds.length) query = query.in("role_id", session.roleIds);
      return query;
    };
    const leads = await loadAllSupabaseRows<LeadRow>((pageFrom, pageTo) =>
      leadQuery().order("id", { ascending:true }).range(pageFrom, pageTo) as any
    );
    const leadIds = leads.map((lead) => lead.id);
    const leadById = new Map(leads.map((lead) => [lead.id, lead]));

    const historyColumns = "id,lead_id,event_type,new_value,actor_profile_id,actor_email,metadata,created_at";
    const leadIdSet = new Set(leadIds);
    const [profiles, companyPeriodHistory, companyJoiningHistory, fieldExecutives] = await Promise.all([
      loadAllSupabaseRows<any>((pageFrom, pageTo) => supabaseAdmin!.from("profiles")
        .select("id,full_name,email,role,role_id,location_scope_ids,is_active,is_master_owner")
        .eq("company_id", companyId).order("id", { ascending:true }).range(pageFrom, pageTo) as any),
      loadAllSupabaseRows<HistoryRow>((pageFrom, pageTo) => supabaseAdmin!
        .from("recruitment_lead_history").select(historyColumns)
        .eq("company_id", companyId)
        .gte("created_at", istTimestamp(from)).lte("created_at", istTimestamp(to, true))
        .order("created_at", { ascending:false }).order("id", { ascending:false })
        .range(pageFrom, pageTo) as any),
      loadAllSupabaseRows<HistoryRow>((pageFrom, pageTo) => supabaseAdmin!
        .from("recruitment_lead_history").select(historyColumns)
        .eq("company_id", companyId).eq("event_type", "workforce_joining_record")
        .order("created_at", { ascending:false }).order("id", { ascending:false })
        .range(pageFrom, pageTo) as any),
      loadAllSupabaseRows<FieldExecutiveRow>((pageFrom, pageTo) => supabaseAdmin!.from(WORKFORCE_PROFILE_TABLE)
        .select("id,full_name,mobile,email,date_of_join,dropx_id,biometric_id,designation,onboarding_status,is_active,created_by,created_at,updated_at,stations(station_code)")
        .eq("company_id", companyId).order("id", { ascending:true }).range(pageFrom, pageTo) as any)
    ]);
    const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
    const profileIdsByEmail = new Map<string, string[]>();
    for (const profile of profiles) {
      const email = String(profile.email ?? "").trim().toLowerCase();
      if (!email) continue;
      profileIdsByEmail.set(email, [...(profileIdsByEmail.get(email) ?? []), profile.id]);
    }
    // Load each company history stream once, then apply the already-authorised
    // workforce lead scope in memory. This preserves the exact visibility
    // rules while avoiding dozens of serial PostgREST chunk queries.
    const periodHistory = companyPeriodHistory.filter((event) => leadIdSet.has(event.lead_id));
    const allJoiningHistory = companyJoiningHistory.filter((event) => leadIdSet.has(event.lead_id));
    const leadLinkedExecutiveIds = new Set(allJoiningHistory
      .map((event)=>String(event.metadata?.field_executive_id??""))
      .filter(Boolean));
    const latestJoiningByLead = new Map<string, HistoryRow>();
    for (const event of allJoiningHistory) {
      if (!latestJoiningByLead.has(event.lead_id)) latestJoiningByLead.set(event.lead_id, event);
    }

    const actorIds = (event: HistoryRow) => performanceActorIds(event, profileIdsByEmail);
    const [accessResult, universalRolesResult, mainStationsResult, recruitmentLocationsResult, universalPermissions] = await Promise.all([
      supabaseAdmin.from("recruitment_user_access")
        .select("id,profile_id,can_access_workforce,can_access_all_locations,can_manage_users,is_active")
        .eq("company_id", companyId),
      supabaseAdmin.from("user_roles")
        .select("id,code,name,location_access_mode")
        .eq("is_active", true),
      supabaseAdmin.from("stations")
        .select("id,station_code")
        .eq("company_id", companyId).eq("is_active", true),
      supabaseAdmin.from("recruitment_locations")
        .select("id,code")
        .eq("company_id", companyId).eq("is_active", true),
      loadUniversalRecruitmentPermissions(companyId)
    ]);
    const rosterFailure = [accessResult, universalRolesResult, mainStationsResult, recruitmentLocationsResult]
      .find((result) => result.error);
    if (rosterFailure?.error) throw rosterFailure.error;
    const accessRows = accessResult.data ?? [];
    const accessIds = accessRows.map((row) => row.id);
    const locationScopeResult = accessIds.length
      ? await supabaseAdmin.from("recruitment_user_locations")
          .select("user_access_id,location_id").in("user_access_id", accessIds)
      : { data: [], error: null };
    if (locationScopeResult.error) throw locationScopeResult.error;
    const locationIdsByAccess = new Map<string, string[]>();
    for (const row of locationScopeResult.data ?? []) {
      locationIdsByAccess.set(row.user_access_id, [
        ...(locationIdsByAccess.get(row.user_access_id) ?? []), row.location_id
      ]);
    }
    const recruitmentLocationByCode = new Map((recruitmentLocationsResult.data ?? [])
      .map((location) => [String(location.code).trim().toUpperCase(), location.id]));
    const mainStationCodeById = new Map((mainStationsResult.data ?? [])
      .map((station) => [station.id, String(station.station_code).trim().toUpperCase()]));
    const accessByProfileId = new Map(accessRows.map((row) => [row.profile_id, row]));
    const members: PerformanceMember[] = profiles.flatMap((profile) => {
      const access = accessByProfileId.get(profile.id);
      if (!access) return [];
      const role = matchUniversalRole(universalRolesResult.data ?? [], profile.role_id, profile.role);
      const configured = workforceFunctionFor(
        profile.id,
        "workforce",
        access.can_manage_users === true,
        workforceConfig.userFunctions,
        [access.id],
        role?.code ?? profile.role,
        role?.name
      );
      const rolePermission = role
        ? universalPermissions.roles[role.id] ?? universalPermissions.roles[String(role.code ?? "").trim().toUpperCase()]
        : null;
      const performanceLevel = rolePermission?.menuAccess?.workforce?.["Recruiter Performance"] ?? "none";
      const effectiveFunction = effectivePerformanceFunction({
        configuredFunction: configured.function,
        canViewTelecallerPerformance: performanceLevel !== "none"
      });
      const explicitLocations = locationIdsByAccess.get(access.id) ?? [];
      const inheritedLocations = (Array.isArray(profile.location_scope_ids) ? profile.location_scope_ids : [])
        .map((stationId:unknown) => mainStationCodeById.get(String(stationId)))
        .map((code:string|undefined) => code ? recruitmentLocationByCode.get(code) : null)
        .filter((locationId:string|null|undefined): locationId is string => Boolean(locationId));
      const allMemberLocations = profile.is_master_owner === true || role?.location_access_mode === "all_locations"
        ? (recruitmentLocationsResult.data ?? []).map((location) => location.id)
        : [...new Set([...explicitLocations, ...inheritedLocations])];
      return [{
        profileId: profile.id,
        accessId: access.id,
        name: profile.full_name || profile.email || "Recruitment user",
        email: profile.email,
        function: effectiveFunction,
        reportingManagerProfileId: configured.reportingManagerProfileId,
        locationIds: allMemberLocations,
        active: profile.is_active !== false && access.is_active !== false,
        workforceEnabled: access.can_access_workforce === true
      } satisfies PerformanceMember];
    });
    const hasAllPerformanceAccess = canUseRecruitmentMenu(session,
      view === "influencer" ? "Influencer Performance" : "Recruiter Performance", "all", "workforce")
      || canUseRecruitmentMenu(session, "Performance Center", "all", "workforce");
    const roster = selectPerformanceMembers({
      members,
      viewerProfileId: session.profileId,
      viewerLocationIds: session.locationIds,
      allLocations: session.allLocations && hasAllPerformanceAccess,
      personalOnly: ["telecaller", "influencer"].includes(session.recruitmentFunction) && !hasAllPerformanceAccess,
      view
    });
    const visibleProfileIds = new Set(roster.map((member) => member.profileId));
    const rosterFunctionById = new Map(roster.map((member) => [member.profileId, member.function]));
    const allowedUser = (id: string) => visibleProfileIds.has(id);
    const users = new Map<string, {
      profileId:string; name:string; email:string | null;
      handled:Set<string>; attempts:number; noResponse:Set<string>; callBack:Set<string>;
      interviews:Set<string>; completed:Set<string>; noShow:Set<string>;
      selected:Set<string>; rejected:Set<string>; joined:Set<string>;
      onboarded:Set<string>;
      mtdJoined:Set<string>;
      retained30:Set<string>; activeAssociates:Set<string>; deliveries:number; activeDays:number;
    }>();
    const user = (id: string, fallbackEmail?: string | null) => {
      const profile = profileById.get(id);
      if (!users.has(id)) users.set(id, {
        profileId:id,
        name:profile?.full_name || fallbackEmail || "Recruitment user",
        email:profile?.email || fallbackEmail || null,
        handled:new Set(), attempts:0, noResponse:new Set(), callBack:new Set(),
        interviews:new Set(), completed:new Set(), noShow:new Set(),
        selected:new Set(), rejected:new Set(), joined:new Set(), onboarded:new Set(), mtdJoined:new Set(),
        retained30:new Set(), activeAssociates:new Set(), deliveries:0, activeDays:0
      });
      return users.get(id)!;
    };

    // Membership is authoritative and independent of period activity. Seed the
    // active roster first so a genuine telecaller remains visible with zeroes.
    for (const member of roster) user(member.profileId, member.email);

    const directExecutives = fieldExecutives;
    for (const executive of directExecutives) {
      const recruiterId = executive.created_by ?? "";
      if (!recruiterId || !allowedUser(recruiterId)) continue;
      const owner = user(recruiterId);
      const createdDate = executive.created_at.slice(0,10);
      if (createdDate >= from && createdDate <= to) owner.onboarded.add(executive.id);
      const isJoined = !leadLinkedExecutiveIds.has(executive.id)
        && executive.is_active && executive.onboarding_status === "active";
      if (isJoined && executive.date_of_join >= from && executive.date_of_join <= to) owner.joined.add(executive.id);
      const monthStart=`${to.slice(0,7)}-01`;
      const monthEnd=to.slice(0,7)===istDate().slice(0,7)?istDate():to;
      if(isJoined&&executive.date_of_join>=monthStart&&executive.date_of_join<=monthEnd){
        owner.mtdJoined.add(executive.id);
      }
    }

    const latestStatusByOwnerLead = new Map<string,string>();
    for (const event of periodHistory) {
      const visibleActorIds = actorIds(event).filter(allowedUser);
      if (!visibleActorIds.length) continue;
      const status = String(event.new_value ?? "").toLowerCase();
      for (const id of visibleActorIds) {
        const owner = user(id, event.actor_email);
        owner.handled.add(event.lead_id);
        const ownerLeadKey = `${id}::${event.lead_id}`;
        if (status && !latestStatusByOwnerLead.has(ownerLeadKey)) latestStatusByOwnerLead.set(ownerLeadKey,status);
        if (event.event_type === "contact_attempt" || ["no_response","call_back","contacting"].includes(status)) owner.attempts++;
        if (status === "no_response") owner.noResponse.add(event.lead_id);
        if (status === "call_back") owner.callBack.add(event.lead_id);
        if (["interview_scheduled","interview_rescheduled"].includes(status)) owner.interviews.add(event.lead_id);
        if ([
          "interview_completed", "joined", "interview_no_show", "no_response",
          "call_back", "not_interested", "not_fit", "long_distance"
        ].includes(status)) owner.completed.add(event.lead_id);
        if (status === "interview_no_show") owner.noShow.add(event.lead_id);
        if (status === "selected") owner.selected.add(event.lead_id);
        if (["rejected","not_fit","not_interested"].includes(status)) owner.rejected.add(event.lead_id);
      }
    }
    // "Handled" is action-based. Assignment or lead creation alone must not
    // inflate a recruiter's attended count.

    const joinings = [...latestJoiningByLead.values()].map((event) => {
      const metadata = event.metadata ?? {};
      const joiningDate = String(metadata.joining_date ?? event.created_at.slice(0, 10));
      const recruiterId = String(metadata.influencer_profile_id ?? metadata.telecaller_profile_id ?? metadata.recruiter_profile_id ?? event.actor_profile_id ?? "");
      return {
        event,
        lead: leadById.get(event.lead_id),
        joiningDate,
        recruiterId: recruiterId || actorIds(event).find(allowedUser) || "",
        providerEmployeeId: cleanId(metadata.provider_employee_id),
        employeeId: String(metadata.employee_id ?? "").trim(),
        companyIdValue: String(metadata.company_id_value ?? "").trim()
      };
    }).filter((item) => item.lead && item.recruiterId && allowedUser(item.recruiterId));

    for (const item of joinings) {
      if (item.joiningDate >= from && item.joiningDate <= to) {
        user(item.recruiterId, item.event.actor_email).joined.add(item.event.lead_id);
      }
      const monthStart=`${to.slice(0,7)}-01`;
      const monthEnd=to.slice(0,7)===istDate().slice(0,7)?istDate():to;
      if(item.joiningDate>=monthStart&&item.joiningDate<=monthEnd){
        user(item.recruiterId,item.event.actor_email).mtdJoined.add(item.event.lead_id);
      }
    }

    const directProviderIds = directExecutives.flatMap((executive) => [
      cleanId(executive.dropx_id), cleanId(executive.biometric_id)
    ]).filter(Boolean);
    const providerIds = [...new Set([
      ...joinings.map((item) => item.providerEmployeeId).filter(Boolean),
      ...directProviderIds
    ])];
    // Influencer milestones are cumulative from joining, not from whichever
    // reporting period the viewer selected.  Fetch enough verified operations
    // history to prove every configured milestone while the funnel counts
    // above remain strictly period-based.
    const influencerJoinDates = view === "influencer"
      ? [
          ...joinings.map((item) => item.joiningDate),
          ...directExecutives
            .filter((executive) => executive.created_by && allowedUser(executive.created_by))
            .map((executive) => executive.date_of_join || executive.created_at.slice(0, 10))
        ].filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && value <= to)
      : [];
    const milestoneLookback = dateDaysAgo(Math.max(366, workforceConfig.influencerProgram.attributionWindowDays));
    const earliestInfluencerJoin = influencerJoinDates.sort()[0];
    const opsFrom = view === "influencer" && earliestInfluencerJoin
      ? (earliestInfluencerJoin > milestoneLookback ? earliestInfluencerJoin : milestoneLookback)
      : from;
    const opsRows: Array<{
      provider_employee_id:string; provider_employee_name:string | null; work_date:string;
      station_code:string; total_delivery:number | string | null; total_activity:number | string | null;
    }> = [];
    let opsSync = { available:true, matchedAssociates:0, latestActivityDate:null as string | null, message:"Live from operations shipment data." };
    if (providerIds.length) {
      const opsPages = await Promise.all(chunks(providerIds, 300).map((ids) => supabaseAdmin!
        .from("cps_shipment_daily")
        .select("provider_employee_id,provider_employee_name,work_date,station_code,total_delivery,total_activity")
        .eq("company_id", companyId)
        .in("provider_employee_id", ids)
        .gte("work_date", opsFrom)
        .lte("work_date", to)
        .limit(20000)));
      const failedOps = opsPages.find((page) => page.error);
      if (failedOps?.error) {
        opsSync = { available:false, matchedAssociates:0, latestActivityDate:null, message:"Operations performance source is not available in this database." };
      } else {
        opsRows.push(...opsPages.flatMap((page) => page.data ?? []) as typeof opsRows);
      }
    }

    const opsById = new Map<string, { dates:Set<string>; deliveries:number; activity:number; lastDate:string | null; name:string | null; station:string | null }>();
    for (const row of opsRows) {
      const id = cleanId(row.provider_employee_id);
      const current = opsById.get(id) ?? { dates:new Set(), deliveries:0, activity:0, lastDate:null, name:null, station:null };
      if (Number(row.total_delivery || 0) > 0 || Number(row.total_activity || 0) > 0) current.dates.add(row.work_date);
      current.deliveries += Number(row.total_delivery || 0);
      current.activity += Number(row.total_activity || 0);
      if (!current.lastDate || row.work_date > current.lastDate) current.lastDate = row.work_date;
      current.name ||= row.provider_employee_name;
      current.station ||= row.station_code;
      opsById.set(id, current);
    }
    const directOpsFor = (executive: FieldExecutiveRow) => [
      cleanId(executive.dropx_id), cleanId(executive.biometric_id)
    ].map((id) => opsById.get(id)).filter(Boolean)
      .sort((left, right) => (right?.dates.size ?? 0) - (left?.dates.size ?? 0))[0];
    opsSync.matchedAssociates = opsById.size;
    opsSync.latestActivityDate = [...opsById.values()].map((item) => item.lastDate).filter(Boolean).sort().at(-1) ?? null;

    const joiningByLead = new Map(joinings.map((item) => [item.event.lead_id, item]));
    const lifecycleStatuses = new Set([
      "interview_scheduled","interview_rescheduled","interview_completed","interview_no_show",
      "selected","rejected","documents_pending","offer_pending","offered","joined","did_not_join"
    ]);
    const interviewStatuses = new Set([
      "interview_scheduled","interview_rescheduled","interview_completed","interview_no_show"
    ]);
    const latestLifecycleEvent = new Map<string, HistoryRow>();
    const latestInterviewEvent = new Map<string, HistoryRow>();
    for (const event of periodHistory) {
      const eventStatus = String(event.new_value ?? "").toLowerCase();
      if (lifecycleStatuses.has(eventStatus) && !latestLifecycleEvent.has(event.lead_id)) {
        latestLifecycleEvent.set(event.lead_id, event);
      }
      if (interviewStatuses.has(eventStatus) && !latestInterviewEvent.has(event.lead_id)) {
        latestInterviewEvent.set(event.lead_id, event);
      }
    }

    for (const item of joinings) {
      const ops = opsById.get(item.providerEmployeeId);
      const retained30 = Boolean(ops && (
        ops.dates.size >= 30 ||
        (ops.lastDate && dayDifference(item.joiningDate, ops.lastDate) >= 29)
      ));
      const owner = user(item.recruiterId, item.event.actor_email);
      if (ops) {
        owner.activeAssociates.add(item.event.lead_id);
        owner.deliveries += ops.deliveries;
        owner.activeDays += ops.dates.size;
      }
      if (retained30) owner.retained30.add(item.event.lead_id);
    }
    for (const executive of directExecutives) {
      const recruiterId = executive.created_by ?? "";
      if (!recruiterId || !allowedUser(recruiterId)) continue;
      const ops = directOpsFor(executive);
      if (!ops) continue;
      const owner = user(recruiterId);
      owner.activeAssociates.add(executive.id);
      owner.deliveries += ops.deliveries;
      owner.activeDays += ops.dates.size;
      if (ops.dates.size >= 30) owner.retained30.add(executive.id);
    }

    const lifecycleLeadIds = new Set([
      ...latestLifecycleEvent.keys(),
      ...joinings.map((item) => item.event.lead_id)
    ]);
    const lifecycle:any[] = [...lifecycleLeadIds].map((leadId) => {
      const lead = leadById.get(leadId);
      if (!lead) return null;
      const joining = joiningByLead.get(leadId);
      const latestEvent = latestLifecycleEvent.get(leadId);
      const interviewEvent = latestInterviewEvent.get(leadId);
      const recruiterId = joining?.recruiterId || (latestEvent ? actorIds(latestEvent).find(allowedUser) : "") || lead.assigned_profile_id || "";
      if (!recruiterId || !allowedUser(recruiterId)) return null;
      const ops = joining ? opsById.get(joining.providerEmployeeId) : undefined;
      const retained30 = Boolean(joining && ops && (
        ops.dates.size >= 30 ||
        (ops.lastDate && dayDifference(joining.joiningDate, ops.lastDate) >= 29)
      ));
      const milestone=influencerMilestoneProgress(ops?.dates.size??0,workforceConfig.influencerProgram.milestones);
      return {
        leadId:lead.id,
        candidate:lead.full_name || "Unnamed candidate",
        phone:lead.phone,
        station:lead.recruitment_locations?.code || ops?.station || "Unmapped",
        role:lead.recruitment_roles?.name || "Unmapped role",
        recruiterProfileId:recruiterId,
        recruiter:user(recruiterId, joining?.event.actor_email || latestEvent?.actor_email).name,
        lifecycleStage:lead.status || "new",
        interviewOutcome:interviewEvent?.new_value || (
          ["interview_scheduled","interview_rescheduled","interview_completed","interview_no_show"].includes(lead.status)
            ? lead.status
            : null
        ),
        interviewAt:interviewEvent?.created_at || null,
        latestOutcome:latestEvent?.new_value || lead.final_status || lead.status || "new",
        outcomeAt:latestEvent?.created_at || joining?.event.created_at || lead.updated_at,
        joiningDate:joining?.joiningDate || null,
        employeeId:joining?.employeeId || null,
        providerEmployeeId:joining?.providerEmployeeId || null,
        companyId:joining?.companyIdValue || null,
        activeDays:ops?.dates.size ?? 0,
        deliveries:ops?.deliveries ?? 0,
        lastActiveDate:ops?.lastDate ?? null,
        retained30,
        opsLinked:Boolean(ops),
        candidateStage:joining?"Active":influencerCandidateStage(lead.status,false),
        earnedAmount:milestone.earnedAmount,
        nextMilestoneDays:milestone.nextMilestoneDays,
        nextMilestoneAmount:milestone.nextMilestoneAmount,
        daysRemaining:milestone.daysRemaining,
        milestoneCompleted:milestone.completed
      };
    }).filter(Boolean);
    for (const executive of directExecutives) {
      if(leadLinkedExecutiveIds.has(executive.id))continue;
      const recruiterId=executive.created_by??"";
      if(!recruiterId||!allowedUser(recruiterId))continue;
      const ops=directOpsFor(executive);
      const createdInPeriod=executive.created_at.slice(0,10)>=from&&executive.created_at.slice(0,10)<=to;
      const updatedInPeriod=String(executive.updated_at??executive.created_at).slice(0,10)>=from
        &&String(executive.updated_at??executive.created_at).slice(0,10)<=to;
      if(!createdInPeriod&&!updatedInPeriod&&!ops)continue;
      const joined=executive.is_active&&executive.onboarding_status==="active";
      const milestone=influencerMilestoneProgress(ops?.dates.size??0,workforceConfig.influencerProgram.milestones);
      lifecycle.push({
        leadId:`field-executive:${executive.id}`,
        candidate:executive.full_name,
        phone:executive.mobile,
        station:executive.stations?.station_code||"Unmapped",
        role:executive.designation||"Unmapped role",
        recruiterProfileId:recruiterId,
        recruiter:user(recruiterId).name,
        lifecycleStage:executive.onboarding_status||"pending",
        interviewOutcome:null,
        interviewAt:null,
        latestOutcome:executive.onboarding_status||"pending",
        outcomeAt:executive.updated_at||executive.created_at,
        joiningDate:joined?executive.date_of_join:null,
        employeeId:executive.dropx_id,
        providerEmployeeId:executive.dropx_id||executive.biometric_id||null,
        companyId:null,
        activeDays:ops?.dates.size??0,
        deliveries:ops?.deliveries??0,
        lastActiveDate:ops?.lastDate??null,
        retained30:(ops?.dates.size??0)>=30,
        opsLinked:Boolean(ops),
        biometricId:executive.biometric_id,
        source:"direct_onboarding",
        candidateStage:influencerCandidateStage(executive.onboarding_status,executive.is_active),
        earnedAmount:milestone.earnedAmount,
        nextMilestoneDays:milestone.nextMilestoneDays,
        nextMilestoneAmount:milestone.nextMilestoneAmount,
        daysRemaining:milestone.daysRemaining,
        milestoneCompleted:milestone.completed
      });
    }
    lifecycle.sort((left,right)=>String(right?.outcomeAt||"").localeCompare(String(left?.outcomeAt||""))).splice(1000);

    const userRows = [...users.values()].map((item) => ({
      profileId:item.profileId,
      name:item.name,
      email:item.email,
      function:rosterFunctionById.get(item.profileId) ?? "viewer",
      handled:item.handled.size,
      attempts:item.attempts,
      noResponse:item.noResponse.size,
      callBack:item.callBack.size,
      interviews:item.interviews.size,
      completed:item.completed.size,
      noShow:item.noShow.size,
      selected:item.selected.size,
      onboarded:item.onboarded.size,
      rejected:item.rejected.size,
      joined:item.joined.size,
      mtdJoined:item.mtdJoined.size,
      retained30:item.retained30.size,
      activeAssociates:item.activeAssociates.size,
      activeDays:item.activeDays,
      deliveries:item.deliveries,
      interviewToJoinRate:item.interviews.size ? Math.round(item.joined.size / item.interviews.size * 100) : 0,
      leadToJoinRate:item.handled.size ? Math.round(item.joined.size / item.handled.size * 100) : 0
    })).sort((left,right)=>right.joined-left.joined || right.interviews-left.interviews || right.handled-left.handled);

    const totals = userRows.reduce((total,row)=>({
      handled:total.handled+row.handled,
      onboarded:total.onboarded+row.onboarded,
      attempts:total.attempts+row.attempts,
      interviews:total.interviews+row.interviews,
      completed:total.completed+row.completed,
      selected:total.selected+row.selected,
      joined:total.joined+row.joined,
      retained30:total.retained30+row.retained30,
      deliveries:total.deliveries+row.deliveries
    }), { handled:0, onboarded:0, attempts:0, interviews:0, completed:0, selected:0, joined:0, retained30:0, deliveries:0 });

    const breakdown=[...users.values()].flatMap((owner)=>{
      const groups=new Map<string,{recruiterProfileId:string;recruiter:string;station:string;designation:string;attended:number;interviews:number;selected:number;joined:number;statusCounts:Record<string,number>}>();
      for(const leadId of owner.handled){
        const lead=leadById.get(leadId);if(!lead)continue;
        const station=lead.recruitment_locations?.code||"Unmapped";
        const designation=lead.recruitment_roles?.code||lead.recruitment_roles?.name||"Unmapped";
        const key=`${station}::${designation}`;
        const item=groups.get(key)??{recruiterProfileId:owner.profileId,recruiter:owner.name,station,designation,attended:0,interviews:0,selected:0,joined:0,statusCounts:{}};
        item.attended++;
        if(owner.interviews.has(leadId))item.interviews++;
        if(owner.selected.has(leadId))item.selected++;
        if(owner.joined.has(leadId))item.joined++;
        const statusKey=owner.joined.has(leadId)
          ? "joined"
          : latestStatusByOwnerLead.get(`${owner.profileId}::${leadId}`) || String(lead.status||"no_status").toLowerCase();
        item.statusCounts[statusKey]=(item.statusCounts[statusKey]||0)+1;
        groups.set(key,item);
      }
      return [...groups.values()];
    }).sort((a,b)=>b.attended-a.attended||a.station.localeCompare(b.station));
    const statusTotals=breakdown.reduce((totals,row)=>{
      for(const [status,count] of Object.entries(row.statusCounts))totals[status]=(totals[status]||0)+Number(count||0);
      return totals;
    },{} as Record<string,number>);
    const statusBreakdown=Object.entries(statusTotals).map(([status,count])=>({status,count})).sort((a,b)=>b.count-a.count||a.status.localeCompare(b.status));
    const mtdJoined=userRows.reduce((sum,row)=>sum+row.mtdJoined,0);
    const visibleLifecycle = view === "influencer"
      ? lifecycle.filter((item) => rosterFunctionById.get(String(item.recruiterProfileId)) === "influencer")
      : lifecycle;
    const influencerEarned = visibleLifecycle.reduce((sum, item) => sum + Number(item.earnedAmount ?? 0), 0);
    return NextResponse.json({
      view, from, to, users:userRows, lifecycle:visibleLifecycle,
      totals:{...totals,mtdJoined,influencerEarned}, breakdown, statusBreakdown, opsSync,
      influencerProgram: workforceConfig.influencerProgram
    });
  } catch (error) {
    console.error("Recruiter performance failed", error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Unable to load recruiter performance."
    }, { status: 500 });
  }
}
