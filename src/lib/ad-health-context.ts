import { calendarDaily, insightTotals, offsetInsightDate, type InsightPeriod, type MetaInsightRow } from "./ad-insight-metrics";
import { evaluateAdHealth } from "./ad-health";
import { defaultGuardPolicy } from "./ad-spend-guard";

export function adPolicy(ad: any, policies: any[]) {
  const role = Array.isArray(ad.recruitment_roles) ? ad.recruitment_roles[0] : ad.recruitment_roles;
  const applicable = policies.filter(p => (!p.stream || p.stream === role?.stream) && (!p.location_id || p.location_id === ad.location_id) && (!p.role_id || p.role_id === ad.role_id));
  applicable.sort((a,b) => Number(Boolean(a.stream)) + Number(Boolean(a.location_id))*2 + Number(Boolean(a.role_id))*2 - Number(Boolean(b.stream)) - Number(Boolean(b.location_id))*2 - Number(Boolean(b.role_id))*2);
  return Object.assign({}, defaultGuardPolicy, ...applicable);
}
const validTime = (value: unknown) => Number.isFinite(Date.parse(String(value || ""))) ? Date.parse(String(value)) : 0;
export function buildHealthContext(input: {
  ad: any; allAds: any[]; daily: MetaInsightRow[]; assessment?: MetaInsightRow; previous?: MetaInsightRow;
  period: InsightPeriod; previousPeriod: InsightPeriod; available: boolean; now: number;
  policy?: any; changes: any[]; requests: any[];
}) {
  const { ad, now } = input, policy = input.policy || defaultGuardPolicy;
  const history = [
    ...input.changes.map(change => ({ at: change.completed_at || change.created_at, label: "Creative replacement", status: change.status })),
    ...input.requests.map(request => ({ at: request.updated_at, label: String(request.request_type).replaceAll("_", " "), status: request.status }))
  ].sort((a,b) => validTime(b.at) - validTime(a.at));
  const completed = history.filter(item => item.status === "completed");
  const runStart = Math.max(validTime(ad.current_run_started_at), validTime(ad.created_on));
  const anchor = Math.max(runStart, ...completed.map(item => validTime(item.at)));
  const anchorDay = anchor ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(anchor)) : input.period.until;
  // Exclude the partial day of a launch/restart/change. Never mix old creative performance into a new verdict.
  const since = anchor >= Date.parse(`${input.period.since}T00:00:00+05:30`) ? offsetInsightDate(anchorDay, 1) : input.period.since;
  const period = { since, until: input.period.until };
  const completeDays = Math.max(0, Math.min(7, Math.round((Date.parse(`${period.until}T00:00:00Z`) - Date.parse(`${period.since}T00:00:00Z`)) / 86400000) + 1));
  let metrics = insightTotals(input.assessment);
  if (since > input.period.since) {
    const days = calendarDaily(input.daily, period);
    const summed = days.reduce((acc, row) => ({ spend: acc.spend + row.spend, impressions: acc.impressions + row.impressions, clicks: acc.clicks + row.clicks, links: acc.links + row.linkClicks, leads: acc.leads + row.leads }), { spend: 0, impressions: 0, clicks: 0, links: 0, leads: 0 });
    metrics = insightTotals({ spend: String(summed.spend), impressions: String(summed.impressions), clicks: String(summed.clicks), inline_link_clicks: String(summed.links), actions: [{ action_type: "lead", value: String(summed.leads) }] });
    // Unique reach for an adjusted window cannot be derived from daily reach.
  }
  const raw = ad.raw_payload || {}, setId = raw.adset?.id || raw.adset_id;
  const sharedBudget = raw.budget_source === "campaign" || input.allAds.filter(item => (item.raw_payload?.adset?.id || item.raw_payload?.adset_id) === setId && setId).length > 1;
  const latestChange = completed[0];
  return {
    ...evaluateAdHealth({ status: ad.status, now, startsAt: ad.starts_at, endsAt: ad.ends_at,
      available: input.available, statusFresh: validTime(ad.last_synced_at) > now - 45*60000,
      metrics, previous: insightTotals(input.previous), completeDays, period,
      comparableWeeks: anchor > 0 && anchor < Date.parse(`${input.previousPeriod.since}T00:00:00+05:30`),
      dailyBudget: Number(ad.daily_budget || 0), sharedBudget, targetingReview: raw.targeting_check?.state === "review_required",
      targetCpl: Number(policy.target_cpl), spendWithoutLead: Number(policy.spend_without_lead), cplWarningMultiplier: Number(policy.cpl_warning_multiplier),
      lastChangeAt: latestChange?.at || null, lastChangeLabel: latestChange?.label || null
    }), history: history.slice(0, 5)
  };
}
