import { NextResponse } from "next/server";
import { canUseRecruitmentMenu, recruitmentSession, requiredEnv } from "@/lib/recruitment-api";
import { loadWorkforceConfig } from "@/lib/recruitment-workforce-config";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { loadAllSupabaseRows } from "@/lib/supabase-pagination";
import { WORKFORCE_PROFILE_TABLE } from "@/lib/workforce-register";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function today() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date());
}
function validDate(value: string | null, fallback: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value ?? "") ? String(value) : fallback;
}
function cleanId(value: unknown) {
  return String(value ?? "").trim().toUpperCase();
}
function chunks<T>(values:T[], size=350) {
  return Array.from({length:Math.ceil(values.length/size)},(_,index)=>values.slice(index*size,index*size+size));
}
function monthBounds(month: string) {
  const safe = /^\d{4}-\d{2}$/.test(month) ? month : today().slice(0, 7);
  const [year, value] = safe.split("-").map(Number);
  const last = new Date(Date.UTC(year, value, 0)).getUTCDate();
  return { month: safe, from: `${safe}-01`, to: `${safe}-${String(last).padStart(2, "0")}` };
}

type PerformanceHistory = {
  id: string;
  lead_id: string;
  event_type: string;
  new_value: string | null;
  actor_profile_id: string | null;
  actor_email: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

function uniqueHistory(groups: PerformanceHistory[][]) {
  return [...new Map(groups.flat().map((event) => [event.id, event])).values()]
    .sort((left, right) => right.created_at.localeCompare(left.created_at));
}

async function attributedHistory(companyId: string, profileId: string, email: string | null, from: string, to: string) {
  const columns = "id,lead_id,event_type,new_value,actor_profile_id,actor_email,metadata,created_at";
  const base = () => supabaseAdmin!.from("recruitment_lead_history")
    .select(columns)
    .eq("company_id", companyId)
    .gte("created_at", new Date(`${from}T00:00:00.000+05:30`).toISOString())
    .lte("created_at", new Date(`${to}T23:59:59.999+05:30`).toISOString())
    .order("created_at", { ascending: false }).order("id", { ascending:false });
  const directFilter = [`actor_profile_id.eq.${profileId}`];
  if (email) directFilter.push(`actor_email.ilike.${email}`);
  const groups = await Promise.all([
    loadAllSupabaseRows<PerformanceHistory>((pageFrom,pageTo)=>base().or(directFilter.join(",")).range(pageFrom,pageTo) as any),
    loadAllSupabaseRows<PerformanceHistory>((pageFrom,pageTo)=>base().contains("metadata", { recruiter_profile_id: profileId }).range(pageFrom,pageTo) as any),
    loadAllSupabaseRows<PerformanceHistory>((pageFrom,pageTo)=>base().contains("metadata", { telecaller_profile_id: profileId }).range(pageFrom,pageTo) as any),
    loadAllSupabaseRows<PerformanceHistory>((pageFrom,pageTo)=>base().contains("metadata", { field_recruiter_profile_id: profileId }).range(pageFrom,pageTo) as any)
  ]);
  return uniqueHistory(groups);
}

export async function GET(request: Request) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase is not configured.");
    const session = await recruitmentSession(request);
    if (!session || !(canUseRecruitmentMenu(session, "Dashboard", "view", "workforce")
      || canUseRecruitmentMenu(session, "Recruiter Performance", "view", "workforce")
      || canUseRecruitmentMenu(session, "Field Recruitment", "view", "workforce"))) {
      return NextResponse.json({ error: "Personal performance access is required." }, { status: 403 });
    }
    const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
    const url = new URL(request.url);
    const dayTo = validDate(url.searchParams.get("to"), today());
    const dayFrom = validDate(url.searchParams.get("from"), dayTo);
    const selectedMonth = monthBounds(url.searchParams.get("month") ?? dayTo.slice(0, 7));
    const config = await loadWorkforceConfig(companyId);
    const functionConfig = config.userFunctions[session.profileId];
    const functionName = functionConfig?.function ?? session.recruitmentFunction;

    const profileResult = await supabaseAdmin.from("profiles").select("email").eq("company_id", companyId).eq("id", session.profileId).maybeSingle();
    if (profileResult.error) throw profileResult.error;
    const profileEmail = String(profileResult.data?.email ?? session.email ?? "").trim().toLowerCase() || null;
    const [rawPeriodHistory, rawMonthHistory, joiningHistory, directExecutivesAll] = await Promise.all([
      attributedHistory(companyId, session.profileId, profileEmail, dayFrom, dayTo),
      attributedHistory(companyId, session.profileId, profileEmail, selectedMonth.from, selectedMonth.to),
      loadAllSupabaseRows<PerformanceHistory>((pageFrom,pageTo)=>supabaseAdmin!.from("recruitment_lead_history")
        .select("id,lead_id,event_type,new_value,actor_profile_id,actor_email,metadata,created_at")
        .eq("company_id", companyId)
        .eq("event_type", "workforce_joining_record")
        .order("created_at", { ascending: false }).order("id", { ascending:false }).range(pageFrom,pageTo) as any),
      loadAllSupabaseRows<any>((pageFrom,pageTo)=>supabaseAdmin!.from(WORKFORCE_PROFILE_TABLE)
        .select("id,full_name,mobile,email,date_of_join,dropx_id,biometric_id,designation,onboarding_status,is_active,created_at,updated_at,stations(station_code)")
        .eq("company_id",companyId).eq("created_by",session.profileId)
        .order("id", { ascending:true }).range(pageFrom,pageTo) as any)
    ]);
    const latestJoining = new Map<string, any>();
    for (const event of joiningHistory) if (!latestJoining.has(event.lead_id)) latestJoining.set(event.lead_id, event);
    const rawAttributed = [...latestJoining.values()].filter((event:any) => {
      const metadata = event.metadata ?? {};
      if (functionName === "field_recruiter") return String(metadata.field_recruiter_profile_id ?? "") === session.profileId;
      return String(metadata.telecaller_profile_id ?? metadata.recruiter_profile_id ?? event.actor_profile_id ?? "") === session.profileId;
    });
    const leadLinkedExecutiveIds=new Set([...latestJoining.values()]
      .map((event:any)=>String(event.metadata?.field_executive_id??""))
      .filter(Boolean));
    const directExecutives=directExecutivesAll.filter((item:any)=>!leadLinkedExecutiveIds.has(item.id));
    const relevantLeadIds=[...new Set([
      ...rawPeriodHistory.map((event)=>event.lead_id),
      ...rawMonthHistory.map((event)=>event.lead_id),
      ...rawAttributed.map((event:any)=>event.lead_id)
    ])];
    const leadPages=relevantLeadIds.length?await Promise.all(chunks(relevantLeadIds).map((ids)=>supabaseAdmin!
      .from("recruitment_leads")
      .select("id,full_name,phone,status,assigned_profile_id,location_id,role_id,recruitment_locations(code,name),recruitment_roles(code,name)")
      .eq("company_id",companyId).eq("stream","workforce").in("id",ids))):[];
    const leadFailure=leadPages.find((page)=>page.error);
    if(leadFailure?.error)throw leadFailure.error;
    const leads=leadPages.flatMap((page)=>page.data??[]).filter((lead)=>(
      (session.allLocations || Boolean(lead.location_id && session.locationIds.includes(lead.location_id))) &&
      (!session.roleIds.length || Boolean(lead.role_id && session.roleIds.includes(lead.role_id)))
    ));
    const accessibleLeadIds=new Set(leads.map((lead)=>lead.id));
    const periodHistory=rawPeriodHistory.filter((event)=>accessibleLeadIds.has(event.lead_id));
    const monthHistory=rawMonthHistory.filter((event)=>accessibleLeadIds.has(event.lead_id));
    const attributed=rawAttributed.filter((event:any)=>accessibleLeadIds.has(event.lead_id));
    const leadById = new Map(leads.map((lead)=>[lead.id,lead]));
    const handled = new Set<string>();
    const activityStatusLeads = new Map<string, Set<string>>();
    const latestStatusByLead = new Map<string,string>();
    for (const event of periodHistory) {
      handled.add(event.lead_id);
      const status = String(event.new_value ?? "").toLowerCase();
      if (status) {
        const set = activityStatusLeads.get(status) ?? new Set<string>();
        set.add(event.lead_id); activityStatusLeads.set(status, set);
        if(!latestStatusByLead.has(event.lead_id))latestStatusByLead.set(event.lead_id,status);
      }
    }

    const joiningInRange = attributed.filter((event:any) => {
      const date = String(event.metadata?.joining_date ?? event.created_at).slice(0,10);
      return date >= dayFrom && date <= dayTo;
    });
    const joinedLeadIds=new Set(joiningInRange.map((event:any)=>event.lead_id));
    const effectiveStatusByLead=new Map<string,string>();
    const effectiveStatusCounts=new Map<string,Set<string>>();
    for(const leadId of handled){
      const lead:any=leadById.get(leadId);
      const status=joinedLeadIds.has(leadId)?"joined":latestStatusByLead.get(leadId)||String(lead?.status||"no_status").toLowerCase();
      effectiveStatusByLead.set(leadId,status);
      const set=effectiveStatusCounts.get(status)??new Set<string>();set.add(leadId);effectiveStatusCounts.set(status,set);
    }
    const providerIds = [...new Set(attributed.map((event:any)=>cleanId(event.metadata?.provider_employee_id)).filter(Boolean))];
    const opsPages=providerIds.length?await Promise.all(chunks(providerIds,300).map((ids)=>supabaseAdmin!
      .from("cps_shipment_daily")
      .select("provider_employee_id,provider_employee_name,work_date,total_delivery,total_activity,station_code")
      .eq("company_id", companyId).in("provider_employee_id", ids)
      .gte("work_date", selectedMonth.from).lte("work_date", selectedMonth.to)
      .order("work_date", { ascending:false }).limit(20000))):[];
    const opsFailure=opsPages.find((page)=>page.error);
    const opsAvailable = !opsFailure;
    const opsRows=opsPages.flatMap((page)=>page.data??[]);
    const opsById = new Map<string, {days:Set<string>;deliveries:number;activity:number;lastDate:string|null;daily:any[]}>();
    for (const row of opsRows) {
      const id = cleanId(row.provider_employee_id);
      const current = opsById.get(id) ?? { days:new Set<string>(), deliveries:0, activity:0, lastDate:null, daily:[] };
      const deliveries = Number(row.total_delivery ?? 0);
      const activity = Number(row.total_activity ?? 0);
      if (deliveries > 0 || activity > 0) current.days.add(row.work_date);
      current.deliveries += deliveries; current.activity += activity;
      if (!current.lastDate || row.work_date > current.lastDate) current.lastDate = row.work_date;
      current.daily.push({ date:row.work_date, deliveries, activity });
      opsById.set(id,current);
    }
    const activeRule = config.incentiveMaster.find((rule)=>rule.isActive && rule.effectiveFrom <= dayTo && (!rule.effectiveTo || rule.effectiveTo >= dayFrom))
      ?? config.incentiveMaster[0];
    const qualificationDays = activeRule?.qualificationDays ?? 30;
    const associates:any[] = attributed.map((event:any) => {
      const lead:any = leadById.get(event.lead_id);
      const meta = event.metadata ?? {};
      const providerId = cleanId(meta.provider_employee_id);
      const activity = opsById.get(providerId);
      const activeDays = activity?.days.size ?? 0;
      return {
        leadId:event.lead_id,
        candidate:lead?.full_name || "Unnamed associate",
        phone:lead?.phone || null,
        station:lead?.recruitment_locations?.code || "Unmapped",
        role:lead?.recruitment_roles?.name || "Unmapped",
        joiningDate:String(meta.joining_date ?? event.created_at).slice(0,10),
        employeeId:String(meta.employee_id ?? "") || null,
        providerEmployeeId:providerId || null,
        paymentRecommendation:String(meta.payment_recommendation ?? "") || null,
        activeDays,
        deliveries:activity?.deliveries ?? 0,
        activity:activity?.activity ?? 0,
        lastActiveDate:activity?.lastDate ?? null,
        retained30:activeDays >= qualificationDays,
        daily:activity?.daily ?? []
      };
    });
    for(const executive of directExecutives as any[]){
      const active=executive.is_active&&executive.onboarding_status==="active";
      associates.push({
        leadId:`field-executive:${executive.id}`,
        candidate:executive.full_name||"Unnamed associate",
        phone:executive.mobile||null,
        station:executive.stations?.station_code||"Unmapped",
        role:executive.designation||"Unmapped",
        joiningDate:active?executive.date_of_join:String(executive.created_at).slice(0,10),
        employeeId:executive.dropx_id||null,
        providerEmployeeId:null,
        paymentRecommendation:null,
        activeDays:0,deliveries:0,activity:0,lastActiveDate:null,retained30:false,daily:[],
        onboardingStatus:executive.onboarding_status||"pending",
        biometricId:executive.biometric_id||null,
        source:"direct_onboarding"
      });
    }
    associates.sort((a,b)=>b.joiningDate.localeCompare(a.joiningDate));
    const qualified = associates.filter((item)=>item.retained30).length;
    const incentiveVisible = session.isOwner
      || Boolean(session.designationCode && activeRule?.eligibleDesignations?.includes(session.designationCode));
    const incentiveEligible = incentiveVisible && qualified >= Number(activeRule?.minimumQualifiedAssociates ?? 1);
    const directJoinedInRange=directExecutives.filter((item:any)=>item.is_active&&item.onboarding_status==="active"&&item.date_of_join>=dayFrom&&item.date_of_join<=dayTo);
    const directOnboardedInRange=directExecutives.filter((item:any)=>String(item.created_at).slice(0,10)>=dayFrom&&String(item.created_at).slice(0,10)<=dayTo);
    const joined = new Set(joiningInRange.map((event:any)=>event.lead_id)).size+directJoinedInRange.length;
    const mtdTo = selectedMonth.month === today().slice(0,7) ? today() : selectedMonth.to;
    const mtdJoined = new Set(attributed.filter((event:any) => {
      const date = String(event.metadata?.joining_date ?? event.created_at).slice(0,10);
      return date >= selectedMonth.from && date <= mtdTo;
    }).map((event:any)=>event.lead_id)).size+directExecutives.filter((item:any)=>
      item.is_active&&item.onboarding_status==="active"&&item.date_of_join>=selectedMonth.from&&item.date_of_join<=mtdTo
    ).length;
    const mtdHandled=new Set(monthHistory.map((event)=>event.lead_id));
    const latestMtdStatus=new Map<string,string>();
    const mtdInterviewLeads=new Set<string>();
    const mtdSelectedLeads=new Set<string>();
    for(const event of monthHistory){
      const status=String(event.new_value??"").toLowerCase();
      if(status&&!latestMtdStatus.has(event.lead_id))latestMtdStatus.set(event.lead_id,status);
      if(["interview_scheduled","interview_rescheduled"].includes(status))mtdInterviewLeads.add(event.lead_id);
      if(status==="selected")mtdSelectedLeads.add(event.lead_id);
    }
    const mtdJoinedLeadIds=new Set(attributed.filter((event:any)=>{
      const date=String(event.metadata?.joining_date??event.created_at).slice(0,10);
      return date>=selectedMonth.from&&date<=mtdTo;
    }).map((event:any)=>event.lead_id));
    const mtdStatusCounts=new Map<string,number>();
    for(const leadId of mtdHandled){
      const lead:any=leadById.get(leadId);
      const status=mtdJoinedLeadIds.has(leadId)?"joined":latestMtdStatus.get(leadId)||String(lead?.status||"no_status").toLowerCase();
      mtdStatusCounts.set(status,(mtdStatusCounts.get(status)||0)+1);
    }
    const breakdown = [...handled].reduce((map,leadId)=>{
      const lead:any=leadById.get(leadId);
      if(!lead)return map;
      const station=lead.recruitment_locations?.code||"Unmapped";
      const designation=lead.recruitment_roles?.code||lead.recruitment_roles?.name||"Unmapped";
      const groupKey=`${station}::${designation}`;
      const item=map.get(groupKey)??{station,designation,attended:0,interviews:0,selected:0,joined:0,statusCounts:{} as Record<string,number>};
      item.attended++;
      if((activityStatusLeads.get("interview_scheduled")?.has(leadId))||(activityStatusLeads.get("interview_rescheduled")?.has(leadId)))item.interviews++;
      if(activityStatusLeads.get("selected")?.has(leadId))item.selected++;
      if(joinedLeadIds.has(leadId))item.joined++;
      const status=effectiveStatusByLead.get(leadId)||"no_status";item.statusCounts[status]=(item.statusCounts[status]||0)+1;
      map.set(groupKey,item);return map;
    },new Map<string,{station:string;designation:string;attended:number;interviews:number;selected:number;joined:number;statusCounts:Record<string,number>}>());
    return NextResponse.json({
      from:dayFrom,to:dayTo,month:selectedMonth.month,function:functionName,opsAvailable,
      metrics:{
        attended:handled.size,
        noResponse:effectiveStatusCounts.get("no_response")?.size ?? 0,
        callBack:effectiveStatusCounts.get("call_back")?.size ?? 0,
        interviews:new Set([...(activityStatusLeads.get("interview_scheduled")??[]),...(activityStatusLeads.get("interview_rescheduled")??[])]).size,
        selected:activityStatusLeads.get("selected")?.size ?? 0,
        onboarded:directOnboardedInRange.length,
        joined,
        mtdJoined,
        conversion:handled.size ? Math.round(joined / handled.size * 100) : 0
      },
      breakdown:[...breakdown.values()].sort((a,b)=>b.attended-a.attended||a.station.localeCompare(b.station)),
      statusBreakdown:[...effectiveStatusCounts].map(([status,ids])=>({status,count:ids.size})).sort((a,b)=>b.count-a.count||a.status.localeCompare(b.status)),
      mtdJourney:{
        attended:mtdHandled.size,
        interviews:mtdInterviewLeads.size,
        selected:mtdSelectedLeads.size,
        joined:mtdJoined,
        conversion:mtdHandled.size ? Math.round(mtdJoined / mtdHandled.size * 100) : 0,
        statusBreakdown:[...mtdStatusCounts].map(([status,count])=>({status,count})).sort((a,b)=>b.count-a.count||a.status.localeCompare(b.status))
      },
      associates,
      qualificationDays,
      qualifiedAssociates:qualified,
      incentiveVisible,
      estimatedIncentive:incentiveEligible ? qualified * Number(activeRule?.amountPerQualifiedAssociate ?? 0) : 0,
      incentiveState:incentiveVisible ? (incentiveEligible ? "Eligible" : "Provisional") : "Not applicable"
    });
  } catch (error) {
    console.error("Personal recruitment performance failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load personal performance." }, { status: 500 });
  }
}
