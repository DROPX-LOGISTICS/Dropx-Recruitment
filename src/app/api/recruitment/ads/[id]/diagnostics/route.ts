import { NextResponse } from "next/server";
import { getConnectionConfig } from "@/lib/connection-config";
import { scopedRecruitmentAd } from "@/lib/scoped-recruitment-ad";
import { metaDeliveryStatus } from "@/lib/meta-ad-delivery";
import { resolveRecruitmentAdAudience } from "@/lib/recruitment-ad-audience";
import { reviewStationTargeting } from "@/lib/meta-targeting";
import { extractMetaFormIds } from "@/lib/meta-ingestion";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: Request, {params}:{params:{id:string}}) {
  try {
    const scoped = await scopedRecruitmentAd(request,params.id);
    if ("error" in scoped) return scoped.error;
    if (!scoped.ad.meta_ad_id) return NextResponse.json({error:"This record has no Meta ad."},{status:409});
    const config = await getConnectionConfig("meta");
    if (!config?.isEnabled || !config.secrets.access_token) return NextResponse.json({error:"Meta is not connected."},{status:409});
    const fields = "id,name,account_id,status,effective_status,issues_info,ad_review_feedback,creative{id,object_story_spec},adset{id,name,status,effective_status,start_time,end_time,daily_budget,lifetime_budget,targeting,optimization_goal,bid_strategy,bid_amount,learning_stage_info},campaign{id,name,status,effective_status,daily_budget,lifetime_budget}";
    const response = await fetch(`https://graph.facebook.com/${config.publicConfig.graph_version || "v25.0"}/${encodeURIComponent(scoped.ad.meta_ad_id)}?fields=${encodeURIComponent(fields)}`,{headers:{Authorization:`Bearer ${config.secrets.access_token}`},cache:"no-store",signal:AbortSignal.timeout(25000)});
    const ad = await response.json();
    if (!response.ok || ad.error) throw new Error(ad.error?.error_user_msg || ad.error?.message || "Meta could not return this ad.");
    const checks: Array<{label:string;value:string;detail:string;tone:string}> = [];
    const state = metaDeliveryStatus(ad);
    for (const [label,entity] of [["Ad",ad],["Ad set",ad.adset],["Campaign",ad.campaign]] as const) checks.push({label:`${label} delivery`,value:label === "Ad" ? state : String(entity?.effective_status || entity?.status || "Unavailable"),detail:entity?.name || "Meta did not return this parent.",tone:(label === "Ad" ? state : entity?.effective_status || entity?.status) === "ACTIVE" ? "good" : "review"});
    const budgetOwner = Number(ad.campaign?.daily_budget || ad.campaign?.lifetime_budget) > 0 ? ad.campaign : ad.adset;
    const campaignBudget = budgetOwner === ad.campaign;
    const amount = Number(budgetOwner?.daily_budget || budgetOwner?.lifetime_budget || 0)/100;
    checks.push({label:"Budget allocation",value:amount ? `₹${amount.toLocaleString("en-IN")}${budgetOwner.daily_budget ? "/day" : " lifetime"}` : "Not returned",detail:campaignBudget ? "Campaign budget. Meta allocates spend across its ad sets; the full amount is not guaranteed to this ad." : "Ad-set budget. Other ads in this set may share its delivery.",tone:"info"});
    checks.push({label:"Delivery goal",value:String(ad.adset?.optimization_goal || "Not returned").replaceAll("_"," "),detail:"The delivery goal affects whom Meta tries to reach. Lead optimisation does not maximise raw impressions.",tone:"info"});
    const learning = ad.adset?.learning_stage_info?.status;
    checks.push({label:"Learning / bidding",value:learning || ad.adset?.bid_strategy || "No specific restriction returned",detail:"A missing learning or bid warning does not prove that delivery is unrestricted. Inspect Ads Manager for account, payment and auction details.",tone:learning ? "review" : "info"});
    try {
      const audience = await resolveRecruitmentAdAudience({companyId:scoped.companyId,locationId:scoped.ad.location_id});
      const check = reviewStationTargeting(ad.adset?.targeting,audience);
      const pins = ad.adset?.targeting?.geo_locations?.custom_locations;
      checks.push({label:"Station location",value:check.state === "matched" ? `${audience.stationCode}: pin matches` : `${audience.stationCode}: review needed`,detail:`Location Master ${audience.latitude.toFixed(5)}, ${audience.longitude.toFixed(5)}.${check.distanceKm != null ? ` Live pin is ${check.distanceKm} km away.` : " Meta uses an area audience or did not supply one pin."}${pins?.[0]?.radius ? ` Radius ${pins[0].radius} ${pins[0].distance_unit || "km"}.` : ""}`,tone:check.state === "matched" ? "good" : "review"});
    } catch(error) { checks.push({label:"Station location",value:"Cannot verify",detail:error instanceof Error ? error.message : "Station reference unavailable.",tone:"review"}); }
    const forms = extractMetaFormIds(ad.creative);
    const story = ad.creative?.object_story_spec?.link_data;
    checks.push({label:"Instant form",value:forms.length ? forms.join(", ") : "No instant form returned",detail:forms.length ? "Verify this form's role, questions and offer in Meta before replacing it. Link clicks include people who may not open or finish the form." : "Check the ad's destination in Meta; this creative may use another format.",tone:forms.length ? "info" : "review"});
    if (story?.link) checks.push({label:"Destination",value:String(story.link),detail:"Confirm the destination matches the role and offer in the poster.",tone:"info"});
    const feedback = [...(Array.isArray(ad.issues_info) ? ad.issues_info : []), ...(ad.ad_review_feedback ? [ad.ad_review_feedback] : [])];
    if (feedback.length) checks.push({label:"Meta feedback",value:"Review Meta's feedback",detail:feedback.map(item => typeof item === "string" ? item : JSON.stringify(item)).join(" · ").slice(0,2000),tone:"review"});
    return NextResponse.json({adName:ad.name,checkedAt:new Date().toISOString(),checks,
      metaUrl:`https://adsmanager.facebook.com/adsmanager/manage/ads?act=${encodeURIComponent(ad.account_id || config.publicConfig.ad_account_id?.replace(/^act_/,"") || "")}&selected_ad_ids=${encodeURIComponent(ad.id)}`,
      note:"These checks read Meta only. They do not pause, change or restart an ad. Meta may expose additional billing, review and auction details in Ads Manager."
    },{headers:{"Cache-Control":"private, no-store"}});
  } catch(error) { return NextResponse.json({error:error instanceof Error ? error.message : "Delivery checks failed."},{status:502}); }
}
