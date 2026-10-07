import { beforeEach, describe, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({ session: {} as any, writes: [] as any[], requests: [] as URL[], missing: "", fail: "", grantLocation: "" }));
vi.mock("./recruitment-api", async (original) => ({ ...await original<any>(), recruitmentSession: async () => f.session, requiredEnv: () => "company" }));
vi.mock("./supabase-admin", async () => {
  const { createClient } = await import("@supabase/supabase-js");
  return { supabaseAdmin: createClient("https://recruit.test", "test-key", { auth: { persistSession: false }, global: { fetch: async (input, init) => {
    const url = new URL(String(input)); f.requests.push(url);
    const table = url.pathname.split("/").at(-1)!;
    if (f.fail === table) return new Response(JSON.stringify({ message: "Unavailable" }), { status: 500 });
    if (init?.method && init.method !== "GET") { f.writes.push({ table, method: init.method, body: JSON.parse(String(init.body)), url }); return new Response(null, { status: 204 }); }
    const one: Record<string, any> = { profiles: { id: "user" }, recruitment_user_access: { id: "access" }, company_product_memberships: { id: "membership" }, recruitment_temporary_location_grants: { id: "grant", location_id: f.grantLocation } };
    const data = f.missing === table ? null : table === "recruitment_locations" ? [{ id: "00000000-0000-4000-8000-000000000003" }, { id: "00000000-0000-4000-8000-000000000004" }] : table === "recruitment_temporary_location_grants" && url.searchParams.has("limit") ? [one[table]] : one[table];
    return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
  } } }) };
});
import { GET, POST, DELETE } from "../app/api/recruitment/access/temporary-locations/route";
const payload = { profileId: "00000000-0000-4000-8000-000000000001", requestId: "00000000-0000-4000-8000-000000000002", locationIds: ["00000000-0000-4000-8000-000000000003", "00000000-0000-4000-8000-000000000004"], reason: "Cover absence", expiresAt: "2099-01-01T00:00:00Z" };
const request = (body = payload) => new Request("https://recruit.test/api/recruitment/access/temporary-locations", { method: "POST", body: JSON.stringify(body) });
const scopedEditor = () => ({ profileId: "actor", isOwner: false, baseAllLocations: false, baseLocationIds: [...payload.locationIds], locationIds: [...payload.locationIds], menuActions: { workforce: { "Access Control": { view: true, add: false, edit: true } }, hr: {} } });
const revokeRequest = () => new Request("https://recruit.test/api/recruitment/access/temporary-locations", { method: "DELETE", body: JSON.stringify({ profileId: payload.profileId, grantId: payload.requestId }) });
beforeEach(() => { f.session = { profileId: "actor", isOwner: true }; f.writes = []; f.requests = []; f.missing = ""; f.fail = ""; f.grantLocation = payload.locationIds[0]; });

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
  it("allows a non-global access editor to grant multiple normal locations", async () => {
    f.session = scopedEditor();
    expect((await POST(request())).status).toBe(200);
    expect(f.writes[0].body.map((row: any) => row.location_id)).toEqual(payload.locationIds);
  });
  it("rejects an entire mixed batch if one location is only temporarily assigned", async () => {
    f.session = { ...scopedEditor(), baseLocationIds: [payload.locationIds[0]], temporaryLocationIds: [payload.locationIds[1]] };
    expect((await POST(request())).status).toBe(403);
    expect(f.writes).toEqual([]);
    expect(f.requests).toEqual([]);
  });
  it("rejects out-of-scope grants even if the client posts a hidden location", async () => {
    f.session = scopedEditor();
    expect((await POST(request({ ...payload, locationIds: ["00000000-0000-4000-8000-000000000009"] }))).status).toBe(403);
    expect(f.writes).toEqual([]);
  });
  it.each([{ view: true, add: false, edit: false }, { view: true, add: true, edit: false }])("rejects view/add-only editors for grant and revoke %#", async (actions) => {
    f.session = { ...scopedEditor(), menuActions: { workforce: { "Access Control": actions } } };
    expect((await POST(request())).status).toBe(403);
    expect((await DELETE(revokeRequest())).status).toBe(403);
    expect(f.writes).toEqual([]);
  });
  it("allows scoped revocation without deleting history", async () => {
    f.session = scopedEditor();
    expect((await DELETE(revokeRequest())).status).toBe(200);
    expect(f.writes[0].method).toBe("PATCH");
  });
  it("rejects revoking another location's grant", async () => {
    f.session = { ...scopedEditor(), baseLocationIds: [payload.locationIds[1]] };
    expect((await DELETE(revokeRequest())).status).toBe(403);
    expect(f.writes).toEqual([]);
  });
  it.each([{ readOnly: true }, { isPreview: true }])("rejects scoped preview mutations %#", async (flags) => {
    f.session = { ...scopedEditor(), ...flags };
    expect((await POST(request())).status).toBe(403);
    expect((await DELETE(revokeRequest())).status).toBe(403);
    expect(f.writes).toEqual([]);
  });
  it.each(["allowed", "outside", "preview", "view only"])("returns authoritative per-grant revoke permission: %s", async (mode) => {
    f.session = scopedEditor();
    if (mode === "outside") f.session.baseLocationIds = [payload.locationIds[1]];
    if (mode === "preview") f.session.isPreview = true;
    if (mode === "view only") f.session.menuActions.workforce["Access Control"].edit = false;
    const response = await GET(new Request(`https://recruit.test/api/recruitment/access/temporary-locations?profileId=${payload.profileId}`));
    expect(response.status).toBe(200);
    expect((await response.json()).grants[0].canRevoke).toBe(mode === "allowed");
    expect(f.writes).toEqual([]);
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
