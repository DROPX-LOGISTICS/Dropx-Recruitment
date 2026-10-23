import assert from "node:assert/strict";
import test from "node:test";
import { handleMcpJsonRpcCore } from "./protocol-core.ts";

test("initialize returns Recruit MCP server info", async () => {
  const response = await handleMcpJsonRpcCore({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {}
  });
  assert.equal(response.error, undefined);
  assert.equal(response.result.serverInfo.name, "dropx-recruit-mcp");
  assert.ok(response.result.capabilities.tools);
});

test("tools/list returns read-only Recruit tools", async () => {
  const response = await handleMcpJsonRpcCore({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list"
  });
  assert.equal(response.error, undefined);
  assert.ok(response.result.tools.some((tool) => tool.name === "recruit_dashboard_summary"));
  assert.ok(response.result.tools.some((tool) => tool.name === "recruit_reports_snapshot"));
  assert.equal(response.result.tools.length, 9);
});

test("write methods and write-like tools are rejected", async () => {
  const writeMethod = await handleMcpJsonRpcCore({
    jsonrpc: "2.0",
    id: 3,
    method: "resources/write"
  });
  assert.equal(writeMethod.error.code, -32601);

  const writeTool = await handleMcpJsonRpcCore({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "recruit_leads_update", arguments: {} }
  });
  assert.equal(writeTool.error.code, -32601);
});
