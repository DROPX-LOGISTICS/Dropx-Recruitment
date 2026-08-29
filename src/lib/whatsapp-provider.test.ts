import { describe, expect, it } from "vitest";
import { resolveWhatsAppWebhookSecret } from "./whatsapp-provider";

describe("WhatsApp provider configuration", () => {
  it("prefers a managed webhook secret when it is present", () => {
    expect(resolveWhatsAppWebhookSecret(" managed ", "environment")).toBe("managed");
  });

  it("falls back to environment configuration when managed settings are incomplete", () => {
    expect(resolveWhatsAppWebhookSecret("", undefined, " environment ")).toBe("environment");
  });
});
