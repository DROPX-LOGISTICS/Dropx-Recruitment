export type RecruitmentUserWorkspace = "workforce" | "hr";

export type RecruitmentUserWorkspaceAccess = {
  can_access_workforce?: boolean | null;
  can_access_hr?: boolean | null;
};

export type ActiveCompanyUser = {
  id?: unknown;
  full_name?: unknown;
  employee_id?: unknown;
  email?: unknown;
  is_active?: unknown;
};

export function activateRecruitmentUserWorkspace(
  current: RecruitmentUserWorkspaceAccess | null | undefined,
  workspace: RecruitmentUserWorkspace
) {
  return {
    can_access_workforce: workspace === "workforce" || current?.can_access_workforce === true,
    can_access_hr: workspace === "hr" || current?.can_access_hr === true
  };
}

export function isRecruitmentUserWorkspaceEnabled(
  access: RecruitmentUserWorkspaceAccess | null | undefined,
  workspace: RecruitmentUserWorkspace
) {
  return workspace === "workforce"
    ? access?.can_access_workforce === true
    : access?.can_access_hr === true;
}

export function activeCompanyUserOptions(users: ActiveCompanyUser[]) {
  const unique = new Map<string, [string, string]>();
  for (const user of users) {
    const id = String(user.id ?? "").trim();
    if (!id || user.is_active === false || unique.has(id)) continue;
    const name = String(user.full_name ?? "").trim() || "Unnamed";
    const identity = String(user.employee_id ?? user.email ?? "No ID").trim() || "No ID";
    unique.set(id, [id, `${name} — ${identity}`]);
  }
  return [...unique.values()].sort((first, second) => first[1].localeCompare(second[1]));
}
