import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./connection-config", () => ({ getConnectionConfig: async () => ({
  isEnabled: true, publicConfig: { ad_account_id: "11111", page_id: "22222", graph_version: "v25.0" }, secrets: { access_token: "test-token" }
}) }));
import { getMetaAdCreativeReplacementContext, replaceMetaAdCreative } from "./meta-ad-builder";

const endsAt = "2026-09-04T07:28:08+0530";
const input = { metaAdId: "33333", expectedCreativeId: "44444", imageHash: "a1b2c3d4e5f678901234567890abcdef", expectedEndTime: endsAt };
function fixture(end = endsAt, status = "ACTIVE") {
  const ad = { id: "33333", name: "KOZA_DA", status, configured_status: status, effective_status: status,
    adset: { id: "55555", status: "ACTIVE", effective_status: "ACTIVE", start_time: "2026-08-30T00:00:00Z", end_time: end, daily_budget: "10000", targeting: { station: "KOZA" } },
    campaign: { id: "66666", status: "ACTIVE", effective_status: "ACTIVE" },
    creative: { id: "44444", name: "Old poster", object_story_spec: { page_id: "22222", link_data: { link: "https://example.test", message: "Apply here", call_to_action: { type: "APPLY_NOW", value: { lead_gen_form_id: "77777" } } } } }
  };
  const writes: Array<{ path: string; values: Record<string, string> }> = [];
  const fetchMock = vi.fn(async (url: URL, options?: RequestInit) => {
    if (url.pathname.endsWith("/me/accounts")) return Response.json({ data: [] });
    if (options?.method === "POST") {
      const values = Object.fromEntries(new URLSearchParams(options.body as URLSearchParams));
      writes.push({ path: url.pathname, values });
      if (url.pathname.endsWith("/adcreatives")) return Response.json({ id: "88888" });
      if (values.status) Object.assign(ad, { status: values.status, configured_status: values.status, effective_status: values.status });
      if (values.creative) ad.creative.id = JSON.parse(values.creative).creative_id;
      return Response.json({ success: true });
    }
    return Response.json(ad);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { ad, writes, fetchMock };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-09T12:00:00Z")); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("completed Meta creative preparation", () => {
  it("reads the actual schedule instead of treating the ACTIVE switch as delivery", async () => {
    fixture();
    expect(await getMetaAdCreativeReplacementContext("33333")).toMatchObject({ deliveryStatus: "COMPLETED", endsAt, replaceable: true });
  });
  it("saves the new creative while holding only this completed ad paused", async () => {
    const f = fixture();
    const before = structuredClone(f.ad);
    const result = await replaceMetaAdCreative(input);
    expect(result.after).toMatchObject({ deliveryStatus: "COMPLETED", configuredStatus: "PAUSED", endsAt, creativeId: "88888" });
    expect(f.ad.adset).toEqual(before.adset);
    expect(f.ad.campaign).toEqual(before.campaign);
    expect(f.writes.map(write => write.path)).toEqual(["/v25.0/33333", "/v25.0/act_11111/adcreatives", "/v25.0/33333"]);
    expect(f.writes[0].values).toEqual({ status: "PAUSED" });
    expect(f.writes[2].values).toEqual({ creative: '{"creative_id":"88888"}' });
    const story = JSON.parse(f.writes[1].values.object_story_spec);
    expect(story.link_data.call_to_action.value.lead_gen_form_id).toBe("77777");
    expect(f.writes.some(write => write.values.status === "ACTIVE")).toBe(false);
  });
  it.each(["ACTIVE", "PAUSED"])("does not change the status of an uncompleted %s ad", async (status) => {
    const f = fixture("2026-09-16T00:00:00Z", status);
    await replaceMetaAdCreative({ ...input, expectedEndTime: undefined });
    expect(f.ad.status).toBe(status);
    expect(f.writes).toHaveLength(2);
    expect(f.writes.every(write => !write.values.status)).toBe(true);
  });
  it.each(["end changed", "creative changed", "invalid image", "archived"])("rejects %s before any Meta write", async (change) => {
    const f = fixture();
    if (change === "end changed") f.ad.adset.end_time = "2026-09-16T00:00:00Z";
    if (change === "creative changed") f.ad.creative.id = "99999";
    if (change === "archived") f.ad.effective_status = "ARCHIVED";
    await expect(replaceMetaAdCreative({ ...input, imageHash: change === "invalid image" ? "bad" : input.imageHash })).rejects.toThrow();
    expect(f.writes).toEqual([]);
  });
  it("does not attach a creative if another actor changes the schedule during creation", async () => {
    const f = fixture();
    const original = f.fetchMock.getMockImplementation()!;
    f.fetchMock.mockImplementation(async (url, options) => {
      const response = await original(url, options);
      if (url.pathname.endsWith("/adcreatives")) f.ad.adset.end_time = "2026-09-16T00:00:00Z";
      return response;
    });
    await expect(replaceMetaAdCreative(input)).rejects.toThrow("schedule changed");
    expect(f.ad.creative.id).toBe("44444");
    expect(f.ad.status).toBe("PAUSED");
    expect(f.writes.some(write => write.values.creative)).toBe(false);
  });
  it("leaves the ad stopped if creative creation fails", async () => {
    const f = fixture();
    const original = f.fetchMock.getMockImplementation()!;
    f.fetchMock.mockImplementation(async (url, options) => url.pathname.endsWith("/adcreatives")
      ? Response.json({ error: { message: "Image is unavailable" } }, { status: 400 }) : original(url, options));
    await expect(replaceMetaAdCreative(input)).rejects.toThrow("Image is unavailable");
    expect(f.ad.status).toBe("PAUSED");
    expect(f.ad.adset.end_time).toBe(endsAt);
    expect(f.ad.creative.id).toBe("44444");
  });
});
