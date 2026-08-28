import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { normalizePhone } from "./recruitment-routing";

function secret() {
  const value = process.env.MOBILE_OTP_HASH_SECRET?.trim();
  if (!value) throw new Error("MOBILE_OTP_HASH_SECRET is not configured.");
  return value;
}

export function normalizeIndianMobileE164(value: unknown) {
  const phone = normalizePhone(value);
  return phone ? `91${phone}` : null;
}

export function generateOtp() {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashOtp(challengeId: string, otp: string) {
  return createHmac("sha256", secret()).update(`${challengeId}:${otp}`).digest("hex");
}

export function verifyOtpHash(challengeId: string, otp: string, expectedHex: string) {
  const actual = Buffer.from(hashOtp(challengeId, otp), "hex");
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function newSessionToken() {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string) {
  return createHmac("sha256", secret()).update(`session:${token}`).digest("hex");
}
