export type MetaFormLead = {
  id?: string;
  created_time?: string;
  ad_id?: string;
  form_id?: string;
};

type MetaFormLeadPage = {
  data?: MetaFormLead[];
  paging?: { next?: string };
  error?: { message?: string };
};

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type MetaFormLeadDelta = {
  leads: MetaFormLead[];
  pages: number;
  truncated: boolean;
  oldestCreatedAt: string | null;
};

/**
 * Reads every lead page that overlaps the polling watermark. Meta returns form
 * leads newest first, so reaching an item older than the watermark is a safe
 * stopping point. A bounded page limit is retained only as a fail-closed guard:
 * callers must treat `truncated` as an ingestion failure instead of silently
 * discarding the remaining leads.
 */
export async function fetchMetaFormLeadsSince(options: {
  formId: string;
  graphVersion: string;
  accessToken: string;
  since: Date;
  maxPages?: number;
  fetchImpl?: FetchLike;
}): Promise<MetaFormLeadDelta> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxPages = Math.max(1, options.maxPages ?? 50);
  let next: string | null = `https://graph.facebook.com/${options.graphVersion}/${encodeURIComponent(options.formId)}/leads`;
  const leads: MetaFormLead[] = [];
  const seen = new Set<string>();
  let pages = 0;
  let reachedWatermark = false;
  let oldestCreatedAt: string | null = null;

  while (next && pages < maxPages) {
    const endpoint = new URL(next);
    if (pages === 0) {
      endpoint.searchParams.set("fields", "id,created_time,ad_id,form_id");
      endpoint.searchParams.set("limit", "100");
    }
    const response = await fetchImpl(endpoint, {
      headers: { Authorization: `Bearer ${options.accessToken}` },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000)
    });
    const payload = await response.json() as MetaFormLeadPage;
    if (!response.ok || payload.error) {
      throw new Error(payload.error?.message || `Meta form ${options.formId} returned HTTP ${response.status}.`);
    }

    pages++;
    const pageLeads = payload.data ?? [];
    for (const lead of pageLeads) {
      const createdAt = lead.created_time ? new Date(lead.created_time) : null;
      if (createdAt && Number.isFinite(createdAt.getTime())) {
        const iso = createdAt.toISOString();
        if (!oldestCreatedAt || iso < oldestCreatedAt) oldestCreatedAt = iso;
        if (createdAt < options.since) {
          reachedWatermark = true;
          continue;
        }
      }
      if (!lead.id || seen.has(lead.id)) continue;
      seen.add(lead.id);
      leads.push(lead);
    }

    next = reachedWatermark ? null : payload.paging?.next ?? null;
  }

  return {
    leads,
    pages,
    truncated: Boolean(next && !reachedWatermark),
    oldestCreatedAt
  };
}

export function mergeMetaFormIds(...groups: Array<Iterable<string>>) {
  const merged = new Set<string>();
  for (const group of groups) {
    for (const value of group) {
      const id = String(value ?? "").trim();
      if (/^\d{5,30}$/.test(id)) merged.add(id);
    }
  }
  return [...merged];
}
