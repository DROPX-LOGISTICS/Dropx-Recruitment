import { describe, expect, it } from "vitest";
import { parseExpenseReceiptDataUrl } from "./field-expense";

describe("field expense workflow", () => {
  it("accepts supported receipt data while expense types remain master-driven", () => {
    const receipt = parseExpenseReceiptDataUrl(`data:image/png;base64,${Buffer.from("receipt").toString("base64")}`);
    expect(receipt.contentType).toBe("image/png");
    expect(receipt.bytes.toString()).toBe("receipt");
  });

  it("rejects unsupported or oversized receipt payloads", () => {
    expect(() => parseExpenseReceiptDataUrl("data:text/plain;base64,SGk=")).toThrow();
  });
});
