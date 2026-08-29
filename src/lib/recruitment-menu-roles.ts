import { supabaseAdmin } from "./supabase-admin";

export const recruitmentMenuCatalog = [
  { id: "Dashboard", label: "Dashboard", group: "Overview", workspaces: ["workforce", "hr"] },
  { id: "Workforce Plan", label: "Workforce Plan / Hiring Picture", group: "Overview", workspaces: ["workforce"] },
  { id: "All Leads", label: "Candidates / All Leads", group: "Leads & talent", workspaces: ["workforce", "hr"] },
  { id: "No Response / Call Back", label: "No Response / Call Back", group: "Leads & talent", workspaces: ["workforce"] },
  { id: "Screening", label: "HR Screening", group: "Leads & talent", workspaces: ["hr"] },
  { id: "My Interviews", label: "My Interview Assignments", group: "My work", workspaces: ["hr"] },
  { id: "Interviews", label: "Interviews", group: "Leads & talent", workspaces: ["workforce", "hr"] },
  { id: "Documents", label: "HR Documents", group: "Leads & talent", workspaces: ["hr"] },
  { id: "Offers", label: "HR Offers", group: "Leads & talent", workspaces: ["hr"] },
  { id: "Hired", label: "HR Hired", group: "Leads & talent", workspaces: ["hr"] },
  { id: "Archived Leads", label: "Archived Leads", group: "Leads & talent", workspaces: ["workforce", "hr"] },
  { id: "Unmapped", label: "Unmapped Intake", group: "Leads & talent", workspaces: ["workforce", "hr"] },
  { id: "WhatsApp Messages", label: "WhatsApp Messages", group: "Communication", workspaces: ["workforce", "hr"] },
  { id: "Reports", label: "Operational Reports", group: "Performance", workspaces: ["workforce", "hr"] },
  { id: "Performance Center", label: "Recruitment Performance Center", group: "Performance", workspaces: ["workforce"] },
  { id: "Recruiter Performance", label: "Telecaller Performance", group: "Performance", workspaces: ["workforce"] },
  { id: "Field Recruitment", label: "Field Recruiter Performance", group: "Performance", workspaces: ["workforce"] },
  { id: "Influencer Performance", label: "Influencer Performance", group: "Performance", workspaces: ["workforce"] },
  { id: "Field Expense Approvals", label: "Field Expense Approvals", group: "Performance", workspaces: ["workforce"] },
  { id: "Field Executive Onboarding", label: "Workforce Onboarding", group: "Onboarding", workspaces: ["workforce"] },
  { id: "DA In-app Onboarding", label: "DA In-app Onboarding", group: "Onboarding", workspaces: ["workforce"] },
  { id: "Incentive Master", label: "Workforce Incentive Master", group: "Performance", workspaces: ["workforce"] },
  { id: "Job Requisitions", label: "Job Requisitions & JDs", group: "Hiring", workspaces: ["hr"] },
  { id: "Resume Intake", label: "Resume Intake & CV Pool", group: "Hiring", workspaces: ["hr"] },
  { id: "AI Fit Review", label: "AI Fit Review", group: "Hiring", workspaces: ["hr"] },
  { id: "Active Ads", label: "Active Ads", group: "Hiring & advertising", workspaces: ["workforce", "hr"] },
  { id: "Ad Requests", label: "Ad Requests", group: "Hiring & advertising", workspaces: ["workforce", "hr"] },
  { id: "Station Directory", label: "Station Directory / Business Locations", group: "Master", workspaces: ["workforce", "hr"] },
  { id: "Station Contacts", label: "Station Contacts", group: "Master", workspaces: ["workforce"] },
  { id: "Roles", label: "Positions & Designations", group: "Master", workspaces: ["workforce", "hr"] },
  { id: "Lead Status Master", label: "Lead Status Master", group: "Master", workspaces: ["workforce", "hr"] },
  { id: "HR Lifecycle", label: "HR Lifecycle & Interview Rules", group: "Master", workspaces: ["hr"] },
  { id: "Notification Rules", label: "Notification Automation", group: "Master", workspaces: ["workforce", "hr"] },
  { id: "User Roles", label: "User Roles", group: "Master", workspaces: ["workforce", "hr"] },
  { id: "Access Control", label: "Users & Access", group: "Master", workspaces: ["workforce", "hr"] },
  { id: "Master Reports", label: "Executive Reports", group: "Administration", workspaces: ["workforce", "hr"] },
  { id: "Connections", label: "Source Integrations", group: "Administration", workspaces: ["workforce", "hr"] },
  { id: "System Health", label: "System Health", group: "Administration", workspaces: ["workforce", "hr"] },
  { id: "Audit", label: "System Logs", group: "Administration", workspaces: ["workforce", "hr"] }
] as const;

