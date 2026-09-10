import { describe, expect, it, vi } from "vitest";
import { restartCompletedMetaAd, validateRestartTerms, type RestartAdSnapshot } from "./meta-ad-restart";

const now = Date.parse("2026-09-09T12:00:00Z");
const expectedEndTime = "2026-09-04T07:28:08+0530";
const metaEndTime = "2026-09-16T12:00:00+0000";

function echoAsIst(value: string) {
  const utc = Date.parse(value);
  const local = new Date(utc + 5.5 * 3_600_000);
  const stamp = local.toISOString().replace(/\.\d{3}Z$/, "");
  return `${stamp}+0530`;
}

function fixture(options?: { echoEndInIst?: boolean }) {
  let ad: RestartAdSnapshot = {
    id: "ad-1", status: "ACTIVE", effective_status: "ACTIVE",
    campaign: { id: "campaign-1", status: "ACTIVE", effective_status: "ACTIVE", is_adset_budget_sharing_enabled: false },
    adset: {
      id: "set-1", status: "ACTIVE", effective_status: "ACTIVE", end_time: expectedEndTime,
      start_time: "2026-08-30T01:58:08Z", daily_budget: "10000",
      ads: { data: [{ id: "ad-1" }] },
      targeting: { geo_locations: { custom_locations: [{ latitude: 11.265875, longitude: 75.825172, radius: 17, distance_unit: "kilometer" }] } }
    }
  };
  const post = vi.fn(async (id: string, values: Record<string, string>) => {
    if (id === ad.id) ad = { ...ad, ...values, effective_status: values.status || ad.effective_status };
    else {
      const end_time = values.end_time && options?.echoEndInIst ? echoAsIst(values.end_time) : values.end_time;
      ad = { ...ad, adset: { ...ad.adset, ...values, ...(end_time ? { end_time } : {}) } };
    }
    return { success: true };
  });
  const read = vi.fn(async () => structuredClone(ad));
  return {
    input: {
      adId: "ad-1", days: 7, budget: 100, expectedEndTime, now,
      audience: { stationCode: "KOZA", latitude: 11.265875, longitude: 75.825172 },
      read, post, sleep: async () => undefined
    },
    get ad() { return ad; }
  };
}

