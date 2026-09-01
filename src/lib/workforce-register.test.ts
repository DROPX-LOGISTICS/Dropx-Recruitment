import { describe, expect, it } from "vitest";
import { canonicalWorkforceIdentity, WORKFORCE_PROFILE_TABLE } from "./workforce-register";

describe("canonical workforce register", () => {
  it("uses the post-cutover workforce table", () => {
    expect(WORKFORCE_PROFILE_TABLE).toBe("workforce");
  });

  it("creates the required canonical identity fields", () => {
    const identity = canonicalWorkforceIdentity("profile-id", "designation-id");

    expect(identity).toMatchObject({
      id: "profile-id",
      designation_id: "designation-id",
      source_profile_type: "field_executive",
      source_profile_id: "profile-id",
      compatibility_mode: false,
      migration_state: "canonical"
    });
    expect(Number.isNaN(Date.parse(identity.synced_at))).toBe(false);
  });
});
