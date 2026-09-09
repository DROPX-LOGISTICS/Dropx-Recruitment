import { createHmac, timingSafeEqual } from "node:crypto";

export type VideoUploadTicket = {
  actor: string; company: string; stream: string; path: string;
  fileName: string; contentType: string; size: number; expires: number;
  videoId?: string;
};

export function signVideoTicket(value: VideoUploadTicket, secret: string) {
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${payload}.${createHmac("sha256", secret).update(`recruit-video:${payload}`).digest("base64url")}`;
}

export function readVideoTicket(ticket: string, secret: string, scope: { actor: string; company: string; stream: string }) {
  const [payload, signature, extra] = ticket.split(".");
  if (!payload || !signature || extra || ticket.length > 8000) throw new Error("Invalid video upload reference.");
  const expected = createHmac("sha256", secret).update(`recruit-video:${payload}`).digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("Invalid video upload reference.");
  const value = JSON.parse(Buffer.from(payload, "base64url").toString()) as VideoUploadTicket;
  if (value.actor !== scope.actor || value.company !== scope.company || value.stream !== scope.stream || value.expires <= Date.now()) {
    throw new Error("The video upload reference expired or belongs to another user. Upload the video again.");
  }
  return value;
}
