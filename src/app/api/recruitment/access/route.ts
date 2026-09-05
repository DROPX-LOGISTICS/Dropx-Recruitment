import { NextResponse } from "next/server";
import { normalizeIndianMobileE164 } from "@/lib/mobile-auth";
import { loadMainDashboardStations } from "@/lib/main-dashboard-masters";
import {
  loadUniversalRecruitmentPermissions,
  matchUniversalRole,
  recruitmentMenuCatalog,
  saveUniversalRecruitmentRolePermissions,
  type RecruitmentAccessTemplate
} from "@/lib/recruitment-menu-roles";
import { calculateEffectiveRecruitmentLocationScope } from "@/lib/recruitment-location-scope";
import { canUseRecruitmentMenu, recruitmentSession, requiredEnv } from "@/lib/recruitment-api";
import { invalidateMobileSessionCache } from "@/lib/mobile-session";
import { loadPeopleDesignations } from "@/lib/people-designation";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { loadWorkforceConfig } from "@/lib/recruitment-workforce-config";
import {
  activateRecruitmentUserWorkspace,
  isRecruitmentUserWorkspaceEnabled,
  type RecruitmentUserWorkspace
} from "@/lib/recruitment-user-workspaces";

export const dynamic = "force-dynamic";

async function loadMainUserRoles(companyId: string) {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  return supabaseAdmin.from("user_roles")
    .select("id,code,name,location_access_mode,parent_role_id,is_system,is_active")
    .eq("company_id", companyId)
    .eq("product_code", "recruit")
    .eq("is_active", true)
    .order("code");
}

async function loadRecruitDesignationAccess(companyId: string) {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  const [designations, policies, roles] = await Promise.all([
    supabaseAdmin.from("designations")
      .select("id,code,name,designation_category:designation_categories!designations_designation_category_id_fkey!inner(people_module,is_active)")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .eq("designation_category.people_module", "people_hr")
      .eq("designation_category.is_active", true)
      .order("name"),
    supabaseAdmin.from("designation_product_access_policies")
      .select("designation_id,is_enabled,default_role_id,location_access_mode")
      .eq("company_id", companyId)
      .eq("product_code", "recruit"),
    loadMainUserRoles(companyId)
  ]);
  if (designations.error || policies.error || roles.error) throw new Error(designations.error?.message ?? policies.error?.message ?? roles.error?.message ?? "Recruit designation access could not be loaded.");
  const policyByDesignation = new Map((policies.data ?? []).map((policy) => [policy.designation_id, policy]));
  const roleById = new Map((roles.data ?? []).map((role) => [role.id, role]));
  return {
    rows: (designations.data ?? []).flatMap((designation) => {
      const policy = policyByDesignation.get(designation.id);
      if (!policy?.is_enabled) return [];
      const role = policy?.default_role_id ? roleById.get(policy.default_role_id) ?? null : null;
      return [{
        designationId: designation.id,
        designationCode: designation.code,
        designationName: designation.name,
        enabled: true,
        role
      }];
    }),
    roles: roles.data ?? [],
    locationRole: (roles.data ?? []).find((role) => role.code === "RECRUIT_LOCATION") ?? null
  };
}

