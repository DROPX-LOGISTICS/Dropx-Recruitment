import { getConnectionConfig } from "./connection-config";

export type MetaInsightRow = {
  ad_id?: string;
  spend?: string;
  reach?: string;
  impressions?: string;
  clicks?: string;
  ctr?: string;
  cpc?: string;
  cpm?: string;
  actions?: Array<{ action_type?: string; value?: string }>;
  date_start?: string;
};

function istDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function offsetDate(day: string, offset: number) {
  const value = new Date(`${day}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}

export function metaLeadActions(row: MetaInsightRow) {
  const accepted = new Set([
    "lead",
    "onsite_conversion.lead_grouped",
    "onsite_conversion.lead",
    "leadgen_grouped"
  ]);
  return (row.actions ?? []).reduce((sum, action) =>
    accepted.has(String(action.action_type || "")) ? sum + Number(action.value || 0) : sum
  , 0);
}

export async function fetchRecentMetaInsights() {
  const today = istDate();
  const config = await getConnectionConfig("meta");
  if (!config?.isEnabled || !config.secrets.access_token || !config.publicConfig.ad_account_id) {
    return { today, rows: [] as MetaInsightRow[], available: false, error: "Meta performance connection is not enabled." };
  }
  const account = config.publicConfig.ad_account_id.replace(/^act_/, "");
  const version = config.publicConfig.graph_version || "v25.0";
  let next: string | null = `https://graph.facebook.com/${version}/act_${encodeURIComponent(account)}/insights`;
  const rows: MetaInsightRow[] = [];
  try {
    for (let page = 0; next && page < 20; page++) {
      const endpoint = new URL(next);
      if (page === 0) {
        endpoint.searchParams.set("level", "ad");
        endpoint.searchParams.set("time_increment", "1");
        endpoint.searchParams.set("limit", "500");
        endpoint.searchParams.set("time_range", JSON.stringify({ since: offsetDate(today, -13), until: today }));
        endpoint.searchParams.set(
          "fields",
          "ad_id,spend,reach,impressions,clicks,ctr,cpc,cpm,actions,date_start"
        );
      }
      const response = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${config.secrets.access_token}` },
        cache: "no-store",
        signal: AbortSignal.timeout(20_000)
      });
      const payload = await response.json() as {
        data?: MetaInsightRow[];
        paging?: { next?: string };
        error?: { message?: string };
      };
      if (!response.ok || payload.error) {
        throw new Error(payload.error?.message || `Meta returned HTTP ${response.status}.`);
      }
      rows.push(...(payload.data ?? []));
      next = payload.paging?.next ?? null;
    }
    return { today, rows, available: true, error: null as string | null };
  } catch (error) {
    return {
      today,
      rows: [] as MetaInsightRow[],
      available: false,
      error: error instanceof Error ? error.message : "Meta performance could not be refreshed."
    };
  }
}