describe("completed ad restart", () => {
  it("extends from now and verifies while paused before activating the same ad", async () => {
    const f = fixture();
    const result = await restartCompletedMetaAd(f.input);
    expect(result.endTime).toBe(metaEndTime);
    expect(result.after.status).toBe("ACTIVE");
    expect(result.after.adset?.targeting).toEqual(result.before.adset?.targeting);
    expect(f.input.post.mock.calls).toEqual([
      ["ad-1", { status: "PAUSED" }],
      ["set-1", { end_time: metaEndTime, daily_budget: "10000", status: "ACTIVE" }],
      ["ad-1", { status: "ACTIVE" }]
    ]);
    expect(result.after.adset?.start_time).toBe(result.before.adset?.start_time);
  });

  it("accepts Meta echoing the end time in the ad-account timezone", async () => {
    const f = fixture({ echoEndInIst: true });
    const result = await restartCompletedMetaAd(f.input);
    expect(result.endTime).toBe(metaEndTime);
    expect(Date.parse(String(result.after.adset?.end_time))).toBe(Date.parse(metaEndTime));
  });

  it.each([undefined, 0, -1, 1.5, 91, Infinity])("rejects invalid duration %s before contacting Meta", async (days) => {
    const f = fixture();
    await expect(restartCompletedMetaAd({ ...f.input, days })).rejects.toThrow("whole number");
    expect(f.input.read).not.toHaveBeenCalled();
    expect(f.input.post).not.toHaveBeenCalled();
  });

  it.each([0, 99, Infinity, "invalid"])("rejects invalid daily budget %s", (budget) => {
    expect(() => validateRestartTerms(7, budget)).toThrow("at least ₹100");
  });

  it("prevents a double submission from extending an already restarted run", async () => {
    const f = fixture();
    await restartCompletedMetaAd(f.input);
    f.input.post.mockClear();
    await expect(restartCompletedMetaAd(f.input)).rejects.toThrow("schedule has changed");
    expect(f.input.post).not.toHaveBeenCalled();
  });

  it("rejects stale schedules even when both end dates are in the past", async () => {
    const f = fixture();
    await expect(restartCompletedMetaAd({ ...f.input, expectedEndTime: "2026-09-01T00:00:00Z" })).rejects.toThrow("schedule has changed");
    expect(f.input.post).not.toHaveBeenCalled();
  });

  it.each(["shared ads", "more pages", "campaign budget", "lifetime budget", "budget sharing", "paused parent", "wrong station"])("blocks %s before any write", async (kind) => {
    const f = fixture();
    if (kind === "shared ads") f.ad.adset!.ads!.data!.push({ id: "another-ad" });
    if (kind === "more pages") f.ad.adset!.ads!.paging = { next: "more" };
    if (kind === "campaign budget") f.ad.campaign!.daily_budget = "20000";
    if (kind === "lifetime budget") f.ad.adset!.lifetime_budget = "70000";
    if (kind === "budget sharing") f.ad.campaign!.is_adset_budget_sharing_enabled = true;
    if (kind === "paused parent") f.ad.campaign!.effective_status = "PAUSED";
    if (kind === "wrong station") f.input.audience.latitude = 10;
    await expect(restartCompletedMetaAd(f.input)).rejects.toThrow();
    expect(f.input.post).not.toHaveBeenCalled();
  });

  it("leaves the ad paused if Meta does not save the requested budget", async () => {
    const f = fixture();
    const originalRead = f.input.read.getMockImplementation()!;
    f.input.read.mockImplementation(async () => {
      const snapshot = await originalRead();
      if (Date.parse(String(snapshot.adset?.end_time)) > now) snapshot.adset!.daily_budget = "50000";
      return snapshot;
    });
    await expect(restartCompletedMetaAd(f.input)).rejects.toThrow(/daily budget 50000/);
    expect(f.ad.status).toBe("PAUSED");
    expect(f.input.post.mock.calls.some(([id, values]) => id === "ad-1" && values.status === "ACTIVE")).toBe(false);
  });

  it("does not activate if the station pin changes during the update", async () => {
    const f = fixture();
    const originalRead = f.input.read.getMockImplementation()!;
    f.input.read.mockImplementation(async () => {
      const snapshot = await originalRead();
      if (Date.parse(String(snapshot.adset?.end_time)) > now) snapshot.adset!.targeting = { geo_locations: { countries: ["IN"] } };
      return snapshot;
    });
    await expect(restartCompletedMetaAd(f.input)).rejects.toThrow("The ad is paused");
    expect(f.ad.status).toBe("PAUSED");
  });

  it("reports an unconfirmed safety pause instead of claiming the ad is paused", async () => {
    const f = fixture();
    f.input.post.mockImplementation(async () => {
      throw new Error("Meta unavailable");
    });
    await expect(restartCompletedMetaAd(f.input)).rejects.toThrow("Meta did not confirm the safety pause");
  });

  it("skips a redundant safety pause when the hold already succeeded", async () => {
    const f = fixture();
    const originalPost = f.input.post.getMockImplementation()!;
    f.input.post.mockImplementation(async (id, values) => {
      if (id === "set-1") throw new Error("ad set write failed");
      return originalPost(id, values);
    });
    await expect(restartCompletedMetaAd(f.input)).rejects.toThrow("The ad is paused");
    expect(f.input.post.mock.calls.filter(([id, values]) => id === "ad-1" && values.status === "PAUSED")).toHaveLength(1);
    expect(f.ad.status).toBe("PAUSED");
  });
});