export async function GET(request: Request) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase is not configured.");
    const session = await recruitmentSession(request);
    if (!canUseRecruitmentMenu(session, "Access Control", "view") && !canUseRecruitmentMenu(session, "User Roles", "view")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
    const [allowlist, access, mobile, locationScopes, roleScopes, locations, roles, registeredProfiles, recruitDesignationAccess, productMemberships, workforceDesignations, mainStations, workforceConfig, universalPermissions] = await Promise.all([
      supabaseAdmin.from("recruitment_login_allowlist").select("email,display_name,access_template,is_active,created_at").eq("company_id", companyId).order("email"),
      supabaseAdmin.from("recruitment_user_access").select("id,profile_id,can_access_workforce,can_access_hr,can_access_all_locations,can_manage_masters,can_manage_ads,can_manage_users,is_active,profiles(full_name,email,mobile,phone,employee_id,role,role_id,location_scope_ids,is_active,is_master_owner)").eq("company_id", companyId),
      supabaseAdmin.from("recruitment_mobile_users").select("mobile_e164,display_name,is_active,profile_id").eq("company_id", companyId).order("display_name"),
      supabaseAdmin.from("recruitment_user_locations").select("user_access_id,location_id"),
      supabaseAdmin.from("recruitment_user_roles").select("user_access_id,role_id"),
      supabaseAdmin.from("recruitment_locations").select("id,code,name,is_active").eq("company_id", companyId).eq("is_active", true).order("code"),
      supabaseAdmin.from("recruitment_roles").select("id,code,name,stream,is_active").eq("company_id", companyId).eq("is_active", true).order("code"),
      supabaseAdmin.from("profiles").select("id,full_name,email,mobile,phone,employee_id,role,role_id,reports_to_user_id,location_scope_ids,invite_method,is_active,is_master_owner")
        .eq("company_id", companyId).eq("is_active", true).order("full_name"),
      loadRecruitDesignationAccess(companyId),
      supabaseAdmin.from("company_product_memberships").select("user_id,role_id,role_code_snapshot,has_all_location_access,location_scope_ids,is_active").eq("company_id", companyId).eq("product_code", "recruit").eq("is_active", true),
      supabaseAdmin.from("designations").select("code,name,is_active")
        .eq("company_id", companyId).eq("is_active", true).order("code"),
      loadMainDashboardStations(companyId),
      loadWorkforceConfig(companyId),
      loadUniversalRecruitmentPermissions(companyId)
    ]);
    const failure = [allowlist, access, mobile, locationScopes, roleScopes, locations, roles, registeredProfiles, productMemberships, workforceDesignations].find((item) => item.error);
    if (failure?.error) throw failure.error;
    const mainUserRoles = recruitDesignationAccess.roles;
    const peopleDesignations = await loadPeopleDesignations(
      companyId,
      (registeredProfiles.data ?? []).map((profile) => profile.id)
    );
    const productMembershipByUser = new Map((productMemberships.data ?? []).map((membership) => [membership.user_id, membership]));
    const locationsByAccess = new Map<string, string[]>();
    for (const row of locationScopes.data ?? []) {
      locationsByAccess.set(row.user_access_id, [...(locationsByAccess.get(row.user_access_id) ?? []), row.location_id]);
    }
    const rolesByAccess = new Map<string, string[]>();
    for (const row of roleScopes.data ?? []) {
      rolesByAccess.set(row.user_access_id, [...(rolesByAccess.get(row.user_access_id) ?? []), row.role_id]);
    }
    const mappedAccess = (access.data ?? []).map((row) => {
      const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
      const mainRole = matchUniversalRole(
        mainUserRoles,
        productMembershipByUser.get(row.profile_id)?.role_id,
        productMembershipByUser.get(row.profile_id)?.role_code_snapshot
      );
      const isOwner = profile?.is_master_owner === true
        || String(mainRole?.code ?? profile?.role ?? "").trim().toUpperCase() === "OWNER";
      const selectedLocationIds = locationsByAccess.get(row.id) ?? [];
      const effectiveScope = calculateEffectiveRecruitmentLocationScope({
        isMasterOwner: profile?.is_master_owner === true,
        universalLocationAccessMode: mainRole?.location_access_mode,
        universalStationIds: Array.isArray(profile?.location_scope_ids)
          ? profile.location_scope_ids
          : [],
        recruitmentScopeMode: row.can_access_all_locations ? "inherit" : "custom",
        selectedRecruitmentLocationIds: selectedLocationIds,
        mainStations: mainStations.map((station) => ({ id: station.id, code: station.code })),
        recruitmentLocations: (locations.data ?? []).map((location) => ({
          id: location.id,
          code: location.code
        }))
      });
      return {
        ...row,
        can_access_workforce: isOwner ? true : row.can_access_workforce === true,
        can_access_hr: isOwner ? true : row.can_access_hr === true,
        scopeMode: effectiveScope.mode,
        effectiveAllLocations: effectiveScope.allLocations,
        effectiveLocationIds: effectiveScope.locationIds,
        universalLocationIds: effectiveScope.universalLocationIds,
        scopeAdjustedToUniversal: effectiveScope.adjustedToUniversalScope,
        locationIds: selectedLocationIds,
        roleIds: rolesByAccess.get(row.id) ?? []
      };
    });
    return NextResponse.json({
      allowlist: allowlist.data ?? [],
      access: mappedAccess,
      mobileUsers: mobile.data ?? [],
      locations: (locations.data ?? []).map((location) => {
        const source = mainStations.find((station) => station.code === location.code);
        return {
          ...location,
          name: source?.name ?? location.name,
          cluster: source?.operationalOwner?.name ?? null,
          operationalOwner: source?.operationalOwner ?? null,
          operationalOwnerStatus: source?.operationalOwnerStatus ?? "unmapped",
          operationalOwnerDesignation: source?.operationalOwnerDesignation ?? null,
          managerName: source?.managerName ?? null
        };
      }),
      roles: roles.data ?? [],
      registeredProfiles: (registeredProfiles.data ?? []).map((profile) => {
        const mainRole = matchUniversalRole(
          mainUserRoles,
          productMembershipByUser.get(profile.id)?.role_id,
          productMembershipByUser.get(profile.id)?.role_code_snapshot
        );
        const scopeIds = Array.isArray(profile.location_scope_ids) ? profile.location_scope_ids : [];
        return {
          ...profile,
          peopleDesignation: peopleDesignations.get(profile.id) ?? null,
          universalRole: mainRole ? {
            id: mainRole.id,
            code: mainRole.code,
            name: mainRole.name,
            allLocations: mainRole.location_access_mode === "all_locations"
          } : profile.is_master_owner ? {
            id: "owner",
            code: "OWNER",
            name: "Owner",
            allLocations: true
          } : null,
          universalLocations: mainRole?.location_access_mode === "all_locations" || profile.is_master_owner
            ? []
            : mainStations
                .filter((station) => scopeIds.includes(station.id))
                .map((station) => ({ id: station.id, code: station.code, name: station.name }))
        };
      }),
      mainUserRoles,
      designationAccess: recruitDesignationAccess.rows,
      locationAccess: { role: recruitDesignationAccess.locationRole },
      workforceDesignations: [...new Map(
        [...(workforceDesignations.data ?? []), ...workforceConfig.recruitmentDesignations]
          .map((item) => [String(item.code).toUpperCase(), {
            code: String(item.code).toUpperCase(),
            name: String(item.name)
          }])
      ).values()].sort((a,b) => a.code.localeCompare(b.code)),
      universalRolePermissions: universalPermissions.roles,
      userFunctions: workforceConfig.userFunctions,
      menuCatalog: recruitmentMenuCatalog,
      universalUsersUrl: "https://dashboard.dropxlogistics.com/users?section=users"
    });
  } catch (error) {
    console.error("Recruitment access failed", error);
    return NextResponse.json({ error: "Unable to load access." }, { status: 500 });
  }
}