export type RecruitmentMenuId = typeof recruitmentMenuCatalog[number]["id"];
export type RecruitmentAccessTemplate = "owner" | "admin" | "hr" | "workforce" | "viewer";
export type RecruitmentWorkspace = "workforce" | "hr";
export type RecruitmentSurface = "web" | "mobile";
export type RecruitmentAccessLevel = "none" | "view" | "edit" | "all";
export type RecruitmentPermissionAction = "view" | "add" | "edit";
export type RecruitmentMenuActionGrant = Record<RecruitmentPermissionAction, boolean>;
export type RecruitmentWorkspaceMenuAccess = Record<
  RecruitmentWorkspace,
  Partial<Record<RecruitmentMenuId, RecruitmentAccessLevel>>
>;
export type RecruitmentWorkspaceMenuActions = Record<
  RecruitmentWorkspace,
  Partial<Record<RecruitmentMenuId, RecruitmentMenuActionGrant>>
>;

export const adRequestActionCatalog = [
  { id: "create", label: "Create requests", description: "Submit new-ad, budget-change and stop-ad requests." },
  { id: "view_own", label: "View own requests", description: "Track requests submitted by the signed-in user." },
  { id: "view_scoped", label: "View assigned scope", description: "View requests within assigned stations and designations." },
  { id: "view_all", label: "View all requests", description: "View requests across every permitted Recruitment workspace." },
  { id: "review", label: "Start review", description: "Move submitted requests into the review queue." },
  { id: "approve", label: "Approve requests", description: "Approve a reviewed advertising request." },
  { id: "reject", label: "Reject requests", description: "Reject a request with a mandatory reason." },
  { id: "publish", label: "Post / publish ads", description: "Record publishing or execute an approved Meta change." },
  { id: "complete", label: "Complete requests", description: "Close a published request after verification." },
  { id: "cancel_own", label: "Cancel own requests", description: "Cancel an unreviewed request submitted by the user." }
] as const;

export type AdRequestAction = typeof adRequestActionCatalog[number]["id"];

export type RecruitmentPermissionSet = {
  workspaces: RecruitmentWorkspace[];
  webMenuIds: RecruitmentMenuId[];
  mobileMenuIds: RecruitmentMenuId[];
  adRequestActions: AdRequestAction[];
  menuAccess: RecruitmentWorkspaceMenuAccess;
  menuActions: RecruitmentWorkspaceMenuActions;
  configured: boolean;
  source?: "owner" | "user" | "role_id" | "role_code" | "unconfigured" | "legacy";
};

export type UniversalRoleReference = {
  id: string;
  code?: string | null;
};

type StoredPermissionSet = {
  workspaces?: unknown;
  webMenuIds?: unknown;
  mobileMenuIds?: unknown;
  adRequestActions?: unknown;
  menuAccess?: unknown;
  menuActions?: unknown;
  enabled?: unknown;
};

const allMenus = recruitmentMenuCatalog.map((item) => item.id);
const allAdRequestActions = adRequestActionCatalog.map((item) => item.id);
const accessRank: Record<RecruitmentAccessLevel, number> = { none: 0, view: 1, edit: 2, all: 3 };
const workforceMenus: RecruitmentMenuId[] = [
  "Dashboard", "Workforce Plan", "All Leads", "No Response / Call Back", "Interviews",
  "Archived Leads", "WhatsApp Messages", "Reports", "Field Executive Onboarding", "DA In-app Onboarding",
  "Recruiter Performance", "Ad Requests"
];
const hrMenus: RecruitmentMenuId[] = [
  "Dashboard", "All Leads", "Screening", "My Interviews", "Interviews", "Documents", "Offers",
  "Hired", "Archived Leads", "WhatsApp Messages", "Reports", "Job Requisitions", "Resume Intake", "AI Fit Review",
  "Active Ads", "Ad Requests", "HR Lifecycle"
];

export const defaultRecruitmentRoleDefinitions: Record<RecruitmentAccessTemplate, {
  label: string;
  menuIds: RecruitmentMenuId[];
}> = {
  owner: { label: "Owner", menuIds: allMenus },
  admin: { label: "Administrator", menuIds: allMenus },
  hr: { label: "HR Recruiter", menuIds: hrMenus },
  workforce: { label: "Workforce Recruiter", menuIds: workforceMenus },
  viewer: { label: "Viewer", menuIds: ["Dashboard", "All Leads", "Reports"] }
};

function sanitizeMenuIds(value: unknown): RecruitmentMenuId[] {
  const allowed = new Set<string>(allMenus);
  return Array.isArray(value)
    ? [...new Set(value.map(String).filter((item) => allowed.has(item)))] as RecruitmentMenuId[]
    : [];
}

