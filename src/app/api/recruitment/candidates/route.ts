import { NextResponse } from "next/server";
import { applyLeadScope, canUseRecruitmentMenu, recruitmentSession, requiredEnv } from "@/lib/recruitment-api";
import { candidateJourney, hrLifecycleFilterOptions } from "@/lib/hr-ats-product";
import { loadHrLifecycleRules } from "@/lib/hr-recruitment-lifecycle";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function csv(value: string | null) {
  return (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

function relation<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

export async function GET(request: Request) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase is not configured.");
    const session = await recruitmentSession(request);
    if (!session || !canUseRecruitmentMenu(session, "Resume Intake", "view", "hr")) {
      return NextResponse.json({ error: "View access to the HR Candidate Database is required." }, { status: 403 });
    }
    const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
    const url = new URL(request.url);
    const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
    const limit = Math.min(100, Math.max(10, Number(url.searchParams.get("limit") ?? 50)));
    const search = String(url.searchParams.get("search") ?? "").trim();
    const statuses = csv(url.searchParams.get("status"));
    const sources = csv(url.searchParams.get("source"));
    const archive = url.searchParams.get("archive") ?? "active";

    let query: any = supabaseAdmin.from("recruitment_leads")
      .select("id,full_name,phone,email,city,post_code,status,source,ad_name,archived,location_id,role_id,assigned_profile_id,last_updated_by,lead_created_at,updated_at,assigned_profile:profiles!recruitment_leads_assigned_profile_id_fkey(id,full_name,email),last_updated_profile:profiles!recruitment_leads_last_updated_by_fkey(id,full_name,email),recruitment_locations(code,name),recruitment_roles(code,name)", { count: "exact" })
      .eq("company_id", companyId);
    query = applyLeadScope(query, session, "hr");
    if (archive === "archived") query = query.eq("archived", true);
    else if (archive !== "all") query = query.eq("archived", false);
    if (statuses.length) query = query.in("status", statuses);
    if (sources.length) query = query.in("source", sources);
    if (search) {
      const safe = search.replace(/[,%()]/g, " ").trim();
      if (safe) query = query.or(`full_name.ilike.%${safe}%,phone.ilike.%${safe}%,email.ilike.%${safe}%,city.ilike.%${safe}%,post_code.ilike.%${safe}%,source.ilike.%${safe}%,ad_name.ilike.%${safe}%`);
    }
    const from = (page - 1) * limit;
    const leads = await query.order("updated_at", { ascending: false }).range(from, from + limit - 1);
    if (leads.error) throw new Error(leads.error.message);
    const leadIds = (leads.data ?? []).map((lead: any) => lead.id);
    const [applications, history, interviews, offers, lifecycleRules] = await Promise.all([
      leadIds.length ? supabaseAdmin.from("recruitment_applications")
        .select("id,lead_id,requisition_id,source,current_stage,status,resume_storage_path,resume_file_name,latest_screened_at,applied_at,recruitment_job_requisitions(id,requisition_code,title)")
        .eq("company_id", companyId).in("lead_id", leadIds).order("applied_at", { ascending: false }) : Promise.resolve({ data: [], error: null }),
      leadIds.length ? supabaseAdmin.from("recruitment_lead_history")
        .select("id,lead_id,event_type,remarks,actor_profile_id,actor_email,metadata,created_at")
        .eq("company_id", companyId).in("lead_id", leadIds)
        .in("event_type", ["hr_document_uploaded", "hr_document_replaced", "hr_screening_profile", "hr_initial_call_outcome", "hr_interview_decision", "hr_interview_forwarded", "hr_interview_invitation_sent", "hr_interview_invitation_failed", "manual_profile_created", "source_ingest"])
        .order("created_at", { ascending: false }) : Promise.resolve({ data: [], error: null }),
      leadIds.length ? supabaseAdmin.from("recruitment_hr_interviews")
        .select("id,lead_id,round_no,status,scheduled_at,meet_link,calendar_event_id,invitation_delivery,decision,feedback,updated_at")
        .eq("company_id", companyId).in("lead_id", leadIds).order("updated_at", { ascending: false }) : Promise.resolve({ data: [], error: null }),
      leadIds.length ? supabaseAdmin.from("recruitment_hr_offer_versions")
        .select("id,lead_id,version_no,status,job_title,joining_date,issued_at,updated_at")
        .eq("company_id", companyId).in("lead_id", leadIds).order("updated_at", { ascending: false }) : Promise.resolve({ data: [], error: null }),
      loadHrLifecycleRules(supabaseAdmin as any, companyId)
    ]);
    const relatedError = applications.error || history.error || interviews.error || offers.error;
    if (relatedError) throw new Error(relatedError.message);

    const byLead = <T extends { lead_id: string }>(rows: T[]) => {
      const map = new Map<string, T[]>();
      for (const row of rows) map.set(row.lead_id, [...(map.get(row.lead_id) ?? []), row]);
      return map;
    };
    const applicationByLead = byLead((applications.data ?? []) as any[]);
    const historyByLead = byLead((history.data ?? []) as any[]);
    const interviewByLead = byLead((interviews.data ?? []) as any[]);
    const offerByLead = byLead((offers.data ?? []) as any[]);

    const candidates = (leads.data ?? []).map((lead: any) => {
      const leadApplications = applicationByLead.get(lead.id) ?? [];
      const events = historyByLead.get(lead.id) ?? [];
      const leadInterviews = interviewByLead.get(lead.id) ?? [];
      const leadOffers = offerByLead.get(lead.id) ?? [];
      const application = leadApplications[0] ?? null;
      const resumeEvent = events.find((event: any) => ["hr_document_uploaded", "hr_document_replaced"].includes(event.event_type)
        && String(event.metadata?.document_type ?? "resume") === "resume");
      const screening = events.find((event: any) => event.event_type === "hr_screening_profile");
      const feedbackEvent = events.find((event: any) => ["hr_interview_decision", "hr_screening_profile", "hr_initial_call_outcome"].includes(event.event_type));
      const latestInterview = leadInterviews[0] ?? null;
      const latestOffer = leadOffers[0] ?? null;
      const hasResume = Boolean(application?.resume_storage_path || resumeEvent);
      const journey = candidateJourney(lead.status, lifecycleRules, {
        hasResume,
        interviewCount: leadInterviews.length,
        latestInterviewStatus: latestInterview?.status,
        latestInterviewHasCalendar: Boolean(latestInterview?.calendar_event_id),
        latestInterviewHasMeet: Boolean(latestInterview?.meet_link),
        latestOfferStatus: latestOffer?.status
      });
      return {
        ...lead,
        recruitment_locations: relation(lead.recruitment_locations),
        recruitment_roles: relation(lead.recruitment_roles),
        assigned_profile: relation(lead.assigned_profile),
        last_updated_profile: relation(lead.last_updated_profile),
        application: application ? {
          ...application,
          recruitment_job_requisitions: relation(application.recruitment_job_requisitions)
        } : null,
        hasResume,
        resumeFileName: application?.resume_file_name ?? resumeEvent?.metadata?.file_name ?? null,
        latestScreening: screening ? { remarks: screening.remarks, metadata: screening.metadata, createdAt: screening.created_at, actorEmail: screening.actor_email } : null,
        latestFeedback: feedbackEvent ? { type: feedbackEvent.event_type, remarks: feedbackEvent.remarks, createdAt: feedbackEvent.created_at, actorEmail: feedbackEvent.actor_email } : null,
        interviews: { count: leadInterviews.length, latest: latestInterview },
        offer: latestOffer,
        journey
      };
    });
    const sourceCounts = new Map<string, number>();
    for (const candidate of candidates) {
      const source = String(candidate.application?.source || candidate.source || "unknown");
      sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1);
    }
    return NextResponse.json({
      candidates,
      total: leads.count ?? candidates.length,
      page,
      limit,
      statuses: hrLifecycleFilterOptions(lifecycleRules).map(([value, label]) => ({ value, label })),
      sources: [...sourceCounts.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count),
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error("Candidate database failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load the candidate database." }, { status: 500 });
  }
}