function permissions(template: RecruitmentAccessTemplate, inheritUniversalScope = true) {
  return {
    can_access_workforce: ["owner", "admin", "workforce"].includes(template),
    can_access_hr: ["owner", "admin", "hr"].includes(template),
    // This legacy column now means "inherit the live main-dashboard location
    // scope". The effective session is global only when the universal user is.
    can_access_all_locations: inheritUniversalScope,
    can_manage_masters: ["owner", "admin"].includes(template),
    can_manage_ads: ["owner", "admin"].includes(template),
    can_manage_users: ["owner", "admin"].includes(template)
  };
}

export async function POST(request: Request) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase is not configured.");
    const session = await recruitmentSession(request);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await request.json() as Record<string, unknown>;
    const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
    if (body.action === "configure_location_role") {
      if (!canUseRecruitmentMenu(session, "User Roles", "edit")) return NextResponse.json({ error: "Edit access to User Roles is required." }, { status: 403 });
      const existing = await supabaseAdmin.from("user_roles").select("id").eq("company_id", companyId).eq("code", "RECRUIT_LOCATION").maybeSingle();
      if (existing.error) throw existing.error;
      let roleId = existing.data?.id ?? null;
      if (!roleId) {
        const created = await supabaseAdmin.from("user_roles").insert({ company_id: companyId, product_code: "recruit", code: "RECRUIT_LOCATION", name: "Location Account", parent_role_id: null, location_access_mode: "role_based", is_system: false, is_active: true }).select("id").single();
        if (created.error || !created.data) throw created.error ?? new Error("Recruit location role could not be created.");
        roleId = created.data.id;
      }
      return NextResponse.json({ saved: true, roleId });
    }
    if (body.action === "configure_designation_role") {
      if (!canUseRecruitmentMenu(session, "User Roles", "edit")) return NextResponse.json({ error: "Edit access to User Roles is required." }, { status: 403 });
      const designationId = String(body.designationId ?? "").trim();
      if (!/^[0-9a-f-]{36}$/i.test(designationId)) return NextResponse.json({ error: "Select a valid People designation." }, { status: 400 });
      const [designation, policy] = await Promise.all([
        supabaseAdmin.from("designations").select("id,code,name,designation_category:designation_categories!designations_designation_category_id_fkey!inner(people_module,is_active)").eq("company_id", companyId).eq("id", designationId).eq("is_active", true).eq("designation_category.people_module", "people_hr").eq("designation_category.is_active", true).maybeSingle(),
        supabaseAdmin.from("designation_product_access_policies").select("id,default_role_id,location_access_mode,is_enabled").eq("company_id", companyId).eq("designation_id", designationId).eq("product_code", "recruit").maybeSingle()
      ]);
      if (designation.error || !designation.data) return NextResponse.json({ error: designation.error?.message ?? "People designation was not found." }, { status: 400 });
      if (policy.error || !policy.data?.is_enabled) return NextResponse.json({ error: policy.error?.message ?? "Enable Recruit in People Designation Master first." }, { status: 400 });
      let roleId = policy.data.default_role_id as string | null;
      if (!roleId) {
        const normalized = String(designation.data.code ?? designation.data.name).toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 28);
        const roleCode = `RECRUIT_${normalized}`;
        const existing = await supabaseAdmin.from("user_roles").select("id").eq("company_id", companyId).eq("code", roleCode).maybeSingle();
        if (existing.error) throw existing.error;
        roleId = existing.data?.id ?? null;
        if (!roleId) {
          const created = await supabaseAdmin.from("user_roles").insert({ company_id: companyId, product_code: "recruit", code: roleCode, name: designation.data.name, parent_role_id: null, location_access_mode: policy.data.location_access_mode === "all_locations" ? "all_locations" : "role_based", is_system: false, is_active: true }).select("id").single();
          if (created.error || !created.data) throw created.error ?? new Error("Recruit role could not be created.");
          roleId = created.data.id;
        }
        const updated = await supabaseAdmin.from("designation_product_access_policies").update({ default_role_id: roleId, updated_by: session.profileId, updated_at: new Date().toISOString() }).eq("id", policy.data.id);
        if (updated.error) throw updated.error;
      }
      const reconciled = await supabaseAdmin.rpc("reconcile_designation_product_memberships", { p_company_id: companyId, p_designation_id: designationId, p_actor_user_id: session.profileId });
      if (reconciled.error) throw reconciled.error;
      return NextResponse.json({ saved: true, roleId });
    }
    if (body.action === "save_universal_role") {
      if (!canUseRecruitmentMenu(session, "User Roles", "edit")) return NextResponse.json({ error: "Edit access to User Roles is required." }, { status: 403 });
      const roleId = String(body.roleId ?? "").trim();
      await saveUniversalRecruitmentRolePermissions(
        companyId,
        roleId,
        body.workspaces,
        body.webMenuIds,
        body.mobileMenuIds,
        body.adRequestActions,
        body.menuAccess,
        body.menuActions,
        session.profileId,
        session.email
      );
      const audited = await supabaseAdmin.from("recruitment_connection_audit").insert({
        company_id: companyId,
        provider: "access",
        action: "role_permissions_updated",
        changed_fields: ["workspaces", "menu_access", "menu_actions", "ad_request_actions"],
        outcome: "success",
        message: `Recruitment permissions updated for universal role ${roleId}.`,
        actor_profile_id: session.profileId,
        actor_email: session.email
      });
      if (audited.error) throw audited.error;
      invalidateMobileSessionCache();
      return NextResponse.json({
        saved: true,
        universalPermissions: await loadUniversalRecruitmentPermissions(companyId)
      });
    }
    const selectedProfileId = String(body.profileId ?? "").trim();
    if (!selectedProfileId) {
      return NextResponse.json({ error: "Select a registered active company user." }, { status: 400 });
    }
    const workspace = body.workspace === "workforce" || body.workspace === "hr"
      ? body.workspace as RecruitmentUserWorkspace
      : null;
    if (!workspace) {
      return NextResponse.json({ error: "Choose Workforce or HR access." }, { status: 400 });
    }
    const existingRecruitmentAccess = await supabaseAdmin.from("recruitment_user_access")
      .select("id,can_access_workforce,can_access_hr,is_active")
      .eq("company_id", companyId).eq("profile_id", selectedProfileId).maybeSingle();
    if (existingRecruitmentAccess.error) throw existingRecruitmentAccess.error;
    const requiredAccessAction = isRecruitmentUserWorkspaceEnabled(existingRecruitmentAccess.data, workspace)
      ? "edit"
      : "add";
    if (!canUseRecruitmentMenu(session, "Access Control", requiredAccessAction)) {
      return NextResponse.json({
        error: `${requiredAccessAction === "add" ? "Add" : "Edit"} access to Users & Access is required.`
      }, { status: 403 });
    }
    const selectedProfile = await supabaseAdmin.from("profiles")
      .select("id,email,full_name,mobile,phone,employee_id,role,role_id,location_scope_ids,is_active,is_master_owner")
      .eq("company_id", companyId)
      .eq("id", selectedProfileId)
      .eq("is_active", true)
      .maybeSingle();
    if (selectedProfile.error) throw selectedProfile.error;
    if (!selectedProfile.data) {
      return NextResponse.json({ error: "Select a registered company user." }, { status: 400 });
    }
    const universalProfile = selectedProfile.data;
    const email = String(universalProfile.email ?? "").trim().toLowerCase();
    const displayName = String(universalProfile.full_name ?? "").trim().slice(0, 160);
    const universalMobile = universalProfile.mobile || universalProfile.phone;
    const mobileE164 = universalMobile ? normalizeIndianMobileE164(universalMobile) : null;
    const locationIds = [...new Set((Array.isArray(body.locationIds) ? body.locationIds : [])
      .map((item) => String(item ?? "").trim()).filter(Boolean))];
    const roleIds = [...new Set((Array.isArray(body.roleIds) ? body.roleIds : [])
      .map((item) => String(item ?? "").trim()).filter(Boolean))];
    const requestedScopeMode = body.scopeMode === "custom"
      ? "custom"
      : body.scopeMode === "inherit"
        ? "inherit"
        : body.allLocations === false
          ? "custom"
          : "inherit";
    const inheritUniversalScope = universalProfile.is_master_owner === true
      ? true
      : requestedScopeMode === "inherit";
    const currentProductMembership = await supabaseAdmin.from("company_product_memberships")
      .select("role_id,role_code_snapshot,has_all_location_access,location_scope_ids,source_system")
      .eq("company_id", companyId)
      .eq("product_code", "recruit")
      .eq("user_id", universalProfile.id)
      .eq("is_active", true)
      .maybeSingle();
    if (currentProductMembership.error) throw currentProductMembership.error;
    const recruitRoleId = currentProductMembership.data?.role_id ?? null;
    if (!universalProfile.is_master_owner && !recruitRoleId) {
      return NextResponse.json({ error: "Enable Recruit for this person's People designation before granting Recruit access." }, { status: 400 });
    }
    const universalPermissionModel = await loadUniversalRecruitmentPermissions(companyId);
    const rolePermission = recruitRoleId
      ? universalPermissionModel.roles[recruitRoleId]
        ?? universalPermissionModel.roles[String(currentProductMembership.data?.role_code_snapshot ?? "").trim().toUpperCase()]
      : null;
    const isOwner = universalProfile.is_master_owner === true
      || String(currentProductMembership.data?.role_code_snapshot ?? "").trim().toUpperCase().endsWith("_OWNER");
    const effectiveWorkspaceFlags = isOwner
      ? { can_access_workforce: true, can_access_hr: true }
      : activateRecruitmentUserWorkspace(existingRecruitmentAccess.data, workspace);
    const effectiveWorkspaces: RecruitmentUserWorkspace[] = [
      ...(effectiveWorkspaceFlags.can_access_workforce ? ["workforce" as const] : []),
      ...(effectiveWorkspaceFlags.can_access_hr ? ["hr" as const] : [])
    ];
    const template: RecruitmentAccessTemplate = isOwner
      ? "owner"
      : effectiveWorkspaces.includes("workforce") && effectiveWorkspaces.includes("hr")
        ? "admin"
        : effectiveWorkspaces.includes("hr")
          ? "hr"
          : effectiveWorkspaces.includes("workforce")
            ? "workforce"
            : "viewer";
    const configuredPermission = rolePermission;
    const hasValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!hasValidEmail && !mobileE164) {
      return NextResponse.json({ error: "The company user must have a valid email or mobile number before Recruitment access can be enabled." }, { status: 400 });
    }
    if (effectiveWorkspaces.length && !inheritUniversalScope && !locationIds.length) {
      return NextResponse.json({
        error: "Choose at least one Recruitment station or inherit the universal main-dashboard scope."
      }, { status: 400 });
    }
    const [validLocations, validRoles, mainRole, mainStations] = await Promise.all([
      locationIds.length
        ? supabaseAdmin.from("recruitment_locations").select("id,code").eq("company_id", companyId).in("id", locationIds)
        : Promise.resolve({ data: [], error: null }),
      roleIds.length
        ? supabaseAdmin.from("recruitment_roles").select("id,stream").eq("company_id", companyId).in("id", roleIds)
        : Promise.resolve({ data: [], error: null }),
      recruitRoleId
        ? supabaseAdmin.from("user_roles").select("id,code,location_access_mode")
            .eq("company_id", companyId).eq("id", recruitRoleId).eq("product_code", "recruit").eq("is_active", true).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      loadMainDashboardStations(companyId)
    ]);
    if (validLocations.error || validRoles.error || mainRole.error) {
      throw validLocations.error || validRoles.error || mainRole.error;
    }
    if ((validLocations.data?.length ?? 0) !== locationIds.length || (validRoles.data?.length ?? 0) !== roleIds.length) {
      return NextResponse.json({ error: "One or more access scopes are invalid." }, { status: 400 });
    }
    if (effectiveWorkspaces.length === 1 && effectiveWorkspaces[0] === "hr" && (validRoles.data ?? []).some((role) => role.stream !== "hr")) {
      return NextResponse.json({ error: "HR users can only be assigned white-collar roles." }, { status: 400 });
    }
    if (effectiveWorkspaces.length === 1 && effectiveWorkspaces[0] === "workforce" && (validRoles.data ?? []).some((role) => role.stream !== "workforce")) {
      return NextResponse.json({ error: "Workforce users can only be assigned blue-collar roles." }, { status: 400 });
    }
    const universalAllLocations = universalProfile.is_master_owner === true
      || currentProductMembership.data?.has_all_location_access === true
      || mainRole.data?.location_access_mode === "all_locations";
    if (!inheritUniversalScope && !universalAllLocations && locationIds.length) {
      const universalStationIds = new Set(
        Array.isArray(currentProductMembership.data?.location_scope_ids)
          ? currentProductMembership.data.location_scope_ids
          : Array.isArray(universalProfile.location_scope_ids) ? universalProfile.location_scope_ids : []
      );
      const allowedCodes = new Set(mainStations
        .filter((station) => universalStationIds.has(station.id))
        .map((station) => station.code));
      if ((validLocations.data ?? []).some((location) => !allowedCodes.has(String(location.code).toUpperCase()))) {
        return NextResponse.json({
          error: "One or more recruitment stations are outside this user's universal main-dashboard scope."
        }, { status: 400 });
      }
    }

    const existingAllowlist = hasValidEmail
      ? await supabaseAdmin.from("recruitment_login_allowlist").select("id")
          .eq("company_id", companyId).ilike("email", email).maybeSingle()
      : await supabaseAdmin.from("recruitment_login_allowlist").select("id")
          .eq("company_id", companyId).eq("mobile_e164", mobileE164).maybeSingle();
    if (existingAllowlist.error) throw existingAllowlist.error;
    const allowlistValues = {
      email: hasValidEmail ? email : null,
      mobile_e164: mobileE164,
      display_name: displayName || email || mobileE164,
      access_template: template,
      is_active: body.isActive !== false,
      updated_at: new Date().toISOString()
    };
    const allowlist = existingAllowlist.data
      ? await supabaseAdmin.from("recruitment_login_allowlist").update(allowlistValues)
          .eq("company_id", companyId).eq("id", existingAllowlist.data.id)
      : await supabaseAdmin.from("recruitment_login_allowlist").insert({
          company_id: companyId,
          ...allowlistValues
        });
    if (allowlist.error) throw allowlist.error;

    const resolvedPermissions = permissions(template, inheritUniversalScope);
    resolvedPermissions.can_access_workforce = effectiveWorkspaceFlags.can_access_workforce;
    resolvedPermissions.can_access_hr = effectiveWorkspaceFlags.can_access_hr;
    if (configuredPermission) {
      const visibleMenus = new Set<string>([
        ...(configuredPermission.webMenuIds ?? []),
        ...(configuredPermission.mobileMenuIds ?? [])
      ]);
      resolvedPermissions.can_manage_masters = [
        "Station Directory", "Station Contacts", "Roles", "Notification Rules", "Incentive Master"
      ].some((menu) => visibleMenus.has(menu));
      resolvedPermissions.can_manage_ads = visibleMenus.has("Active Ads");
      resolvedPermissions.can_manage_users = visibleMenus.has("Access Control") || visibleMenus.has("User Roles");
    }
    const access = await supabaseAdmin.from("recruitment_user_access").upsert({
      company_id: companyId,
      profile_id: universalProfile.id,
      ...resolvedPermissions,
      is_active: body.isActive !== false,
      updated_at: new Date().toISOString()
    }, { onConflict: "company_id,profile_id" }).select("id").single();
    if (access.error) throw access.error;
    // Persist and verify the location mode explicitly. This boolean predates
    // the universal-scope model and some existing rows were retaining their
    // old value after an otherwise successful upsert.
    const persistedScope = await supabaseAdmin.from("recruitment_user_access")
      .update({
        can_access_all_locations: inheritUniversalScope,
        updated_at: new Date().toISOString()
      })
      .eq("company_id", companyId)
      .eq("id", access.data.id)
      .select("can_access_all_locations")
      .single();
    if (persistedScope.error) throw persistedScope.error;
    if (persistedScope.data.can_access_all_locations !== inheritUniversalScope) {
      throw new Error("Recruitment station scope could not be saved.");
    }

    const membership = await supabaseAdmin.from("company_product_memberships").upsert({
      company_id: companyId,
      product_code: "recruit",
      user_id: universalProfile.id,
      role_id: recruitRoleId,
      role_code_snapshot: mainRole.data?.code ?? currentProductMembership.data?.role_code_snapshot,
      source_system: "person_override",
      has_all_location_access: universalAllLocations || inheritUniversalScope,
      location_scope_ids: universalAllLocations || inheritUniversalScope
        ? []
        : Array.isArray(currentProductMembership.data?.location_scope_ids)
          ? currentProductMembership.data.location_scope_ids
          : Array.isArray(universalProfile.location_scope_ids) ? universalProfile.location_scope_ids : [],
      is_active: body.isActive !== false,
      assigned_by: session.profileId,
      updated_at: new Date().toISOString()
    }, { onConflict: "company_id,product_code,user_id" });
    if (membership.error) throw membership.error;

    const [clearedLocations, clearedRoles] = await Promise.all([
      supabaseAdmin.from("recruitment_user_locations").delete().eq("user_access_id", access.data.id),
      supabaseAdmin.from("recruitment_user_roles").delete().eq("user_access_id", access.data.id)
    ]);
    if (clearedLocations.error || clearedRoles.error) throw clearedLocations.error || clearedRoles.error;
    if (!inheritUniversalScope && locationIds.length) {
      const scoped = await supabaseAdmin.from("recruitment_user_locations").insert(
        locationIds.map((locationId) => ({ user_access_id: access.data.id, location_id: locationId }))
      );
      if (scoped.error) throw scoped.error;
    }
    if (roleIds.length) {
      const scoped = await supabaseAdmin.from("recruitment_user_roles").insert(
        roleIds.map((roleId) => ({ user_access_id: access.data.id, role_id: roleId }))
      );
      if (scoped.error) throw scoped.error;
    }

    if (mobileE164) {
      const mobile = await supabaseAdmin.from("recruitment_mobile_users").upsert({
        company_id: companyId,
        profile_id: universalProfile.id,
        mobile_e164: mobileE164,
        display_name: displayName || email,
        is_active: body.isActive !== false,
        updated_at: new Date().toISOString()
      }, { onConflict: "company_id,mobile_e164" });
      if (mobile.error) throw mobile.error;
    } else {
      const mobile = await supabaseAdmin.from("recruitment_mobile_users").update({
        is_active: false,
        updated_at: new Date().toISOString()
      }).eq("company_id", companyId).eq("profile_id", universalProfile.id);
      if (mobile.error) throw mobile.error;
    }
    const audited = await supabaseAdmin.from("recruitment_connection_audit").insert({
      company_id: companyId,
      provider: "access",
      action: existingRecruitmentAccess.data ? "user_access_updated" : "user_access_added",
      changed_fields: ["workspace", "scope", "locations", "roles", "active"],
      outcome: "success",
      message: `${displayName || email || mobileE164} · ${workspace} · ${inheritUniversalScope ? "universal scope" : `${locationIds.length} selected station(s)`} · ${body.isActive === false ? "inactive" : "active"}.`,
      actor_profile_id: session.profileId,
      actor_email: session.email
    });
    if (audited.error) throw audited.error;
    invalidateMobileSessionCache();
    return NextResponse.json({
      saved: true,
      accessId: access.data.id,
      scopeMode: persistedScope.data.can_access_all_locations ? "inherit" : "custom"
    });
  } catch (error) {
    console.error("Recruitment access save failed", error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Unable to save user access."
    }, { status: 400 });
  }
}
