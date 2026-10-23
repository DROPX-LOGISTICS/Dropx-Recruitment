import { canUseRecruitmentMenu } from "@/lib/recruitment-api";
import type { MobileSessionContext } from "@/lib/mobile-session";
import { loadRecruitAuthForMcpUser } from "@/lib/recruitment-web-session";
import { MCP_SCOPE } from "@/lib/mcp/constants";
import type { RecruitmentMenuId, RecruitmentWorkspace } from "@/lib/recruitment-menu-roles";

export { loadRecruitAuthForMcpUser };

export type RecruitMcpAuthContext = MobileSessionContext & { companyId: string };

export function mcpUserHasRecruitAccess(session: MobileSessionContext) {
  if (session.isOwner) return true;
  if (session.workforce || session.hr) return true;
  return (session.menuPermissions?.length ?? 0) > 0;
}

export function assertMcpScope(scope: string | null | undefined) {
  const parts = String(scope ?? "")
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.includes(MCP_SCOPE) || parts.includes("recruit") || parts.length === 0;
}

export function mcpCanViewMenu(
  session: MobileSessionContext,
  menuId: RecruitmentMenuId,
  workspace?: RecruitmentWorkspace
) {
  return canUseRecruitmentMenu(session, menuId, "view", workspace);
}

export function withCompanyId(session: MobileSessionContext, companyId: string): RecruitMcpAuthContext {
  return { ...session, companyId };
}
