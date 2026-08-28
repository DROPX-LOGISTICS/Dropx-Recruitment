import { NextResponse } from "next/server";
import { canUseRecruitmentMenu, recruitmentSession, requiredEnv } from "@/lib/recruitment-api";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { fetchRecentMetaInsights, metaLeadActions } from "@/lib/meta-ad-insights";
import { defaultGuardPolicy, evaluateAdGuard } from "@/lib/ad-spend-guard";
import { enhanceGuardRecommendations } from "@/lib/ad-spend-guard-ai";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function adWithinScope(session: NonNullable<Awaited<ReturnType<typeof recruitmentSession>>>, ad: any, stream: string | null) {
  const role = Array.isArray(ad.recruitment_roles) ? ad.recruitment_roles[0] : ad.recruitment_roles;
  const adStream = String(role?.stream || "");
  if (stream && adStream !== stream) return false;
  if (adStream === "workforce" && !session.workforce) return false;
  if (adStream === "hr" && !session.hr) return false;
  if (!session.allLocations && (!ad.location_id || !session.locationIds.includes(ad.location_id))) return false;
  if (session.roleIds.length && (!ad.role_id || !session.roleIds.includes(ad.role_id))) return false;
  return true;
}

export async function GET(request: Request) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase is not configured.");
    const session = await recruitmentSession(request);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const url = new URL(request.url);
    const stream = url.searchParams.get("stream");
    if (stream && !["workforce", "hr"].includes(stream)) {
      return NextResponse.json({ error: "Invalid recruitment workspace." }, { status: 400 });
    }
    if (!canUseRecruitmentMenu(session, "Active Ads", "view", stream as "workforce" | "hr" | undefined)
      && !(stream === "workforce" && canUseRecruitmentMenu(session, "Performance Center", "view", "workforce"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const companyId=requiredEnv("RECRUITMENT_COMPANY_ID");
    const ads = await supabaseAdmin.from("recruitment_ads")
      .select("id,meta_ad_id,status,daily_budget,created_on,last_synced_at,location_id,role_id,recruitment_roles(stream)")
      .eq("company_id", companyId)
      .not("meta_ad_id", "is", null);
    if (ads.error) throw new Error(ads.error.message);
    const allowedIds = new Set((ads.data ?? [])
      .filter((ad) => adWithinScope(session, ad, stream))
      .map((ad) => String(ad.meta_ad_id)));
    const visibleAds=(ads.data??[]).filter((ad)=>adWithinScope(session,ad,stream));
    const visibleDbIds=visibleAds.map((ad:any)=>ad.id);
    const [leadResult,policyResult]=await Promise.all([
      visibleDbIds.length?supabaseAdmin.from("recruitment_leads").select("ad_id,total_attempts,lead_created_at,created_at").eq("company_id",companyId).in("ad_id",visibleDbIds).eq("archived",false):Promise.resolve({data:[],error:null}),
      supabaseAdmin.from("recruitment_ad_guard_policies").select("*").eq("company_id",companyId).eq("enabled",true)
    ]);
    if(leadResult.error)throw leadResult.error;
    const policies=policyResult.error?[]:(policyResult.data??[]);
    const meta = await fetchRecentMetaInsights();
    const grouped = new Map<string, any[]>();
    for (const row of meta.rows) {
      if (!row.ad_id || !allowedIds.has(row.ad_id)) continue;
      grouped.set(row.ad_id, [...(grouped.get(row.ad_id) ?? []), row]);
    }
    const insights = Object.fromEntries([...grouped.entries()].map(([adId, rows]) => {
      const allDaily = rows.sort((a, b) => String(a.date_start || "").localeCompare(String(b.date_start || "")))
        .map((row) => ({
          date: row.date_start,
          spend: Number(row.spend || 0),
          reach: Number(row.reach || 0),
          impressions: Number(row.impressions || 0),
          clicks: Number(row.clicks || 0),
          leads: metaLeadActions(row)
        }));
      const daily=allDaily.slice(-7), previousDaily=allDaily.slice(-14,-7);
      const today = daily.find((row) => row.date === meta.today);
      const summarise=(source:typeof daily)=>source.reduce((summary, row) => ({
        spend: summary.spend + row.spend,
        reach: summary.reach + row.reach,
        impressions: summary.impressions + row.impressions,
        clicks: summary.clicks + row.clicks,
        leads: summary.leads + row.leads
      }), { spend: 0, reach: 0, impressions: 0, clicks: 0, leads: 0 });
      const period=summarise(daily), previous=summarise(previousDaily);
      return [adId, {
        today_spend: today?.spend ?? 0,
        today_reach: today?.reach ?? 0,
        today_impressions: today?.impressions ?? 0,
        today_clicks: today?.clicks ?? 0,
        today_meta_leads: today?.leads ?? 0,
        recent_spend: period.spend,
        recent_reach: period.reach,
        recent_impressions: period.impressions,
        recent_clicks: period.clicks,
        recent_meta_leads: period.leads,
        previous_spend:previous.spend,
        previous_clicks:previous.clicks,
        previous_meta_leads:previous.leads,
        recent_daily: daily
      }];
    }));
    const now=Date.now();
    const leadMetrics=new Map<string,{total:number;unattempted:number;unattemptedAges:number[]}>();
    for(const lead of leadResult.data??[]){const m=leadMetrics.get(lead.ad_id)||{total:0,unattempted:0,unattemptedAges:[]};m.total++;if(Number(lead.total_attempts||0)===0){m.unattempted++;m.unattemptedAges.push(now-new Date(lead.lead_created_at||lead.created_at).getTime());}leadMetrics.set(lead.ad_id,m);}
    const guardRows=visibleAds.map((ad:any)=>{
      const insight=insights[String(ad.meta_ad_id)]||{};const leads=leadMetrics.get(ad.id)||{total:0,unattempted:0,unattemptedAges:[]};
      const role=Array.isArray(ad.recruitment_roles)?ad.recruitment_roles[0]:ad.recruitment_roles;
      const policy={...defaultGuardPolicy,...policies.find((p:any)=>!p.location_id&&!p.role_id&&(!p.stream||p.stream===role?.stream)),...policies.find((p:any)=>p.location_id===ad.location_id&&p.role_id===ad.role_id)};
      const stale=leads.unattemptedAges.filter((age:number)=>age>Number(policy.response_sla_minutes)*60000).length;
      return{ad,result:evaluateAdGuard({status:ad.status,recentSpend:Number(insight.recent_spend||0),recentLeads:Number(insight.recent_meta_leads||0),previousSpend:Number(insight.previous_spend||0),previousLeads:Number(insight.previous_meta_leads||0),dashboardLeads:leads.total,unattempted:leads.unattempted,staleUnattempted:stale,ageDays:Math.max(0,Math.floor((now-new Date(ad.created_on||now).getTime())/86400000)),clicks:Number(insight.recent_clicks||0),impressions:Number(insight.recent_impressions||0),dailyBudget:Number(ad.daily_budget||0),syncFresh:Boolean(ad.last_synced_at&&now-new Date(ad.last_synced_at).getTime()<259200000)},policy)};
    });
    const risky=guardRows.filter(x=>["critical","warning"].includes(x.result.severity)).slice(0,12);
    const ai=await enhanceGuardRecommendations(risky.map(({ad,result}:any)=>{const role=Array.isArray(ad.recruitment_roles)?ad.recruitment_roles[0]:ad.recruitment_roles;return{id:String(ad.meta_ad_id),ad:String(ad.meta_ad_id),station:String(ad.location_id||"unmapped"),role:String(role?.stream||"unknown"),result};}));
    const recommendations=Object.fromEntries(guardRows.map(({ad,result}:any)=>{const enhancement=ai?.get(String(ad.meta_ad_id));return[String(ad.meta_ad_id),{...result,...(enhancement||{}),aiEnhanced:Boolean(enhancement)}];}));
    return NextResponse.json({
      insightDate: meta.today,
      insightsAvailable: meta.available,
      insightsError: meta.error,
      insights,
      recommendations,
      privacy:{personalDataSentToAI:false,mode:"aggregated_metrics_only"}
    });
  } catch (error) {
    console.error("Recruitment ad insights failed", error);
    return NextResponse.json({ error: "Unable to refresh Meta ad insights." }, { status: 500 });
  }
}
