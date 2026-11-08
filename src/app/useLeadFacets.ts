"use client";

import { useEffect, useMemo, useState } from "react";
import { buildDependentLeadFacets, facetSelections, type LeadFacetGroup } from "@/lib/lead-facets";
import { leadFacetContext } from "@/lib/lead-queue-query";

/** Summary fetches are independent of the table. Checkbox changes are local. */
export function useLeadFacets({params, enabled, token, requestHeaders, locations, revision}: {
  params: URLSearchParams; enabled: boolean; token: string; requestHeaders: (token: string) => Record<string, string>;
  locations: Array<{code: string; cluster?: string | null}>; revision: number;
}) {
  const context = leadFacetContext(params);
  const identity = `${token}:${context}`;
  const [result, setResult] = useState<{identity: string; groups: LeadFacetGroup[]} | null>(null);
  const [failure, setFailure] = useState<{identity: string; message: string} | null>(null);
  const [retry, setRetry] = useState(0);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (!enabled || !token) return;
    const controller = new AbortController();
    setPending(true);
    setFailure(null);
    // Coalesce typing, date changes, and the table's refresh into one request.
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/recruitment/leads/facets?${context}`, {headers: requestHeaders(token), cache: "no-store", signal: controller.signal});
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Unable to update filter choices.");
        if (!controller.signal.aborted) setResult({identity, groups: payload.groups});
      } catch (error) {
        if (!controller.signal.aborted) {
          setResult(null);
          setFailure({identity, message: error instanceof Error ? error.message : "Unable to update filter choices."});
        }
      } finally { if (!controller.signal.aborted) setPending(false); }
    }, 250);
    return () => {clearTimeout(timer); controller.abort();};
  }, [enabled, token, context, identity, revision, retry, requestHeaders]);
  const selectedKey = params.toString();
  const facets = useMemo(() => {
    if (!enabled || result?.identity !== identity) return null;
    return buildDependentLeadFacets(result.groups, facetSelections(new URLSearchParams(selectedKey)), new Map(locations.map(row => [row.code, row.cluster ?? null])));
  }, [enabled, result, identity, selectedKey, locations]);
  return {facets, loading: enabled && (pending || (!facets && failure?.identity !== identity)), error: failure?.identity === identity ? failure.message : "", retry: () => setRetry(value => value + 1)};
}
