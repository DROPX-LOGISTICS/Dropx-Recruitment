import { adScheduleSummary, type AdScheduleData } from "@/lib/ad-schedule";

export default function AdSchedule({ ad, now, compact = false }: { ad: AdScheduleData; now: number; compact?: boolean }) {
  const schedule = adScheduleSummary(ad, now);
  return <span className={`ad-schedule ad-schedule-${schedule.kind}${schedule.endingSoon ? " ad-schedule-ending" : ""}`}>
    <strong>{schedule.endLabel}</strong>
    <span className="ad-schedule-remaining">{schedule.detail}</span>
    {!compact && schedule.startLabel ? <span className="ad-schedule-start">{schedule.startLabel}</span> : null}
  </span>;
}
