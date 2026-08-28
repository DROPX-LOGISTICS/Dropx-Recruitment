import { describe, expect, it, vi } from "vitest";
import { fetchMetaFormLeadsSince, mergeMetaFormIds } from "./meta-lead-poller";

function graphResponse(payload: unknown) {
  return Promise.resolve(new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" }
  }));
}

describe("Meta lead polling", () => {
  it("paginates until it reaches the safety watermark", async () => {
    const fetchImpl = vi.fn()
      .mockImplementationOnce(() => graphResponse({
        data: [
          { id: "new-2", created_time: "2026-08-01T10:04:00.000Z" },
          { id: "new-1", created_time: "2026-08-01T10:01:00.000Z" }
        ],
        paging: { next: "https://graph.facebook.com/v25.0/form/leads?after=page-2" }
      }))
      .mockImplementationOnce(() => graphResponse({
        data: [
          { id: "overlap", created_time: "2026-08-01T10:00:00.000Z" },
          { id: "old", created_time: "2026-08-01T09:59:59.000Z" }
        ],
        paging: { next: "https://graph.facebook.com/v25.0/form/leads?after=page-3" }
      }));

    const result = await fetchMetaFormLeadsSince({
      formId: "123456789",
      graphVersion: "v25.0",
      accessToken: "secret",
      since: new Date("2026-08-01T10:00:00.000Z"),
      fetchImpl
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.leads.map((lead) => lead.id)).toEqual(["new-2", "new-1", "overlap"]);
    expect(result.truncated).toBe(false);
    expect(result.pages).toBe(2);
  });

  it("fails closed when the page guard is reached before the watermark", async () => {
    const fetchImpl = vi.fn(() => graphResponse({
      data: [{ id: "new", created_time: "2026-08-01T10:04:00.000Z" }],
      paging: { next: "https://graph.facebook.com/v25.0/form/leads?after=more" }
    }));
    const result = await fetchMetaFormLeadsSince({
      formId: "123456789",
      graphVersion: "v25.0",
      accessToken: "secret",
      since: new Date("2026-08-01T10:00:00.000Z"),
      maxPages: 1,
      fetchImpl
    });
    expect(result.truncated).toBe(true);
  });

  it("unions saved, historical and newly discovered forms", () => {
    expect(mergeMetaFormIds(
      ["111111", "222222"],
      ["222222", "333333"],
      ["invalid", "444444"]
    )).toEqual(["111111", "222222", "333333", "444444"]);
  });
});
