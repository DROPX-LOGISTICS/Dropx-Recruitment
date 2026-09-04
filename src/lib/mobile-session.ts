import { hashSessionToken } from "./mobile-auth";
import { canPreviewPortalUsers, loadPeopleDesignations } from "./people-designation";
import {
  matchUniversalRole,
  resolveRecruitmentPermissionSet,
  type AdRequestAction,
  type RecruitmentAccessTemplate,
  type RecruitmentAccessLevel,
  type RecruitmentMenuId,
  type RecruitmentWorkspaceMenuActions
} from "./recruitment-menu-roles";
import { calculateEffectiveRecruitmentLocationScope } from "./recruitment-location-scope";
import { loadWorkforceConfig, workforceFunctionFor, type RecruitmentFunction } from "./recruitment-workforce-config";
import { supabaseAdmin } from "./supabase-admin";

export type MobileSessionContext = {
  sessionId: string;
  mobileUserId: string;
  profileId: string;
  displayName: string | null;
  email: string | null;
  accessId: string;
  workforce: boolean;
  hr: boolean;
  allLocations: boolean;
  manageMasters: boolean;
  manageAds: boolean;
  manageUsers: boolean;
  accessTemplate?: RecruitmentAccessTemplate;
  menuPermissions?: RecruitmentMenuId[];
  webMenuPermissions?: RecruitmentMenuId[];
  mobileMenuPermissions?: RecruitmentMenuId[];
  menuAccess: Record<"workforce" | "hr", Partial<Record<RecruitmentMenuId, RecruitmentAccessLevel>>>;
  menuActions: RecruitmentWorkspaceMenuActions;
  adRequestActions: AdRequestAction[];
  recruitmentFunction: RecruitmentFunction;
  trackPerformance: boolean;
  reportingManagerProfileId: string | null;
  designationCode: string | null;
  designationName?: string | null;
  isOwner: boolean;
  canPreviewUsers: boolean;
  isPreview: boolean;
  viewerProfileId: string;
  previewProfileId: string | null;
  readOnly: boolean;
  locationIds: string[];
  roleIds: string[];
};

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return match?.[1]?.trim() || null;
}

const sessionCache = new Map<string, { expiresAt: number; session: MobileSessionContext }>();
// A mobile screen can make several API calls in quick succession. Rebuilding the
// full role, scope and permission context for every call is expensive; writes
// explicitly invalidate this cache, while normal reads can safely reuse it.
const sessionCacheTtlMs = 60_000;

export function invalidateMobileSessionCache() {
  sessionCache.clear();
}

async function loadUniversalRole(
  companyId: string,
  roleId?: string | null,
  roleCode?: string | null
) {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  let roles = await supabaseAdmin.from("user_roles")
    .select("id,code,name,location_access_mode")
    .eq("company_id", companyId)
    .eq("is_active", true);
  if (!roles.error && !(roles.data ?? []).length) {
    roles = await supabaseAdmin.from("user_roles")
      .select("id,code,name,location_access_mode")
      .eq("is_active", true);
  }
  if (roles.error) throw new Error(roles.error.message);
  return matchUniversalRole(roles.data ?? [], roleId, roleCode);
}

function resolvedManagement(
  permissionSet: Awaited<ReturnType<typeof resolveRecruitmentPermissionSet>>,
  legacy: { can_manage_masters: boolean; can_manage_ads: boolean; can_manage_users: boolean }
) {
  if (!permissionSet.configured) {
    return {
      manageMasters: legacy.can_manage_masters,
      manageAds: legacy.can_manage_ads,
      manageUsers: legacy.can_manage_users
    };
  }
  const levels = Object.values(permissionSet.menuAccess).flatMap((workspace) => Object.entries(workspace));
  const canChange = (menuId: RecruitmentMenuId) => levels.some(([id, level]) =>
    id === menuId && (level === "edit" || level === "all")
  );
  return {
    manageMasters: ["Station Directory", "Station Contacts", "Roles", "Lead Status Master", "Notification Rules", "Incentive Master"]
      .some((menu) => canChange(menu as RecruitmentMenuId)),
    manageAds: canChange("Active Ads"),
    manageUsers: canChange("Access Control") || canChange("User Roles")
  };
}

function cachedSession(key: string) {
  const cached = sessionCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    sessionCache.delete(key);
    return null;
  }
  return cached.session;
}

