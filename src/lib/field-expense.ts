export function parseExpenseReceiptDataUrl(value: unknown) {
  const match = /^data:(image\/jpeg|image\/png|application\/pdf);base64,([A-Za-z0-9+/=]+)$/.exec(String(value ?? ""));
  if (!match) throw new Error("Upload a JPG, PNG or PDF receipt.");
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > 2 * 1024 * 1024) throw new Error("Receipt must be smaller than 2 MB.");
  return { contentType: match[1], bytes };
}
