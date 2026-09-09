import { type InsightPeriod, type InsightTotals } from "./ad-insight-metrics";

export type HealthAction = "diagnose" | "replace_creative" | "pause" | "restart";
export type HealthIssue = {
  code: string; severity: "critical" | "warning" | "notice";
  title: string; evidence: string; explanation: string; suggestion: string;
  action: HealthAction; actionLabel: string; followUp: string;
};
export type HealthInput = {
  status: string; now: number; startsAt?: string | null; endsAt?: string | null;
  available: boolean; statusFresh: boolean; metrics: InsightTotals; previous: InsightTotals;
  completeDays: number; comparableWeeks: boolean; dailyBudget: number; sharedBudget: boolean;
  targetingReview: boolean; targetCpl: number; spendWithoutLead: number; cplWarningMultiplier: number;
  period: InsightPeriod; lastChangeAt?: string | null; lastChangeLabel?: string | null;
};
export type AdHealth = ReturnType<typeof evaluateAdHealth>;
const money = (value: number) => `₹${Math.round(value).toLocaleString("en-IN")}`;
const count = (value: number) => Math.round(value).toLocaleString("en-IN");

export function evaluateAdHealth(x: HealthInput) {
  const issues: HealthIssue[] = [], m = x.metrics, p = x.previous;
  const active = x.status === "ACTIVE";
  const add = (issue: HealthIssue) => issues.push(issue);
  const inspect: Pick<HealthIssue, "action" | "actionLabel" | "followUp"> = {
    action: "diagnose", actionLabel: "Check delivery", followUp: "Refresh the checks after fixing any issue; compare the next 3 complete days."
  };
  if (!x.available) add({ code: "data_unavailable", severity: "warning", title: "Performance data unavailable", evidence: "Meta did not return a complete performance window.", explanation: "Missing data cannot establish that reach or leads are zero.", suggestion: "Refresh performance before changing this ad.", ...inspect });
  else if (!x.statusFresh && active) add({ code: "status_stale", severity: "warning", title: "Verify current delivery", evidence: "The saved delivery status is more than 45 minutes old.", explanation: "The ad may have changed in Meta since the last refresh.", suggestion: "Check the live ad, ad set and campaign status first.", ...inspect });

  if (active && x.targetingReview) add({ code: "targeting_review", severity: "warning", title: "Station targeting needs review", evidence: "The last verified targeting pin differs from the station reference.", explanation: "The selected audience may include the wrong service area. Performance alone cannot confirm the intended location.", suggestion: "Compare the live pin with the Location Master before editing the audience.", ...inspect });
  const end = Date.parse(x.endsAt || "");
  if (active && end > x.now && end - x.now <= 86400000) add({ code: "ending_soon", severity: "notice", title: "Run ends within 24 hours", evidence: "Delivery stops at the end time shown in Run schedule.", explanation: "An ended schedule stops impressions even when Meta's switch remains on.", suggestion: "Check whether recruitment is still required. Use Run again after the schedule ends.", ...inspect });
  if (!["ACTIVE", "PAUSED", "COMPLETED", "ARCHIVED", "DELETED", "UNKNOWN", "SCHEDULED"].includes(x.status)) add({ code: "delivery_blocked", severity: "warning", title: "Meta delivery needs attention", evidence: `Current delivery state: ${x.status.replaceAll("_", " ").toLowerCase()}.`, explanation: "Approval, account or ad-set restrictions can prevent impressions.", suggestion: "Read the live Meta diagnostic and address the specific restriction.", ...inspect });

  if (active && x.available && x.statusFresh) {
    if (x.completeDays < 3) {
      add({ code: "new_run_observation", severity: "notice", title: "Gathering results", evidence: `${x.completeDays} complete day${x.completeDays === 1 ? "" : "s"} since launch or the latest recorded change.`, explanation: "An early or recently changed run has too little comparable history for a spend or creative verdict.", suggestion: "Review delivery now if needed; give the current setup 3 complete days before judging response.", ...inspect });
    } else {
      if (m.impressions === 0) add({ code: "no_delivery", severity: "warning", title: "No impressions in the review window", evidence: `${count(x.completeDays)} complete days · ${money(m.spend)} spend · 0 impressions.`, explanation: "An active switch does not prove delivery. Approval, parent status, budget allocation or bidding can block it.", suggestion: "Check live delivery and budget ownership before increasing spend.", ...inspect });
      else if (x.dailyBudget > 0 && m.spend < x.dailyBudget * x.completeDays * .35) add({ code: "low_delivery", severity: "warning", title: "Low delivery for the available budget", evidence: `${money(m.spend)} spent across ${x.completeDays} complete days; current ${x.sharedBudget ? "shared " : ""}budget ${money(x.dailyBudget)}/day.`, explanation: `${x.sharedBudget ? "Meta allocates this budget across a campaign or ad set; this ad is not guaranteed the full amount. " : ""}Past pauses or budget changes can also explain low spend. Audience size, bidding and approval need a live check.`, suggestion: "Check delivery and budget allocation. Raising the budget alone may not improve reach.", ...inspect });
      if (m.spend >= x.spendWithoutLead && m.leads === 0) add({ code: "spend_no_leads", severity: "critical", title: "Spend without leads", evidence: `${money(m.spend)} spent · ${count(m.impressions)} impressions · no Meta leads.`, explanation: "The completed-day spend has crossed the configured no-lead limit. Check the form and creative before more spend accumulates.", suggestion: "Pause this ad while investigating, or review its creative and form.", action: "pause", actionLabel: "Review pause", followUp: "Verify the pause, diagnose the form, then resume only when a fix is ready." });
      else if (m.leads >= 3 && m.cpl !== null && m.cpl > x.targetCpl * x.cplWarningMultiplier) add({ code: "high_cpl", severity: "warning", title: "Leads cost more than target", evidence: `${m.leads} Meta leads at ${money(m.cpl)} each; configured target ${money(x.targetCpl)}.`, explanation: "The ad is producing leads, but acquisition cost is above the configured tolerance.", suggestion: "Refresh the poster and compare cost per lead after 3 complete days.", action: "replace_creative", actionLabel: "Replace creative", followUp: "The next review uses complete days after the recorded creative change." });
      if (m.spend >= 300 && m.impressions >= 1000 && x.comparableWeeks && p.impressions >= 1000 && p.spend >= 150 && m.cpm! >= p.cpm! * 1.5) add({ code: "rising_cpm", severity: "warning", title: "Impressions are getting more expensive", evidence: `Cost per 1,000 impressions rose from ${money(p.cpm!)} to ${money(m.cpm!)} versus the previous complete week.`, explanation: "Auction competition, audience saturation or weaker creative can reduce exposure for the same spend. This signal does not identify one confirmed cause.", suggestion: "Check audience, placements and delivery; inspect creative response before increasing the budget.", ...inspect });
      else if (m.spend >= x.spendWithoutLead && m.impressions > 0 && m.impressions < 2000) add({ code: "low_exposure", severity: "warning", title: "Little exposure for this spend", evidence: `${money(m.spend)} bought ${count(m.impressions)} impressions (${money(m.cpm!)} per 1,000).`, explanation: "Exposure is limited relative to spend. Audience restrictions, auction costs and placements are possible causes.", suggestion: "Inspect live delivery and audience settings before changing the budget.", ...inspect });
      if (m.frequency !== null && m.frequency >= 3 && m.impressions >= 3000 && (m.linkCtr! < .7 || (x.comparableWeeks && p.leads >= 5 && m.leads < p.leads * .7))) add({ code: "audience_fatigue", severity: "warning", title: "Repeated exposure with weak response", evidence: `Average frequency ${m.frequency.toFixed(1)} · link click rate ${(m.linkCtr || 0).toFixed(2)}%.`, explanation: "The same people are seeing the ad repeatedly while response is weak; creative fatigue is a possible cause.", suggestion: "Replace the poster and keep the verified station location unchanged.", action: "replace_creative", actionLabel: "Replace creative", followUp: "Check link response and cost per lead after 3 complete days." });
      else if (m.impressions >= 3000 && m.linkCtr !== null && m.linkCtr < .7) add({ code: "weak_response", severity: "warning", title: "People see the ad but rarely click", evidence: `${count(m.impressions)} impressions · ${count(m.linkClicks)} link clicks · ${m.linkCtr.toFixed(2)}% link click rate.`, explanation: "Delivery exists, but the poster or offer may not be attracting enough interest. The 0.7% threshold is a review trigger, not a Meta guarantee.", suggestion: "Use a clearer local recruitment poster with the role, location, offer and call to action.", action: "replace_creative", actionLabel: "Replace creative", followUp: "Compare link click rate and cost per lead after 3 complete days." });
      if (m.linkClicks >= 80 && m.clickToLead !== null && m.clickToLead < 2) add({ code: "form_conversion", severity: "warning", title: "Clicks are not becoming leads", evidence: `${count(m.linkClicks)} link clicks · ${m.leads} leads · ${m.clickToLead.toFixed(1)}% click-to-lead ratio.`, explanation: "The form, offer or audience may be losing applicants after they click. Meta attribution can also affect this ratio.", suggestion: "Inspect the destination and instant form; check the role and offer match the poster.", action: "diagnose", actionLabel: "Check form and delivery", followUp: "After a form correction, compare the next 3 complete days." });
      if (x.comparableWeeks && p.leads >= 5 && m.leads <= p.leads * .5 && m.spend >= p.spend * .8 && !issues.some(i => i.action === "replace_creative")) add({ code: "lead_decline", severity: "warning", title: "Fewer leads for similar spend", evidence: `Leads fell from ${p.leads} to ${m.leads}; spend changed from ${money(p.spend)} to ${money(m.spend)}.`, explanation: "Two complete weeks show weaker response. Creative fatigue or changing demand may be contributing.", suggestion: "Review the poster and offer, then measure the next run of results.", action: "replace_creative", actionLabel: "Replace creative", followUp: "Compare results after 3 complete days without another edit." });
    }
  }
  const rank = { critical: 3, warning: 2, notice: 1 };
  issues.sort((a, b) => rank[b.severity] - rank[a.severity]);
  const eligible = active || issues.some(i => i.code === "delivery_blocked");
  return { issues, metrics: m, previous: p, period: x.period, completeDays: x.completeDays, eligible,
    state: !x.available ? "unavailable" : !eligible ? "inactive" : issues.some(i => i.severity !== "notice") ? "attention" : x.completeDays < 3 ? "observing" : "healthy",
    lastChangeAt: x.lastChangeAt || null, lastChangeLabel: x.lastChangeLabel || null };
}

export function monitoringState(event: { reviewed_at?: string; evidence?: { reviewAfter?: string }; recommendation_code: string }, health: AdHealth, now: number) {
  if (!health.eligible) return "inactive";
  if (!health.issues.some(issue => issue.code === event.recommendation_code) && health.state !== "unavailable" && health.state !== "observing" && !health.issues.some(issue => ["status_stale","data_unavailable"].includes(issue.code))) return "cleared";
  return Date.parse(event.evidence?.reviewAfter || "") > now ? "monitoring" : "due";
}
