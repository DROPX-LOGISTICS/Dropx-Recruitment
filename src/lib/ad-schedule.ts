export type AdScheduleData = {
  status?: unknown;
  schedule_known?: boolean;
  starts_at?: string | null;
  current_run_started_at?: string | null;
  ends_at?: string | null;
};

const parse = (value: unknown) => value ? Date.parse(String(value)) : Number.NaN;
const scheduleDateFormatter = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata", weekday: "short", day: "2-digit", month: "short", year: "numeric",
  hour: "2-digit", minute: "2-digit", hour12: true
});

export function formatAdScheduleDate(value: string | number) {
  const time = typeof value === "number" ? value : parse(value);
  if (!Number.isFinite(time)) return "Unavailable";
  return `${scheduleDateFormatter.format(time)} IST`;
}

export function adRunEndTime(days: number, now: number) {
  if (!Number.isInteger(days) || days < 1 || days > 90 || !Number.isFinite(now)) return null;
  return new Date(Math.floor(now / 1000) * 1000 + days * 86_400_000).toISOString();
}

function timeRemaining(milliseconds: number) {
  const minutes = Math.ceil(milliseconds / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export function adScheduleSummary(ad: AdScheduleData, now: number) {
  const end = parse(ad.ends_at);
  const start = parse(ad.current_run_started_at || ad.starts_at);
  const status = String(ad.status || "").toUpperCase();
  const startLabel = Number.isFinite(start) ? `${start > now ? "Starts" : "Started"} ${formatAdScheduleDate(start)}` : null;
  if (Number.isFinite(end)) {
    const ended = end <= now;
    const delivering = status === "ACTIVE";
    return {
      kind: ended ? "ended" : "scheduled",
      endLabel: `${ended ? "Ended" : "Ends"} ${formatAdScheduleDate(end)}`,
      detail: ended ? "Run finished" : `${timeRemaining(end - now)} ${delivering ? "remaining" : "until scheduled end"}`,
      startLabel,
      endingSoon: !ended && delivering && end - now <= 86_400_000
    };
  }
  const known = !ad.ends_at && (ad.schedule_known === true || Number.isFinite(start));
  return {
    kind: known ? "open" : "unknown",
    endLabel: known ? "No end date" : "Schedule unavailable",
    detail: known ? (status === "ACTIVE" ? "Runs until paused" : "No automatic end set") : "Not supplied by Meta",
    startLabel,
    endingSoon: false
  };
}