async function effectiveLocationScope(input: {
  companyId: string;
  isMasterOwner: boolean;
  roleLocationAccessMode?: string | null;
  universalStationIds: string[];
  inheritUniversalScope: boolean;
  selectedRecruitmentLocationIds: string[];
}) {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  const [mainStations, recruitmentLocations] = await Promise.all([
    supabaseAdmin.from("stations")
      .select("id,station_code")
      .eq("company_id", input.companyId)
      .eq("is_active", true),
    supabaseAdmin.from("recruitment_locations")
      .select("id,code")
      .eq("company_id", input.companyId)
      .eq("is_active", true)
  ]);
  if (mainStations.error) throw new Error(mainStations.error.message);
  if (recruitmentLocations.error) throw new Error(recruitmentLocations.error.message);
  return calculateEffectiveRecruitmentLocationScope({
    isMasterOwner: input.isMasterOwner,
    universalLocationAccessMode: input.roleLocationAccessMode,
    universalStationIds: input.universalStationIds,
    recruitmentScopeMode: input.inheritUniversalScope ? "inherit" : "custom",
    selectedRecruitmentLocationIds: input.selectedRecruitmentLocationIds,
    mainStations: (mainStations.data ?? []).map((station) => ({
      id: station.id,
      code: station.station_code
    })),
    recruitmentLocations: recruitmentLocations.data ?? []
  });
}

async function previewContext(
  companyId: string,
  profileId: string,
  viewer: MobileSessionContext
): Promise<MobileSessionContext | null> {
  if (!supabaseAdmin) return null;
  const profile = await supabaseAdmin.from("profiles")
    .select("id,full_name,email,role,role_id,location_scope_ids,is_active,is_master_owner")
    .eq("company_id", companyId).eq("id", profileId).eq("is_active", true).maybeSingle();
  if (profile.error) throw new Error(profile.error.message);
  if (!profile.data) return null;
  const access = await supabaseAdmin.from("recruitment_user_access")
    .select("id,can_access_workforce,can_access_hr,can_access_all_locations,can_manage_masters,can_manage_ads,can_manage_users")
    .eq("company_id", companyId).eq("profile_id", profileId).eq("is_active", true).maybeSingle();
  if (access.error) throw new Error(access.error.message);
  if (!access.data) return null;
  const [allowlist, locations, roles, workforceConfig, membership] = await Promise.all([
    profile.data.email ? supabaseAdmin.from("recruitment_login_allowlist").select("access_template")
      .eq("company_id", companyId).ilike("email", profile.data.email).eq("is_active", true).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabaseAdmin.from("recruitment_user_locations").select("location_id").eq("user_access_id", access.data.id),
    supabaseAdmin.from("recruitment_user_roles").select("role_id").eq("user_access_id", access.data.id),
    loadWorkforceConfig(companyId),
    supabaseAdmin.from("company_product_memberships")
      .select("role_id,role_code_snapshot,has_all_location_access,location_scope_ids")
      .eq("company_id", companyId).eq("product_code", "recruit")
      .eq("user_id", profileId).eq("is_active", true).maybeSingle()
  ]);
  const failure = [allowlist, locations, roles, membership].find((item) => item.error);
  if (failure?.error) throw new Error(failure.error.message);
  if (!membership.data) return null;
  const universalRole = await loadUniversalRole(companyId, membership.data.role_id, membership.data.role_code_snapshot);
  const accessTemplate = (allowlist.data?.access_template || (
    access.data.can_manage_users ? "admin" :
    access.data.can_access_hr && !access.data.can_access_workforce ? "hr" :
    access.data.can_access_workforce && !access.data.can_access_hr ? "workforce" : "viewer"
  )) as RecruitmentAccessTemplate;
  const workforceFunction = workforceFunctionFor(
    profileId,
    accessTemplate,
    access.data.can_manage_users,
    workforceConfig.userFunctions,
    [access.data.id],
    universalRole?.code ?? profile.data.role,
    universalRole?.name
  );
  const isOwner = profile.data.is_master_owner === true
    || accessTemplate === "owner"
    || universalRole?.code?.toUpperCase() === "OWNER";
  const permissionSet = await resolveRecruitmentPermissionSet({
    companyId,
    profileId,
    universalRoleId: universalRole?.id ?? null,
    universalRoleCode: universalRole?.code ?? profile.data.role,
    isOwner,
    accessTemplate,
    workforce: access.data.can_access_workforce,
    hr: access.data.can_access_hr
  });
  const management = resolvedManagement(permissionSet, access.data);
  const locationScope = await effectiveLocationScope({
    companyId,
    isMasterOwner: isOwner,
    roleLocationAccessMode: membership.data.has_all_location_access ? "all_locations" : universalRole?.location_access_mode,
    universalStationIds: Array.isArray(membership.data.location_scope_ids)
      ? membership.data.location_scope_ids
      : [],
    inheritUniversalScope: access.data.can_access_all_locations,
    selectedRecruitmentLocationIds: (locations.data ?? []).map((row) => row.location_id)
  });
  const peopleDesignation = (await loadPeopleDesignations(companyId, [profileId])).get(profileId);
  return {
    designationName: peopleDesignation?.name ?? null,
    sessionId: viewer.sessionId,
    mobileUserId: viewer.mobileUserId,
    profileId,
    displayName: profile.data.full_name,
    email: profile.data.email,
    accessId: access.data.id,
    workforce: permissionSet.workspaces.includes("workforce"),
    hr: permissionSet.workspaces.includes("hr"),
    allLocations: locationScope.allLocations,
    manageMasters: management.manageMasters,
    manageAds: management.manageAds,
    manageUsers: management.manageUsers,
    accessTemplate,
    menuPermissions: permissionSet.webMenuIds,
    webMenuPermissions: permissionSet.webMenuIds,
    mobileMenuPermissions: permissionSet.mobileMenuIds,
    menuAccess: permissionSet.menuAccess,
    menuActions: permissionSet.menuActions,
    adRequestActions: permissionSet.adRequestActions,
    recruitmentFunction: workforceFunction.function,
    trackPerformance: workforceFunction.trackPerformance,
    reportingManagerProfileId: workforceFunction.reportingManagerProfileId,
    designationCode: workforceFunction.designationCode
      || String(profile.data.role ?? universalRole?.code ?? "").trim().toUpperCase()
      || null,
    isOwner,
    canPreviewUsers: true,
    isPreview: true,
    viewerProfileId: viewer.profileId,
    previewProfileId: profileId,
    readOnly: true,
    locationIds: locationScope.locationIds,
    roleIds: (roles.data ?? []).map((row) => row.role_id)
  };
}

