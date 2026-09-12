const dateFormatter = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric"
});
const timeFormatter = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true
});

export default function MetaReceivedTime({ value }: { value?: string | null }) {
  const timestamp = value ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(timestamp)) {
    return <span title="No Meta ingestion timestamp recorded">—</span>;
  }
  const date = dateFormatter.format(timestamp);
  const time = `${timeFormatter.format(timestamp)} IST`;
  return <time className="meta-received-time" dateTime={new Date(timestamp).toISOString()} title={`Last received from Meta: ${date}, ${time}`}>
    <b>{date}</b><small>{time}</small>
  </time>;
}
