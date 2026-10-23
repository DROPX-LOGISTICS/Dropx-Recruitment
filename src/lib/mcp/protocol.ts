import type { MobileSessionContext } from "@/lib/mobile-session";
import { callMcpTool, mcpToolsVisibleTo } from "@/lib/mcp/tools";
import {
  handleMcpJsonRpcCore,
  type JsonRpcRequest,
  type JsonRpcResponse
} from "@/lib/mcp/protocol-core";

export type { JsonRpcId, JsonRpcRequest, JsonRpcResponse } from "@/lib/mcp/protocol-core";
export { jsonRpcError, jsonRpcResult } from "@/lib/mcp/protocol-core";

export async function handleMcpJsonRpc(
  session: MobileSessionContext,
  companyId: string,
  body: JsonRpcRequest | JsonRpcRequest[]
): Promise<JsonRpcResponse | JsonRpcResponse[]> {
  const hooks = {
    listTools: () => mcpToolsVisibleTo(session, companyId),
    callTool: (name: string, args: Record<string, unknown>) => callMcpTool(session, companyId, name, args)
  };
  if (Array.isArray(body)) {
    const responses: JsonRpcResponse[] = [];
    for (const item of body) {
      responses.push(await handleMcpJsonRpcCore(item, hooks));
    }
    return responses;
  }
  return handleMcpJsonRpcCore(body, hooks);
}
