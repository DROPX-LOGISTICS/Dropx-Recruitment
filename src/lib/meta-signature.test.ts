import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyMetaSignature } from "./meta-signature";

describe("Meta webhook signature", () => {
  it("accepts the matching SHA-256 signature", () => {
    const body = '{"entry":[]}';
    const secret = "test-secret";
    const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
    expect(verifyMetaSignature(body, signature, secret)).toBe(true);
  });

  it("rejects a mismatched signature", () => {
    expect(verifyMetaSignature("body", "sha256=00", "secret")).toBe(false);
  });
});
