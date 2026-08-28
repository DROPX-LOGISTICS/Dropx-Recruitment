import { createHash, randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { canAccessLead, canUseRecruitmentMenu, recruitmentSession, requiredEnv } from "@/lib/recruitment-api";
import { uploadRecruitmentDocument } from "@/lib/recruitment-documents";
import { normalizePhone } from "@/lib/recruitment-routing";
import { extractRecruitmentDocumentText, supportedRecruitmentDocument } from "@/lib/resume-text";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function text(value: unknown, limit = 500) { return String(value ?? "").trim().slice(0, limit); }
const manualSources = new Set(["linkedin", "referral", "naukri", "email", "walk_in", "cv_pool", "other"]);

export async function GET(request: Request) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase is not configured.");
    const session = await recruitmentSession(request);
    const requestedMenu = new URL(request.url).searchParams.get("menu") === "AI Fit Review" ? "AI Fit Review" : "Resume Intake";
    if (!session || !canUseRecruitmentMenu(session, requestedMenu, "view", "hr")) return NextResponse.json({ error: `HR ${requestedMenu} access is required.` }, { status: 403 });
    const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
    let query = supabaseAdmin.from("recruitment_applications")
      .select("id,lead_id,requisition_id,source,current_stage,status,applied_at,resume_file_name,latest_screened_at,people_worker_type,people_record_id,transferred_at,recruitment_leads(id,full_name,phone,email,city,status,location_id,role_id,recruitment_locations(code,name),recruitment_roles(code,name)),recruitment_job_requisitions(id,requisition_code,title,status,worker_type,location_id,role_id)")
      .eq("company_id", companyId).order("applied_at", { ascending: false }).limit(250);
    const result = await query;
    if (result.error) throw new Error(result.error.message);
    const scoped = (result.data ?? []).filter((item: any) => {
      const lead = Array.isArray(item.recruitment_leads) ? item.recruitment_leads[0] : item.recruitment_leads;
      return lead && canAccessLead(session, { stream: "hr", location_id: lead.location_id, role_id: lead.role_id });
    });
    const ids = scoped.map((item) => item.id);
    const screening = ids.length ? await supabaseAdmin.from("recruitment_ai_screening_results")
      .select("id,application_id,status,fit_score,recommendation,summary,confidence,reviewer_decision,reviewed_at,created_at")
      .eq("company_id", companyId).in("application_id", ids).order("created_at", { ascending: false }) : { data: [], error: null };
    if (screening.error) throw new Error(screening.error.message);
    const latest = new Map<string, any>();
    for (const row of screening.data ?? []) if (!latest.has(row.application_id)) latest.set(row.application_id, row);
    let requisitionQuery = supabaseAdmin.from("recruitment_job_requisitions")
      .select("id,requisition_code,title,status,worker_type,location_id,role_id,recruitment_locations(code,name),recruitment_roles(code,name)")
      .eq("company_id", companyId).in("status", ["draft", "pending_approval", "open"]).order("created_at", { ascending: false });
    if (!session.isOwner && !session.allLocations) requisitionQuery = requisitionQuery.in("location_id", session.locationIds);
    if (!session.isOwner && session.roleIds.length) requisitionQuery = requisitionQuery.in("role_id", session.roleIds);
    const requisitions = await requisitionQuery;
    if (requisitions.error) throw new Error(requisitions.error.message);
    return NextResponse.json({
      applications: scoped.map((item) => ({ ...item, latestScreening: latest.get(item.id) ?? null })),
      requisitions: requisitions.data ?? []
    });
  } catch (error) {
    console.error("Application list failed", error);
    return NextResponse.json({ error: "Unable to load resume intake." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase is not configured.");
    const session = await recruitmentSession(request);
    if (!session || !canUseRecruitmentMenu(session, "Resume Intake", "add", "hr")) return NextResponse.json({ error: "Add access to HR Resume Intake is required." }, { status: 403 });
    const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
    const form = await request.formData();
    const requisitionId = text(form.get("requisitionId"), 80);
    const fullName = text(form.get("fullName"), 180);
    const rawPhone = text(form.get("phone"), 30);
    const phone = normalizePhone(rawPhone);
    const email = text(form.get("email"), 180).toLowerCase() || null;
    const city = text(form.get("city"), 180) || null;
    const requestedSource = text(form.get("source"), 40).toLowerCase();
    const source = manualSources.has(requestedSource) ? requestedSource : "cv_pool";
    const resume = form.get("resume");
    if (!requisitionId || fullName.length < 2 || (!phone && !email)) return NextResponse.json({ error: "Requisition, candidate name and a valid phone or email are required." }, { status: 400 });
    if (!(resume instanceof File) || !supportedRecruitmentDocument(resume)) return NextResponse.json({ error: "Upload a PDF, DOCX or TXT resume up to 15 MB." }, { status: 400 });
    await extractRecruitmentDocumentText(resume);
    const requisition = await supabaseAdmin.from("recruitment_job_requisitions")
      .select("id,requisition_code,title,status,location_id,role_id")
      .eq("company_id", companyId).eq("id", requisitionId).maybeSingle();
    if (requisition.error || !requisition.data || !["open", "pending_approval", "draft"].includes(requisition.data.status)) return NextResponse.json({ error: "Choose an active requisition." }, { status: 400 });
    if (!session.isOwner && !session.allLocations && !session.locationIds.includes(requisition.data.location_id)) return NextResponse.json({ error: "That requisition is outside your access scope." }, { status: 403 });
    if (!session.isOwner && session.roleIds.length && !session.roleIds.includes(requisition.data.role_id)) return NextResponse.json({ error: "That requisition is outside your position scope." }, { status: 403 });

    let existing: any = null;
    if (phone) {
      const result = await supabaseAdmin.from("recruitment_leads").select("id,location_id,role_id,stream").eq("company_id", companyId).eq("stream", "hr").eq("normalized_phone", phone).order("updated_at", { ascending: false }).limit(1).maybeSingle();
      if (result.error) throw new Error(result.error.message);
      existing = result.data;
    }
    if (!existing && email) {
      const result = await supabaseAdmin.from("recruitment_leads").select("id,location_id,role_id,stream").eq("company_id", companyId).eq("stream", "hr").ilike("email", email).order("updated_at", { ascending: false }).limit(1).maybeSingle();
      if (result.error) throw new Error(result.error.message);
      existing = result.data;
    }
    if (existing && !canAccessLead(session, existing)) return NextResponse.json({ error: "A matching candidate already exists outside your access scope." }, { status: 409 });
    const now = new Date().toISOString();
    let leadId = existing?.id as string | undefined;
    if (!leadId) {
      const identity = phone ? phone : `email-${createHash("sha256").update(email!).digest("hex").slice(0, 24)}`;
      const inserted = await supabaseAdmin.from("recruitment_leads").insert({
        company_id: companyId,
        canonical_key: `application:${source}:${requisition.data.requisition_code.toLowerCase()}:${identity || randomUUID()}`,
        normalized_phone: phone,
        full_name: fullName,
        phone: phone,
        email,
        city,
        location_id: requisition.data.location_id,
        role_id: requisition.data.role_id,
        stream: "hr",
        ad_name: requisition.data.requisition_code,
        source,
        status: "new",
        duplicate_count: 1,
        lead_created_at: now,
        last_updated_by: session.profileId,
        updated_at: now
      }).select("id").single();
      if (inserted.error) throw new Error(inserted.error.message);
      leadId = inserted.data.id;
    } else {
      const duplicateApplication = await supabaseAdmin.from("recruitment_applications").select("id").eq("company_id", companyId).eq("lead_id", leadId).eq("requisition_id", requisitionId).maybeSingle();
      if (duplicateApplication.error) throw new Error(duplicateApplication.error.message);
      if (duplicateApplication.data) return NextResponse.json({ error: "This candidate already has an application for the selected requisition." }, { status: 409 });
    }
    if (!leadId) throw new Error("Candidate identity could not be created.");
    const uploaded = await uploadRecruitmentDocument({ companyId, leadId, documentType: "resume", fileName: resume.name, contentType: resume.type || "application/octet-stream", bytes: await resume.arrayBuffer() });
    const application = await supabaseAdmin.from("recruitment_applications").insert({
      company_id: companyId, lead_id: leadId, requisition_id: requisitionId, source, current_stage: "new", status: "active",
      resume_storage_path: uploaded.path, resume_file_name: uploaded.name, resume_content_type: resume.type || null,
      created_by: session.profileId
    }).select("id,lead_id,requisition_id").single();
    if (application.error) throw new Error(application.error.message);
    const history = await supabaseAdmin.from("recruitment_lead_history").insert({
      company_id: companyId, lead_id: leadId, event_type: "manual_profile_created",
      remarks: `${source.replaceAll("_", " ")} resume intake for ${requisition.data.requisition_code} · ${requisition.data.title}`,
      actor_profile_id: session.profileId, actor_email: session.email,
      metadata: { application_id: application.data.id, requisition_id: requisitionId, source, resume_path: uploaded.path, file_name: uploaded.name }
    });
    if (history.error) throw new Error(history.error.message);
    return NextResponse.json({ saved: true, application: application.data, message: "Candidate profile and application created." });
  } catch (error) {
    console.error("Manual resume intake failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to create candidate application." }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase is not configured.");
    const session = await recruitmentSession(request);
    if (!session || !canUseRecruitmentMenu(session, "Resume Intake", "edit", "hr")) {
      return NextResponse.json({ error: "Edit access to HR Resume Intake is required." }, { status: 403 });
    }
    const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
    const body = await request.json() as Record<string, unknown>;
    const applicationId = text(body.applicationId, 80);
    if (!applicationId || body.action !== "send_to_people") {
      return NextResponse.json({ error: "Choose a valid application handoff action." }, { status: 400 });
    }
    const application = await supabaseAdmin.from("recruitment_applications")
      .select("id,lead_id,requisition_id,status,transferred_at,recruitment_leads(id,full_name,stream,status,location_id,role_id),recruitment_job_requisitions(id,requisition_code,title,worker_type)")
      .eq("company_id", companyId).eq("id", applicationId).maybeSingle();
    if (application.error) throw new Error(application.error.message);
    const lead = Array.isArray(application.data?.recruitment_leads) ? application.data.recruitment_leads[0] : application.data?.recruitment_leads;
    const requisition = Array.isArray(application.data?.recruitment_job_requisitions) ? application.data.recruitment_job_requisitions[0] : application.data?.recruitment_job_requisitions;
    if (!application.data || !lead || lead.stream !== "hr" || !requisition || !canAccessLead(session, lead)) {
      return NextResponse.json({ error: "Application not found in your HR scope." }, { status: 404 });
    }
    if (application.data.transferred_at) {
      return NextResponse.json({ error: "This candidate is already in the People handoff queue." }, { status: 409 });
    }
    if (lead.status !== "joined") {
      return NextResponse.json({ error: "Mark the candidate as Joined in HR Candidates before sending the profile to People." }, { status: 409 });
    }
    const screening = await supabaseAdmin.from("recruitment_ai_screening_results")
      .select("reviewer_decision").eq("company_id", companyId).eq("application_id", applicationId)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (screening.error) throw new Error(screening.error.message);
    if (screening.data && screening.data.reviewer_decision !== "advance") {
      return NextResponse.json({ error: "The latest AI fit review must be advanced by a human reviewer before People handoff." }, { status: 409 });
    }
    const transferredAt = new Date().toISOString();
    const updated = await supabaseAdmin.from("recruitment_applications").update({
      status: "transferred",
      current_stage: "people_handoff",
      people_worker_type: requisition.worker_type,
      transferred_at: transferredAt,
      transferred_by: session.profileId
    }).eq("company_id", companyId).eq("id", applicationId).is("transferred_at", null)
      .select("id,people_worker_type,transferred_at").maybeSingle();
    if (updated.error) throw new Error(updated.error.message);
    if (!updated.data) return NextResponse.json({ error: "This application was already handed off." }, { status: 409 });
    const history = await supabaseAdmin.from("recruitment_lead_history").insert({
      company_id: companyId,
      lead_id: application.data.lead_id,
      event_type: "people_handoff_created",
      remarks: `${requisition.worker_type === "contractor" ? "Independent contractor" : "Employee"} onboarding sent to People for mapping and activation.`,
      actor_profile_id: session.profileId,
      actor_email: session.email,
      metadata: { application_id: applicationId, requisition_id: application.data.requisition_id, worker_type: requisition.worker_type }
    });
    if (history.error) throw new Error(history.error.message);
    return NextResponse.json({ saved: true, application: updated.data, message: "Candidate sent to the People onboarding queue." });
  } catch (error) {
    console.error("People handoff failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to send candidate to People." }, { status: 400 });
  }
}
