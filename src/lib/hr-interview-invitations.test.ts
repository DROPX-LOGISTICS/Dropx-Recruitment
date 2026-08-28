import { describe, expect, it } from "vitest";
import {
  decodeGoogleCalendarCredential,
  encodeGoogleCalendarCredential
} from "./hr-interview-invitations";

describe("Google Calendar credential storage", () => {
  it("preserves legacy client-secret values", () => {
    expect(decodeGoogleCalendarCredential("legacy-secret")).toEqual({
      clientSecret: "legacy-secret",
      refreshToken: ""
    });
  });

  it("round-trips the encrypted compound credential", () => {
    const encoded = encodeGoogleCalendarCredential({
      clientSecret: "client-secret",
      refreshToken: "refresh-token"
    });
    expect(decodeGoogleCalendarCredential(encoded)).toEqual({
      clientSecret: "client-secret",
      refreshToken: "refresh-token"
    });
  });
});
