import type { RecruitmentMenuId, RecruitmentWorkspace } from "@/lib/recruitment-menu-roles";

export type McpToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  menuIds: RecruitmentMenuId[];
  workspaces?: RecruitmentWorkspace[];
};

const WRITE_NAME_PATTERN = /(write|create|update|delete|mutate|insert|upsert|patch|remove|approve|reject|submit)/i;

const streamProp = {
  stream: {
    type: "string",
    description: "Optional workspace stream: workforce or hr. Defaults to both when permitted."
  }
};

export const MCP_READ_ONLY_TOOLS: McpToolDefinition[] = [
  {
    name: "recruit_list_scope",
    description: "Describe the caller's Recruit permission scope (no lead or candidate directory dump).",
    menuIds: ["Dashboard"],
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "recruit_dashboard_summary",
    description: "Read-only dashboard funnel metrics (counts only; no names or phones).",
    menuIds: ["Dashboard"],
    inputSchema: { type: "object", properties: { ...streamProp } }
  },
  {
    name: "recruit_lead_status_summary",
    description: "Read-only lead counts grouped by status within scope.",
    menuIds: ["Dashboard", "All Leads"],
    inputSchema: { type: "object", properties: { ...streamProp } }
  },
  {
    name: "recruit_sla_queues",
    description: "Read-only SLA queue counts (no status, callback, stale buckets).",
    menuIds: ["Dashboard", "No Response / Call Back"],
    inputSchema: { type: "object", properties: { ...streamProp } }
  },
  {
    name: "recruit_interview_summary",
    description: "Read-only interview outcome counts for a date range (no candidate PII).",
    menuIds: ["Interviews", "Reports"],
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "ISO start date YYYY-MM-DD" },
        to: { type: "string", description: "ISO end date YYYY-MM-DD" }
      }
    }
  },
  {
    name: "recruit_ads_summary",
    description: "Read-only active ad counts by delivery/route status (no creative payloads).",
    menuIds: ["Active Ads"],
    inputSchema: { type: "object", properties: { ...streamProp } }
  },
  {
    name: "recruit_unmapped_count",
    description: "Count of unmapped intake leads needing station or designation mapping.",
    menuIds: ["Unmapped"],
    inputSchema: { type: "object", properties: { ...streamProp } }
  },
  {
    name: "recruit_requisition_summary",
    description: "Read-only open job requisition counts and remaining openings.",
    menuIds: ["Job Requisitions"],
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "recruit_reports_snapshot",
    description: "List operational report types available to the caller (no XLSX export or row dumps).",
    menuIds: ["Reports"],
    inputSchema: { type: "object", properties: { ...streamProp } }
  }
];

export function isWriteLikeToolName(name: string) {
  return WRITE_NAME_PATTERN.test(name);
}

export function listMcpTools() {
  return MCP_READ_ONLY_TOOLS;
}

export function findMcpTool(name: string) {
  return MCP_READ_ONLY_TOOLS.find((tool) => tool.name === name) ?? null;
}

export function assertReadOnlyToolName(name: string) {
  if (isWriteLikeToolName(name) || !findMcpTool(name)) {
    const error = new Error(`Unknown or unsupported tool: ${name}`) as Error & { code: number };
    error.code = -32601;
    throw error;
  }
}

export type McpMenuCheck = (menuId: RecruitmentMenuId, workspace?: RecruitmentWorkspace) => boolean;

export function mcpToolsGate(canAccess: McpMenuCheck) {
  if (canAccess("Dashboard", "workforce") || canAccess("Dashboard", "hr")) return true;
  return MCP_READ_ONLY_TOOLS.some((tool) =>
    tool.menuIds.some((menuId) =>
      (tool.workspaces ?? ["workforce", "hr"]).some((workspace) => canAccess(menuId, workspace))
    )
  );
}

export function listMcpToolsForAuth(canAccess: McpMenuCheck): McpToolDefinition[] {
  if (!mcpToolsGate(canAccess)) return [];
  return MCP_READ_ONLY_TOOLS.filter((tool) =>
    tool.menuIds.some((menuId) =>
      (tool.workspaces ?? ["workforce", "hr"]).some((workspace) => canAccess(menuId, workspace))
    )
  );
}

export function toolToListEntry(tool: McpToolDefinition) {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema
  };
}
