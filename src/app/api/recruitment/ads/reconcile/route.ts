import { NextResponse } from "next/server";
import { getConnectionConfig } from "@/lib/connection-config";
import { syncMetaAds } from "@/lib/meta-ingestion";
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
    const result = await syncMetaAds({
      accessToken: config.secrets.access_token,
      adAccountId: config.publicConfig.ad_account_id,
      graphVersion: config.publicConfig.graph_version || "v25.0",
      reconcileMissing: true
    });
    return NextResponse.json({ reconciled: true, ...result });
  } catch (error) {
    console.error("Recruitment Meta ad reconciliation failed", error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Unable to reconcile Meta ads."
    }, { status: 500 });
  }
}