function sanitizeWorkspaces(value: unknown): RecruitmentWorkspace[] {
  const allowed = new Set<RecruitmentWorkspace>(["workforce", "hr"]);
  return Array.isArray(value)
    ? [...new Set(value.map(String).filter((item): item is RecruitmentWorkspace => allowed.has(item as RecruitmentWorkspace)))]
    : [];
}

function sanitizeAdRequestActions(value: unknown): AdRequestAction[] {
  const allowed = new Set<string>(allAdRequestActions);
  return Array.isArray(value)
    ? [...new Set(value.map(String).filter((item) => allowed.has(item)))] as AdRequestAction[]
    : [];
}

function sanitizeAccessLevel(value: unknown): RecruitmentAccessLevel {
  return ["view", "edit", "all"].includes(String(value))
    ? String(value) as RecruitmentAccessLevel
    : "none";
}

export function emptyRecruitmentMenuAccess(): RecruitmentWorkspaceMenuAccess {
  return { workforce: {}, hr: {} };
}

export function emptyRecruitmentMenuActions(): RecruitmentWorkspaceMenuActions {
  return { workforce: {}, hr: {} };
}

function actionGrantFromLevel(level: RecruitmentAccessLevel): RecruitmentMenuActionGrant {
  if (level === "all") return { view: true, add: true, edit: true };
  // Historical "edit" access pre-dates the separate Add column. Preserve its
  // ability to create records until the role is explicitly resaved in the new
  // action matrix.
  if (level === "edit") return { view: true, add: true, edit: true };
  if (level === "view") return { view: true, add: false, edit: false };
  return { view: false, add: false, edit: false };
}

function accessLevelFromActionGrant(grant: RecruitmentMenuActionGrant): RecruitmentAccessLevel {
  if (grant.view && grant.add && grant.edit) return "all";
  if (grant.add || grant.edit) return "edit";
  return grant.view ? "view" : "none";
}

function sanitizeMenuActions(
  value: unknown,
  fallbackAccess: RecruitmentWorkspaceMenuAccess
): RecruitmentWorkspaceMenuActions {
  const result = emptyRecruitmentMenuActions();
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  for (const workspace of ["workforce", "hr"] as const) {
    const workspaceValue = source[workspace] && typeof source[workspace] === "object"
      ? source[workspace] as Record<string, unknown>
      : {};
    for (const menuId of allMenus) {
      const raw = workspaceValue[menuId];
      const fallback = actionGrantFromLevel(fallbackAccess[workspace][menuId] ?? "none");
      const grant = raw && typeof raw === "object"
        ? {
            view: Boolean((raw as Record<string, unknown>).view),
            add: Boolean((raw as Record<string, unknown>).add),
            edit: Boolean((raw as Record<string, unknown>).edit)
          }
        : fallback;
      if (grant.add || grant.edit) grant.view = true;
      if (grant.view || grant.add || grant.edit) result[workspace][menuId] = grant;
    }
  }
  return result;
}

function menuAccessFromActions(menuActions: RecruitmentWorkspaceMenuActions): RecruitmentWorkspaceMenuAccess {
  const result = emptyRecruitmentMenuAccess();
  for (const workspace of ["workforce", "hr"] as const) {
    for (const [menuId, grant] of Object.entries(menuActions[workspace])) {
      const level = accessLevelFromActionGrant(grant);
      if (level !== "none") result[workspace][menuId as RecruitmentMenuId] = level;
    }
  }
  return result;
}

export function recruitmentWorkspacesFromMenuAccess(
  menuAccess: RecruitmentWorkspaceMenuAccess
): RecruitmentWorkspace[] {
  return (["workforce", "hr"] as const).filter(
    (workspace) => Object.values(menuAccess[workspace]).some((level) => level && level !== "none")
  );
}

function sanitizeMenuAccess(value: unknown): RecruitmentWorkspaceMenuAccess {
  const result = emptyRecruitmentMenuAccess();
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  for (const workspace of ["workforce", "hr"] as const) {
    const workspaceValue = source[workspace] && typeof source[workspace] === "object"
      ? source[workspace] as Record<string, unknown>
      : {};
    for (const menuId of allMenus) {
      const level = sanitizeAccessLevel(workspaceValue[menuId]);
      if (level !== "none") result[workspace][menuId] = level;
    }
  }
  return result;
}

