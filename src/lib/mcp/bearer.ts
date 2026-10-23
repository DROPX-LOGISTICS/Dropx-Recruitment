import {
  assertMcpScope,
  loadRecruitAuthForMcpUser,
  mcpUserHasRecruitAccess,
  withCompanyId,
  type RecruitMcpAuthContext
} from "@/lib/mcp/authorization";
import { requiredEnv } from "@/lib/recruitment-api";
import { resolveAccessToken } from "@/lib/mcp/store";

export type McpBearerResult =
  | { ok: true; auth: RecruitMcpAuthContext; scope: string }
  | { ok: false; reason: "missing" | "invalid" | "forbidden" };

export function extractBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? request.headers.get("Authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || null;
}

export async function authorizeMcpRequest(request: Request): Promise<McpBearerResult> {
  const token = extractBearerToken(request);
  if (!token) return { ok: false, reason: "missing" };
  const resolved = await resolveAccessToken(token);
  if (!resolved || !assertMcpScope(resolved.scope)) return { ok: false, reason: "invalid" };
  const session = await loadRecruitAuthForMcpUser(resolved.userId);
  if (!session || !mcpUserHasRecruitAccess(session)) return { ok: false, reason: "forbidden" };
  const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
  if (resolved.companyId && resolved.companyId !== companyId) {
    return { ok: false, reason: "forbidden" };
  }
  return { ok: true, auth: withCompanyId(session, companyId), scope: resolved.scope };
}
