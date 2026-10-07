export type RecruitNavItem = [string, string, string];

/** Keep stable route/permission IDs; only reorganise presentation. */
export function groupRecruitNavigation(items: RecruitNavItem[]) {
  const settings = new Set(["Access Control", "User Roles", "Connections", "System Health", "Audit"]);
  const groups = new Map<string, RecruitNavItem[]>();
  for (const [section, label, route] of items) {
    const group = settings.has(route) ? "Settings"
      : section === "Master" ? "Masters"
      : route === "Master Reports" ? "Reports" : section;
    groups.set(group, [...(groups.get(group) ?? []), [group, label, route]]);
  }
  const result = [...groups].filter(([name]) => !["Masters", "Settings"].includes(name));
  for (const name of ["Masters", "Settings"]) {
    if (groups.has(name)) result.push([name, groups.get(name)!]);
  }
  return result;
}
