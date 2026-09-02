export type RecruitmentRoleCatalogItem = {
  code?: string | null;
  name?: string | null;
  stream?: string | null;
};

export function workspaceRoleCatalog(
  masterRoles: RecruitmentRoleCatalogItem[],
  workspace: "workforce" | "hr",
  observedRoles: RecruitmentRoleCatalogItem[] = []
) {
  const catalog = new Map<string, { code: string; name: string; stream: "workforce" | "hr" }>();
  for (const item of [...masterRoles, ...observedRoles]) {
    const code = String(item?.code || "").trim().toUpperCase();
    const stream = item?.stream === "hr" ? "hr" : item?.stream === "workforce" ? "workforce" : null;
    if (!code || stream !== workspace) continue;
    if (!catalog.has(code)) {
      catalog.set(code, {
        code,
        name: String(item?.name || code).trim() || code,
        stream
      });
    }
  }
  return [...catalog.values()].sort((left, right) => left.code.localeCompare(right.code));
}
