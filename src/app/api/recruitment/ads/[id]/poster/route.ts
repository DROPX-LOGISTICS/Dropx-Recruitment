import { NextResponse } from "next/server";
import { getFreshMetaAdPoster } from "@/lib/meta-ingestion";
import { canAccessLead, canUseRecruitmentMenu, recruitmentSession, requiredEnv } from "@/lib/recruitment-api";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase is not configured.");
    const session = await recruitmentSession(request);
    if (!canUseRecruitmentMenu(session, "Active Ads", "view")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
    const result = await supabaseAdmin
      .from("recruitment_ads")
      .select("id,meta_ad_id,ad_name,poster_url,location_id,role_id,recruitment_roles(stream)")
      .eq("company_id", companyId)
      .eq("id", params.id)
      .maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) {
      return NextResponse.json({ error: "Ad not found." }, { status: 404 });
    }
    const role = Array.isArray(result.data.recruitment_roles)
      ? result.data.recruitment_roles[0]
      : result.data.recruitment_roles;
    if (!canAccessLead(session, {
      stream: role?.stream,
      location_id: result.data.location_id,
      role_id: result.data.role_id
    })) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    let url = "";
    if (result.data.meta_ad_id) {
      url = await getFreshMetaAdPoster(result.data.meta_ad_id);
      await supabaseAdmin
        .from("recruitment_ads")
        .update({ poster_url: url, updated_at: new Date().toISOString() })
        .eq("company_id", companyId)
        .eq("id", result.data.id);
    } else if (result.data.poster_url) {
      const parsed = new URL(result.data.poster_url);
      if (parsed.protocol !== "https:") throw new Error("The saved poster URL is invalid.");
      url = parsed.toString();
    }

    if (!url) {
      return NextResponse.json({ error: "No poster is available for this ad." }, { status: 404 });
    }
    return NextResponse.json(
      { url, adName: result.data.ad_name },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } }
    );
  } catch (error) {
    console.error("Recruitment ad poster refresh failed", error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Unable to load the poster."
    }, { status: 502 });
  }
}
