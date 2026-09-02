import { NextResponse } from "next/server";
import { canUseRecruitmentMenu, hasFullLeadAccess, recruitmentSession, requiredEnv } from "@/lib/recruitment-api";
import {
  defaultHiringManagerFor,
  loadMainDashboardHiringManagers,
  loadMainDashboardStations
} from "@/lib/main-dashboard-masters";
import { authoritativeRoleStream } from "@/lib/recruitment-routing";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { loadWorkforceConfig } from "@/lib/recruitment-workforce-config";
import { loadHrLifecycleRules, loadHrWorkflowSettings } from "@/lib/hr-recruitment-lifecycle";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase is not configured.");
    const session = await recruitmentSession(request);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
    const unrestrictedCatalog = hasFullLeadAccess(session);
    let locations = supabaseAdmin.from("recruitment_locations").select("id,code,name,cluster,state").eq("company_id", companyId).eq("is_active", true);
    let roles = supabaseAdmin.from("recruitment_roles").select("id,code,name,stream").eq("company_id", companyId).eq("is_active", true);
    if (!unrestrictedCatalog && !session.allLocations) locations = locations.in("id", session.locationIds);
    if (!unrestrictedCatalog && session.roleIds.length) roles = roles.in("id", session.roleIds);
    else if (!unrestrictedCatalog && session.workforce && !session.hr) roles = roles.eq("stream", "workforce");
    else if (!unrestrictedCatalog && session.hr && !session.workforce) roles = roles.eq("stream", "hr");
    const assignees = canUseRecruitmentMenu(session, "All Leads", "all")
      ? supabaseAdmin.from("recruitment_user_access")
          .select("profile_id,profiles(full_name,email)")
          .eq("company_id", companyId)
          .eq("is_active", true)
      : Promise.resolve({ data: [], error: null });
    const [locationResult, roleResult, assigneeResult, mainStations, hiringManagers, workforceConfig, lifecycleRules, lifecycleSettings] = await Promise.all([
      locations.order("code"),
      roles.order("code"),
      assignees,
      loadMainDashboardStations(companyId),
      session.hr ? loadMainDashboardHiringManagers(companyId) : Promise.resolve([]),
      loadWorkforceConfig(companyId),
      session.hr ? loadHrLifecycleRules(supabaseAdmin as any, companyId) : Promise.resolve([]),
      session.hr ? loadHrWorkflowSettings(supabaseAdmin as any, companyId) : Promise.resolve(null)
    ]);
    if (locationResult.error || roleResult.error || assigneeResult.error) {
      throw new Error(locationResult.error?.message || roleResult.error?.message || assigneeResult.error?.message);
    }
    return NextResponse.json({
      locations: (locationResult.data ?? []).map((location) => {
        const source = mainStations.find((station) => station.code === location.code);
        const recommendedByRole = Object.fromEntries((roleResult.data ?? [])
          .filter((role) => authoritativeRoleStream(role.code, role.stream) === "hr")
          .map((role) => [
            role.code,
            defaultHiringManagerFor(source, role.code, hiringManagers)?.id ?? null
          ]));
        return {
          ...location,
          name: source?.name ?? location.name,
          cluster: source?.cluster ?? location.cluster,
          clusterManager: source?.clusterManager ?? null,
          clusterManagerStatus: source?.clusterManagerStatus ?? "unmapped",
          state: source?.state ?? location.state,
          mainDashboardStationId: source?.id ?? null,
          manager: source?.managerId ? {
            id: source.managerId,
            name: source.managerName,
            email: source.managerEmail
          } : null,
          recommendedManagerByRole: recommendedByRole
        };
      }),
      roles: (roleResult.data ?? []).map((role) => ({
        ...role,
        stream: authoritativeRoleStream(role.code, role.stream) ?? role.stream
      })),
      statuses: [
        "__BLANK__","assigned","contacting","no_response","call_back","interested",
        "not_interested","not_fit","long_distance","wrong_number","interview_scheduled",
        "interview_rescheduled","interview_completed","interview_no_show","selected","hold",
        "rejected","documents_pending","offer_pending","offered","joined","did_not_join",
        "closed","unmapped","invalid"
      ],
      workforceStatuses: workforceConfig.leadStatusMaster.filter((item) => item.isActive && ["workforce","both"].includes(item.stream)),
      hrStatuses: lifecycleRules.filter((item) => item.isActive && item.firstCallAvailable).map((item) => ({
        code: item.code,
        label: item.label,
        isActive: item.isActive,
        requiresSchedule: item.requiresSchedule,
        scheduleType: item.notificationTrigger === "interview" ? "interview" : item.code === "call_back" ? "callback" : null
      })),
      hrLifecycleRules: lifecycleRules,
      hrWorkflowSettings: lifecycleSettings,
      finalStatuses: ["Joined","Dropped","Selected","Rejected","Hold"],
      assignees: (assigneeResult.data ?? []).map((item: any) => ({
        id: item.profile_id,
        name: item.profiles?.full_name || item.profiles?.email || "DropX user",
        email: item.profiles?.email || null
      })),
      hiringManagers: hiringManagers.map((manager) => ({
        id: manager.id,
        name: manager.name,
        email: manager.email,
        phone: manager.phone,
        employeeId: manager.employeeId,
        roleCode: manager.roleCode,
        roleName: manager.roleName
      }))
    });
  } catch (error) {
    console.error("Recruitment options failed", error);
    return NextResponse.json({ error: "Unable to load filter options." }, { status: 500 });
  }
}
