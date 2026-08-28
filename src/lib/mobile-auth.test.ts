import { beforeEach, describe, expect, it } from "vitest";
import {
  generateOtp,
  hashOtp,
  hashSessionToken,
  newSessionToken,
  normalizeIndianMobileE164,
  verifyOtpHash
} from "./mobile-auth";

describe("mobile authentication", () => {
  beforeEach(() => {
    process.env.MOBILE_OTP_HASH_SECRET = "test-secret";
  });

  it("normalizes registered Indian mobiles", () => {
    expect(normalizeIndianMobileE164("+91 79024 28024")).toBe("917902428024");
  });

  it("creates six-digit OTP values", () => {
    expect(generateOtp()).toMatch(/^\d{6}$/);
  });

  it("verifies OTP hashes without storing the OTP", () => {
    const hash = hashOtp("challenge", "123456");
    expect(verifyOtpHash("challenge", "123456", hash)).toBe(true);
    expect(verifyOtpHash("challenge", "654321", hash)).toBe(false);
  });

  it("creates opaque hashed sessions", () => {
    const token = newSessionToken();
    expect(token.length).toBeGreaterThan(30);
    expect(hashSessionToken(token)).not.toContain(token);
  });
});
