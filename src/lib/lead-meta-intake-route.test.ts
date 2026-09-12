import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  signedIn: true, allowed: true, rows: [] as any[], events: [] as any[], requests: [] as URL[]
}));
vi.mock("./recruitment-api", () => ({
  recruitmentSession: async () => fixture.signedIn ? { profileId: "viewer" } : null,
  canUseRecruitmentMenu: () => fixture.allowed,
  requiredEnv: () => "company",
  applyLeadScope: (query: any, _session: any, stream: string) => query.eq("stream", stream).eq("location_id", "allowed-location")
}));
vi.mock("./main-dashboard-masters", () => ({ loadMainDashboardStations: async () => [] }));
vi.mock("./supabase-admin", async () => {
  const { createClient } = await import("@supabase/supabase-js");
  return { supabaseAdmin: createClient("https://database.example.test", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input) => {
      const url = new URL(String(input));
      fixture.requests.push(url);
      const isIntake = url.pathname.endsWith("/recruitment_lead_source_events");
      const offset = Number(url.searchParams.get("offset") || 0);
      const rows = isIntake ? fixture.events.slice(offset, offset + 1000) : fixture.rows;
      return new Response(JSON.stringify(rows), {
        headers: { "Content-Type": "application/json", "Content-Range": "0-1/75" }
      });
    } }
  }) };
});

import { GET } from "../app/api/recruitment/leads/route";
const call = (query = "stream=workforce") => GET(new Request(`https://recruit.example.test/api/recruitment/leads?${query}`));

beforeEach(() => {
  fixture.signedIn = true;
  fixture.allowed = true;
  fixture.requests = [];
  fixture.events = [{ lead_id: "meta-lead", received_at: "2026-09-11T08:00:00Z" }];
  fixture.rows = [
    { id: "meta-lead", updated_at: "2026-09-12T10:30:00Z", lead_created_at: "2026-09-10T07:00:00Z" },
    { id: "legacy-lead", updated_at: "2026-09-12T10:00:00Z", lead_created_at: "2026-07-01T07:00:00Z" }
  ];
});

describe("Meta intake time in workforce queues", () => {
  it("returns intake separately from creation and recruiter updates, with no invented legacy time", async () => {
    const response = await call();
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.leads).toHaveLength(2);
    expect(data.total).toBe(75);
    expect(data.leads[0]).toMatchObject({ meta_received_at: "2026-09-11T08:00:00Z", updated_at: "2026-09-12T10:30:00Z" });
    expect(data.leads[1].meta_received_at).toBeNull();
    expect(data.leads[0]).not.toHaveProperty("meta_intake");
  });

  it("batches only the authorized page and preserves parent pagination", async () => {
    await call("stream=workforce&page=2&limit=50");
    expect(fixture.requests).toHaveLength(2);
    const leads = fixture.requests[0].searchParams;
    expect(leads.get("company_id")).toBe("eq.company");
    expect(leads.get("location_id")).toBe("eq.allowed-location");
    expect(leads.get("stream")).toBe("eq.workforce");
    expect(leads.get("limit")).toBe("50");
    expect(leads.get("offset")).toBe("50");
    const intake = fixture.requests[1].searchParams;
    expect(intake.get("select")).toBe("lead_id,received_at");
    expect(intake.get("company_id")).toBe("eq.company");
    expect(intake.get("lead_id")).toBe("in.(meta-lead,legacy-lead)");
    expect(intake.get("source_system")).toBe("like.meta%");
    expect(intake.get("status")).toBe("in.(processed,lead_saved)");
    expect(intake.get("order")).toBe("received_at.desc,id.desc");
  });

  it("finds all leads across occurrence pages and keeps the newest occurrence", async () => {
    fixture.events = [
      ...Array.from({ length: 1000 }, () => ({ lead_id: "meta-lead", received_at: "2026-09-11T08:00:00Z" })),
      { lead_id: "meta-lead", received_at: "2026-09-10T08:00:00Z" },
      { lead_id: "legacy-lead", received_at: "2026-09-09T08:00:00Z" }
    ];
    const data = await (await call()).json();
    expect(data.leads.map((lead: any) => lead.meta_received_at)).toEqual(["2026-09-11T08:00:00Z", "2026-09-09T08:00:00Z"]);
    expect(fixture.requests).toHaveLength(3);
    expect(fixture.requests[2].searchParams.get("offset")).toBe("1000");
  });

  it("does not query intake for an empty queue", async () => {
    fixture.rows = [];
    expect((await (await call()).json()).leads).toEqual([]);
    expect(fixture.requests).toHaveLength(1);
  });

  it.each(["stream=hr", "stream=workforce&compact=true"])("does not add intake reads to %s", async (query) => {
    fixture.rows = [{ id: "lead" }];
    const response = await call(query);
    expect(response.status).toBe(200);
    expect(fixture.requests).toHaveLength(1);
    expect((await response.json()).leads).toEqual([{ id: "lead" }]);
  });

  it("rejects unauthenticated requests before reading timestamps", async () => {
    fixture.signedIn = false;
    expect((await call()).status).toBe(401);
    expect(fixture.requests).toEqual([]);
  });

  it("rejects users without queue access before reading timestamps", async () => {
    fixture.allowed = false;
    expect((await call()).status).toBe(403);
    expect(fixture.requests).toEqual([]);
  });
});
