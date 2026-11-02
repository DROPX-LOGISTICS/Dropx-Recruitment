import { NextResponse } from "next/server";
import { canAccessLead, canUseRecruitmentMenu, recruitmentSession } from "@/lib/recruitment-api";
import { scopedRecruitmentAd } from "@/lib/scoped-recruitment-ad";
import { searchMetaAudienceLocations } from "@/lib/meta-ad-builder";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const url = new URL(request.url), query = (url.searchParams.get("q") || "").trim();
    if (query.length < 3 || query.length > 120) return NextResponse.json({ error: "Enter a city or PIN code (3–120 characters)." }, { status: 400 });
    const adId = url.searchParams.get("adId");
    if (adId) {
      const scoped = await scopedRecruitmentAd(request, adId, true);
      if ("error" in scoped) return scoped.error;
      if (scoped.session.readOnly || scoped.session.isPreview) return NextResponse.json({ error: "Exit preview first." }, { status: 403 });
    } else {
      const session = await recruitmentSession(request);
      const stream = url.searchParams.get("stream");
      if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      if (session.readOnly || session.isPreview || !["workforce", "hr"].includes(stream || "") || !(canUseRecruitmentMenu(session, "Active Ads", "all", stream as "hr" | "workforce") || session.adRequestActions.includes("publish")) || !canAccessLead(session, { stream, location_id: url.searchParams.get("locationId"), role_id: url.searchParams.get("roleId") })) return NextResponse.json({ error: "This station is outside your ad editing access." }, { status: 403 });
    }
    return NextResponse.json({ locations: await searchMetaAudienceLocations(query), source: "Meta" }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Location search is unavailable. Move the pin or enter coordinates." }, { status: 502 }); }
}
