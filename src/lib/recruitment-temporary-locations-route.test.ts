import { beforeEach, describe, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({ session: {} as any, writes: [] as any[], requests: [] as URL[], missing: "", fail: "" }));
vi.mock("./recruitment-api", async (original) => ({ ...await original<any>(), recruitmentSession: async () => f.session, requiredEnv: () => "company" }));
vi.mock("./supabase-admin", async () => {
  const { createClient } = await import("@supabase/supabase-js");
  return { supabaseAdmin: createClient("https://recruit.test", "test-key", { auth: { persistSession: false }, global: { fetch: async (input, init) => {
    const url = new URL(String(input)); f.requests.push(url);
    const table = url.pathname.split("/").at(-1)!;
    if (f.fail === table) return new Response(JSON.stringify({ message: "Unavailable" }), { status: 500 });
    if (init?.method && init.method !== "GET") { f.writes.push({ table, method: init.method, body: JSON.parse(String(init.body)), url }); return new Response(null, { status: 204 }); }
    const one: Record<string, any> = { profiles: { id: "user" }, recruitment_user_access: { id: "access" }, company_product_memberships: { id: "membership" }, recruitment_temporary_location_grants: { id: "grant" } };
    const data = f.missing === table ? null : table === "recruitment_locations" ? [{ id: "00000000-0000-4000-8000-000000000003" }, { id: "00000000-0000-4000-8000-000000000004" }] : one[table];
    return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
  } } }) };
});
import { POST, DELETE } from "../app/api/recruitment/access/temporary-locations/route";
const payload = { profileId: "00000000-0000-4000-8000-000000000001", requestId: "00000000-0000-4000-8000-000000000002", locationIds: ["00000000-0000-4000-8000-000000000003", "00000000-0000-4000-8000-000000000004"], reason: "Cover absence", expiresAt: "2099-01-01T00:00:00Z" };
const request = (body = payload) => new Request("https://recruit.test/api/recruitment/access/temporary-locations", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => { f.session = { profileId: "actor", isOwner: true }; f.writes = []; f.requests = []; f.missing = ""; f.fail = ""; });

describe("temporary access endpoint", () => {
  it("atomically inserts all selected locations with actor and reason, not company scope", async () => {
    expect((await POST(request())).status).toBe(200);
    expect(f.writes).toHaveLength(1);
    expect(f.writes[0].table).toBe("recruitment_temporary_location_grants");
    expect(f.writes[0].body).toHaveLength(2);
    expect(f.writes[0].body[0]).toMatchObject({ granted_by: "actor", company_id: "company", user_access_id: "access", reason: "Cover absence", request_id: payload.requestId });
    expect(f.writes[0].url.searchParams.get("on_conflict")).toBe("company_id,request_id,location_id");
    expect(f.requests.every((url) => url.searchParams.get("company_id") === "eq.company" || url.pathname.endsWith("recruitment_temporary_location_grants"))).toBe(true);
  });
  it.each([null, { isOwner: false, allLocations: true }, { isOwner: true, readOnly: true }, { isOwner: true, isPreview: true }])("rejects unauthorized or preview grant %#", async (session) => {
    f.session = session;
    expect((await POST(request())).status).toBe(403); expect(f.writes).toEqual([]);
  });
  it.each(["profiles", "recruitment_user_access", "company_product_memberships", "recruitment_locations"])("rejects an inactive/missing/cross-company %s", async (table) => {
    f.missing = table;
    expect((await POST(request())).status).toBe(400); expect(f.writes).toEqual([]);
  });
  it("rejects the whole batch when even one station is invalid", async () => {
    expect((await POST(request({ ...payload, locationIds: [...payload.locationIds, "00000000-0000-4000-8000-000000000009"] }))).status).toBe(400);
    expect(f.writes).toEqual([]);
  });
  it("disables only the selected user's grant and retains audit history", async () => {
    const response = await DELETE(new Request("https://recruit.test/api/recruitment/access/temporary-locations", { method: "DELETE", body: JSON.stringify({ profileId: payload.profileId, grantId: payload.requestId }) }));
    expect(response.status).toBe(200); expect(f.writes).toHaveLength(1);
    expect(f.writes[0].method).toBe("PATCH");
    expect(f.writes[0].body.revoked_by).toBe("actor");
    expect(f.writes[0].url.searchParams.get("company_id")).toBe("eq.company");
    expect(f.writes[0].url.searchParams.get("user_access_id")).toBe("eq.access");
    expect(f.writes[0].url.searchParams.get("revoked_at")).toBe("is.null");
  });
});
