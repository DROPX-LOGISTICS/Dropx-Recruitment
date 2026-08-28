import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  normalizeIndeedApplication,
  validateIndeedMappingInput,
  verifyIndeedSignature
} from "./recruitment-source-ingestion";

describe("normalizeIndeedApplication", () => {
  it("normalizes the official Indeed Apply payload without routing from the public title", () => {
    expect(normalizeIndeedApplication({
      id: "apply-123",
      appliedOnMillis: 1785731400000,
      job: {
        jobId: "employer-job-123",
        jobTitle: "Cluster Manager – Last Mile Delivery",
        jobMeta: "AP_CLM",
        jobLocation: "Gudur"
      },
      applicant: {
        fullName: "Asha P",
        phoneNumber: "+91 98765 43210",
        email: "ASHA@example.com"
      },
      answers: { "Notice period": "15 days" }
    })).toMatchObject({
      source: "indeed",
      externalEventId: "apply-123",
      jobId: "employer-job-123",
      jobName: "Cluster Manager – Last Mile Delivery",
      jobMeta: "AP_CLM",
      fullName: "Asha P",
      phone: "+91 98765 43210",
      email: "asha@example.com",
      questionnaire: { notice_period: "15 days" }
    });
  });

  it("requires stable application and job identifiers", () => {
    expect(() => normalizeIndeedApplication({ id: "1", job: { jobTitle: "Recruiter" } })).toThrow(/job ID/i);
    expect(() => normalizeIndeedApplication({ job: { jobId: "job-1", jobTitle: "Recruiter" } })).toThrow(/application ID/i);
  });
});

describe("verifyIndeedSignature", () => {
  it("accepts only Indeed's HMAC-SHA1 Base64 signature over the unmodified body", () => {
    const body = JSON.stringify({ id: "apply-1" });
    const signature = createHmac("sha1", "secret").update(body).digest("base64");
    expect(verifyIndeedSignature(body, signature, "secret")).toBe(true);
    expect(verifyIndeedSignature(`${body} `, signature, "secret")).toBe(false);
    expect(verifyIndeedSignature(body, "bad", "secret")).toBe(false);
  });
});

describe("validateIndeedMappingInput", () => {
  it("keeps detailed titles public and routing codes internal", () => {
    expect(validateIndeedMappingInput({
      publicTitle: "Junior Accountant / Accounts Executive",
      internalCode: "HO_JAE",
      roleCode: "JAE",
      roleStream: "hr"
    })).toEqual({
      publicTitle: "Junior Accountant / Accounts Executive",
      internalCode: "HO_JAE"
    });
  });

  it("cannot route Indeed into workforce roles or expose the internal code as the title", () => {
    expect(() => validateIndeedMappingInput({
      publicTitle: "Delivery Associate",
      internalCode: "KOZA_DA",
      roleCode: "DA",
      roleStream: "workforce"
    })).toThrow(/limited to HR/i);
    expect(() => validateIndeedMappingInput({
      publicTitle: "AP_CLM",
      internalCode: "AP_CLM",
      roleCode: "CLM",
      roleStream: "hr"
    })).toThrow(/cannot expose/i);
  });
});
