import { describe, expect, it } from "vitest";
import { redactResumeForScreening } from "./recruitment-screening";

describe("resume screening redaction", () => {
  it("removes direct contact and protected-trait lines before AI review", () => {
    const redacted = redactResumeForScreening("Muhammed Ali\nDOB: 1999-01-01\nGender: Male\nali@example.com\n+91 98765 43210\n5 years warehouse operations", "Muhammed Ali");
    expect(redacted).not.toContain("Muhammed Ali");
    expect(redacted).not.toContain("1999");
    expect(redacted).not.toContain("Male");
    expect(redacted).not.toContain("ali@example.com");
    expect(redacted).not.toContain("98765");
    expect(redacted).toContain("warehouse operations");
  });
});

