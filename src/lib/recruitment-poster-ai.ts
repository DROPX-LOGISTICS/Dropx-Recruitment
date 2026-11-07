import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp, { type OverlayOptions } from "sharp";
import type { PosterBrand } from "./recruitment-poster-brand";
import { POSTER_FORMATS, posterPrompt, type PosterInput } from "./recruitment-poster";

const geminiCredential = () => process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() || "";
export const posterModel = () => process.env.RECRUITMENT_POSTER_MODEL?.trim() || (geminiCredential() ? "gemini-3.1-flash-image" : "google/gemini-3.1-flash-image");
export const posterCredential = () => geminiCredential() || process.env.AI_GATEWAY_API_KEY?.trim() || process.env.VERCEL_OIDC_TOKEN?.trim() || "";
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

export function allowedPosterReferenceUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && (!url.port || url.port === "443")
      && (url.hostname.endsWith(".fbcdn.net") || url.hostname.endsWith(".fbsbx.com"));
  } catch { return false; }
}

export async function downloadPosterReference(url: string, signal: AbortSignal) {
  if (!allowedPosterReferenceUrl(url)) throw new Error("This previous poster cannot be used as an AI reference. Choose another ad or a fresh design.");
  const response = await fetch(url, { signal, redirect: "error" });
  if (!response.ok || !response.body) throw new Error("The previous poster could not be loaded. Choose another reference.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_IMAGE_BYTES) { await reader.cancel(); throw new Error("The reference poster is too large."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const image = await sharp(Buffer.concat(chunks), { limitInputPixels: 25_000_000 }).rotate().resize({ width: 1200, height: 1600, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  return `data:image/jpeg;base64,${image.toString("base64")}`;
}

export function generatedPosterData(payload: any) {
  const url = payload?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (typeof url !== "string" || url.length > MAX_IMAGE_BYTES * 1.4) throw new Error("AI returned no usable poster. Try generating again.");
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(url);
  if (!match) throw new Error("AI returned an unsupported image. Try generating again.");
  return Buffer.from(match[2], "base64");
}

export async function generateRecruitmentPoster(input: PosterInput, context: { role: string; location: string; brand: PosterBrand }, reference: string | null, signal: AbortSignal) {
  const credential = posterCredential();
  if (!credential) throw new Error("AI image generation is not configured for Recruit. Upload a poster or ask your administrator to configure a Gemini image connection.");
  const logo = await readFile(path.join(process.cwd(), "public/dropx-logo.png"));
  const content: Array<Record<string, unknown>> = [
    { type: "text", text: posterPrompt(input, context) },
    { type: "image_url", image_url: { url: `data:image/png;base64,${logo.toString("base64")}` } }
  ];
  if (reference) content.push({ type: "image_url", image_url: { url: reference } });
  const size = POSTER_FORMATS[input.format];
  const directGemini = geminiCredential();
  const response = directGemini ? await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(posterModel().replace(/^google\//, ""))}:generateContent`, {
    method: "POST", signal, headers: { "x-goog-api-key": directGemini, "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ role: "user", parts: content.map(part => {
      if (part.type === "text") return { text: part.text };
      const url = (part.image_url as { url: string }).url;
      const comma = url.indexOf(",");
      return { inlineData: { mimeType: url.slice(5, url.indexOf(";")), data: url.slice(comma + 1) } };
    }) }], generationConfig: { responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio: size.ratio, imageSize: "2K" } } })
  }) : await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
    method: "POST", signal,
    headers: { Authorization: `Bearer ${credential}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: posterModel(), stream: false, modalities: ["text", "image"], messages: [{ role: "user", content }], providerOptions: { google: { imageConfig: { aspectRatio: size.ratio, imageSize: "2K" } } } })
  });
  if (!response.ok) {
    // Inspect only the error category, never echo provider diagnostics or request data.
    const failure = await response.json().catch(() => ({}));
    const budgetBlocked = response.status === 402 || (response.status === 403 && failure?.error?.type === "no_providers_available");
    throw new Error(budgetBlocked ? "The AI account has no available image-generation budget. Upload a poster or ask your administrator to check the AI budget."
      : response.status === 429 ? "AI image generation is busy. Please try again shortly."
      : response.status === 401 || response.status === 403 ? "The AI connection could not authorize image generation. Ask your administrator to check the image-generation connection."
      : "The image service could not generate this poster. Try again or upload an image.");
  }
  const payload = await response.json();
  const inline = directGemini ? payload?.candidates?.[0]?.content?.parts?.find((part: any) => part.inlineData?.data)?.inlineData : null;
  const bytes = generatedPosterData(directGemini ? { choices: [{ message: { images: [{ image_url: { url: inline ? `data:${inline.mimeType};base64,${inline.data}` : null } }] } }] } : payload);
  const dropx = await sharp(logo).resize({ width: 390, height: 132, fit: "inside" }).png().toBuffer();
  const branding: OverlayOptions[] = [
    { input: Buffer.from('<svg width="936" height="170"><rect width="936" height="170" rx="14" fill="white"/></svg>'), left: 72, top: 450 },
    { input: dropx, left: 98, top: 468 }
  ];
  if (context.brand.key !== "dropx") {
    const partner = await sharp(path.join(process.cwd(), "public/brand", { amazon_now: "amazon-now-logo.png", amazon: "amazon-logo.png", flipkart: "flipkart-logo.png" }[context.brand.key])).resize({ width: 240, height: 135, fit: "inside" }).png().toBuffer();
    branding.push({ input: partner, left: 710, top: 468 });
  }
  const image = await sharp(bytes, { limitInputPixels: 25_000_000 }).rotate()
    .resize(size.width, size.height, { fit: "contain", background: "#fffaf5" }).composite(branding)
    .jpeg({ quality: 94, mozjpeg: true }).toBuffer();
  return { image, model: posterModel(), width: size.width, height: size.height };
}
