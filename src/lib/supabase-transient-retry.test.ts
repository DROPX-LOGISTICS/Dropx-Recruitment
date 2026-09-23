import { describe, expect, it, vi } from "vitest";
import { fetchWithSupabaseTransientRetry } from "./supabase-transient-retry";

describe("Supabase transient retries", () => {
  it("retries a transient read failure and returns the recovery response", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(new Response("unavailable", { status: 521 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const response = await fetchWithSupabaseTransientRetry("https://example.test/rest/v1/profiles", undefined, request);

    expect(response.status).toBe(200);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("does not retry a mutation, avoiding duplicate OTP writes", async () => {
    const request = vi.fn().mockResolvedValue(new Response("unavailable", { status: 521 }));

    const response = await fetchWithSupabaseTransientRetry(
      "https://example.test/rest/v1/recruitment_mobile_otp_challenges",
      { method: "POST", body: "{}" },
      request
    );

    expect(response.status).toBe(521);
    expect(request).toHaveBeenCalledTimes(1);
  });
});
