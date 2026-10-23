import { canUseRecruitmentMenu } from "@/lib/recruitment-api";
import type { RecruitmentMenuId, RecruitmentWorkspace } from "@/lib/recruitment-menu-roles";
import {
  assertReadOnlyToolName,
  findMcpTool,
  listMcpTools,
  listMcpToolsForAuth,
  isWriteLikeToolName,
  type McpToolDefinition
} from "@/lib/mcp/tools-policy";
import { mcpUserHasRecruitAccess, withCompanyId, type RecruitMcpAuthContext } from "@/lib/mcp/authorization";
import type { MobileSessionContext } from "@/lib/mobile-session";
import * as summaries from "@/lib/mcp/summaries";

export type { McpToolDefinition };
export { isWriteLikeToolName, listMcpTools, listMcpToolsForAuth };

function canAccessMenu(session: MobileSessionContext, menuId: RecruitmentMenuId, workspace?: RecruitmentWorkspace) {
  return canUseRecruitmentMenu(session, menuId, "view", workspace);
}

export function mcpToolsVisibleTo(session: MobileSessionContext, companyId: string) {
  if (!mcpUserHasRecruitAccess(session)) return [];
  return listMcpToolsForAuth((menuId, workspace) => canAccessMenu(session, menuId, workspace));
}

export async function callMcpTool(
  session: MobileSessionContext,
  companyId: string,
  name: string,
  args: Record<string, unknown> = {}
): Promise<unknown> {
  assertReadOnlyToolName(name);
  const tool = findMcpTool(name);
  if (!tool) throw Object.assign(new Error(`Unknown tool: ${name}`), { code: -32601 });
  if (!mcpUserHasRecruitAccess(session)) {
    throw Object.assign(new Error("Permission denied for Recruit."), { code: -32003 });
  }
  if (!listMcpToolsForAuth((menuId, workspace) => canAccessMenu(session, menuId, workspace)).some((entry) => entry.name === name)) {
    throw Object.assign(new Error("Permission denied for Recruit MCP."), { code: -32003 });
  }
  const auth: RecruitMcpAuthContext = withCompanyId(session, companyId);
  summaries.requireToolMenus(auth, tool, args);

  switch (name) {
    case "recruit_list_scope":
      return summaries.summarizeRecruitScope(auth);
    case "recruit_dashboard_summary":
      return summaries.summarizeDashboard(auth, args);
    case "recruit_lead_status_summary":
      return summaries.summarizeLeadStatus(auth, args);
    case "recruit_sla_queues":
      return summaries.summarizeSlaQueues(auth, args);
    case "recruit_interview_summary":
      return summaries.summarizeInterviews(auth, args);
    case "recruit_ads_summary":
      return summaries.summarizeAds(auth, args);
    case "recruit_unmapped_count":
      return summaries.summarizeUnmapped(auth, args);
    case "recruit_requisition_summary":
      return summaries.summarizeRequisitions(auth);
    case "recruit_reports_snapshot":
      return summaries.summarizeReportsSnapshot(auth, args);
    default:
      throw Object.assign(new Error(`Unknown tool: ${name}`), { code: -32601 });
  }
}
