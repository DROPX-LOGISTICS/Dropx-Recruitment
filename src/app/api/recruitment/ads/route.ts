import { NextResponse } from "next/server";
import { canAccessLead, canUseRecruitmentMenu, recruitmentSession, requiredEnv } from "@/lib/recruitment-api";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function adWithinScope(session: NonNullable<Awaited<ReturnType<typeof recruitmentSession>>>, ad: any, stream: string | null) {
  const role = Array.isArray(ad.recruitment_roles) ? ad.recruitment_roles[0] : ad.recruitment_roles;
  const location = Array.isArray(ad.recruitment_locations) ? ad.recruitment_locations[0] : ad.recruitment_locations;
  const adStream = String(role?.stream || "");
  if (stream && adStream !== stream) return false;
  return canAccessLead(session, {
    stream: adStream,
    location_id: location?.id ?? ad.location_id,
    role_id: role?.id ?? ad.role_id
  });
}

export async function GET(request: Request) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase is not configured.");
    const session = await recruitmentSession(request);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
    const url = new URL(request.url);
    const stream = url.searchParams.get("stream");
    if (stream && !["workforce", "hr"].includes(stream)) {
      return NextResponse.json({ error: "Invalid recruitment workspace." }, { status: 400 });
    }
    if (!canUseRecruitmentMenu(session, "Active Ads", "view", stream as "workforce" | "hr" | undefined)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const result = await supabaseAdmin
      .from("recruitment_ads")
      .select("id,meta_ad_id,ad_name,adset_name,campaign_name,location_id,role_id,route_status,status,daily_budget,total_spend,poster_url,created_on,last_synced_at,raw_payload,recruitment_locations(id,code,name,cluster),recruitment_roles(id,code,name,stream)")
      .eq("company_id", companyId)
      .order("last_synced_at", { ascending: false })
      .limit(500);
    if (result.error) throw result.error;
    const ads = (result.data ?? []).filter((ad) => adWithinScope(session, ad, stream));
    const visibleAdIds = new Set(ads.map((ad) => ad.id));
    const counts = new Map<string, number>();
    const leadTotal = await supabaseAdmin.from("recruitment_leads")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .not("ad_id", "is", null);
    if (leadTotal.error) throw leadTotal.error;
    const leadPages = await Promise.all(Array.from(
      { length: Math.ceil((leadTotal.count ?? 0) / 1000) },
      (_, page) => supabaseAdmin!.from("recruitment_leads")
        .select("ad_id")
        .eq("company_id", companyId)
        .not("ad_id", "is", null)
        .range(page * 1000, page * 1000 + 999)
    ));
    const failedPage = leadPages.find((page) => page.error);
    if (failedPage?.error) throw failedPage.error;
    for (const page of leadPages) {
      for (const lead of page.data ?? []) {
        if (lead.ad_id && visibleAdIds.has(lead.ad_id)) {
          counts.set(lead.ad_id, (counts.get(lead.ad_id) ?? 0) + 1);
        }
      }
    }
    const numberFrom = (payload: unknown, keys: string[]) => {
      const source = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
      for (const key of keys) {
        const value = Number(source[key]);
        if (Number.isFinite(value)) return value;
      }
      return 0;
    };
    return NextResponse.json({
      ads: ads.map((ad) => ({
          ...ad,
          lead_count: counts.get(ad.id) ?? 0,
          reach: numberFrom(ad.raw_payload, ["reach", "total_reach"]),
          impressions: numberFrom(ad.raw_payload, ["impressions", "total_impressions"]),
          raw_payload: undefined
        })),
      permissions: session.adRequestActions,
      stream
    });
  } catch (error) {
    console.error("Recruitment ads failed", error);
    return NextResponse.json({ error: "Unable to load ads." }, { status: 500 });
  }
}
