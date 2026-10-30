import { beforeEach, describe, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ membership: true, existing: false, saved: [] as any[] }));
vi.mock("./supabase-admin", async () => {
  const { createClient } = await import("@supabase/supabase-js");
  return { supabaseAdmin: createClient("https://recruit.test", "test-key", { auth: { persistSession: false }, global: { fetch: async (input, init) => {
    const table = new URL(String(input)).pathname.split("/").at(-1);
    if (init?.method === "POST") {
      f.saved.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ id: "new-access" }), { headers: { "Content-Type": "application/json" } });
    }
    const data = table === "company_product_memberships"
      ? f.membership ? { id: "membership", role_code_snapshot: "RECRUIT_SM", has_all_location_access: false } : null
      : f.existing ? { id: "existing-access" } : null;
    return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
  } } }) };
});
import { ensureRecruitmentAccess, type RecruitmentAuthProfile } from "./recruitment-auth-user";
const profile: RecruitmentAuthProfile = { id: "manager", full_name: "Manager", email: "manager@example.test", mobile: null, phone: null, role: "user", role_id: null, is_master_owner: false };
beforeEach(() => { f.membership = true; f.existing = false; f.saved = []; });
describe("automatic Recruit login setup", () => {
  it("creates inheriting access for an assigned-location membership without manual Recruit mapping", async () => {
    expect(await ensureRecruitmentAccess("company", profile)).toEqual({ id: "new-access" });
    expect(f.saved[0]).toMatchObject({ company_id: "company", profile_id: "manager", can_access_all_locations: true, can_manage_users: false, can_manage_ads: false });
  });
  it("does not create access without an active product membership", async () => {
    f.membership = false;
    expect(await ensureRecruitmentAccess("company", profile)).toBeNull();
    expect(f.saved).toEqual([]);
  });
  it("does not rewrite an existing access record on login", async () => {
    f.existing = true;
    expect(await ensureRecruitmentAccess("company", profile)).toEqual({ id: "existing-access" });
    expect(f.saved).toEqual([]);
  });
});
