import { leadAge } from "@/lib/lead-age";

const dateFormatter = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata", day: "2-digit", month: "short"
});
const timeFormatter = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: true
});
const fullTimestampFormatter = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true
});

export default function MetaReceivedTime({ value, now = Date.now() }: { value?: string | null; now?: number }) {
  const timestamp = value ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(timestamp)) {
    return <span title="No Meta ingestion timestamp recorded">—</span>;
  }
  const date = dateFormatter.format(timestamp);
  const time = timeFormatter.format(timestamp);
  const fullTimestamp = fullTimestampFormatter.format(timestamp);
  const age = leadAge(value, now);
  return <time className="meta-received-time" dateTime={new Date(timestamp).toISOString()} title={`Last received from Meta: ${fullTimestamp} IST`}>
    <b>{time}{age?<em className={`lead-age lead-age-${age.tone}`}>{age.label}</em>:null}</b><small>{date}</small>
  </time>;
}
