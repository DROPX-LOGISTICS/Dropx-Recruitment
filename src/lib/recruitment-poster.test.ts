import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { resolvePosterBrand } from "./recruitment-poster-brand";
import { POSTER_FORMATS, validatePosterInput } from "./recruitment-poster";
import { allowedPosterReferenceUrl, generateRecruitmentPoster, generatedPosterData } from "./recruitment-poster-ai";

const input = { brand: "amazon_now", language: "Malayalam", format: "story", style: "clean", phone: "85475 76282", email: "hr@dropxlogistics.com", details: "Previous dark store experience", instructions: "", referenceAdId: "" };
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("recruitment poster generation", () => {
  it("enforces the standard size and validates contact information before any paid request", () => {
    expect(POSTER_FORMATS.story).toMatchObject({ width: 1080, height: 1920 });
    expect(validatePosterInput(input).phone).toBe("85475 76282");
    for (const change of [{ format: "square" }, { language: "unsupported" }, { phone: "123" }, { email: "hr@" }, { details: "x".repeat(1501) }]) expect(() => validatePosterInput({ ...input, ...change })).toThrow();
  });
  it("does not fetch arbitrary reference URLs or remote provider responses", () => {
    expect(allowedPosterReferenceUrl("https://scontent.fbcdn.net/image.jpg")).toBe(true);
    for (const value of ["https://scontent.fbcdn.net.evil.test/a", "http://scontent.fbcdn.net/a", "https://localhost/a", "https://user@a.fbcdn.net/a", "https://a.fbcdn.net:8443/a"]) expect(allowedPosterReferenceUrl(value)).toBe(false);
    expect(() => generatedPosterData({ choices: [{ message: { images: [{ image_url: { url: "https://localhost/private" } }] } }] })).toThrow();
  });
  it("exports an exact-sized image, adds real brand assets, and keeps the chosen contact and language in the request", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-server-secret");
    const source = await sharp({ create: { width: 540, height: 960, channels: 3, background: "#eeeeee" } }).png().toBuffer();
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { images: [{ image_url: { url: `data:image/png;base64,${source.toString("base64")}` } }] } }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const result = await generateRecruitmentPoster(validatePosterInput(input), { role: "Store Manager", location: "Gurgaon", brand: resolvePosterBrand("AMAZON", "NOW") }, null, new AbortController().signal);
    const metadata = await sharp(result.image).metadata();
    expect(metadata).toMatchObject({ width: 1080, height: 1920, format: "jpeg" });
    const logoPixels = await sharp(result.image).extract({ left: 100, top: 470, width: 385, height: 125 }).stats();
    expect(logoPixels.channels[0].stdev).toBeGreaterThan(25);
    const partnerPixels = await sharp(result.image).extract({ left: 710, top: 468, width: 240, height: 135 }).stats();
    expect(partnerPixels.channels[2].mean).toBeGreaterThan(partnerPixels.channels[0].mean);
    const sent = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(sent.messages[0].content[0].text).toContain("85475 76282");
    expect(sent.messages[0].content[0].text).toContain("hr@dropxlogistics.com");
    expect(sent.messages[0].content[0].text).toContain("Malayalam");
    expect(JSON.stringify(sent)).not.toContain("test-server-secret");
  });
  it("can reuse a configured Gemini key directly and reads Gemini inline image responses", async () => {
    vi.stubEnv("GEMINI_API_KEY", "direct-server-secret");
    const source = await sharp({ create: { width: 540, height: 960, channels: 3, background: "white" } }).png().toBuffer();
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: source.toString("base64") } }] } }] })));
    vi.stubGlobal("fetch", fetcher);
    const result = await generateRecruitmentPoster(validatePosterInput(input), { role: "Delivery Associate", location: "Station", brand: resolvePosterBrand("AMAZON", "EDSP") }, null, new AbortController().signal);
    expect((await sharp(result.image).metadata()).width).toBe(1080);
    expect(fetcher.mock.calls[0][0]).toContain("generativelanguage.googleapis.com");
    expect(JSON.parse(fetcher.mock.calls[0][1].body).generationConfig.imageConfig.aspectRatio).toBe("9:16");
    expect(fetcher.mock.calls[0][1].body).not.toContain("direct-server-secret");
  });
  it("treats free-tier provider refusal as a budget issue", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-server-secret");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { type: "no_providers_available", message: "private details" } }), { status: 403 })));
    await expect(generateRecruitmentPoster(validatePosterInput(input), { role: "Associate", location: "Station", brand: resolvePosterBrand("FLIPKART", "MDH") }, null, new AbortController().signal)).rejects.toThrow("budget");
  });
  it("shows a useful budget error without exposing a provider response", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-server-secret");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("private provider diagnostics", { status: 402 })));
    await expect(generateRecruitmentPoster(validatePosterInput(input), { role: "Store Manager", location: "Gurgaon", brand: resolvePosterBrand("AMAZON", "NOW") }, null, new AbortController().signal)).rejects.toThrow("no available image-generation budget");
  });
});
