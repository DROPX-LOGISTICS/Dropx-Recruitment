import { NextResponse } from "next/server";
import { scopedRecruitmentAd } from "@/lib/scoped-recruitment-ad";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { fetchRecentMetaInsights } from "@/lib/meta-ad-insights";
import { insightTotals } from "@/lib/ad-insight-metrics";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
const codes = new Set(["data_unavailable","status_stale","targeting_review","ending_soon","delivery_blocked","new_run_observation","no_delivery","low_delivery","spend_no_leads","high_cpl","rising_cpm","low_exposure","audience_fatigue","weak_response","form_conversion","lead_decline"]);
export async function POST(request:Request,{params}:{params:{id:string}}) {
  try {
    const scoped = await scopedRecruitmentAd(request,params.id,true);
    if ("error" in scoped) return scoped.error;
    const body = await request.json();
    if (!["monitor","review_now"].includes(body.action || "monitor") || !codes.has(body.code) || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestId || "")) return NextResponse.json({error:"Reopen this recommendation and try again."},{status:400});
    const prior = await supabaseAdmin!.from("recruitment_ad_guard_events").select("id,ad_id,evidence").eq("company_id",scoped.companyId).eq("id",body.requestId).maybeSingle();
    if (prior.error) throw prior.error;
    if (prior.data) {
      if (prior.data.ad_id !== scoped.ad.id) return NextResponse.json({error:"Request reference already used."},{status:409});
      return NextResponse.json({monitored:true,reviewAfter:prior.data.evidence?.reviewAfter});
    }
    const meta = await fetchRecentMetaInsights(), now = new Date();
    const reviewAfter = new Date(now.getTime()+(body.action === "review_now" ? 0 : 48*3600000)).toISOString();
    const saved = await supabaseAdmin!.from("recruitment_ad_guard_events").insert({id:body.requestId,company_id:scoped.companyId,ad_id:scoped.ad.id,
      severity:"opportunity",recommendation_code:body.code,state:"acknowledged",action_taken:"monitor_48h",
      actor_profile_id:scoped.session.profileId,reviewed_at:now.toISOString(),
      explanation:body.action === "review_now" ? "Returned to review; no ad settings changed." : "Watch for 48 hours; no delivery, creative or budget change applied.",
      evidence:{reviewAfter,endedEarly:body.action === "review_now",period:meta.periods.assessment,baseline:meta.available ? insightTotals(meta.assessment.find(row => row.ad_id === scoped.ad.meta_ad_id)) : null}});
    if (saved.error) {
      if (saved.error.code !== "23505") throw saved.error;
      const replay = await supabaseAdmin!.from("recruitment_ad_guard_events").select("evidence")
        .eq("company_id",scoped.companyId).eq("ad_id",scoped.ad.id).eq("id",body.requestId).maybeSingle();
      if (replay.error || !replay.data) return NextResponse.json({error:"Request reference already used. Refresh and try again."},{status:409});
      return NextResponse.json({monitored:true,reviewAfter:replay.data.evidence?.reviewAfter});
    }
    return NextResponse.json({monitored:true,reviewAfter});
  } catch(error) { return NextResponse.json({error:error instanceof Error ? error.message : "Unable to save monitoring."},{status:500}); }
}
