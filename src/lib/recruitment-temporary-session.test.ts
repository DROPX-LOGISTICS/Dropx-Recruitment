import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ grants: [] as any[], requests: [] as URL[], inactive: false, failGrants: false }));
vi.mock("./mobile-auth", () => ({ hashSessionToken: (token: string) => `test-hash-${token}` }));
vi.mock("./people-designation", () => ({ loadPeopleDesignations: async () => new Map(), canPreviewPortalUsers: () => false }));
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
    const rows: Record<string, any> = {
      recruitment_mobile_sessions: { id: "session", profile_id: "user", auth_method: "google", expires_at: "2099-01-01T00:00:00Z", revoked_at: null, last_seen_at: new Date().toISOString() },
      profiles: { full_name: "Station", role: "RECRUIT_LOCATION", location_scope_ids: ["main-normal"], is_active: true },
      recruitment_user_access: { id: "access", can_access_workforce: true, can_access_hr: false, can_access_all_locations: true },
      company_product_memberships: { id: "membership", role_id: "role", role_code_snapshot: "RECRUIT_LOCATION", has_all_location_access: false },
      recruitment_login_allowlist: null,
      recruitment_user_locations: [], recruitment_user_roles: [{ role_id: "da" }],
      user_roles: [{ id: "role", code: "RECRUIT_LOCATION", location_access_mode: "assigned_locations" }],
      stations: [{ id: "main-normal", station_code: "NORMAL" }],
      recruitment_locations: [{ id: "normal", code: "NORMAL" }, { id: "extra", code: "EXTRA" }]
    };
    if (table === "recruitment_temporary_location_grants") {
      if (f.failGrants) return new Response(JSON.stringify({ message: "Grant lookup unavailable" }), { status: 400 });
      rows[table] = f.inactive ? [] : f.grants.filter((grant) => !grant.revoked_at && Date.parse(grant.expires_at) > Date.now() && Date.parse(grant.starts_at) <= Date.now());
    }
    return new Response(JSON.stringify(rows[table] ?? null), { headers: { "Content-Type": "application/json" } });
  } } }) };
});
import { resolveMobileSession, invalidateMobileSessionCache } from "./mobile-session";
const request = () => new Request("https://recruit.test/api/recruitment/leads", { headers: { Authorization: "Bearer test-session-token" } });
const grant = { id: "grant", user_access_id: "access", location_id: "extra", starts_at: "2026-10-07T07:00:00Z", expires_at: "2026-10-07T09:00:00Z", revoked_at: null };
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-07T08:00:00Z")); invalidateMobileSessionCache(); f.grants = [grant]; f.requests = []; f.inactive = false; f.failGrants = false; });
afterEach(() => vi.useRealTimers());

describe("live grants outside the cached session", () => {
  it("removes a revoked grant on the very next GET without logout or cache invalidation", async () => {
    expect((await resolveMobileSession(request(), "company"))?.locationIds).toEqual(["normal", "extra"]);
    f.grants = [{ ...grant, revoked_at: new Date().toISOString() }];
    expect((await resolveMobileSession(request(), "company"))?.locationIds).toEqual(["normal"]);
    expect(f.requests.filter((url) => url.pathname.endsWith("recruitment_mobile_sessions"))).toHaveLength(1);
    expect(f.requests.filter((url) => url.pathname.endsWith("recruitment_temporary_location_grants"))).toHaveLength(2);
  });
  it("expires a grant while the normal session cache is still fresh", async () => {
    f.grants = [{ ...grant, expires_at: "2026-10-07T08:00:01Z" }];
    expect((await resolveMobileSession(request(), "company"))?.locationIds).toContain("extra");
    vi.setSystemTime(new Date("2026-10-07T08:00:02Z"));
    expect((await resolveMobileSession(request(), "company"))?.locationIds).toEqual(["normal"]);
  });
  it("adds a newly granted location to an existing cached login", async () => {
    f.grants = [];
    expect((await resolveMobileSession(request(), "company"))?.locationIds).toEqual(["normal"]);
    f.grants = [grant];
    expect((await resolveMobileSession(request(), "company"))?.locationIds).toEqual(["normal", "extra"]);
  });
  it("fails closed if grant verification fails, instead of reusing previous elevated scope", async () => {
    await resolveMobileSession(request(), "company");
    f.failGrants = true;
    await expect(resolveMobileSession(request(), "company")).rejects.toThrow("Grant lookup unavailable");
  });
  it("filters grant reads by company, target, dates, revocation, active person and location", async () => {
    await resolveMobileSession(request(), "company");
    const query = f.requests.find((url) => url.pathname.endsWith("recruitment_temporary_location_grants"))!.searchParams;
    expect(query.get("company_id")).toBe("eq.company");
    expect(query.get("user_access_id")).toBe("eq.access");
    expect(query.get("revoked_at")).toBe("is.null");
    expect(query.get("expires_at")).toBe("gt.2026-10-07T08:00:00.000Z");
    expect(query.get("recruitment_user_access.profiles.is_active")).toBe("eq.true");
    expect(query.get("recruitment_locations.stations.is_active")).toBe("eq.true");
  });
});
