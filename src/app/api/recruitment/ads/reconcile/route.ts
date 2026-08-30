import { NextResponse } from "next/server";
import { getConnectionConfig } from "@/lib/connection-config";
import { syncMetaAds } from "@/lib/meta-ingestion";
import { setMetaObjectName } from "@/lib/meta-ad-builder";
import { canUseRecruitmentMenu, recruitmentSession } from "@/lib/recruitment-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const session = await recruitmentSession(request);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const stream = body.stream === "hr" ? "hr" : "workforce";
    if (!canUseRecruitmentMenu(session, "Active Ads", "all", stream)) {
      return NextResponse.json({ error: "Full Active Ads access is required to reconcile Meta." }, { status: 403 });
    }
    const config = await getConnectionConfig("meta");
    if (!config?.isEnabled || !config.secrets.access_token || !config.publicConfig.ad_account_id) {
      return NextResponse.json({ error: "Meta advertising is not fully connected." }, { status: 409 });
    }
    let result = await syncMetaAds({
      accessToken: config.secrets.access_token,
      adAccountId: config.publicConfig.ad_account_id,
      graphVersion: config.publicConfig.graph_version || "v25.0",
      reconcileMissing: true
    });
    const repairMetaAdId = String(body.repairMetaAdId || "").trim();
    let repaired: { metaAdId: string; oldName: string; newName: string } | null = null;
    if (repairMetaAdId) {
      const mismatch = result.mappingMismatches.find((item) => item.metaAdId === repairMetaAdId);
      if (!mismatch) {
        return NextResponse.json({ error: "The selected Meta ad no longer has a station mismatch." }, { status: 409 });
      }
      const liveState = String(mismatch.effectiveStatus || mismatch.configuredStatus || "").toUpperCase();
      if (liveState === "ACTIVE") {
        return NextResponse.json({ error: "Pause the mismatched Meta ad before correcting its station name." }, { status: 409 });
      }
      const relatedStations = [...new Set([mismatch.adsetStation, mismatch.campaignStation].filter(Boolean))];
      if (relatedStations.length !== 1) {
        return NextResponse.json({ error: "Campaign and ad-set station names do not agree; review this ad manually in Meta." }, { status: 409 });
      }
      const targetStation = relatedStations[0] as string;
      const escaped = mismatch.adStation.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const nextName = mismatch.adName.replace(new RegExp(`^${escaped}(?=[^A-Z0-9]|$)`, "i"), targetStation);
      if (nextName === mismatch.adName) {
        return NextResponse.json({ error: "The mismatched station prefix could not be corrected safely." }, { status: 409 });
      }
      await setMetaObjectName(mismatch.metaAdId, nextName);
      repaired = { metaAdId: mismatch.metaAdId, oldName: mismatch.adName, newName: nextName };
      result = await syncMetaAds({
        accessToken: config.secrets.access_token,
        adAccountId: config.publicConfig.ad_account_id,
        graphVersion: config.publicConfig.graph_version || "v25.0",
        reconcileMissing: true
      });
    }
    return NextResponse.json({ reconciled: true, repaired, ...result });
  } catch (error) {
    console.error("Recruitment Meta ad reconciliation failed", error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Unable to reconcile Meta ads."
    }, { status: 500 });
  }
}
