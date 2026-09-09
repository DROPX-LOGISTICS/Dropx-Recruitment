import { createHash } from "node:crypto";
import { getConnectionConfig } from "./connection-config";
import { insightPeriods, type InsightPeriod, type MetaInsightRow } from "./ad-insight-metrics";
export { metaLeadActions } from "./ad-insight-metrics";
export type { MetaInsightRow } from "./ad-insight-metrics";

function istDate() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}
type InsightData = {
  today: string; periods: ReturnType<typeof insightPeriods>; rows: MetaInsightRow[];
  recent: MetaInsightRow[]; assessment: MetaInsightRow[]; previous: MetaInsightRow[];
  available: boolean; error: string | null; fetchedAt: string;
};
const cache = new Map<string, { expires: number; result: Promise<InsightData> }>();
export async function fetchRecentMetaInsights(): Promise<InsightData> {
  const today = istDate(), periods = insightPeriods(today);
  const empty = (error: string): InsightData => ({ today, periods, rows: [], recent: [], assessment: [], previous: [], available: false, error, fetchedAt: new Date().toISOString() });
  const config = await getConnectionConfig("meta");
  if (!config?.isEnabled || !config.secrets.access_token || !config.publicConfig.ad_account_id) return empty("Meta performance connection is not enabled.");
  const account = config.publicConfig.ad_account_id.replace(/^act_/, "");
  const version = config.publicConfig.graph_version || "v25.0";
  const token = config.secrets.access_token;
  const key = `${account}:${version}:${today}:${createHash("sha256").update(token).digest("hex")}`;
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.result;
  for (const [k, value] of cache) if (value.expires <= Date.now()) cache.delete(k);
  const result = (async () => {
    const deadline = AbortSignal.timeout(40_000);
    async function read(period: InsightPeriod, daily = false) {
      let next: string | null = `https://graph.facebook.com/${version}/act_${encodeURIComponent(account)}/insights`;
      const rows: MetaInsightRow[] = [];
      for (let page = 0; next && page < 20; page++) {
        const endpoint: URL = new URL(next);
        if (endpoint.origin !== "https://graph.facebook.com") throw new Error("Meta returned an invalid insights page.");
        if (page === 0) {
          endpoint.searchParams.set("level", "ad");
          if (daily) endpoint.searchParams.set("time_increment", "1");
          endpoint.searchParams.set("limit", "500");
          endpoint.searchParams.set("time_range", JSON.stringify(period));
          endpoint.searchParams.set("fields", "ad_id,spend,reach,impressions,clicks,inline_link_clicks,actions,date_start,date_stop");
        }
        const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: deadline });
        const payload = await response.json() as { data?: MetaInsightRow[]; paging?: { next?: string }; error?: { message?: string } };
        if (!response.ok || payload.error || !Array.isArray(payload.data)) throw new Error(payload.error?.message || `Meta returned HTTP ${response.status}.`);
        rows.push(...payload.data);
        next = payload.paging?.next ?? null;
      }
      if (next) throw new Error("Meta performance exceeded the page limit; incomplete results were discarded.");
      return rows;
    }
    try {
      // Unique reach must be requested for each period, never summed across days.
      const [rows, recent, assessment, previous] = await Promise.all([
        read({ since: periods.previous.since, until: today }, true),
        read(periods.recent), read(periods.assessment), read(periods.previous)
      ]);
      return { today, periods, rows, recent, assessment, previous, available: true, error: null, fetchedAt: new Date().toISOString() };
    } catch (error) { return empty(error instanceof Error ? error.message : "Meta performance could not be refreshed."); }
  })();
  cache.set(key, { expires: Date.now() + 120_000, result });
  const data = await result;
  if (!data.available) cache.delete(key);
  return data;
}
