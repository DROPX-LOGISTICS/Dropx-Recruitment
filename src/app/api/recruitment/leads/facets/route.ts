import { NextResponse } from "next/server";
import { canUseRecruitmentMenu, recruitmentSession, requiredEnv } from "@/lib/recruitment-api";
import { resolveLeadMenu } from "@/lib/lead-queue-menu";
import { loadLeadFacetSummary } from "@/lib/lead-facet-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const session = await recruitmentSession(request);
    if (!session) return NextResponse.json({error: "Unauthorized"}, {status: 401});
    const url = new URL(request.url);
    const stream = url.searchParams.get("stream");
    const menu = resolveLeadMenu(url);
    if ((stream !== "workforce" && stream !== "hr") || !menu || !canUseRecruitmentMenu(session, menu, "view", stream)) {
      return NextResponse.json({error: "View access to this Recruitment queue is required."}, {status: 403});
    }
    // resolveLeadMenu also handles older clients that don't send a menu.
    url.searchParams.set("menu", menu);
    const groups = await loadLeadFacetSummary(session, url, requiredEnv("RECRUITMENT_COMPANY_ID"), stream);
    return NextResponse.json({groups}, {headers: {"Cache-Control": "private, no-store"}});
  } catch (error) {
    console.error("Recruitment lead filter summary failed", error);
    return NextResponse.json({error: "Unable to update filter choices."}, {status: 500});
  }
}
