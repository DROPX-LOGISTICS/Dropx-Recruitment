import { beforeEach, describe, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({ stations: ["main-a", "main-b"], source: "designation_policy", active: true, fail: false, previewAllowed: true, requests: [] as URL[] }));
vi.mock("./mobile-auth", () => ({ hashSessionToken: () => "hash" }));
vi.mock("./people-designation", () => ({ loadPeopleDesignations: async () => new Map(), canPreviewPortalUsers: () => f.previewAllowed }));
vi.mock("./recruitment-workforce-config", () => ({ loadWorkforceConfig: async () => ({ userFunctions: [] }), workforceFunctionFor: () => ({ function: "manager", trackPerformance: false }) }));
vi.mock("./recruitment-menu-roles", () => ({
  matchUniversalRole: (rows: any[]) => rows[0],
  resolveRecruitmentPermissionSet: async () => ({ configured: false, workspaces: ["workforce"], webMenuIds: [], mobileMenuIds: [], menuAccess: { workforce: {}, hr: {} }, menuActions: { workforce: {}, hr: {} }, adRequestActions: [] })
}));
vi.mock("./supabase-admin", async () => {
  const { createClient } = await import("@supabase/supabase-js");
  return { supabaseAdmin: createClient("https://recruit.test", "test-key", { auth: { persistSession: false }, global: { fetch: async (input) => {
    const url = new URL(String(input)); f.requests.push(url);
    const table = url.pathname.split("/").at(-1)!;
    if (table === "company_product_memberships" && f.fail) return new Response(JSON.stringify({ message: "Scope unavailable" }), { status: 500 });
    const rows: Record<string, any> = {
      recruitment_mobile_sessions: { id: "session", profile_id: "viewer", auth_method: "google", expires_at: "2099-01-01T00:00:00Z", revoked_at: null, last_seen_at: new Date().toISOString() },
      profiles: { id: url.searchParams.get("id")?.slice(3), full_name: "Test manager", role: "user", location_scope_ids: ["old-home"], is_active: true },
      recruitment_user_access: { id: "access", can_access_workforce: true, can_access_hr: false, can_access_all_locations: false },
      company_product_memberships: f.active ? { role_id: "role", role_code_snapshot: "RECRUIT_CLM", source_system: f.source, designation_id: "clm", has_all_location_access: false, location_scope_ids: f.stations } : null,
      recruitment_login_allowlist: null, recruitment_user_locations: [{ location_id: "old-home" }], recruitment_user_roles: [],
      user_roles: [{ id: "role", code: "RECRUIT_CLM", location_access_mode: "assigned_locations" }],
      stations: [{ id: "main-a", station_code: "A" }, { id: "main-b", station_code: "B" }, { id: "old-home", station_code: "OLD" }],
      recruitment_locations: [{ id: "a", code: "A" }, { id: "b", code: "B" }, { id: "old-home", code: "OLD" }],
      recruitment_temporary_location_grants: []
    };
    return new Response(JSON.stringify(rows[table] ?? null), { headers: { "Content-Type": "application/json" } });
  } } }) };
});
import { invalidateMobileSessionCache, loadRecruitSessionForProfile, resolveMobileSession } from "./mobile-session";
const request = (preview = "", method = "GET") => new Request("https://recruit.test/api/recruitment/options", {
  method, headers: { Authorization: "Bearer test", ...(preview ? { "x-dropx-preview-profile": preview } : {}) }
});

beforeEach(() => { invalidateMobileSessionCache(); f.stations = ["main-a", "main-b"]; f.source = "designation_policy"; f.active = true; f.fail = false; f.previewAllowed = true; f.requests = []; });

describe("People scope across all Recruit entry points", () => {
  it("uses the same current scope for real login, read-only preview and MCP", async () => {
    const actual = await resolveMobileSession(request(), "company");
    const preview = await resolveMobileSession(request("target"), "company");
    const mcp = await loadRecruitSessionForProfile("company", "target");
    for (const session of [actual, preview, mcp]) {
      expect(session?.locationIds).toEqual(["a", "b"]);
      expect(session?.allLocations).toBe(false);
    }
    expect(actual?.readOnly).toBe(false);
    expect(preview).toMatchObject({ profileId: "target", viewerProfileId: "viewer", isPreview: true, readOnly: true });
    expect(mcp?.readOnly).toBe(true);
  });
  it("inherits the same scope for a People-linked person override", async () => {
    f.source = "person_override"; f.stations = ["main-b"];
    expect((await resolveMobileSession(request(), "company"))?.locationIds).toEqual(["b"]);
  });
  it("picks up additions/removals without editing Recruit and uses fresh scope for writes", async () => {
    expect((await resolveMobileSession(request(), "company"))?.locationIds).toEqual(["a", "b"]);
    f.stations = [];
    expect((await resolveMobileSession(request("", "POST"), "company"))?.locationIds).toEqual([]);
    invalidateMobileSessionCache();
    f.stations = ["main-b"];
    expect((await resolveMobileSession(request(), "company"))?.locationIds).toEqual(["b"]);
  });
  it("denies inactive memberships and fails closed on lookup errors", async () => {
    f.active = false;
    expect(await resolveMobileSession(request(), "company")).toBeNull();
    expect(await loadRecruitSessionForProfile("company", "target")).toBeNull();
    f.active = true; f.fail = true;
    await expect(resolveMobileSession(request(), "company")).rejects.toThrow("Scope unavailable");
  });
  it("refreshes People changes on GET after the existing 60-second session cache expires", async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    try {
      expect((await resolveMobileSession(request(), "company"))?.locationIds).toEqual(["a", "b"]);
      f.stations = ["main-b"];
      clock.mockReturnValue(now + 60_001);
      expect((await resolveMobileSession(request(), "company"))?.locationIds).toEqual(["b"]);
    } finally { clock.mockRestore(); }
  });
  it("does not allow an ordinary user to choose someone else's preview", async () => {
    f.previewAllowed = false;
    expect(await resolveMobileSession(request("target"), "company")).toMatchObject({ profileId: "viewer", isPreview: false });
  });
  it("keeps membership and station reads company-scoped and active-only", async () => {
    await resolveMobileSession(request("target"), "company");
    for (const url of f.requests.filter(url => ["company_product_memberships", "stations", "recruitment_locations"].some(table => url.pathname.endsWith(`/${table}`)))) {
      expect(url.searchParams.get("company_id")).toBe("eq.company");
      expect(url.searchParams.get("is_active")).toBe("eq.true");
    }
    const membership = f.requests.find(url => url.pathname.endsWith("company_product_memberships"))!;
    expect(membership.searchParams.get("product_code")).toBe("eq.recruit");
    expect(membership.searchParams.get("select")).toContain("source_system,designation_id");
  });
});
