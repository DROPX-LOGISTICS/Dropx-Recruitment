import { NextResponse } from "next/server";
import { canUseRecruitmentMenu, recruitmentSession, requiredEnv } from "@/lib/recruitment-api";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { parseManualPunchRemarks } from "@/lib/manual-punch";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function metadata(value: unknown) {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

export async function GET(request: Request) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase is not configured.");
    const session = await recruitmentSession(request);
    if (!canUseRecruitmentMenu(session, "Master Reports", "view")) return NextResponse.json({ error: "Restricted report access." }, { status: 403 });
    const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
    const [events, profiles, manualPunches, punchDecisions] = await Promise.all([
      supabaseAdmin.from("recruitment_lead_history")
        .select("id,lead_id,event_type,new_value,actor_profile_id,actor_email,metadata,created_at,recruitment_leads(full_name,phone,recruitment_locations(code,name),recruitment_roles(code,name))")
        .eq("company_id", companyId).order("created_at", { ascending: false }).limit(30000),
      supabaseAdmin.from("profiles").select("id,employee_id,full_name,email").eq("company_id", companyId),
      supabaseAdmin.from("attendance_regularization_requests")
        .select("id,profile_id,attendance_date,request_kind,requested_in_time,requested_out_time,status,remarks,requested_latitude,requested_longitude,requested_accuracy_meters,review_remarks,reviewed_by,reviewed_at,duty_id,recruitment_field_duties(started_at,punch_in_at,punch_in_source,punch_out_at,punch_out_source,worked_minutes)")
        .eq("company_id", companyId).in("request_kind", ["field_duty_in","field_duty_out"]).order("attendance_date", { ascending: false }).limit(10000),
      supabaseAdmin.from("recruitment_manual_punch_decisions")
        .select("request_id,action,decided_by_profile_id,comments,decided_at").eq("company_id", companyId).order("decided_at")
    ]);
    if (events.error || profiles.error || manualPunches.error || punchDecisions.error) throw new Error(events.error?.message || profiles.error?.message || manualPunches.error?.message || punchDecisions.error?.message);
    const profileById = new Map((profiles.data ?? []).map((profile) => [profile.id, profile]));
    const funnelByRecruiter = new Map<string, {
      recruiter: string; employeeId: string; email: string; calls: number; noResponse: number;
      callbacks: number; interviews: number; selected: number; joined: number;
    }>();
    for (const event of events.data ?? []) {
      if (!event.actor_profile_id || !["status_change", "contact_attempt", "workforce_joining_record"].includes(event.event_type)) continue;
      const profile = profileById.get(event.actor_profile_id);
      const row = funnelByRecruiter.get(event.actor_profile_id) ?? {
        recruiter: profile?.full_name || event.actor_email || "Recruiter",
        employeeId: profile?.employee_id || "—",
        email: profile?.email || event.actor_email || "—",
        calls: 0, noResponse: 0, callbacks: 0, interviews: 0, selected: 0, joined: 0
      };
      row.calls += 1;
      if (event.new_value === "no_response") row.noResponse += 1;
      if (event.new_value === "call_back") row.callbacks += 1;
      if (String(event.new_value || "").startsWith("interview_")) row.interviews += 1;
      if (event.new_value === "selected") row.selected += 1;
      if (event.new_value === "joined" || event.event_type === "workforce_joining_record") row.joined += 1;
      funnelByRecruiter.set(event.actor_profile_id, row);
    }

    const joiningEvents = (events.data ?? []).filter((event) => event.event_type === "workforce_joining_record");
    const providerIds = [...new Set(joiningEvents.map((event) => String(metadata(event.metadata).provider_employee_id ?? "").trim()).filter(Boolean))];
    const shipment = providerIds.length
      ? await supabaseAdmin.from("cps_shipment_daily")
          .select("provider_employee_id,work_date,total_delivery,total_activity")
          .eq("company_id", companyId).in("provider_employee_id", providerIds.slice(0, 500)).limit(50000)
      : { data: [], error: null };
    if (shipment.error) throw new Error(shipment.error.message);
    const activity = new Map<string, { dates: Set<string>; deliveries: number; activity: number }>();
    for (const row of shipment.data ?? []) {
      const key = String(row.provider_employee_id ?? "");
      const item = activity.get(key) ?? { dates: new Set<string>(), deliveries: 0, activity: 0 };
      if (row.work_date) item.dates.add(row.work_date);
      item.deliveries += Number(row.total_delivery || 0);
      item.activity += Number(row.total_activity || 0);
      activity.set(key, item);
    }
    const joiningRegister = joiningEvents.map((event) => {
      const details = metadata(event.metadata);
      const leadRelation = Array.isArray(event.recruitment_leads) ? event.recruitment_leads[0] : event.recruitment_leads;
      const location = Array.isArray(leadRelation?.recruitment_locations) ? leadRelation.recruitment_locations[0] : leadRelation?.recruitment_locations;
      const role = Array.isArray(leadRelation?.recruitment_roles) ? leadRelation.recruitment_roles[0] : leadRelation?.recruitment_roles;
      const providerId = String(details.provider_employee_id ?? "");
      const operational = activity.get(providerId);
      const joiningDate = String(details.joining_date ?? "");
      const ageDays = joiningDate ? Math.max(0, Math.floor((Date.now() - new Date(`${joiningDate}T00:00:00+05:30`).getTime()) / 86_400_000)) : 0;
      return {
        leadId: event.lead_id,
        candidate: leadRelation?.full_name || "Unnamed",
        phone: leadRelation?.phone || "—",
        station: location?.code || "—",
        designation: role?.name || role?.code || "—",
        employeeId: details.employee_id || "—",
        providerEmployeeId: providerId || "—",
        companyId: details.company_id_value || "—",
        joiningDate: joiningDate || "—",
        recruiter: profileById.get(String(details.recruiter_profile_id ?? event.actor_profile_id))?.full_name || details.recruiter_email || event.actor_email || "—",
        daysWorked: operational?.dates.size ?? 0,
        deliveries: operational?.deliveries ?? 0,
        totalActivity: operational?.activity ?? 0,
        ageDays,
        retention30: ageDays < 30 ? "Not due" : (operational?.dates.size ?? 0) > 0 ? "Operational activity found" : "Review"
      };
    });
    const decisionsByRequest = new Map<string, any[]>();
    for (const decision of punchDecisions.data ?? []) decisionsByRequest.set(decision.request_id, [...(decisionsByRequest.get(decision.request_id) ?? []), decision]);
    const manualPunchRegister = (manualPunches.data ?? []).map((item:any) => {
      const audit=parseManualPunchRemarks(item.remarks);const duty=Array.isArray(item.recruitment_field_duties)?item.recruitment_field_duties[0]:item.recruitment_field_duties;
      const decisions=decisionsByRequest.get(item.id)??[];const last=decisions.at(-1);const recruiter=profileById.get(item.profile_id);const reviewer=profileById.get(last?.decided_by_profile_id??item.reviewed_by);
      return {requestId:item.id,date:item.attendance_date,recruiter:recruiter?.full_name||recruiter?.email||"—",employeeId:recruiter?.employee_id||"—",punchType:item.request_kind==="field_duty_out"?"OUT":"IN",requestedTime:String(item.request_kind==="field_duty_out"?item.requested_out_time:item.requested_in_time).slice(0,8),location:audit.locationName,gps:audit.gps,latitude:item.requested_latitude,longitude:item.requested_longitude,accuracyMeters:item.requested_accuracy_meters,reason:audit.reason,status:item.status,reviewer:reviewer?.full_name||reviewer?.email||"—",reviewComments:last?.comments||item.review_remarks||"",reviewedAt:last?.decided_at||item.reviewed_at||"",punchIn:duty?.punch_in_at||"",punchInSource:duty?.punch_in_source||"",punchOut:duty?.punch_out_at||"",punchOutSource:duty?.punch_out_source||"",workedMinutes:duty?.worked_minutes??""};
    });
    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      recruiterFunnel: [...funnelByRecruiter.values()].sort((a, b) => b.joined - a.joined || b.calls - a.calls),
      joiningRegister,
      manualPunchRegister,
      retentionSummary: {
        joined: joiningRegister.length,
        due30: joiningRegister.filter((row) => row.ageDays >= 30).length,
        activityFound: joiningRegister.filter((row) => row.daysWorked > 0).length,
        review: joiningRegister.filter((row) => row.retention30 === "Review").length
      }
    });
  } catch (error) {
    console.error("Recruitment master reports failed", error);
    return NextResponse.json({ error: "Unable to load restricted recruitment reports." }, { status: 500 });
  }
}
