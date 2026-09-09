export type MetaInsightRow = {
  ad_id?: string; spend?: string; reach?: string; impressions?: string; clicks?: string;
  inline_link_clicks?: string; frequency?: string;
  actions?: Array<{ action_type?: string; value?: string }>;
  date_start?: string; date_stop?: string;
};
export type InsightPeriod = { since: string; until: string };
export const metricNumber = (value: unknown) => Math.max(0, Number.isFinite(Number(value)) ? Number(value) : 0);

export function offsetInsightDate(day: string, offset: number) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
export function insightPeriods(today: string) {
  return {
    recent: { since: offsetInsightDate(today, -6), until: today },
    assessment: { since: offsetInsightDate(today, -7), until: offsetInsightDate(today, -1) },
    previous: { since: offsetInsightDate(today, -14), until: offsetInsightDate(today, -8) }
  };
}
/** These are overlapping Meta totals, not independent conversions to add together. */
export function metaLeadActions(row: MetaInsightRow) {
  for (const type of ["lead", "onsite_conversion.lead_grouped", "leadgen_grouped", "onsite_conversion.lead"]) {
    const action = row.actions?.find((item) => item.action_type === type);
    if (action) return metricNumber(action.value);
  }
  return 0;
}
export function insightTotals(row?: MetaInsightRow) {
  const impressions = metricNumber(row?.impressions);
  const spend = metricNumber(row?.spend);
  const leads = row ? metaLeadActions(row) : 0;
  const links = metricNumber(row?.inline_link_clicks ?? row?.actions?.find((a) => a.action_type === "link_click")?.value);
  // A missing row means zero delivery. A missing reach field on a delivered row means unavailable.
  const reach = !row || impressions === 0 ? 0 : row.reach == null ? null : metricNumber(row.reach);
  return {
    spend, impressions, reach, clicks: metricNumber(row?.clicks), linkClicks: links, leads,
    cpm: impressions ? spend / impressions * 1000 : null,
    cpl: leads ? spend / leads : null,
    linkCtr: impressions ? links / impressions * 100 : null,
    clickToLead: links ? leads / links * 100 : null,
    frequency: reach ? impressions / reach : null
  };
}
export type InsightTotals = ReturnType<typeof insightTotals>;
/** Meta omits zero-delivery days. Select calendar dates, never the last seven returned rows. */
export function calendarDaily(rows: MetaInsightRow[], period: InsightPeriod) {
  const byDay = new Map(rows.map((row) => [row.date_start, row]));
  const result = [];
  for (let day = period.since; day <= period.until; day = offsetInsightDate(day, 1)) result.push({ date: day, ...insightTotals(byDay.get(day)) });
  return result;
}
