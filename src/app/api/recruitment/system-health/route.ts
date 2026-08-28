import { NextResponse } from "next/server";
import { canUseRecruitmentMenu, recruitmentSession, requiredEnv } from "@/lib/recruitment-api";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { runSheetBridge } from "@/lib/sheet-bridge";
import { getConnectionConfig } from "@/lib/connection-config";
import { notificationRulesFromConfig } from "@/lib/recruitment-notifications";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function count(query: any) {
  return query.then((result: { count: number | null; error: { message: string } | null }) => {
    if (result.error) throw new Error(result.error.message);
    return result.count ?? 0;
  });
}

type LeadIdentityAuditRow = {
  id: string;
  meta_lead_id: string | null;
  normalized_phone: string | null;
  source: string | null;
  ad_name: string | null;
  created_at: string;
};

function duplicateProfile(values: Array<string | null>) {
  const groups = new Map<string, number>();
  for (const value of values) {
    if (!value) continue;
    groups.set(value, (groups.get(value) ?? 0) + 1);
  }
  let duplicateGroups = 0;
  let duplicateRows = 0;
  let excessRows = 0;
  for (const size of groups.values()) {
    if (size < 2) continue;
    duplicateGroups++;
    duplicateRows += size;
    excessRows += size - 1;
  }
  return { distinct: groups.size, duplicateGroups, duplicateRows, excessRows };
}

async function leadIdentityAudit(companyId: string) {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  const rows: LeadIdentityAuditRow[] = [];
  for (let start = 0; ; start += 1000) {
    const result = await supabaseAdmin.from("recruitment_leads")
      .select("id,meta_lead_id,normalized_phone,source,ad_name,created_at")
      .eq("company_id", companyId)
      .order("id", { ascending: true })
      .range(start, start + 999);
    if (result.error) throw new Error(result.error.message);
    rows.push(...((result.data ?? []) as LeadIdentityAuditRow[]));
    if ((result.data?.length ?? 0) < 1000) break;
  }

  const sourceCounts = new Map<string, number>();
  const phoneSources = new Map<string, Set<string>>();
  for (const row of rows) {
    const source = row.source || "unknown";
    sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1);
    if (row.normalized_phone) {
      const sources = phoneSources.get(row.normalized_phone) ?? new Set<string>();
      sources.add(source);
      phoneSources.set(row.normalized_phone, sources);
    }
  }
  const crossSourcePhones = [...phoneSources.values()].filter((sources) => sources.size > 1).length;
  const candidateKeys = rows.map((row) => row.normalized_phone
    ? `phone:${row.normalized_phone}`
    : row.meta_lead_id
      ? `meta:${row.meta_lead_id}`
      : `row:${row.id}`);

  return {
    totalRows: rows.length,
    sourceCounts: Object.fromEntries([...sourceCounts.entries()].sort()),
    metaLeadId: duplicateProfile(rows.map((row) => row.meta_lead_id)),
    phone: duplicateProfile(rows.map((row) => row.normalized_phone)),
    estimatedUniqueCandidates: new Set(candidateKeys).size,
    crossSourcePhones
  };
}

