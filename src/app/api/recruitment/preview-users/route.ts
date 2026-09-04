import { NextResponse } from "next/server";
import { recruitmentSession, requiredEnv } from "@/lib/recruitment-api";
import { loadUniversalRecruitmentPermissions, matchUniversalRole } from "@/lib/recruitment-menu-roles";
import { loadWorkforceConfig, workforceFunctionFor } from "@/lib/recruitment-workforce-config";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { loadPeopleDesignations } from "@/lib/people-designation";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase is not configured.");
    const session = await recruitmentSession(request);
    if (!session?.canPreviewUsers) {
      return NextResponse.json({ error: "Owner access is required." }, { status: 403 });
    }
    const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
    // Do not rely on an embedded profiles join here.  Access Control loads the
    // universal profile and Recruitment access independently, and the preview
    // selector must use the same source of truth.  The embedded join used to
    // silently omit valid users (for example Athul) when the relationship cache
    // was stale or the profile row lived outside the join's inferred scope.
    const [access, profiles, universalPermissions] = await Promise.all([
      supabaseAdmin.from("recruitment_user_access")
        .select("id,profile_id,can_access_workforce,can_access_hr,can_manage_users")
        .eq("company_id", companyId).eq("is_active", true),
      supabaseAdmin.from("profiles")
        .select("id,full_name,email,employee_id,role,role_id,is_active,is_master_owner")
        .eq("company_id", companyId).eq("is_active", true),
      loadUniversalRecruitmentPermissions(companyId)
    ]);
    if (access.error || profiles.error) throw access.error || profiles.error;
    let roles = await supabaseAdmin.from("user_roles")
      .select("id,code,name")
      .eq("company_id", companyId)
      .eq("is_active", true);
    if (!roles.error && !(roles.data ?? []).length) {
      roles = await supabaseAdmin.from("user_roles")
        .select("id,code,name")
        .eq("is_active", true);
    }
    if (roles.error) throw roles.error;
    const workforceConfig = await loadWorkforceConfig(companyId);
    const profileById = new Map((profiles.data ?? []).map((profile: any) => [profile.id, profile]));
    const peopleDesignations = await loadPeopleDesignations(companyId, (profiles.data ?? []).map((profile: any) => profile.id));
    const users = (access.data ?? []).flatMap((row: any) => {
      const profile = profileById.get(row.profile_id) as any;
      if (!profile?.is_active) return [];
      const role = matchUniversalRole(roles.data ?? [], profile.role_id, profile.role);
      const isOwner = profile.is_master_owner === true
        || String(role?.code ?? profile.role ?? "").trim().toUpperCase() === "OWNER";
      const rolePermission = role
        ? universalPermissions.roles[role.id]
          ?? universalPermissions.roles[String(role.code ?? "").trim().toUpperCase()]
        : universalPermissions.roles[String(profile.role ?? "").trim().toUpperCase()];
      const workspaces = isOwner
        ? ["workforce", "hr"]
        : rolePermission?.workspaces ?? [
            ...(row.can_access_workforce ? ["workforce"] : []),
            ...(row.can_access_hr ? ["hr"] : [])
          ];
      if (!workspaces.length) return [];
      const configuredFunction = workforceFunctionFor(
        row.profile_id,
        undefined,
        row.can_manage_users === true,
        workforceConfig.userFunctions,
        [row.id],
        role?.code ?? profile.role,
        role?.name
      );
      return [{
        profileId: row.profile_id,
        name: profile.full_name || profile.email || "Unnamed user",
        email: profile.email,
        employeeId: profile.employee_id,
        designationCode: configuredFunction.designationCode
          || String(profile.role || role?.code || "").trim().toUpperCase()
          || null,
        roleName: peopleDesignations.get(profile.id)?.name || role?.name || null,
        designationName: peopleDesignations.get(profile.id)?.name || null,
        workforce: workspaces.includes("workforce"),
        hr: workspaces.includes("hr")
      }];
    }).sort((first, second) => first.name.localeCompare(second.name));
    return NextResponse.json(
      { users, viewerProfileId: session.viewerProfileId },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } }
    );
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Unable to load preview users."
    }, { status: 500 });
  }
}
