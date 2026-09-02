import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { applyLeadScope, canUseRecruitmentMenu, recruitmentSession, requiredEnv } from "@/lib/recruitment-api";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getConnectionConfig } from "@/lib/connection-config";
import { buildHrUserPerformance } from "@/lib/hr-ats-product";
import { buildLeadAttemptRows, type LeadAttemptEvent, type LeadAttemptLead } from "@/lib/lead-attempt-report";
import { loadMainDashboardStations } from "@/lib/main-dashboard-masters";

export const dynamic = "force-dynamic";

function startOfIstDay(value: string) {
  return `${value}T00:00:00.000+05:30`;
}

function endOfIstDay(value: string) {
  return `${value}T23:59:59.999+05:30`;
}
export const runtime = "nodejs";
export const maxDuration = 60;

type LeadRow = {
  id: string;
  meta_lead_id: string | null;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  post_code: string | null;
  status: string;
  final_status: string | null;
  remarks: string | null;
  final_remarks: string | null;
  work_email: string | null;
  follow_up_at: string | null;
  callback_at: string | null;
  total_attempts: number;
  no_response_attempts: number;
  call_back_attempts: number;
  archived: boolean;
  stream: string | null;
  ad_name: string | null;
  normalized_phone: string | null;
  duplicate_count: number;
  lead_created_at: string | null;
  updated_at: string;
  ad_id: string | null;
  recruitment_locations: { code: string; name: string; region: string | null; state: string | null; poc_name: string | null; poc_mobile: string | null } | null;
  recruitment_roles: { code: string; name: string } | null;
};

function csv(value: string | null) {
  return (value ?? "").split(",").map((part) => part.trim()).filter(Boolean);
}

function dateTime(value: string | null) {
  return value ? new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "";
}

function lower(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function workbookResponse(rows: unknown[][], prefix: string) {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  worksheet["!freeze"] = { xSplit: 0, ySplit: 1 };
  worksheet["!autofilter"] = rows[0]?.length ? { ref: XLSX.utils.encode_range({ r: 0, c: 0 }, { r: Math.max(0, rows.length - 1), c: rows[0].length - 1 }) } : undefined;
  worksheet["!cols"] = (rows[0] ?? []).map((_, column) => ({
    wch: Math.min(48, Math.max(12, ...rows.slice(0, 500).map((row) => String(row[column] ?? "").length)))
  }));
  XLSX.utils.book_append_sheet(workbook, worksheet, "Report");
  const bytes = XLSX.write(workbook, { type: "buffer", bookType: "xlsx", compression: true });
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(bytes, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${prefix}_${stamp}.xlsx"`,
      "Cache-Control": "private, no-store"
    }
  });
}