export async function GET(request: Request) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase is not configured.");
    const session = await recruitmentSession(request);
    if (!canUseRecruitmentMenu(session, "System Health", "view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
    const url = new URL(request.url);
    if (url.searchParams.get("audit") === "lead_identity") {
      return NextResponse.json({ audit: await leadIdentityAudit(companyId), generatedAt: new Date().toISOString() });
    }
    const base = () => supabaseAdmin!.from("recruitment_leads")
      .select("id", { count: "exact", head: true }).eq("company_id", companyId);
    const outbox = (status: string) => count(supabaseAdmin!.from("recruitment_whatsapp_outbox")
      .select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("status", status));

    const recentSince=new Date(Date.now()-15*60_000).toISOString();
    const activitySince=new Date(Date.now()-24*60*60_000).toISOString();
    const recentMetaEvents=await supabaseAdmin.from("recruitment_lead_source_events")
      .select("lead_id,meta_lead_id,ad_name,source_system,status,received_at")
      .eq("company_id",companyId).like("source_system","meta%")
      .gte("received_at",recentSince).order("received_at",{ascending:false}).limit(500);
    if(recentMetaEvents.error)throw recentMetaEvents.error;
    const [activityEvents,whatsappActivity,blockedActivity]=await Promise.all([
      supabaseAdmin.from("recruitment_lead_source_events")
        .select("lead_id,meta_lead_id,ad_name,source_system,status,received_at")
        .eq("company_id",companyId).like("source_system","meta%")
        .gte("received_at",activitySince).order("received_at",{ascending:false}).limit(5000),
      supabaseAdmin.from("recruitment_whatsapp_outbox")
        .select("lead_id,template_name,status,created_at,sent_at,delivered_at,failed_at,last_error")
        .eq("company_id",companyId).gte("created_at",activitySince).order("created_at",{ascending:false}).limit(5000),
      supabaseAdmin.from("recruitment_lead_history")
        .select("lead_id,remarks,created_at")
        .eq("company_id",companyId).eq("event_type","whatsapp_notification_blocked")
        .gte("created_at",activitySince).order("created_at",{ascending:false}).limit(5000)
    ]);
    const activityFailure=[activityEvents,whatsappActivity,blockedActivity].find((item)=>item.error);
    if(activityFailure?.error)throw activityFailure.error;
    const recentLeadIds=[...new Set((recentMetaEvents.data??[]).map((item)=>item.lead_id).filter(Boolean))] as string[];
    const activityLeadIds=[...new Set((activityEvents.data??[]).map((item)=>item.lead_id).filter(Boolean))] as string[];
    const activityLeads=activityLeadIds.length?await supabaseAdmin.from("recruitment_leads")
      .select("id,meta_lead_id,source,created_at,ad_name,recruitment_locations(code,name)").eq("company_id",companyId).in("id",activityLeadIds):{data:[],error:null};
    if(activityLeads.error)throw activityLeads.error;
    const activityLeadById=new Map((activityLeads.data??[]).map((lead)=>[lead.id,lead]));
    const recentLocationCounts=new Map<string,number>();
    for(const leadId of recentLeadIds){
      const lead=activityLeadById.get(leadId);if(!lead)continue;
      const relation=Array.isArray(lead.recruitment_locations)?lead.recruitment_locations[0]:lead.recruitment_locations;
      const code=(relation as {code?:string}|null)?.code||"Unmapped";
      recentLocationCounts.set(code,(recentLocationCounts.get(code)??0)+1);
    }
    const hourCounts=new Map<string,number>();
    const adCounts=new Map<string,{count:number;lastReceivedAt:string|null}>();
    const stationCounts=new Map<string,number>();
    for(const event of activityEvents.data??[]){
      const hour=`${String(event.received_at).slice(0,13)}:00:00.000Z`;
      hourCounts.set(hour,(hourCounts.get(hour)??0)+1);
      const ad=event.ad_name||"Unmapped";const current=adCounts.get(ad)??{count:0,lastReceivedAt:null};
      current.count++;if(!current.lastReceivedAt||event.received_at>current.lastReceivedAt)current.lastReceivedAt=event.received_at;adCounts.set(ad,current);
      const lead=activityLeadById.get(event.lead_id);const relation=lead?(Array.isArray(lead.recruitment_locations)?lead.recruitment_locations[0]:lead.recruitment_locations):null;
      const station=(relation as {code?:string}|null)?.code||"Unmapped";stationCounts.set(station,(stationCounts.get(station)??0)+1);
    }
    const directMetaLeadIds=new Set((activityEvents.data??[])
      .filter((event)=>event.lead_id&&event.meta_lead_id&&activityLeadById.get(event.lead_id)?.meta_lead_id===event.meta_lead_id)
      .map((event)=>event.lead_id));
    const freshLeadIds=new Set((activityLeads.data??[])
      .filter((lead)=>lead.created_at>=activitySince&&lead.source==="meta"&&directMetaLeadIds.has(lead.id))
      .map((lead)=>lead.id));
    const whatsappConfig=await getConnectionConfig("whatsapp");
    const welcomeTemplates=new Set(notificationRulesFromConfig(whatsappConfig?.publicConfig??{})
      .filter((rule)=>rule.enabled&&rule.trigger==="new_lead"&&rule.templateName)
      .map((rule)=>rule.templateName));
    const outboxByLead=new Map<string,typeof whatsappActivity.data>();
    for(const row of whatsappActivity.data??[]){
      if(!row.lead_id||!freshLeadIds.has(row.lead_id)||!welcomeTemplates.has(row.template_name))continue;
      const rows=outboxByLead.get(row.lead_id)??[];rows.push(row);outboxByLead.set(row.lead_id,rows);
    }
    const blockedLeadIds=new Set((blockedActivity.data??[]).map((row)=>row.lead_id).filter((id)=>id&&freshLeadIds.has(id)));
    const notificationCounts=new Map<string,number>();
    for(const rows of outboxByLead.values())for(const row of rows??[])notificationCounts.set(row.status,(notificationCounts.get(row.status)??0)+1);
    const missingNotification=[...freshLeadIds].filter((id)=>!outboxByLead.has(id)&&!blockedLeadIds.has(id)).length;

    const [active, archived, sources, unmapped, queued, retry, sent, delivered, failed, latestLead, latestSource, latestRun, latestMetaRun, connectionRows] =
      await Promise.all([
        count(base().eq("archived", false)),
        count(base().eq("archived", true)),
        count(supabaseAdmin.from("recruitment_lead_source_events").select("id", { count: "exact", head: true }).eq("company_id", companyId)),
        count(base().eq("archived", false).or("location_id.is.null,role_id.is.null")),
        outbox("queued"),
        outbox("retry"),
        outbox("sent"),
        outbox("delivered"),
        outbox("failed"),
        supabaseAdmin.from("recruitment_leads").select("lead_created_at,source,ad_name")
          .eq("company_id", companyId).order("lead_created_at", { ascending: false }).limit(1).maybeSingle(),
        supabaseAdmin.from("recruitment_lead_source_events").select("received_at,processed_at,source_system,status,error")
          .eq("company_id", companyId).order("received_at", { ascending: false }).limit(1).maybeSingle(),
        supabaseAdmin.from("recruitment_ingestion_runs").select("source,mode,status,scanned_count,inserted_count,updated_count,duplicate_count,rejected_count,error_count,started_at,completed_at,error")
          .eq("company_id", companyId).order("started_at", { ascending: false }).limit(1).maybeSingle(),
        supabaseAdmin.from("recruitment_ingestion_runs").select("source,mode,status,scanned_count,inserted_count,duplicate_count,error_count,started_at,completed_at,error,cursor")
          .eq("company_id", companyId).eq("source", "meta_direct").order("started_at", { ascending: false }).limit(1).maybeSingle(),
        supabaseAdmin.rpc("recruitment_list_connection_settings", { p_company_id: companyId })
      ]);
    const queryFailure = [latestLead, latestSource, latestRun, latestMetaRun, connectionRows].find((item) => item.error);
    if (queryFailure?.error) throw queryFailure.error;
    const [indeedMappings,indeedApplications,latestIndeedApplication]=await Promise.all([
      count(supabaseAdmin.from("recruitment_indeed_job_mappings").select("id",{count:"exact",head:true}).eq("company_id",companyId).eq("is_active",true)),
      count(supabaseAdmin.from("recruitment_indeed_applications").select("id",{count:"exact",head:true}).eq("company_id",companyId)),
      supabaseAdmin.from("recruitment_indeed_applications").select("received_at,processed_at,indeed_job_id")
        .eq("company_id",companyId).order("received_at",{ascending:false}).limit(1).maybeSingle()
    ]);
    if(latestIndeedApplication.error)throw latestIndeedApplication.error;

    return NextResponse.json({
      leads: { active, archived, total: active + archived, sourceEvents: sources, unmapped },
      whatsapp: { queued, retry, sent, delivered, failed, safeToEnable: queued + retry === 0 },
      latest: {
        lead: latestLead.data ?? null,
        sourceEvent: latestSource.data ?? null,
        ingestionRun: latestRun.data ?? null,
        metaRun: latestMetaRun.data ?? null
      },
      recentMeta:{
        windowMinutes:15,
        events:(recentMetaEvents.data??[]).length,
        uniqueLeads:recentLeadIds.length,
        locations:[...recentLocationCounts].map(([code,count])=>({code,count})).sort((a,b)=>b.count-a.count||a.code.localeCompare(b.code)),
        latestReceivedAt:recentMetaEvents.data?.[0]?.received_at??null
      },
      indeed:{
        activeMappings:indeedMappings,
        applications:indeedApplications,
        latestApplication:latestIndeedApplication.data??null
      },
      intakeActivity:{
        windowHours:24,
        events:(activityEvents.data??[]).length,
        uniqueLeads:activityLeadIds.length,
        hourly:[...hourCounts].map(([hour,count])=>({hour,count})).sort((a,b)=>a.hour.localeCompare(b.hour)),
        ads:[...adCounts].map(([adName,value])=>({adName,...value})).sort((a,b)=>b.count-a.count||a.adName.localeCompare(b.adName)).slice(0,25),
        stations:[...stationCounts].map(([station,count])=>({station,count})).sort((a,b)=>b.count-a.count||a.station.localeCompare(b.station)).slice(0,25)
      },
      notificationActivity:{
        windowHours:24,
        expectedFreshLeads:freshLeadIds.size,
        coveredLeads:outboxByLead.size,
        blockedLeads:blockedLeadIds.size,
        missingLeads:missingNotification,
        statuses:Object.fromEntries([...notificationCounts].sort()),
        welcomeTemplates:[...welcomeTemplates],
        latestFailures:(whatsappActivity.data??[]).filter((row)=>row.status==="failed").slice(0,10).map((row)=>({templateName:row.template_name,failedAt:row.failed_at,lastError:row.last_error}))
      },
      connections: (connectionRows.data ?? []).map((row: Record<string, unknown>) => ({
        provider: row.provider,
        enabled: row.is_enabled,
        status: row.connection_status,
        lastTestedAt: row.last_tested_at,
        lastSuccessAt: row.last_success_at
      })),
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error("Recruitment system health failed", error);
    return NextResponse.json({ error: "Unable to load system health." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await recruitmentSession(request);
    if (!canUseRecruitmentMenu(session, "System Health", "all")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
    const mode = body.mode === "full_refresh" ? "full_refresh" : "incremental";
    return NextResponse.json(await runSheetBridge({
      mode,
      startRow: Number(body.startRow || 0) || undefined,
      batchSize: Number(body.batchSize || 0) || undefined
    }));
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Unable to run the source sync."
    }, { status: 500 });
  }
}