function migratedMenuAccess(
  workspaces: RecruitmentWorkspace[],
  webMenuIds: RecruitmentMenuId[],
  mobileMenuIds: RecruitmentMenuId[]
): RecruitmentWorkspaceMenuAccess {
  const result = emptyRecruitmentMenuAccess();
  const visible = new Set([...webMenuIds, ...mobileMenuIds]);
  for (const workspace of workspaces) {
    for (const menuId of visible) result[workspace][menuId] = "edit";
  }
  return result;
}

function visibleMenus(menuAccess: RecruitmentWorkspaceMenuAccess) {
  return [...new Set((Object.values(menuAccess) as Array<Partial<Record<RecruitmentMenuId, RecruitmentAccessLevel>>>).flatMap((workspace) =>
    Object.entries(workspace).flatMap(([menuId, level]) => level && level !== "none" ? [menuId as RecruitmentMenuId] : [])
  ))];
}

function actionsFromMenuAccess(menuAccess: RecruitmentWorkspaceMenuAccess): AdRequestAction[] {
  const actions = new Set<AdRequestAction>();
  for (const workspace of ["workforce", "hr"] as const) {
    const requestLevel = menuAccess[workspace]["Ad Requests"] ?? "none";
    const adsLevel = menuAccess[workspace]["Active Ads"] ?? "none";
    if (accessRank[requestLevel] >= accessRank.view) actions.add("view_own");
    if (accessRank[requestLevel] >= accessRank.edit) {
      actions.add("create");
      actions.add("cancel_own");
    }
    if (accessRank[requestLevel] >= accessRank.all) {
      actions.add("view_scoped");
      actions.add("view_all");
      actions.add("review");
      actions.add("approve");
      actions.add("reject");
      actions.add("publish");
      actions.add("complete");
    }
    if (accessRank[adsLevel] >= accessRank.view) actions.add("view_scoped");
    if (accessRank[adsLevel] >= accessRank.all) actions.add("view_all");
  }
  return [...actions];
}

export function restrictRecruitmentPermissionSetToUserWorkspaces(
  permissionSet: RecruitmentPermissionSet,
  enabled: { workforce: boolean; hr: boolean }
): RecruitmentPermissionSet {
  const menuAccess = emptyRecruitmentMenuAccess();
  const menuActions = emptyRecruitmentMenuActions();
  for (const workspace of ["workforce", "hr"] as const) {
    if (!enabled[workspace]) continue;
    menuAccess[workspace] = { ...permissionSet.menuAccess[workspace] };
    menuActions[workspace] = { ...permissionSet.menuActions[workspace] };
  }
  const visible = new Set(visibleMenus(menuAccess));
  return {
    ...permissionSet,
    workspaces: recruitmentWorkspacesFromMenuAccess(menuAccess),
    webMenuIds: permissionSet.webMenuIds.filter((menuId) => visible.has(menuId)),
    mobileMenuIds: permissionSet.mobileMenuIds.filter((menuId) => visible.has(menuId)),
    adRequestActions: actionsFromMenuAccess(menuAccess),
    menuAccess,
    menuActions
  };
}

export function recruitmentMenuAccessLevel(
  permissionSet: Pick<RecruitmentPermissionSet, "menuAccess">,
  workspace: RecruitmentWorkspace,
  menuId: RecruitmentMenuId
) {
  return permissionSet.menuAccess[workspace]?.[menuId] ?? "none";
}

export function recruitmentAccessAtLeast(
  actual: RecruitmentAccessLevel,
  required: Exclude<RecruitmentAccessLevel, "none">
) {
  return accessRank[actual] >= accessRank[required];
}

function inferredAdRequestActions(webMenuIds: RecruitmentMenuId[], mobileMenuIds: RecruitmentMenuId[]) {
  const menus = new Set([...webMenuIds, ...mobileMenuIds]);
  const actions: AdRequestAction[] = [];
  if (menus.has("Ad Requests")) actions.push("create", "view_own", "cancel_own");
  if (menus.has("Active Ads")) {
    actions.push("view_scoped", "review", "approve", "reject", "publish", "complete");
  }
  return [...new Set(actions)];
}

