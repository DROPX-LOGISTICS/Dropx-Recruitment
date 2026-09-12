export type LeadAgeTone = "fresh" | "aging" | "old";

export function leadAge(receivedAt: string | null | undefined, now: number) {
  const receivedTime = receivedAt ? Date.parse(receivedAt) : Number.NaN;
  if (!Number.isFinite(receivedTime)) return null;
  const minutes = Math.max(0, Math.floor((now - receivedTime) / 60_000));
  const tone: LeadAgeTone = minutes < 30 ? "fresh" : minutes < 24 * 60 ? "aging" : "old";
  if (minutes < 1) return { label: "Now", tone };
  if (minutes < 60) return { label: `${minutes}m`, tone };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { label: `${hours}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`, tone };
  const days = Math.floor(hours / 24);
  return { label: `${days}d${hours % 24 ? ` ${hours % 24}h` : ""}`, tone };
}
