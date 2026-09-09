import { storedAdDelivery } from "@/lib/meta-ad-delivery";
import { NextResponse } from "next/server";
import { canAccessLead, canUseRecruitmentMenu, recruitmentSession, requiredEnv } from "@/lib/recruitment-api";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { fetchRecentMetaInsights } from "@/lib/meta-ad-insights";
import { calendarDaily, insightTotals } from "@/lib/ad-insight-metrics";
import { adPolicy, buildHealthContext } from "@/lib/ad-health-context";
import { monitoringState } from "@/lib/ad-health";
import { recruitmentQueryPages } from "@/lib/recruitment-query-pages";
import { evaluateAdGuard } from "@/lib/ad-spend-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function adWithinScope(session: NonNullable<Awaited<ReturnType<typeof recruitmentSession>>>, ad: any, stream: string | null) {
  const role = Array.isArray(ad.recruitment_roles) ? ad.recruitment_roles[0] : ad.recruitment_roles;
  const adStream = String(role?.stream || "");
  if (stream && adStream !== stream) return false;
  return canAccessLead(session, {
    stream: adStream,
    location_id: ad.location_id,
    role_id: ad.role_id
  });
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
    const admin = supabaseAdmin;
    const allAds = await recruitmentQueryPages((from,to) => admin.from("recruitment_ads")
      .select("id,meta_ad_id,raw_payload,status,daily_budget,created_on,last_synced_at,location_id,role_id,recruitment_roles(stream)")
      .eq("company_id",companyId).not("meta_ad_id","is",null).order("id").range(from,to));
    const visibleAds = allAds.map(ad => storedAdDelivery(ad)).filter(ad => adWithinScope(session,ad,stream));
    const ids = visibleAds.map(ad => ad.id);
    const since = new Date(Date.now()-30*86400000).toISOString();
    const [leads, policiesResult, changes, requests, events, meta] = await Promise.all([
      ids.length ? recruitmentQueryPages((from,to) => admin.from("recruitment_leads").select("id,ad_id,total_attempts,lead_created_at,created_at")
        .eq("company_id",companyId).in("ad_id",ids).eq("archived",false).order("id").range(from,to)) : [],
      admin.from("recruitment_ad_guard_policies").select("*").eq("company_id",companyId).eq("enabled",true),
      ids.length ? recruitmentQueryPages((from,to) => admin.from("recruitment_ad_creative_changes").select("id,ad_id,status,created_at,completed_at")
        .eq("company_id",companyId).in("ad_id",ids).gte("created_at",since).order("id").range(from,to)) : [],
      ids.length ? recruitmentQueryPages((from,to) => admin.from("recruitment_ad_requests").select("id,ad_id,request_type,status,updated_at")
        .eq("company_id",companyId).in("ad_id",ids).gte("updated_at",since).order("id").range(from,to)) : [],
      ids.length ? recruitmentQueryPages((from,to) => admin.from("recruitment_ad_guard_events").select("id,ad_id,recommendation_code,evidence,reviewed_at,created_at,action_taken")
        .eq("company_id",companyId).in("ad_id",ids).eq("action_taken","monitor_48h").gte("created_at",since).order("id").range(from,to)) : [],
      fetchRecentMetaInsights()
    ]);
    if (policiesResult.error) throw policiesResult.error;
    const policies = policiesResult.data || [], now = Date.now();
    const insights: Record<string,any> = {}, recommendations: Record<string,any> = {}, health: Record<string,any> = {};
    for (const ad of visibleAds) {
      const metaId = String(ad.meta_ad_id), dailyRows = meta.rows.filter(row => row.ad_id === metaId);
      const recent = insightTotals(meta.recent.find(row => row.ad_id === metaId));
      const previous = insightTotals(meta.previous.find(row => row.ad_id === metaId));
      const today = insightTotals(dailyRows.find(row => row.date_start === meta.today));
      if (meta.available) insights[metaId] = {
        today_spend:today.spend,today_reach:today.reach,today_impressions:today.impressions,today_clicks:today.clicks,today_meta_leads:today.leads,
        recent_spend:recent.spend,recent_reach:recent.reach,recent_impressions:recent.impressions,recent_clicks:recent.clicks,
        recent_link_clicks:recent.linkClicks,recent_link_ctr:recent.linkCtr,recent_frequency:recent.frequency,recent_cpm:recent.cpm,recent_meta_leads:recent.leads,
        previous_spend:previous.spend,previous_clicks:previous.clicks,previous_meta_leads:previous.leads,
        recent_daily:calendarDaily(dailyRows,meta.periods.recent)
      };
      const policy = adPolicy(ad,policies), adLeads = leads.filter(lead => lead.ad_id === ad.id);
      const unattempted = adLeads.filter(lead => Number(lead.total_attempts||0) === 0);
      const stale = unattempted.filter(lead => now-Date.parse(lead.lead_created_at||lead.created_at) > Number(policy.response_sla_minutes)*60000);
      // Lead follow-up has its own result, so acquisition issues cannot hide the response backlog.
      const followup = evaluateAdGuard({ status:ad.status,recentSpend:0,recentLeads:0,dashboardLeads:adLeads.length,
        unattempted:unattempted.length,staleUnattempted:stale.length,ageDays:0,clicks:0,syncFresh:true },policy);
      if (followup.action === "assign_leads") recommendations[metaId] = { ...followup, evidence:{...followup.evidence,recentSpend:recent.spend,recentLeads:recent.leads},aiEnhanced:false };
      const result = buildHealthContext({ ad, allAds, daily:dailyRows, assessment:meta.assessment.find(row => row.ad_id === metaId),
        previous:meta.previous.find(row => row.ad_id === metaId), period:meta.periods.assessment,previousPeriod:meta.periods.previous,
        available:meta.available,now,policy,changes:changes.filter(item => item.ad_id === ad.id),requests:requests.filter(item => item.ad_id === ad.id) });
      const latestEvents = new Map<string,any>();
      events.filter(event => event.ad_id === ad.id).sort((a,b) => Date.parse(b.created_at)-Date.parse(a.created_at)).forEach(event => {
        if (!latestEvents.has(event.recommendation_code)) latestEvents.set(event.recommendation_code,event);
      });
      health[metaId] = { ...result, monitoring:[...latestEvents.values()].map(event => ({
        id:event.id,code:event.recommendation_code,reviewedAt:event.reviewed_at,reviewAfter:event.evidence?.reviewAfter,
        state:monitoringState(event,result,now)
      })) };
    }
    return NextResponse.json({ insightDate:meta.today,insightsAvailable:meta.available,insightsError:meta.error,
      insights,recommendations,health,assessmentPeriod:meta.periods.assessment,previousPeriod:meta.periods.previous,
      fetchedAt:meta.fetchedAt,privacy:{personalDataSentToAI:false,mode:"deterministic_metrics"}
    }, { headers:{"Cache-Control":"private, no-store, max-age=0"} });
  } catch (error) {
    console.error("Recruitment ad insights failed", error);
    return NextResponse.json({ error: "Unable to refresh Meta ad insights." }, { status: 500 });
  }
}