export async function resolveMobileSession(
  request: Request,
  companyId: string
): Promise<MobileSessionContext | null> {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  const token = bearerToken(request);
  if (!token) return null;
  const tokenHash = hashSessionToken(token);
  const requestedPreview = request.headers.get("x-dropx-preview-profile")?.trim() ?? "";
  const cacheKey = `${tokenHash}:${requestedPreview}`;
  if (request.method.toUpperCase() === "GET") {
    const cached = cachedSession(cacheKey);
    if (cached) return cached;
  }

  const session = await supabaseAdmin
    .from("recruitment_mobile_sessions")
    .select("id, profile_id, mobile_user_id, auth_method, expires_at, revoked_at, last_seen_at")
    .eq("company_id", companyId)
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (session.error) throw new Error(session.error.message);
  if (
    !session.data ||
    session.data.revoked_at ||
    new Date(session.data.expires_at).getTime() <= Date.now()
  ) {
    return null;
  }

  let displayName: string | null = null;
  let email: string | null = null;
  let mobileUserId = session.data.mobile_user_id as string | null;
  if (session.data.auth_method === "whatsapp_otp") {
    if (!mobileUserId) return null;
    const mobileUser = await supabaseAdmin
      .from("recruitment_mobile_users")
      .select("id, profile_id, display_name")
      .eq("company_id", companyId)
      .eq("id", mobileUserId)
      .eq("profile_id", session.data.profile_id)
      .eq("is_active", true)
      .maybeSingle();
    if (mobileUser.error) throw new Error(mobileUser.error.message);
    if (!mobileUser.data) return null;
    displayName = mobileUser.data.display_name;
  }
  const profile = await supabaseAdmin
    .from("profiles")
    .select("full_name,email,role,role_id,location_scope_ids,is_active,is_master_owner")
    .eq("company_id", companyId)
    .eq("id", session.data.profile_id)
    .eq("is_active", true)
    .maybeSingle();
  if (profile.error) throw new Error(profile.error.message);
  if (!profile.data) return null;
  if (!displayName) displayName = profile.data?.full_name ?? null;
  email = profile.data?.email ?? null;

  const [access, membership] = await Promise.all([
    supabaseAdmin
      .from("recruitment_user_access")
      .select("id, can_access_workforce, can_access_hr, can_access_all_locations, can_manage_masters, can_manage_ads, can_manage_users")
      .eq("company_id", companyId)
      .eq("profile_id", session.data.profile_id)
      .eq("is_active", true)
      .maybeSingle(),
    supabaseAdmin.from("company_product_memberships")
      .select("role_id,role_code_snapshot,has_all_location_access,location_scope_ids")
      .eq("company_id", companyId).eq("product_code", "recruit")
      .eq("user_id", session.data.profile_id).eq("is_active", true).maybeSingle()
  ]);
  if (access.error) throw new Error(access.error.message);
  if (membership.error) throw new Error(membership.error.message);
  if (!access.data || !membership.data) return null;

  const allowlist = email ? await supabaseAdmin.from("recruitment_login_allowlist")
    .select("access_template")
    .eq("company_id", companyId)
    .ilike("email", email)
    .eq("is_active", true)
    .maybeSingle() : { data: null, error: null };
  if (allowlist.error) throw new Error(allowlist.error.message);
  const accessTemplate = (allowlist.data?.access_template || (
    access.data.can_manage_users ? "admin" :
    access.data.can_access_hr && !access.data.can_access_workforce ? "hr" :
    access.data.can_access_workforce && !access.data.can_access_hr ? "workforce" : "viewer"
  )) as RecruitmentAccessTemplate;
  const [locations, roles, workforceConfig] = await Promise.all([
    supabaseAdmin
      .from("recruitment_user_locations")
      .select("location_id")
      .eq("user_access_id", access.data.id),
    supabaseAdmin
      .from("recruitment_user_roles")
      .select("role_id")
      .eq("user_access_id", access.data.id),
    loadWorkforceConfig(companyId)
  ]);
  if (locations.error) throw new Error(locations.error.message);
  if (roles.error) throw new Error(roles.error.message);

  const lastSeenAt = session.data.last_seen_at ? new Date(session.data.last_seen_at).getTime() : 0;
  if (!Number.isFinite(lastSeenAt) || Date.now() - lastSeenAt > 5 * 60_000) {
    void supabaseAdmin
      .from("recruitment_mobile_sessions")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("company_id", companyId)
      .eq("id", session.data.id)
      .then(() => undefined, () => undefined);
  }

  const universalRole = await loadUniversalRole(
    companyId,
    membership.data.role_id,
    membership.data.role_code_snapshot
  );
  const workforceFunction = workforceFunctionFor(
    session.data.profile_id,
    accessTemplate,
    access.data.can_manage_users,
    workforceConfig.userFunctions,
    [access.data.id],
    universalRole?.code ?? profile.data.role,
    universalRole?.name
  );
  const designationCode = workforceFunction.designationCode
    || String(profile.data.role ?? universalRole?.code ?? "").trim().toUpperCase()
    || null;
  const isOwner = profile.data.is_master_owner === true
    || accessTemplate === "owner"
    || universalRole?.code?.toUpperCase() === "OWNER";
  const permissionSet = await resolveRecruitmentPermissionSet({
    companyId,
    profileId: session.data.profile_id,
    universalRoleId: universalRole?.id ?? null,
    universalRoleCode: universalRole?.code ?? profile.data.role,
    isOwner,
    accessTemplate,
    workforce: access.data.can_access_workforce,
    hr: access.data.can_access_hr
  });
  const management = resolvedManagement(permissionSet, access.data);
  const locationScope = await effectiveLocationScope({
    companyId,
    isMasterOwner: isOwner,
    roleLocationAccessMode: membership.data.has_all_location_access ? "all_locations" : universalRole?.location_access_mode,
    universalStationIds: Array.isArray(membership.data.location_scope_ids)
      ? membership.data.location_scope_ids
      : [],
    inheritUniversalScope: access.data.can_access_all_locations,
    selectedRecruitmentLocationIds: (locations.data ?? []).map((row) => row.location_id)
  });
  const peopleDesignation = (await loadPeopleDesignations(companyId, [session.data.profile_id])).get(session.data.profile_id);
  const resolved: MobileSessionContext = {
    designationName: peopleDesignation?.name ?? null,
    sessionId: session.data.id,
    mobileUserId: mobileUserId ?? "",
    profileId: session.data.profile_id,
    displayName,
    email,
    accessId: access.data.id,
    workforce: permissionSet.workspaces.includes("workforce"),
    hr: permissionSet.workspaces.includes("hr"),
    allLocations: locationScope.allLocations,
    manageMasters: management.manageMasters,
    manageAds: management.manageAds,
    manageUsers: management.manageUsers,
    accessTemplate,
    menuPermissions: permissionSet.webMenuIds,
    webMenuPermissions: permissionSet.webMenuIds,
    mobileMenuPermissions: permissionSet.mobileMenuIds,
    menuAccess: permissionSet.menuAccess,
    menuActions: permissionSet.menuActions,
    adRequestActions: permissionSet.adRequestActions,
    recruitmentFunction: workforceFunction.function,
    trackPerformance: workforceFunction.trackPerformance,
    reportingManagerProfileId: workforceFunction.reportingManagerProfileId,
    designationCode,
    isOwner,
    canPreviewUsers: canPreviewPortalUsers(isOwner, null, peopleDesignation),
    isPreview: false,
    viewerProfileId: session.data.profile_id,
    previewProfileId: null,
    readOnly: false,
    locationIds: locationScope.locationIds,
    roleIds: (roles.data ?? []).map((row) => row.role_id)
  };
  const effective = !requestedPreview || !resolved.canPreviewUsers || requestedPreview === resolved.profileId
    ? resolved
    : await previewContext(companyId, requestedPreview, resolved) ?? resolved;
  if (request.method.toUpperCase() === "GET") {
    sessionCache.set(cacheKey, { expiresAt: Date.now() + sessionCacheTtlMs, session: effective });
  }
  return effective;
}
