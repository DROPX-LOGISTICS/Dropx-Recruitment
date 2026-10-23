import assert from "node:assert/strict";
import test from "node:test";
import { listMcpToolsForAuth, mcpToolsGate } from "./tools-policy.ts";

test("mcpToolsGate allows Dashboard or any menu view", () => {
  assert.equal(mcpToolsGate((_menu, workspace) => workspace === "workforce"), true);
  assert.equal(mcpToolsGate((menu) => menu === "Reports"), true);
  assert.equal(mcpToolsGate(() => false), false);
});

test("listMcpToolsForAuth filters by menu access", () => {
  const tools = listMcpToolsForAuth((menu) => menu === "Dashboard" || menu === "Unmapped");
  const names = tools.map((tool) => tool.name);
  assert.ok(names.includes("recruit_dashboard_summary"));
  assert.ok(names.includes("recruit_unmapped_count"));
  assert.equal(names.includes("recruit_requisition_summary"), false);
});

test("listMcpToolsForAuth returns empty without gate permission", () => {
  assert.deepEqual(listMcpToolsForAuth(() => false), []);
});