function normalizePermissionSet(value: StoredPermissionSet | undefined): RecruitmentPermissionSet | null {
  if (!value || value.enabled === false) return null;
  const webMenuIds = sanitizeMenuIds(value.webMenuIds);
  const mobileMenuIds = sanitizeMenuIds(value.mobileMenuIds);
  const workspaces = sanitizeWorkspaces(value.workspaces);
  const storedAccess = sanitizeMenuAccess(value.menuAccess);
  const menuAccess = visibleMenus(storedAccess).length
    ? storedAccess
    : migratedMenuAccess(workspaces, webMenuIds, mobileMenuIds);
  const menuActions = sanitizeMenuActions(value.menuActions, menuAccess);
  const accessFromActions = menuAccessFromActions(menuActions);
  const effectiveAccess = visibleMenus(accessFromActions).length ? accessFromActions : menuAccess;
  const migratedVisibleMenus = visibleMenus(effectiveAccess);
  return {
    workspaces: recruitmentWorkspacesFromMenuAccess(effectiveAccess).length
      ? recruitmentWorkspacesFromMenuAccess(effectiveAccess)
      : workspaces,
    webMenuIds: migratedVisibleMenus,
    mobileMenuIds: Array.isArray(value.mobileMenuIds)
      ? mobileMenuIds.filter((menuId) => migratedVisibleMenus.includes(menuId))
      : migratedVisibleMenus,
    adRequestActions: Array.isArray(value.adRequestActions)
      ? sanitizeAdRequestActions(value.adRequestActions)
      : actionsFromMenuAccess(effectiveAccess),
    menuAccess: effectiveAccess,
    menuActions,
    configured: true
  };
}

