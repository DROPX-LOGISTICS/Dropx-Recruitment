import { adRunEndTime, formatAdScheduleDate } from "@/lib/ad-schedule";

export default function AdExtensionSummary({ endTime, days, dailyBudget, paused = false }: {
  endTime: string;
  days: number;
  dailyBudget: number;
  paused?: boolean;
}) {
  const newEnd = adRunEndTime(days, Date.parse(endTime));
  return <div className="wide ad-extension-summary" aria-live="polite">
    <dl>
      <div><dt>Current end</dt><dd>{formatAdScheduleDate(endTime)}</dd></div>
      <div className="ad-extension-new-end"><dt>New end</dt><dd>{newEnd ? formatAdScheduleDate(newEnd) : "Choose extra days"}</dd></div>
      <div><dt>Daily budget</dt><dd>₹{dailyBudget.toLocaleString("en-IN")}</dd></div>
      {newEnd ? <div><dt>Estimated extra spend · {days} days</dt><dd>₹{(dailyBudget * days).toLocaleString("en-IN")}</dd></div> : null}
    </dl>
    <p>{paused ? "This ad stays paused. Resume it separately when ready. " : "The ad continues on its existing schedule. "}Actual spend depends on Meta delivery.</p>
  </div>;
}
