import { describe, expect, it, vi } from "vitest";
import { extendMetaAd, validateExtensionTerms } from "./meta-ad-extension";
import { canExtendAd } from "./ad-schedule";
import type { RestartAdSnapshot } from "./meta-ad-restart";

const now = Date.parse("2026-11-02T04:00:00Z");
const end = "2026-11-02T19:37:00+0530";
const newEnd = "2026-11-09T14:07:00+0000";
function fixture(status = "ACTIVE") {
  const ad: RestartAdSnapshot = {
    id: "ad", status, campaign: { id: "campaign", status: "ACTIVE", is_adset_budget_sharing_enabled: false },
    adset: { id: "set", status: "ACTIVE", start_time: "2026-10-30T14:07:00Z", end_time: end,
      daily_budget: "15000", ads: { data: [{ id: "ad" }] }, targeting: { geo_locations: { countries: ["IN"] } } }
  };
  const read = vi.fn(async () => structuredClone(ad));
  const post = vi.fn(async (_id: string, values: Record<string, string>) => { Object.assign(ad.adset!, values); });
  return { ad, input: { adId: "ad", days: 7, expectedEndTime: end, expectedBudget: 150, now, read, post, sleep: async () => {} } };
}

describe("extending an existing ad", () => {
  it.each(["ACTIVE", "PAUSED"])("adds days to current end, preserving budget and %s state", async status => {
    const f = fixture(status);
    const original = structuredClone(f.ad);
    const result = await extendMetaAd(f.input);
    expect(result.endTime).toBe(newEnd);
    expect(f.input.post.mock.calls).toEqual([["set", { end_time: newEnd }]]);
    expect(result.after).toEqual({ ...original, adset: { ...original.adset, end_time: newEnd } });
    expect(result.dailyBudget).toBe(150);
  });
  it("handles IST month/year boundaries and exact days", () => {
    expect(validateExtensionTerms(3,"2026-12-31T23:30:00+0530",150,now).endTime).toBe("2027-01-03T18:00:00+0000");
  });
  it.each([undefined, null, "", 0, -1, 1.5, 91, Infinity, "bad"])("rejects invalid days %s without writing", async days => {
    const f = fixture();
    await expect(extendMetaAd({ ...f.input, days })).rejects.toThrow("whole number");
    expect(f.input.read).not.toHaveBeenCalled();
    expect(f.input.post).not.toHaveBeenCalled();
  });
  it.each(["", "bad", "2026-11-01T12:00:00Z"])("rejects absent/expired end %s", async expectedEndTime => {
    const f = fixture();
    await expect(extendMetaAd({ ...f.input, expectedEndTime })).rejects.toThrow();
    expect(f.input.post).not.toHaveBeenCalled();
  });
  it("rejects a duplicate or stale extension instead of adding days twice", async () => {
    const f = fixture();
    await extendMetaAd(f.input);
    f.input.post.mockClear();
    await expect(extendMetaAd(f.input)).rejects.toThrow("schedule has changed");
    expect(f.input.post).not.toHaveBeenCalled();
  });
  it.each(["siblings", "pagination", "campaign budget", "lifetime", "sharing", "changed budget", "archived"])("rejects %s before writing", async kind => {
    const f = fixture();
    if (kind === "siblings") f.ad.adset!.ads!.data!.push({ id: "another-ad" });
    if (kind === "pagination") f.ad.adset!.ads!.paging = { next: "more" };
    if (kind === "campaign budget") f.ad.campaign!.daily_budget = "20000";
    if (kind === "lifetime") f.ad.adset!.lifetime_budget = "100000";
    if (kind === "sharing") f.ad.campaign!.is_adset_budget_sharing_enabled = true;
    if (kind === "changed budget") f.ad.adset!.daily_budget = "20000";
    if (kind === "archived") f.ad.status = "ARCHIVED";
    await expect(extendMetaAd(f.input)).rejects.toThrow();
    expect(f.input.post).not.toHaveBeenCalled();
  });
  it("waits for eventual Meta confirmation and accepts an IST echo", async () => {
    const f = fixture();
    const previous = structuredClone(f.ad);
    f.input.read.mockResolvedValueOnce(previous).mockResolvedValueOnce(previous)
      .mockResolvedValueOnce({ ...previous, adset: { ...previous.adset, end_time: "2026-11-09T19:37:00+0530" } });
    const result = await extendMetaAd(f.input);
    expect(result.endTime).toBe(newEnd);
    expect(f.input.read).toHaveBeenCalledTimes(3);
  });
  it("does not claim success or reapply if Meta has not confirmed the write", async () => {
    const f = fixture();
    f.input.post.mockImplementation(async () => {});
    await expect(extendMetaAd(f.input)).rejects.toThrow("may already be saved");
    expect(f.input.post).toHaveBeenCalledTimes(1);
  });
  it("surfaces a rejected Meta update without modifying other ad settings", async () => {
    const f = fixture();
    f.input.post.mockRejectedValue(new Error("Meta rejected schedule"));
    await expect(extendMetaAd(f.input)).rejects.toThrow("Meta rejected");
    expect(f.ad.adset!.end_time).toBe(end);
    expect(f.input.post).toHaveBeenCalledTimes(1);
  });
  it("offers extension only for existing active/paused ads with a future end", () => {
    const ad = { status: "ACTIVE", meta_ad_id: "ad", ends_at: end };
    expect(canExtendAd(ad, now)).toBe(true);
    expect(canExtendAd({ ...ad, status: "PAUSED" }, now)).toBe(true);
    for (const change of [{ends_at:null}, {ends_at:"bad"}, {meta_ad_id:null}, {status:"ARCHIVED"}]) {
      expect(canExtendAd({ ...ad, ...change }, now)).toBe(false);
    }
    expect(canExtendAd(ad, Date.parse(end))).toBe(false);
  });
});
