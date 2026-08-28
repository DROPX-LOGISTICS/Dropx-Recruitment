import { resolveMobileSession } from "./mobile-session";
import {
  recruitmentAccessAtLeast,
  type RecruitmentAccessLevel,
  type RecruitmentMenuId,
  type RecruitmentWorkspace
} from "./recruitment-menu-roles";

export function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

export async function recruitmentSession(request: Request) {
  const session = await resolveMobileSession(request, requiredEnv("RECRUITMENT_COMPANY_ID"));
  if (session?.readOnly && !["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())) {
    throw new Error("Owner preview is read-only. Exit View as user before making changes.");
  }
  return session;
}

export function canUseRecruitmentMenu(
  session: Awaited<ReturnType<typeof recruitmentSession>>,
  menuId: RecruitmentMenuId,
  required: "view" | "add" | "edit" | "all" = "view",
  workspace?: RecruitmentWorkspace
) {
  if (!session) return false;
  if (session.isOwner) return true;
  // RINF is deliberately a closed personal workspace. Universal fallback
  // menus must never turn an influencer into a telecaller or expose the full
  // Workforce queue before the role matrix is configured.
  if (session.recruitmentFunction === "influencer") {
    if (menuId === "Influencer Performance" && required === "view" && workspace !== "hr") return true;
    if (menuId === "Field Executive Onboarding" && ["view", "add"].includes(required) && workspace !== "hr") return true;
    return false;
  }
  // Personal performance is function-derived, not dependent on a manager
  // manually adding the menu to every individual user role.
  if (workspace !== "hr" && menuId === "Recruiter Performance"
    && session.recruitmentFunction === "telecaller" && required === "view") return true;
  if (workspace !== "hr" && menuId === "Field Recruitment"
    && session.recruitmentFunction === "field_recruiter"
    && ["view", "add", "edit"].includes(required)) return true;
  const workspaces: RecruitmentWorkspace[] = workspace
    ? [workspace]
    : ["workforce", "hr"];
  return workspaces.some((scope) => {
    const grant = session.menuActions?.[scope]?.[menuId];
    if (grant) {
      if (required === "all") return grant.view && grant.add && grant.edit;
      return grant[required] === true;
    }
    // Compatibility for sessions created before the action matrix existed.
    // A historical Edit permission included create/update behavior.
    const level = session.menuAccess?.[scope]?.[menuId] ?? "none";
    if (required === "add") return recruitmentAccessAtLeast(level, "edit");
    return recruitmentAccessAtLeast(level, required);
  });
}

type LeadAccessTarget = {
  stream?: string | null;
  location_id?: string | null;
  role_id?: string | null;
};

export function hasFullLeadAccess(
  session: Awaited<ReturnType<typeof recruitmentSession>>
) {
  return Boolean(
    session &&
    (session.isOwner || (
      canUseRecruitmentMenu(session, "All Leads", "all", "workforce") &&
      canUseRecruitmentMenu(session, "All Leads", "all", "hr")
    )) &&
    session.allLocations &&
    session.workforce &&
    session.hr
  );
}

export function canAccessLead(
  session: Awaited<ReturnType<typeof recruitmentSession>>,
  lead: LeadAccessTarget
) {
  if (!session) return false;
  if (hasFullLeadAccess(session)) return true;
  if (lead.stream === "workforce" && !session.workforce) return false;
  if (lead.stream === "hr" && !session.hr) return false;
  if (!session.allLocations && (!lead.location_id || !session.locationIds.includes(lead.location_id))) return false;
  if (session.roleIds.length && (!lead.role_id || !session.roleIds.includes(lead.role_id))) return false;
  return true;
}

export function applyLeadScope<T extends {
  in(column: string, values: string[]): T;
  eq(column: string, value: string): T;
}>(
  query: T,
  session: Awaited<ReturnType<typeof recruitmentSession>>,
  stream?: string | null
) {
  if (!session) return query;
  let scoped = query;
  if (stream === "workforce" || stream === "hr") {
    scoped = scoped.eq("stream", stream);
  }
  // Global lead scope comes only from explicit All access to All Leads in both
  // workspaces (or Owner). Admin/menu-management access never widens lead data.
  if (hasFullLeadAccess(session)) {
    return scoped;
  }
  if (!session.allLocations) {
    scoped = scoped.in("location_id", session.locationIds);
  }
  if (session.roleIds.length) {
    scoped = scoped.in("role_id", session.roleIds);
  }
  return scoped;
}