function increment(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function ranked(map: Map<string, number>, limit = 20) {
  return [...map.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
    .slice(0, limit);
}

function matchesAdStatus(status: unknown, filters: string[]) {
  const value = String(status ?? "").trim().toUpperCase();
  if (!filters.length) return true;
  return filters.some((filter) =>
    filter === "ACTIVE" ? value === "ACTIVE" :
    filter === "PAUSED" ? value === "PAUSED" :
    filter === "INACTIVE" ? value !== "ACTIVE" && value !== "PAUSED" :
    false
  );
}

type Period = { label: string; start: string; end: string };
type MetaSpendRow = {
  ad_id?: string;
  ad_name?: string;
  spend?: string;
  reach?: string;
  impressions?: string;
  date_start?: string;
  date_stop?: string;
};

function dateOnly(value: string) {
  return new Date(`${value}T12:00:00.000Z`);
}

function ymd(value: Date) {
  return value.toISOString().slice(0, 10);
}

function dropxWeekNumber(value: Date) {
  const jan1 = new Date(Date.UTC(value.getUTCFullYear(), 0, 1, 12));
  const firstSunday = new Date(jan1);
  firstSunday.setUTCDate(jan1.getUTCDate() + ((7 - jan1.getUTCDay()) % 7));
  if (value < firstSunday) return 1;
  return Math.floor((value.getTime() - firstSunday.getTime()) / 604_800_000) + 2;
}

function dmy(value: Date) {
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${String(value.getUTCDate()).padStart(2, "0")}-${months[value.getUTCMonth()]}-${value.getUTCFullYear()}`;
}

function weekPeriod(day: string): Period {
  const date = dateOnly(day);
  const start = new Date(date);
  start.setUTCDate(date.getUTCDate() - date.getUTCDay());
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  return {
    label: `Week ${dropxWeekNumber(start)} (${dmy(start)} to ${dmy(end)})`,
    start: ymd(start),
    end: ymd(end)
  };
}

function monthPeriod(day: string): Period {
  const date = dateOnly(day);
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 12));
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 12));
  return {
    label: date.toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }),
    start: ymd(start),
    end: ymd(end)
  };
}

function defaultSpendRange(from: string | null, to: string | null) {
  if (from && to) return { from, to };
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date());
  const current = dateOnly(today);
  const start = new Date(current);
  start.setUTCDate(current.getUTCDate() - current.getUTCDay());
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  return { from: from || ymd(start), to: to || ymd(end) };
}

async function fetchMetaDailySpend(from: string, to: string) {
  const config = await getConnectionConfig("meta");
  if (!config?.isEnabled || !config.secrets.access_token || !config.publicConfig.ad_account_id) {
    throw new Error("Enable and test Meta Lead Ads in Admin → Connections before generating the period spend report.");
  }
  const account = config.publicConfig.ad_account_id.replace(/^act_/, "");
  const version = config.publicConfig.graph_version || "v25.0";
  let next: string | null = `https://graph.facebook.com/${version}/act_${encodeURIComponent(account)}/insights`;
  const rows: MetaSpendRow[] = [];
  for (let page = 0; next && page < 20; page++) {
    const endpoint = new URL(next);
    if (page === 0) {
      endpoint.searchParams.set("level", "ad");
      endpoint.searchParams.set("time_increment", "1");
      endpoint.searchParams.set("limit", "500");
      endpoint.searchParams.set("time_range", JSON.stringify({ since: from, until: to }));
      endpoint.searchParams.set("fields", "ad_id,ad_name,spend,reach,impressions,date_start,date_stop");
    }
    const response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${config.secrets.access_token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(30_000)
    });
    const payload = await response.json() as {
      data?: MetaSpendRow[];
      paging?: { next?: string };
      error?: { message?: string };
    };
    if (!response.ok || payload.error) throw new Error(payload.error?.message || `Meta spend request returned HTTP ${response.status}.`);
    rows.push(...(payload.data ?? []));
    next = payload.paging?.next ?? null;
  }
  return rows;
}

export async function GET(request: Request) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase is not configured.");
    const session = await recruitmentSession(request);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const url = new URL(request.url);
    const stream = url.searchParams.get("stream");
    const workspace = stream === "hr" ? "hr" : "workforce";
    if (!canUseRecruitmentMenu(session, "Reports", "view", workspace)) return NextResponse.json({ error: "Reports view access is required." }, { status: 403 });
    const canDownloadReports = canUseRecruitmentMenu(session, "Reports", "edit", workspace);

    const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const updatedFrom = url.searchParams.get("updatedFrom");
    const updatedTo = url.searchParams.get("updatedTo");
    const interviewFrom = url.searchParams.get("interviewFrom");
    const interviewTo = url.searchParams.get("interviewTo");
    const report = url.searchParams.get("report");
    const format = url.searchParams.get("format");
    if (format === "xlsx" && !canDownloadReports) {
      return NextResponse.json({ error: "Reports download permission is required." }, { status: 403 });
    }
    const reportUser = url.searchParams.get("reportUser");
    const attemptFrom = url.searchParams.get("attemptFrom");
    const attemptTo = url.searchParams.get("attemptTo");
    const statuses = csv(url.searchParams.get("status"));
    const stationCodes = csv(url.searchParams.get("station"));
    const clusters = csv(url.searchParams.get("cluster"));
    const roleCodes = csv(url.searchParams.get("role"));
    const noStatusAge = Number(url.searchParams.get("noStatusAge") ?? 12);
    const adStatus = csv(url.searchParams.get("adStatus")).map((item) => item.toUpperCase());
    const spendFrom = url.searchParams.get("spendFrom");
    const spendTo = url.searchParams.get("spendTo");
    const mainStations = await loadMainDashboardStations(companyId);
    const ownerByStationCode = new Map(mainStations.map((station) => [
      station.code,
      station.operationalOwner?.name ?? null
    ]));
    const ownerNameFor = (stationCode: unknown) => ownerByStationCode.get(String(stationCode ?? "").trim().toUpperCase()) ?? "";
    let locationIds: string[] | null = null;
    let roleIds: string[] | null = null;
    let adIds: string[] | null = null;
    if (stationCodes.length || clusters.length) {
      let locations = supabaseAdmin.from("recruitment_locations").select("id").eq("company_id", companyId);
      const ownerStationCodes = clusters.length
        ? mainStations
            .filter((station) => station.operationalOwner && clusters.includes(station.operationalOwner.name))
            .map((station) => station.code)
        : null;
      const resolvedStationCodes = ownerStationCodes
        ? (stationCodes.length ? stationCodes.filter((code) => ownerStationCodes.includes(code)) : ownerStationCodes)
        : stationCodes;
      locations = resolvedStationCodes.length
        ? locations.in("code", resolvedStationCodes)
        : locations.eq("id", "00000000-0000-0000-0000-000000000000");
      const resolved = await locations;
      if (resolved.error) throw new Error(resolved.error.message);
      locationIds = (resolved.data ?? []).map((row) => row.id);
    }
    if (roleCodes.length) {
      const resolved = await supabaseAdmin.from("recruitment_roles").select("id").eq("company_id", companyId).in("code", roleCodes);
      if (resolved.error) throw new Error(resolved.error.message);
      roleIds = (resolved.data ?? []).map((row) => row.id);
    }
    if (adStatus.length) {
      const resolved = await supabaseAdmin.from("recruitment_ads").select("id,status")
        .eq("company_id", companyId);
      if (resolved.error) throw new Error(resolved.error.message);
      adIds = (resolved.data ?? []).filter((ad) => matchesAdStatus(ad.status, adStatus)).map((ad) => ad.id);
    }

    if (report === "leadattempts" && format === "xlsx") {
      const attemptLeads: LeadAttemptLead[] = [];
      for (let start = 0; ; start += 1000) {
        let query: any = supabaseAdmin.from("recruitment_leads")
          .select("id,full_name,phone,city,post_code,remarks,callback_at,follow_up_at,source,ad_name,recruitment_locations(code,name),recruitment_roles(code,name)")
          .eq("company_id", companyId);
        query = applyLeadScope(query, session, stream);
        if (locationIds) {
          if (!locationIds.length) break;
          query = query.in("location_id", locationIds);
        }
        if (roleIds) {
          if (!roleIds.length) break;
          query = query.in("role_id", roleIds);
        }
        const result = await query.order("id").range(start, start + 999);
        if (result.error) throw new Error(result.error.message);
        attemptLeads.push(...((result.data ?? []) as unknown as LeadAttemptLead[]));
        if ((result.data?.length ?? 0) < 1000) break;
      }
      const events: LeadAttemptEvent[] = [];
      const leadIds = attemptLeads.map((lead) => lead.id);
      for (let start = 0; start < leadIds.length; start += 200) {
        let eventQuery: any = supabaseAdmin.from("recruitment_lead_history")
          .select("lead_id,event_type,field_name,old_value,new_value,remarks,actor_profile_id,actor_email,created_at")
          .eq("company_id", companyId)
          .in("lead_id", leadIds.slice(start, start + 200))
          .gte("created_at", startOfIstDay(attemptFrom || new Intl.DateTimeFormat("en-CA", { timeZone:"Asia/Kolkata" }).format(new Date())))
          .lte("created_at", endOfIstDay(attemptTo || attemptFrom || new Intl.DateTimeFormat("en-CA", { timeZone:"Asia/Kolkata" }).format(new Date())));
        if (reportUser) eventQuery = eventQuery.eq("actor_profile_id", reportUser);
        const result = await eventQuery.order("created_at", { ascending: true });
        if (result.error) throw new Error(result.error.message);
        events.push(...((result.data ?? []) as LeadAttemptEvent[]));
      }
      return workbookResponse([[
        "Sl. No.","Updated Time (IST)","Telecaller","Candidate","Phone","City / PIN","Station","Role",
        "Previous Status","Updated Status","Remarks","Follow-up / Callback","Source","Ad Name"
      ], ...buildLeadAttemptRows(events, attemptLeads)], "DropX_Lead_Attempt_Detail");
    }
    const rows: LeadRow[] = [];
    for (let start = 0; ; start += 1000) {
      let query: any = supabaseAdmin
        .from("recruitment_leads")
        .select("id,meta_lead_id,full_name,phone,email,city,post_code,status,final_status,remarks,final_remarks,work_email,follow_up_at,callback_at,total_attempts,no_response_attempts,call_back_attempts,archived,stream,ad_id,ad_name,normalized_phone,duplicate_count,lead_created_at,updated_at,recruitment_locations(code,name,region,state,poc_name,poc_mobile),recruitment_roles(code,name)")
        .eq("company_id", companyId)
        .eq("archived", false);
      query = applyLeadScope(query, session, stream);
      if (from) query = query.gte("lead_created_at", startOfIstDay(from));
      if (to) query = query.lte("lead_created_at", endOfIstDay(to));
      if (updatedFrom) query = query.gte("updated_at", startOfIstDay(updatedFrom));
      if (updatedTo) query = query.lte("updated_at", endOfIstDay(updatedTo));
      if (interviewFrom) query = query.gte("follow_up_at", startOfIstDay(interviewFrom));
      if (interviewTo) query = query.lte("follow_up_at", endOfIstDay(interviewTo));
      if (statuses.length) {
        const normalized = statuses.flatMap((status) => status === "__BLANK__" ? ["", "new"] : [status]);
        query = query.in("status", normalized);
      }
      if (locationIds) {
        if (!locationIds.length) break;
        query = query.in("location_id", locationIds);
      }
      if (roleIds) {
        if (!roleIds.length) break;
        query = query.in("role_id", roleIds);
      }
      if (adIds) {
        if (!adIds.length) break;
        query = query.in("ad_id", adIds);
      }
      const result = await query
        .order("lead_created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(start, start + 999);
      if (result.error) throw new Error(result.error.message);
      rows.push(...((result.data ?? []) as LeadRow[]));
      if ((result.data?.length ?? 0) < 1000) break;
    }

    if (report && format === "xlsx") {
      const header = ["Lead ID","Meta Lead ID","Lead Received","Name","Phone","Email","City","Post Code","Station Code","Station","Operational Owner","State","Role Code","Role","Stream","Status","Final Status","Remarks","Final Remarks","Interview / Follow-up","Callback","Work Email","Ad Name","Total Attempts","No Response Attempts","Call Back Attempts","Duplicate Sources","Last Updated"];
      const leadValues = (source: LeadRow[]) => source.map((lead) => [
        lead.id, lead.meta_lead_id ?? "", dateTime(lead.lead_created_at), lead.full_name ?? "", lead.phone ?? "", lead.email ?? "", lead.city ?? "", lead.post_code ?? "",
        lead.recruitment_locations?.code ?? "", lead.recruitment_locations?.name ?? "", ownerNameFor(lead.recruitment_locations?.code), lead.recruitment_locations?.state ?? "",
        lead.recruitment_roles?.code ?? "", lead.recruitment_roles?.name ?? "", lead.stream ?? "", lead.status || "No Status", lead.final_status ?? "",
        lead.remarks ?? "", lead.final_remarks ?? "", dateTime(lead.follow_up_at), dateTime(lead.callback_at), lead.work_email ?? "", lead.ad_name ?? "",
        lead.total_attempts, lead.no_response_attempts, lead.call_back_attempts, lead.duplicate_count, dateTime(lead.updated_at)
      ]);
      if (report === "leads") return workbookResponse([header, ...leadValues(rows)], "DropX_Lead_Data");
      if (report === "interviews") {
        const filtered = rows.filter((lead) => lead.status === "interview_scheduled");
        return workbookResponse([header, ...leadValues(filtered)], "DropX_Interview_Report");
      }
      if (report === "nostatus") {
        const cutoff = Date.now() - Math.max(12, noStatusAge) * 3_600_000;
        const filtered = rows.filter((lead) => (!lead.status || lead.status === "new") && lead.lead_created_at && new Date(lead.lead_created_at).getTime() <= cutoff);
        return workbookResponse([header, ...leadValues(filtered)], "DropX_No_Status_Leads");
      }
      if (report === "designationpendency") {
        const groups = new Map<string, any>();
        for (const lead of rows.filter((item) => !item.status || ["new","no_response","call_back"].includes(item.status))) {
          const key = `${lead.recruitment_locations?.code ?? "Unmapped"}|${lead.recruitment_roles?.code ?? "Unmapped"}`;
          const item = groups.get(key) ?? { station:lead.recruitment_locations?.code ?? "Unmapped", role:lead.recruitment_roles?.code ?? "Unmapped", total:0, blank:0, noResponse:0, callback:0, h12:0, h24:0 };
          item.total++;
          if (!lead.status || lead.status === "new") item.blank++;
          if (lead.status === "no_response") item.noResponse++;
          if (lead.status === "call_back") item.callback++;
          const age = lead.lead_created_at ? (Date.now() - new Date(lead.lead_created_at).getTime()) / 3_600_000 : 0;
          if ((!lead.status || lead.status === "new") && age >= 12) item.h12++;
          if ((!lead.status || lead.status === "new") && age >= 24) item.h24++;
          groups.set(key, item);
        }
        const summary = [["Station","Designation","Total Pending","No Status","No Status 12h+","No Status 24h+","No Response","Call Back"],
          ...[...groups.values()].sort((a,b)=>b.total-a.total).map((item)=>[item.station,item.role,item.total,item.blank,item.h12,item.h24,item.noResponse,item.callback])];
        return workbookResponse(summary, "DropX_Designation_Pendency");
      }
      if (report === "leadquality") {
        const quality = rows.filter((lead) => !lead.normalized_phone || !lead.recruitment_locations || !lead.recruitment_roles || lead.duplicate_count > 1)
          .map((lead) => [!lead.normalized_phone ? "Missing/invalid phone" : !lead.recruitment_locations ? "Missing station" : !lead.recruitment_roles ? "Missing role" : "Duplicate source", ...leadValues([lead])[0]]);
        return workbookResponse([["Issue", ...header], ...quality], "DropX_Lead_Quality");
      }
      if (report === "spend" || report === "weeklyspend" || report === "dailyleads") {
        if (report === "dailyleads") {
          const dailyMap = new Map<string, Record<string, number>>();
          for (const lead of rows) {
            const day = lead.lead_created_at?.slice(0,10) ?? "Unknown";
            const item = dailyMap.get(day) ?? { total:0, noStatus:0, noResponse:0, callback:0, interviews:0, joined:0 };
            item.total++; if (!lead.status || lead.status === "new") item.noStatus++; if (lead.status === "no_response") item.noResponse++; if (lead.status === "call_back") item.callback++; if (lead.status.startsWith("interview_")) item.interviews++; if (lead.status === "joined" || lead.final_status === "Joined") item.joined++;
            dailyMap.set(day,item);
          }
          return workbookResponse([["Date","Total Leads","No Status","No Response","Call Back","Interviews","Joined"], ...[...dailyMap.entries()].sort().map(([day,item])=>[day,item.total,item.noStatus,item.noResponse,item.callback,item.interviews,item.joined])], "DropX_Daily_Lead_Generation");
        }
        let adsQuery: any = supabaseAdmin.from("recruitment_ads")
          .select("id,meta_ad_id,ad_name,status,daily_budget,total_spend,created_on,last_synced_at,location_id,role_id,recruitment_locations(code,name,region),recruitment_roles(code,name)")
          .eq("company_id", companyId);
        if (locationIds) {
          if (!locationIds.length) return workbookResponse([["Ad Name","Station","Operational Owner","Role","Ad Status","Daily Budget","Total Spend","Leads","Cost Per Lead","Created","Last Sync"]], report === "spend" ? "DropX_Spend_Analysis" : "DropX_Ad_Spend_Period_Report");
          adsQuery = adsQuery.in("location_id", locationIds);
        }
        if (roleIds) {
          if (!roleIds.length) return workbookResponse([["Ad Name","Station","Operational Owner","Role","Ad Status","Daily Budget","Total Spend","Leads","Cost Per Lead","Created","Last Sync"]], report === "spend" ? "DropX_Spend_Analysis" : "DropX_Ad_Spend_Period_Report");
          adsQuery = adsQuery.in("role_id", roleIds);
        }
        const ads = await adsQuery;
        if (ads.error) throw new Error(ads.error.message);
        const leadCounts = new Map<string, number>(); rows.forEach((lead)=>leadCounts.set(lead.ad_name ?? "Unknown", (leadCounts.get(lead.ad_name ?? "Unknown") ?? 0)+1));
        const filteredAds = (ads.data ?? []).filter((ad:any)=>matchesAdStatus(ad.status, adStatus));
        if (report === "weeklyspend") {
          const range = defaultSpendRange(spendFrom, spendTo);
          const metaRows = await fetchMetaDailySpend(range.from, range.to);
          const normalizeAd = (value: unknown) => String(value ?? "").trim().toLowerCase();
          const adByMeta = new Map<string, any>();
          const adByName = new Map<string, any>();
          for (const ad of filteredAds) {
            if (ad.meta_ad_id) adByMeta.set(String(ad.meta_ad_id), ad);
            if (ad.ad_name) adByName.set(normalizeAd(ad.ad_name), ad);
          }
          type SpendAgg = {
            type: string; level: string; period: string; start: string; end: string;
            adName: string; station: string; stationName: string; cluster: string; region: string;
            spend: number; reach: number; impressions: number;
          };
          const spendAgg = new Map<string, SpendAgg>();
          const addSpend = (type: string, level: string, period: Period, identity: string, base: Omit<SpendAgg, "type"|"level"|"period"|"start"|"end"|"spend"|"reach"|"impressions">, spend: number, reach: number, impressions: number) => {
            const key = `${type}|${level}|${period.label}|${identity}`;
            const item = spendAgg.get(key) ?? {
              type, level, period: period.label, start: period.start, end: period.end,
              ...base, spend: 0, reach: 0, impressions: 0
            };
            item.spend += spend; item.reach += reach; item.impressions += impressions;
            spendAgg.set(key, item);
          };
          for (const insight of metaRows) {
            const ad = adByMeta.get(String(insight.ad_id ?? "")) || adByName.get(normalizeAd(insight.ad_name));
            if (!ad) continue;
            const day = String(insight.date_start || insight.date_stop || "");
            if (!day) continue;
            const daily: Period = { label: day, start: day, end: day };
            const weekly = weekPeriod(day);
            const monthly = monthPeriod(day);
            const adName = String(insight.ad_name || ad.ad_name || "");
            const station = String(ad.recruitment_locations?.code || "");
            const stationName = String(ad.recruitment_locations?.name || station);
            const cluster = ownerNameFor(ad.recruitment_locations?.code);
            const region = String(ad.recruitment_locations?.region || "");
            const spend = Number(insight.spend || 0);
            const reach = Number(insight.reach || 0);
            const impressions = Number(insight.impressions || 0);
            const base = { adName, station, stationName, cluster, region };
            addSpend("Daily","Ad",daily,normalizeAd(adName),base,spend,reach,impressions);
            addSpend("Daily","Station",daily,station,{...base,adName:""},spend,reach,impressions);
            addSpend("Daily","Operational Owner",daily,cluster,{...base,adName:"",station:"",stationName:""},spend,reach,impressions);
            addSpend("Daily","Region",daily,region,{...base,adName:"",station:"",stationName:"",cluster:""},spend,reach,impressions);
            addSpend("Weekly","Station",weekly,station,{...base,adName:""},spend,reach,impressions);
            addSpend("Weekly","Operational Owner",weekly,cluster,{...base,adName:"",station:"",stationName:""},spend,reach,impressions);
            addSpend("Weekly","Region",weekly,region,{...base,adName:"",station:"",stationName:"",cluster:""},spend,reach,impressions);
            addSpend("Monthly","Station",monthly,station,{...base,adName:""},spend,reach,impressions);
            addSpend("Monthly","Operational Owner",monthly,cluster,{...base,adName:"",station:"",stationName:""},spend,reach,impressions);
            addSpend("Monthly","Region",monthly,region,{...base,adName:"",station:"",stationName:"",cluster:""},spend,reach,impressions);
          }

          const leadAgg = new Map<string, { leads: number; interviews: number; joined: number }>();
          const addLead = (type: string, level: string, period: string, identity: string, lead: LeadRow) => {
            const key = `${type}|${level}|${period}|${identity}`;
            const item = leadAgg.get(key) ?? { leads: 0, interviews: 0, joined: 0 };
            item.leads++;
            if (lead.status === "interview_scheduled") item.interviews++;
            if (lower(lead.status) === "joined" || lower(lead.final_status) === "joined") item.joined++;
            leadAgg.set(key, item);
          };
          const rangeStart = new Date(startOfIstDay(range.from)).toISOString();
          const rangeEnd = new Date(endOfIstDay(range.to)).toISOString();
          for (const lead of rows) {
            if (!lead.lead_created_at || lead.lead_created_at < rangeStart || lead.lead_created_at > rangeEnd) continue;
            const day = lead.lead_created_at.slice(0, 10);
            const weekly = weekPeriod(day);
            const monthly = monthPeriod(day);
            const adName = normalizeAd(lead.ad_name);
            const station = lead.recruitment_locations?.code ?? "";
            const cluster = ownerNameFor(lead.recruitment_locations?.code);
            const region = lead.recruitment_locations?.region ?? "";
            addLead("Daily","Ad",day,adName,lead);
            addLead("Daily","Station",day,station,lead);
            addLead("Daily","Operational Owner",day,cluster,lead);
            addLead("Daily","Region",day,region,lead);
            addLead("Weekly","Station",weekly.label,station,lead);
            addLead("Weekly","Operational Owner",weekly.label,cluster,lead);
            addLead("Weekly","Region",weekly.label,region,lead);
            addLead("Monthly","Station",monthly.label,station,lead);
            addLead("Monthly","Operational Owner",monthly.label,cluster,lead);
            addLead("Monthly","Region",monthly.label,region,lead);
          }
          const identity = (item: SpendAgg) => item.level === "Ad" ? normalizeAd(item.adName)
            : item.level === "Station" ? item.station : item.level === "Operational Owner" ? item.cluster : item.region;
          const reportRows = [...spendAgg.values()].sort((a,b) =>
            ["Daily","Weekly","Monthly"].indexOf(a.type) - ["Daily","Weekly","Monthly"].indexOf(b.type)
            || a.period.localeCompare(b.period) || a.level.localeCompare(b.level) || identity(a).localeCompare(identity(b))
          ).map((item) => {
            const leads = leadAgg.get(`${item.type}|${item.level}|${item.period}|${identity(item)}`) ?? { leads:0, interviews:0, joined:0 };
            const cost = (count: number) => count ? Math.round((item.spend / count) * 100) / 100 : "";
            return [
              item.type,item.level,item.period,item.start,item.end,item.adName,item.station,item.stationName,item.cluster,item.region,
              Math.round(item.spend*100)/100,Math.round(item.reach),Math.round(item.impressions),
              leads.leads,leads.interviews,leads.joined,cost(leads.leads),cost(leads.interviews),cost(leads.joined)
            ];
          });
          return workbookResponse([[
            "Period Type","Level","Period","From","To","Ad Name","Station Code","Station","Operational Owner","Region",
            "Spend","Reach","Impressions","Leads","Interviews","Joined","Cost Per Lead","Cost Per Interview","Cost Per Joined"
          ], ...reportRows], "DropX_Ad_Spend_Period_Report");
        }
        const spendAds = filteredAds.filter((ad:any) => adStatus.length || ["ACTIVE","PAUSED"].includes(String(ad.status ?? "").toUpperCase()));
        const spendRows = spendAds.map((ad:any) => {
          const exact = rows.filter((lead) => lead.ad_name?.trim() && lead.ad_name.trim() === String(ad.ad_name ?? "").trim());
          const related = exact.length ? exact : rows.filter((lead) =>
            lead.recruitment_locations?.code === ad.recruitment_locations?.code
            && lead.recruitment_roles?.code === ad.recruitment_roles?.code
          );
          const count = (status: string) => related.filter((lead) => lower(lead.status) === status).length;
          const finalCount = (status: string) => related.filter((lead) => lower(lead.final_status) === status || lower(lead.status) === status).length;
          const noStatus = related.filter((lead) => !lead.status || lead.status === "new").length;
          const interviews = count("interview_scheduled");
          const joined = finalCount("joined");
          const spend = Number(ad.total_spend || 0);
          const cost = (value: number) => value ? Math.round((spend / value) * 100) / 100 : "";
          return [
            ad.ad_name,ad.recruitment_locations?.code??"",ad.recruitment_locations?.name??"",ownerNameFor(ad.recruitment_locations?.code),
            ad.recruitment_roles?.code??"",Math.round(spend*100)/100,related.length,noStatus,count("no_response"),count("call_back"),
            interviews,joined,finalCount("dropped"),count("not_interested"),count("long_distance"),count("not_fit"),
            cost(related.length),cost(interviews),cost(joined)
          ];
        });
        return workbookResponse([[
          "Ad Name","Station Code","Station","Operational Owner","Role","Total Spend","Total Leads","No Status","No Response",
          "Call Back","Interviews","Joined","Dropped","Not Interested","Long Distance","Not Fit",
          "Cost Per Lead","Cost Per Interview","Cost Per Joined"
        ], ...spendRows], "DropX_Spend_Analysis");
      }
      if (report === "effort" || report === "userattempts") {
        const leadIds = rows.map((lead) => lead.id);
        const events: any[] = [];
        for (let start = 0; start < leadIds.length; start += 200) {
          const result = await supabaseAdmin.from("recruitment_lead_history").select("lead_id,event_type,field_name,new_value,remarks,actor_email,created_at").eq("company_id", companyId).in("lead_id", leadIds.slice(start,start+200)).order("created_at");
          if (result.error) throw new Error(result.error.message);
          events.push(...(result.data ?? []));
        }
        const leadById = new Map(rows.map((lead)=>[lead.id,lead]));
        if (report === "effort") {
          return workbookResponse([["Time","User","Lead ID","Candidate","Phone","Station","Role","Event","Field","New Value","Remarks"], ...events.map((event)=>{const lead=leadById.get(event.lead_id);return [dateTime(event.created_at),event.actor_email??"System",event.lead_id,lead?.full_name??"",lead?.phone??"",lead?.recruitment_locations?.code??"",lead?.recruitment_roles?.code??"",event.event_type,event.field_name??"",event.new_value??"",event.remarks??""];})], "DropX_Effort_Report");
        }
        const users = new Map<string,{total:number;leads:Set<string>;noResponse:number;callBack:number}>();
        for (const event of events) { const user=event.actor_email??"System"; const item=users.get(user)??{total:0,leads:new Set<string>(),noResponse:0,callBack:0}; item.total++;item.leads.add(event.lead_id);if(event.new_value==="No Response"||event.new_value==="no_response")item.noResponse++;if(event.new_value==="Call Back"||event.new_value==="call_back")item.callBack++;users.set(user,item); }
        return workbookResponse([["User","Total Updates","Unique Leads","No Response Attempts","Call Back Attempts"], ...[...users.entries()].sort((a,b)=>b[1].total-a[1].total).map(([user,item])=>[user,item.total,item.leads.size,item.noResponse,item.callBack])], "DropX_User_Attempt_Summary");
      }
    }

    const byStatus = new Map<string, number>();
    const byRole = new Map<string, number>();
    const byLocation = new Map<string, number>();
    const byCluster = new Map<string, number>();
    const byAd = new Map<string, number>();
    const daily = new Map<string, number>();
    let pending24h = 0;
    let missingRoute = 0;
    let duplicateSources = 0;
    let validPhones = 0;
    const now = Date.now();

    for (const lead of rows) {
      const status = lead.status || "new";
      increment(byStatus, status);
      increment(byRole, lead.recruitment_roles?.name ?? "Unmapped");
      increment(byLocation, lead.recruitment_locations?.name ?? "Unmapped");
      increment(byCluster, ownerNameFor(lead.recruitment_locations?.code) || "Unmapped");
      increment(byAd, lead.ad_name ?? "Unknown ad");
      if (lead.lead_created_at) increment(daily, lead.lead_created_at.slice(0, 10));
      if (["", "new", "no_response", "call_back"].includes(status) && lead.lead_created_at &&
          now - new Date(lead.lead_created_at).getTime() >= 24 * 60 * 60_000) pending24h += 1;
      if (!lead.recruitment_locations || !lead.recruitment_roles) missingRoute += 1;
      if (lead.duplicate_count > 1) duplicateSources += lead.duplicate_count - 1;
      if (lead.normalized_phone) validPhones += 1;
    }

    const interviews = rows.filter((lead) =>
      ["interview_scheduled", "interview_rescheduled", "interview_completed", "interview_no_show"].includes(lead.status)
    ).length;
    const selected = rows.filter((lead) =>
      ["selected", "documents_pending", "offer_pending", "offered", "joined"].includes(lead.status)
    ).length;
    const joined = rows.filter((lead) => lead.status === "joined").length;

    let userPerformance: Array<Record<string, unknown>> = [];
    if (workspace === "hr") {
      const scopedLeadIds = new Set(rows.map((lead) => lead.id));
      const activityFrom = updatedFrom || from || new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
      const activityTo = updatedTo || to;
      let activityQuery: any = supabaseAdmin.from("recruitment_lead_history")
        .select("lead_id,event_type,actor_profile_id,actor_email,new_value,created_at")
        .eq("company_id", companyId)
        .gte("created_at", startOfIstDay(activityFrom))
        .order("created_at", { ascending: false })
        .limit(10_000);
      if (activityTo) activityQuery = activityQuery.lte("created_at", endOfIstDay(activityTo));
      const activity = await activityQuery;
      if (activity.error) throw new Error(activity.error.message);
      const performance = buildHrUserPerformance((activity.data ?? []).filter((event: any) => scopedLeadIds.has(event.lead_id)));
      const profileIds = [...new Set(performance.map((item) => item.profileId).filter(Boolean))] as string[];
      const profiles = profileIds.length
        ? await supabaseAdmin.from("profiles").select("id,full_name,email").in("id", profileIds)
        : { data: [], error: null };
      if (profiles.error) throw new Error(profiles.error.message);
      const profileById = new Map((profiles.data ?? []).map((profile: any) => [profile.id, profile]));
      userPerformance = performance.map((item) => ({
        ...item,
        name: (item.profileId ? profileById.get(item.profileId)?.full_name : null) || item.email,
        activityFrom,
        activityTo: activityTo || new Date().toISOString().slice(0, 10)
      }));
    }

    let reportUsers: Array<{ id:string; name:string; email:string|null }> = [];
    if (workspace === "workforce" && canDownloadReports) {
      const scopedLeadIds = new Set(rows.map((lead) => lead.id));
      const recentActors = await supabaseAdmin.from("recruitment_lead_history")
        .select("lead_id,actor_profile_id")
        .eq("company_id", companyId)
        .not("actor_profile_id", "is", null)
        .gte("created_at", new Date(Date.now() - 90 * 86_400_000).toISOString())
        .limit(10_000);
      if (recentActors.error) throw new Error(recentActors.error.message);
      const actorIds = [...new Set((recentActors.data ?? [])
        .filter((event) => scopedLeadIds.has(event.lead_id))
        .map((event) => event.actor_profile_id)
        .filter(Boolean))] as string[];
      if (actorIds.length) {
        const profiles = await supabaseAdmin.from("profiles").select("id,full_name,email").in("id", actorIds).order("full_name");
        if (profiles.error) throw new Error(profiles.error.message);
        reportUsers = (profiles.data ?? []).map((profile) => ({
          id: profile.id,
          name: profile.full_name || profile.email || "DropX user",
          email: profile.email
        }));
      }
    }

    return NextResponse.json({
      canDownloadReports,
      reportUsers,
      summary: {
        total: rows.length,
        contacted: rows.length - (byStatus.get("new") ?? 0) - (byStatus.get("") ?? 0),
        interviews,
        selected,
        joined,
        pending24h,
        missingRoute,
        validPhoneRate: rows.length ? Math.round((validPhones / rows.length) * 1000) / 10 : 0,
        duplicateSources
      },
      funnel: ranked(byStatus, 50),
      roles: ranked(byRole),
      locations: ranked(byLocation),
      clusters: ranked(byCluster),
      ads: ranked(byAd),
      daily: ranked(daily, 366).sort((a, b) => a.label.localeCompare(b.label)),
      userPerformance,
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error("Recruitment reports failed", error);
    return NextResponse.json({ error: "Unable to generate reports." }, { status: 500 });
  }
}
