import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isMetaConcurrentObjectEditLimit,
  META_OBJECT_EDIT_INTERVAL_MS,
  resetMetaObjectEditThrottle,
  withMetaObjectEditGate
} from "./meta-graph-throttle";

afterEach(() => {
  resetMetaObjectEditThrottle();
  vi.useRealTimers();
});

describe("isMetaConcurrentObjectEditLimit", () => {
  it("matches Meta code 613/4841018", () => {
    expect(isMetaConcurrentObjectEditLimit({ metaCode: 613, metaSubcode: 4841018 })).toBe(true);
    expect(isMetaConcurrentObjectEditLimit({ code: 613, error_subcode: 4841018 })).toBe(true);
    expect(isMetaConcurrentObjectEditLimit(new Error("(#613) concurrent request rate limit (Meta code 613/4841018)"))).toBe(true);
    expect(isMetaConcurrentObjectEditLimit({ metaCode: 613, metaSubcode: 1487742 })).toBe(false);
    expect(isMetaConcurrentObjectEditLimit(new Error("invalid parameter"))).toBe(false);
  });
});

describe("withMetaObjectEditGate", () => {
  it("spaces consecutive edits to the same object by 30 seconds", async () => {
    vi.useFakeTimers();
    let now = 1_000_000;
    const slept: number[] = [];
    const run = vi.fn(async () => "ok");

    const first = withMetaObjectEditGate("ad-1", run, {
      now: () => now,
      sleep: async (ms) => {
        slept.push(ms);
        now += ms;
        await vi.advanceTimersByTimeAsync(ms);
      }
    });
    await vi.runAllTimersAsync();
    await expect(first).resolves.toBe("ok");
    expect(slept).toEqual([]);

    const second = withMetaObjectEditGate("ad-1", run, {
      now: () => now,
      sleep: async (ms) => {
        slept.push(ms);
        now += ms;
        await vi.advanceTimersByTimeAsync(ms);
      }
    });
    await vi.runAllTimersAsync();
    await expect(second).resolves.toBe("ok");
    expect(slept).toEqual([META_OBJECT_EDIT_INTERVAL_MS]);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("does not delay edits to different objects", async () => {
    const slept: number[] = [];
    await withMetaObjectEditGate("ad-1", async () => 1, {
      now: () => 0,
      sleep: async (ms) => { slept.push(ms); }
    });
    await withMetaObjectEditGate("adset-1", async () => 2, {
      now: () => 0,
      sleep: async (ms) => { slept.push(ms); }
    });
    expect(slept).toEqual([]);
  });

  it("retries 613/4841018 with increasing delay", async () => {
    vi.useFakeTimers();
    let now = 0;
    const slept: number[] = [];
    const run = vi.fn()
      .mockRejectedValueOnce({ metaCode: 613, metaSubcode: 4841018, message: "rate limit" })
      .mockResolvedValueOnce("recovered");

    const promise = withMetaObjectEditGate("ad-1", run, {
      now: () => now,
      sleep: async (ms) => {
        slept.push(ms);
        now += ms;
        await vi.advanceTimersByTimeAsync(ms);
      },
      maxRetries: 2
    });
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBe("recovered");
    expect(slept).toEqual([META_OBJECT_EDIT_INTERVAL_MS]);
    expect(run).toHaveBeenCalledTimes(2);
  });
});