async function loadPermissionConfig(companyId: string) {
  if (!supabaseAdmin) return {} as Record<string, unknown>;
  const setting = await supabaseAdmin.from("recruitment_connection_settings")
    .select("public_config")
    .eq("company_id", companyId)
    .eq("provider", "mobile")
    .maybeSingle();
  if (setting.error) throw new Error(setting.error.message);
  return setting.data?.public_config && typeof setting.data.public_config === "object"
    ? setting.data.public_config as Record<string, unknown>
    : {};
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function fallbackPermissionSet(
  accessTemplate: RecruitmentAccessTemplate,
  workforce: boolean,
  hr: boolean
): RecruitmentPermissionSet {
  const menuIds = defaultRecruitmentRoleDefinitions[accessTemplate]?.menuIds ?? [];
  const workspaces: RecruitmentWorkspace[] = [
    ...(workforce ? ["workforce" as const] : []),
    ...(hr ? ["hr" as const] : [])
  ];
  const menuAccess = migratedMenuAccess(workspaces, menuIds, menuIds);
  const menuActions = sanitizeMenuActions(undefined, menuAccess);
  return {
    workspaces,
    webMenuIds: menuIds,
    mobileMenuIds: menuIds,
    adRequestActions: inferredAdRequestActions(menuIds, menuIds),
    menuAccess,
    menuActions,
    configured: false,
    source: "legacy"
  };
}

export function matchUniversalRole<T extends UniversalRoleReference>(
  roles: T[],
  roleId?: string | null,
  roleCode?: string | null
) {
  const normalizedId = String(roleId ?? "").trim();
  if (normalizedId) {
    const byId = roles.find((role) => role.id === normalizedId);
    if (byId) return byId;
  }
  const normalizedCode = String(roleCode ?? "").trim().toUpperCase();
  return normalizedCode
    ? roles.find((role) => String(role.code ?? "").trim().toUpperCase() === normalizedCode) ?? null
    : null;
}

export async function loadUniversalRecruitmentPermissions(companyId: string) {
  const publicConfig = await loadPermissionConfig(companyId);
  const roleValues = publicConfig.universal_role_permissions && typeof publicConfig.universal_role_permissions === "object"
    ? publicConfig.universal_role_permissions as Record<string, StoredPermissionSet>
    : {};
  const storedRoles = Object.fromEntries(
    Object.entries(roleValues).flatMap(([id, value]) => {
      const normalized = normalizePermissionSet(value);
      return normalized ? [[id, normalized]] : [];
    })
  ) as Record<string, RecruitmentPermissionSet>;
  const roles: Record<string, RecruitmentPermissionSet> = { ...storedRoles };
  if (supabaseAdmin) {
    const dedicated = await supabaseAdmin.from("recruitment_role_menu_permissions")
      .select("role_id,role_code,workspace,menu_id,can_view,can_add,can_edit")
      .eq("company_id", companyId);
    const missingDedicatedTable = dedicated.error
      && ["42P01", "PGRST202", "PGRST205"].includes(String(dedicated.error.code ?? ""));
    if (dedicated.error && !missingDedicatedTable) throw new Error(dedicated.error.message);

    const dedicatedByRole = new Map<string, {
      roleCode: string;
      menuActions: RecruitmentWorkspaceMenuActions;
    }>();
    for (const row of dedicated.data ?? []) {
      const roleId = String(row.role_id ?? "");
      if (!roleId) continue;
      const entry = dedicatedByRole.get(roleId) ?? {
        roleCode: String(row.role_code ?? "").trim().toUpperCase(),
        menuActions: emptyRecruitmentMenuActions()
      };
      const workspace = row.workspace as RecruitmentWorkspace;
      const menuId = row.menu_id as RecruitmentMenuId;
      if (!["workforce", "hr"].includes(workspace) || !allMenus.includes(menuId)) continue;
      entry.menuActions[workspace][menuId] = {
        view: Boolean(row.can_view || row.can_add || row.can_edit),
        add: Boolean(row.can_add),
        edit: Boolean(row.can_edit)
      };
      dedicatedByRole.set(roleId, entry);
    }
    for (const [roleId, entry] of dedicatedByRole) {
      const normalized = normalizePermissionSet({ enabled: true, menuActions: entry.menuActions });
      if (!normalized) continue;
      roles[roleId] = normalized;
      if (entry.roleCode) roles[entry.roleCode] = normalized;
    }

    const storedRoleIds = [...new Set([
      ...Object.keys(storedRoles).filter(isUuid),
      ...dedicatedByRole.keys()
    ])];
    const [companyRoles, storedRoleRows] = await Promise.all([
      supabaseAdmin.from("user_roles")
        .select("id,code")
        .eq("company_id", companyId)
        .eq("is_active", true),
      storedRoleIds.length
        ? supabaseAdmin.from("user_roles").select("id,code").in("id", storedRoleIds)
        : Promise.resolve({ data: [], error: null })
    ]);
    if (companyRoles.error) throw new Error(companyRoles.error.message);
    if (storedRoleRows.error) throw new Error(storedRoleRows.error.message);
    const roleRows = [...(storedRoleRows.data ?? []), ...(companyRoles.data ?? [])];
    const permissionByCode = new Map<string, RecruitmentPermissionSet>();
    for (const role of roleRows) {
      const permission = roles[role.id];
      const code = String(role.code ?? "").trim().toUpperCase();
      if (permission && code) permissionByCode.set(code, permission);
    }
    for (const [key, permission] of Object.entries(roles)) {
      const codeKey = key.trim().toUpperCase();
      if (codeKey && !roleRows.some((role) => role.id === key)) {
        permissionByCode.set(codeKey, permission);
      }
    }
    for (const role of companyRoles.data ?? []) {
      const code = String(role.code ?? "").trim().toUpperCase();
      const permission = roles[role.id] ?? permissionByCode.get(code);
      if (permission) roles[role.id] = permission;
    }
    for (const [code, permission] of permissionByCode) roles[code] = permission;
  }
  return { roles };
}

export async function resolveRecruitmentPermissionSet(input: {
  companyId: string;
  profileId: string;
  universalRoleId?: string | null;
  universalRoleCode?: string | null;
  isOwner?: boolean;
  accessTemplate: RecruitmentAccessTemplate;
  workforce: boolean;
  hr: boolean;
}) {
  if (input.isOwner || input.accessTemplate === "owner") {
    const menuAccess = {
      workforce: Object.fromEntries(allMenus.map((menuId) => [menuId, "all"])),
      hr: Object.fromEntries(allMenus.map((menuId) => [menuId, "all"]))
    } as RecruitmentWorkspaceMenuAccess;
    const menuActions = sanitizeMenuActions(undefined, menuAccess);
    return {
      workspaces: ["workforce", "hr"],
      webMenuIds: [...allMenus],
      mobileMenuIds: [...allMenus],
      adRequestActions: [...allAdRequestActions],
      menuAccess,
      menuActions,
      configured: true,
      source: "owner"
    } satisfies RecruitmentPermissionSet;
  }
  const configured = await loadUniversalRecruitmentPermissions(input.companyId);
  // Recruitment follows the same simple model as the main DropX dashboard:
  // the universal user is assigned a role, and that role owns the menu matrix.
  // Per-user menu overrides are intentionally ignored so a user's effective
  // access can always be explained by one role plus an optional narrower scope.
  if (input.universalRoleId) {
    const directRolePermission = configured.roles[input.universalRoleId];
    if (directRolePermission) return {
      ...restrictRecruitmentPermissionSetToUserWorkspaces(directRolePermission, input),
      source: "role_id"
    };
  }
  const roleCode = String(input.universalRoleCode ?? "").trim().toUpperCase();
  if (roleCode) {
    const keyedByCode = configured.roles[roleCode];
    if (keyedByCode) return {
      ...restrictRecruitmentPermissionSetToUserWorkspaces(keyedByCode, input),
      source: "role_code"
    };
    if (supabaseAdmin) {
      const matchingRoleIds = await supabaseAdmin.from("user_roles")
        .select("id")
        .ilike("code", roleCode);
      if (matchingRoleIds.error) throw new Error(matchingRoleIds.error.message);
      const migratedPermission = (matchingRoleIds.data ?? [])
        .map((role) => configured.roles[role.id])
        .find(Boolean);
      if (migratedPermission) return {
        ...restrictRecruitmentPermissionSetToUserWorkspaces(migratedPermission, input),
        source: "role_code"
      };
    }
  }
  if (input.universalRoleId || roleCode) {
    // Rolling-upgrade bridge: a universal role may exist before its new
    // Recruitment matrix has been saved. Preserve that user's existing
    // Workforce/HR access instead of turning every menu and queue off. The
    // first role save replaces this bridge with the explicit action matrix.
    return fallbackPermissionSet(input.accessTemplate, input.workforce, input.hr);
  }
  return fallbackPermissionSet(input.accessTemplate, input.workforce, input.hr);
}

async function savePermissionConfig(
  companyId: string,
  section: "universal_role_permissions" | "user_permission_overrides",
  id: string,
  value: StoredPermissionSet,
  actorProfileId: string,
  actorEmail: string | null
) {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  const current = await supabaseAdmin.from("recruitment_connection_settings")
    .select("id,is_enabled,public_config")
    .eq("company_id", companyId)
    .eq("provider", "mobile")
    .maybeSingle();
  if (current.error) throw new Error(current.error.message);
  const publicConfig = current.data?.public_config && typeof current.data.public_config === "object"
    ? current.data.public_config as Record<string, unknown>
    : {};
  const existing = publicConfig[section] && typeof publicConfig[section] === "object"
    ? publicConfig[section] as Record<string, unknown>
    : {};
  const values = {
    company_id: companyId,
    provider: "mobile",
    is_enabled: current.data?.is_enabled ?? false,
    public_config: {
      ...publicConfig,
      [section]: {
        ...existing,
        [id]: value
      }
    },
    updated_by: actorProfileId,
    updated_by_email: actorEmail,
    updated_at: new Date().toISOString()
  };
  const saved = current.data
    ? await supabaseAdmin.from("recruitment_connection_settings").update(values).eq("id", current.data.id)
    : await supabaseAdmin.from("recruitment_connection_settings").insert(values);
  if (saved.error) throw new Error(saved.error.message);
}

export async function saveUniversalRecruitmentRolePermissions(
  companyId: string,
  roleId: string,
  workspaces: unknown,
  webMenuIds: unknown,
  mobileMenuIds: unknown,
  adRequestActions: unknown,
  menuAccess: unknown,
  menuActions: unknown,
  actorProfileId: string,
  actorEmail: string | null
) {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  const requestedWorkspaces = sanitizeWorkspaces(workspaces);
  const role = await supabaseAdmin.from("user_roles").select("id,code")
    .eq("id", roleId).eq("is_active", true).maybeSingle();
  if (role.error) throw new Error(role.error.message);
  if (!role.data) throw new Error("Choose an active universal company role.");
  let sanitizedMenuAccess = sanitizeMenuAccess(menuAccess);
  const sanitizedMenuActions = sanitizeMenuActions(menuActions, sanitizedMenuAccess);
  if (menuActions && typeof menuActions === "object") {
    sanitizedMenuAccess = menuAccessFromActions(sanitizedMenuActions);
  }
  const hasMenuMatrix = Boolean(menuAccess && typeof menuAccess === "object");
  for (const workspace of ["workforce", "hr"] as const) {
    if (!hasMenuMatrix && !requestedWorkspaces.includes(workspace)) {
      sanitizedMenuAccess[workspace] = {};
      continue;
    }
    const validMenus = new Set<RecruitmentMenuId>(
      recruitmentMenuCatalog
        .filter((item) => (item.workspaces as readonly string[]).includes(workspace))
        .map((item) => item.id)
    );
    sanitizedMenuAccess[workspace] = Object.fromEntries(
      Object.entries(sanitizedMenuAccess[workspace]).filter(([menuId]) => validMenus.has(menuId as RecruitmentMenuId))
    );
    sanitizedMenuActions[workspace] = Object.fromEntries(
      Object.entries(sanitizedMenuActions[workspace]).filter(([menuId]) => validMenus.has(menuId as RecruitmentMenuId))
    );
  }
  // Workforce/HR access is inferred from the actual menu matrix. There is no
  // separate workspace switch that can drift out of sync with permissions.
  const sanitizedWorkspaces = recruitmentWorkspacesFromMenuAccess(sanitizedMenuAccess);
  const normalizedVisibleMenus = visibleMenus(sanitizedMenuAccess);
  const normalizedMobileMenus = sanitizeMenuIds(mobileMenuIds)
    .filter((menuId) => normalizedVisibleMenus.includes(menuId));
  const permissionValue = {
    enabled: true,
    workspaces: sanitizedWorkspaces,
    webMenuIds: normalizedVisibleMenus.length ? normalizedVisibleMenus : sanitizeMenuIds(webMenuIds),
    mobileMenuIds: normalizedVisibleMenus.length ? normalizedMobileMenus : sanitizeMenuIds(mobileMenuIds),
    adRequestActions: normalizedVisibleMenus.length ? actionsFromMenuAccess(sanitizedMenuAccess) : sanitizeAdRequestActions(adRequestActions),
    menuAccess: sanitizedMenuAccess,
    menuActions: sanitizedMenuActions
  };
  await savePermissionConfig(
    companyId,
    "universal_role_permissions",
    roleId,
    permissionValue,
    actorProfileId,
    actorEmail
  );
  const roleCode = String(role.data.code ?? "").trim().toUpperCase();
  const dedicatedSave = await supabaseAdmin.rpc("recruitment_replace_role_menu_permissions", {
    p_company_id: companyId,
    p_role_id: roleId,
    p_role_code: roleCode,
    p_permissions: sanitizedMenuActions,
    p_actor_profile_id: actorProfileId
  });
  const missingDedicatedRpc = dedicatedSave.error
    && ["42883", "PGRST202"].includes(String(dedicatedSave.error.code ?? ""));
  if (dedicatedSave.error && !missingDedicatedRpc) throw new Error(dedicatedSave.error.message);

  if (roleCode) {
    await savePermissionConfig(
      companyId,
      "universal_role_permissions",
      roleCode,
      permissionValue,
      actorProfileId,
      actorEmail
    );
  }
}

export async function loadRecruitmentRoleDefinitions(companyId: string) {
  if (!supabaseAdmin) return defaultRecruitmentRoleDefinitions;
  const setting = await supabaseAdmin.from("recruitment_connection_settings")
    .select("public_config")
    .eq("company_id", companyId)
    .eq("provider", "mobile")
    .maybeSingle();
  if (setting.error) throw new Error(setting.error.message);
  const configured = (setting.data?.public_config as Record<string, unknown> | null)?.user_roles;
  const roleConfig = configured && typeof configured === "object"
    ? configured as Record<string, { label?: unknown; menuIds?: unknown }>
    : {};
  return Object.fromEntries(
    (Object.keys(defaultRecruitmentRoleDefinitions) as RecruitmentAccessTemplate[]).map((template) => {
      const defaults = defaultRecruitmentRoleDefinitions[template];
      const saved = roleConfig[template];
      const menuIds = saved && "menuIds" in saved ? sanitizeMenuIds(saved.menuIds) : defaults.menuIds;
      if (["workforce", "admin"].includes(template) && menuIds.includes("Field Executive Onboarding") && !menuIds.includes("DA In-app Onboarding")) {
        menuIds.push("DA In-app Onboarding");
      }
      return [template, {
        label: String(saved?.label ?? defaults.label).trim().slice(0, 80) || defaults.label,
        menuIds: template === "owner" ? allMenus : menuIds
      }];
    })
  ) as typeof defaultRecruitmentRoleDefinitions;
}

export async function saveRecruitmentRoleDefinition(
  companyId: string,
  template: RecruitmentAccessTemplate,
  label: string,
  menuIds: unknown,
  actorProfileId: string,
  actorEmail: string | null
) {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  if (!(template in defaultRecruitmentRoleDefinitions)) throw new Error("Invalid recruitment user role.");
  const current = await supabaseAdmin.from("recruitment_connection_settings")
    .select("id,is_enabled,public_config")
    .eq("company_id", companyId)
    .eq("provider", "mobile")
    .maybeSingle();
  if (current.error) throw new Error(current.error.message);
  const publicConfig = current.data?.public_config && typeof current.data.public_config === "object"
    ? current.data.public_config as Record<string, unknown>
    : {};
  const existingRoles = publicConfig.user_roles && typeof publicConfig.user_roles === "object"
    ? publicConfig.user_roles as Record<string, unknown>
    : {};
  const nextConfig = {
    ...publicConfig,
    user_roles: {
      ...existingRoles,
      [template]: {
        label: label.trim().slice(0, 80) || defaultRecruitmentRoleDefinitions[template].label,
        menuIds: template === "owner" ? allMenus : sanitizeMenuIds(menuIds)
      }
    }
  };
  const values = {
    company_id: companyId,
    provider: "mobile",
    is_enabled: current.data?.is_enabled ?? false,
    public_config: nextConfig,
    updated_by: actorProfileId,
    updated_by_email: actorEmail,
    updated_at: new Date().toISOString()
  };
  const saved = current.data
    ? await supabaseAdmin.from("recruitment_connection_settings").update(values).eq("id", current.data.id)
    : await supabaseAdmin.from("recruitment_connection_settings").insert(values);
  if (saved.error) throw new Error(saved.error.message);
}
