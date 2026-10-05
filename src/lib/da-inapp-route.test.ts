import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  session: null as any,
  allowed: true,
  workforce: [] as any[],
  mappings: [] as any[],
  requests: [] as URL[],
  writes: [] as any[],
  failMappings: false,
  batch: { id: "batch", source_type: "da_inapp_onboarding", file_name: "DA inapp onboarding.csv", created_at: "2026-10-05T08:00:00Z", report_to: "2026-10-05" },
  row: { id: "case", batch_id: "batch", source_type: "da_inapp_onboarding", station_code: "KDJE", created_at: "2026-10-05T08:00:00Z", raw_data: { transporter_id: "provider-last", employee_name: "DA example", action_item: "Video verification" }, normalized_data: { imported_field: "retain" } }
}));
vi.mock("./recruitment-api", () => ({
  recruitmentSession: async () => fixture.session,
  canUseRecruitmentMenu: () => fixture.allowed,
  requiredEnv: () => "company"
}));
vi.mock("./main-dashboard-masters", () => ({
  loadMainDashboardStations: async () => [],
  loadMainDashboardHiringManagers: async () => [],
  defaultHiringManagerFor: () => null
}));
vi.mock("./recruitment-documents", () => ({ uploadRecruitmentDocument: vi.fn() }));
vi.mock("./supabase-admin", async () => {
  const { createClient } = await import("@supabase/supabase-js");
  return { supabaseAdmin: createClient("https://database.example.test", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input));
      fixture.requests.push(url);
      if (url.href.length > 8000) return new Response("Bad Request", { status: 400 });
      const table = url.pathname.split("/").at(-1);
      if (init?.method === "PATCH") {
        fixture.writes.push({ table, body: JSON.parse(String(init.body)), url });
        return new Response(null, { status: 204 });
      }
      let data: any[] = [];
      if (table === "workforce") data = fixture.workforce;
      if (table === "field_executive_provider_mappings") {
        if (fixture.failMappings) return new Response(JSON.stringify({ message: "Mapping lookup unavailable" }), { status: 400 });
        const ids = new Set((url.searchParams.get("field_executive_id") || "").slice(4, -1).split(","));
        data = fixture.mappings.filter(row => ids.has(row.field_executive_id));
      }
      if (table === "report_import_batches") data = [fixture.batch];
      if (table === "report_import_rows") data = [fixture.row];
      if (table === "recruitment_locations") data = [{ id: "allowed-location", code: "KDJE", name: "Barbil" }];
      const offset = Number(url.searchParams.get("offset") || 0);
      const limit = Math.min(Number(url.searchParams.get("limit") || 1000), 1000);
      data = data.slice(offset, offset + limit);
      const single = url.searchParams.get("id")?.startsWith("eq.");
      return new Response(JSON.stringify(single ? data[0] : data), { headers: { "Content-Type": "application/json" } });
    } }
  }) };
});

import { GET, PATCH } from "../app/api/recruitment/danap-onboarding/route";
const get = () => GET(new Request("https://recruit.example.test/api/recruitment/danap-onboarding?status=all&search=kdje"));
const update = () => {
  const body = new FormData();
  for (const [key, value] of Object.entries({ id: "case", remarks: "Contacted associate", subStatus: "pending", videoStatus: "pending", uanStatus: "yes", finalOutcome: "pending" })) body.set(key, value);
  return PATCH(new Request("https://recruit.example.test/api/recruitment/danap-onboarding", { method: "PATCH", body }));
};

afterEach(() => vi.restoreAllMocks());

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  fixture.session = { profileId: "owner", email: "owner@example.test", recruitmentFunction: "recruiter", locationIds: [], allLocations: false };
  fixture.allowed = true;
  fixture.failMappings = false;
  fixture.requests = [];
  fixture.writes = [];
  fixture.workforce = Array.from({ length: 1605 }, (_, index) => ({ id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, created_by: index === 1604 ? "owner" : "someone-else", stations: { station_code: "KDJE" } }));
  fixture.mappings = [{ field_executive_id: fixture.workforce[1604].id, provider_member_id: "provider-last" }];
});

describe("DA In-App large Workforce lookup", () => {
  it("loads and authorizes a case beyond 1,000 profiles without oversized requests", async () => {
    const response = await get();
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.visibility).toBe("mine");
    expect(data.records.map((row: any) => row.id)).toEqual(["case"]);
    expect(fixture.requests.every(url => url.href.length < 8000)).toBe(true);
    expect(fixture.requests.filter(url => url.pathname.endsWith("/workforce")).every(url => url.searchParams.get("company_id") === "eq.company")).toBe(true);
  });

  it("saves through the same batched lookup, retaining imported fields and audit identity", async () => {
    const response = await update();
    expect(response.status).toBe(200);
    expect(fixture.writes).toHaveLength(1);
    expect(fixture.writes[0].body.normalized_data).toMatchObject({ imported_field: "retain", ops_remarks: "Contacted associate", ops_updated_by: "owner", ops_final_outcome: "pending" });
    expect(fixture.writes[0].url.searchParams.get("company_id")).toBe("eq.company");
    expect(fixture.writes[0].url.searchParams.get("id")).toBe("eq.case");
  });

  it("retains conflicting owners across mapping pages instead of granting access", async () => {
    fixture.mappings = [
      ...Array.from({ length: 1000 }, () => ({ field_executive_id: fixture.workforce[0].id, provider_member_id: "irrelevant" })),
      { field_executive_id: fixture.workforce[0].id, provider_member_id: "provider-last" },
      ...fixture.mappings
    ];
    expect((await (await get()).json()).records).toEqual([]);
    expect((await update()).status).toBe(400);
    expect(fixture.writes).toEqual([]);
  });

  it("does not let another recruiter view or update the case", async () => {
    fixture.session.profileId = "unrelated";
    expect((await (await get()).json()).records).toEqual([]);
    expect((await update()).status).toBe(400);
    expect(fixture.writes).toEqual([]);
  });

  it("retains station restrictions on updates", async () => {
    fixture.session.recruitmentFunction = "manager";
    fixture.session.locationIds = ["allowed-location"];
    const original = fixture.row.station_code;
    fixture.row.station_code = "OTHER";
    try {
      const response = await update();
      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe("This station is outside your access.");
      expect(fixture.writes).toEqual([]);
    } finally { fixture.row.station_code = original; }
  });

  it("does not return partial ownership data when a mapping batch fails", async () => {
    fixture.failMappings = true;
    expect((await get()).status).toBe(400);
    expect((await update()).status).toBe(400);
    expect(fixture.writes).toEqual([]);
  });

  it("requires menu permission before making database requests", async () => {
    fixture.allowed = false;
    expect((await get()).status).toBe(403);
    expect((await update()).status).toBe(403);
    expect(fixture.requests).toEqual([]);
  });
});
