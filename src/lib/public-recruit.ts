import { createHmac, randomUUID, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { requiredEnv } from "./recruitment-api";

const origins = new Set(["https://www.dropxlogistics.com", "https://dropxlogistics.com", "https://recruit.dropxlogistics.com"]);
export function allowedOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  return origins.has(origin) || origin === new URL(request.url).origin || (process.env.NODE_ENV !== "production" && /^http:\/\/localhost:\d+$/.test(origin));
}
export function publicResponse(request: Request, body: unknown, status = 200) {
  const origin = request.headers.get("origin");
  return NextResponse.json(body, { status, headers: {
    "Cache-Control": "no-store", "Vary": "Origin", "X-Content-Type-Options": "nosniff",
    ...(origin && allowedOrigin(request) ? { "Access-Control-Allow-Origin": origin } : {})
  }});
}
export function preflight(request: Request) {
  return new Response(null, { status: allowedOrigin(request) ? 204 : 403, headers: {
    ...(allowedOrigin(request) ? { "Access-Control-Allow-Origin": request.headers.get("origin") || new URL(request.url).origin } : {}),
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Vary": "Origin"
  }});
}
function signature(value: string) {
  return createHmac("sha256", requiredEnv("SUPABASE_SERVICE_ROLE_KEY")).update(`dropx-website-v1:${value}`).digest("hex");
}
export function issueIntakeToken(now = Date.now()) {
  const payload = `${now}.${randomUUID()}`;
  return `${payload}.${signature(payload)}`;
}
export function verifyIntakeToken(token: string, now = Date.now()) {
  const parts = token.split(".");
  if (parts.length !== 3 || !/^\d{13}$/.test(parts[0]) || !/^[0-9a-f-]{36}$/.test(parts[1]) || !/^[0-9a-f]{64}$/.test(parts[2])) return null;
  const age = now - Number(parts[0]);
  if (age < 1500 || age > 2 * 60 * 60 * 1000) return null;
  const expected = signature(`${parts[0]}.${parts[1]}`);
  return timingSafeEqual(Buffer.from(expected), Buffer.from(parts[2])) ? parts[1] : null;
}
export function requestHash(value: string) { return signature(`identity:${value}`); }
export function validPhone(value: string) {
  const clean = value.replace(/[\s()-]/g, "");
  return /^(?:\+91|91)?[6-9]\d{9}$/.test(clean) ? clean.slice(-10) : null;
}
export const publicRoleNames: Record<string, string> = {
  DA: "Delivery partner — two-wheeler", DCD: "Delivery associate — company van", ODCD: "Delivery partner — own van"
};
export function cleanAttribution(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  return Object.fromEntries(["utm_source", "utm_medium", "utm_campaign", "utm_content", "referrer"].flatMap(key =>
    typeof source[key] === "string" ? [[key, String(source[key]).slice(0, 200)]] : []));
}
