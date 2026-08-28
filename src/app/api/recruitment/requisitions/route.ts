import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { canUseRecruitmentMenu, recruitmentSession, requiredEnv } from "@/lib/recruitment-api";
import { extractRecruitmentDocumentText, supportedRecruitmentDocument } from "@/lib/resume-text";
import { uploadRecruitmentDocument } from "@/lib/recruitment-documents";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function text(value: unknown, limit = 500) { return String(value ?? "").trim().slice(0, limit); }
function optional(value: unknown, limit = 500) { return text(value, limit) || null; }
function numberValue(value: unknown) {
  if (value === "" || value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function list(value: unknown) {
  return [...new Set(String(value ?? "").split(/[,\n]/).map((item) => item.trim()).filter(Boolean))].slice(0, 80);
}
function code() {
  const month = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "2-digit", month: "2-digit" }).format(new Date()).replace("-", "");
  return `REQ-${month}-${randomBytes(3).toString("hex").toUpperCase()}`;
}

async function scopedRequisitions(session: NonNullable<Awaited<ReturnType<typeof recruitmentSession>>>, companyId: string) {
  let query = supabaseAdmin!.from("recruitment_job_requisitions")
    .select("id,requisition_code,title,worker_type,openings,filled_positions,status,priority,target_joining_date,experience_min_years,experience_max_years,education,salary_min,salary_max,currency,jd_text,jd_file_name,must_have_skills,preferred_skills,source_channels,version,approved_at,created_at,updated_at,role_id,location_id,hiring_manager_profile_id,recruiter_profile_id,recruitment_roles(code,name),recruitment_locations(code,name),hiring_manager:profiles!recruitment_job_requisitions_hiring_manager_profile_id_fkey(id,full_name,email),recruiter:profiles!recruitment_job_requisitions_recruiter_profile_id_fkey(id,full_name,email)")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false });
  if (!session.isOwner && !session.allLocations) query = query.in("location_id", session.locationIds);
  if (!session.isOwner && session.roleIds.length) query = query.in("role_id", session.roleIds);
  const result = await query;
  if (result.error) throw new Error(result.error.message);
  const ids = (result.data ?? []).map((item) => item.id);
  const counts = ids.length ? await supabaseAdmin!.from("recruitment_applications")
    .select("requisition_id,status").eq("company_id", companyId).in("requisition_id", ids) : { data: [], error: null };
  if (counts.error) throw new Error(counts.error.message);
  const applicationCounts = new Map<string, { total: number; active: number; hired: number }>();
  for (const row of counts.data ?? []) {
    const current = applicationCounts.get(row.requisition_id) ?? { total: 0, active: 0, hired: 0 };
    current.total += 1;
    if (row.status === "active") current.active += 1;
    if (["hired", "transferred"].includes(row.status)) current.hired += 1;
    applicationCounts.set(row.requisition_id, current);
  }
  return (result.data ?? []).map((item) => ({ ...item, applications: applicationCounts.get(item.id) ?? { total: 0, active: 0, hired: 0 } }));
}

export async function GET(request: Request) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase is not configured.");
    const session = await recruitmentSession(request);
    if (!session || !canUseRecruitmentMenu(session, "Job Requisitions", "view", "hr")) {
      return NextResponse.json({ error: "HR Job Requisitions access is required." }, { status: 403 });
    }
    const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
    const [requisitions, people] = await Promise.all([
      scopedRequisitions(session, companyId),
      supabaseAdmin.from("profiles").select("id,full_name,email").eq("company_id", companyId).eq("is_active", true).order("full_name")
    ]);
    if (people.error) throw new Error(people.error.message);
    return NextResponse.json({ requisitions, people: people.data ?? [] });
  } catch (error) {
    console.error("Requisition list failed", error);
    return NextResponse.json({ error: "Unable to load job requisitions." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase is not configured.");
    const session = await recruitmentSession(request);
    if (!session || !canUseRecruitmentMenu(session, "Job Requisitions", "add", "hr")) {
      return NextResponse.json({ error: "Add access to HR Job Requisitions is required." }, { status: 403 });
    }
    const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
    const form = await request.formData();
    const title = text(form.get("title"), 180);
    const roleId = text(form.get("roleId"), 80);
    const locationId = text(form.get("locationId"), 80);
    const workerType = text(form.get("workerType"), 20);
    const openings = Math.max(1, Math.min(10000, Math.round(Number(form.get("openings")) || 1)));
    const requestedStatus = text(form.get("status"), 30);
    const priority = text(form.get("priority"), 30) || "normal";
    const jdFile = form.get("jdFile");
    let jdText = text(form.get("jdText"), 30_000);
    if (!title || !roleId || !locationId || !["employee", "contractor"].includes(workerType)) {
      return NextResponse.json({ error: "Title, position, location and worker type are required." }, { status: 400 });
    }
    if (!["low", "normal", "high", "critical"].includes(priority)) {
      return NextResponse.json({ error: "Choose a valid priority." }, { status: 400 });
    }
    if (jdFile instanceof File && jdFile.size) {
      if (!supportedRecruitmentDocument(jdFile)) return NextResponse.json({ error: "Upload a PDF, DOCX or TXT JD up to 15 MB." }, { status: 400 });
      jdText = await extractRecruitmentDocumentText(jdFile);
    }
    if (jdText.length < 80) return NextResponse.json({ error: "Add a detailed JD or upload a readable JD file." }, { status: 400 });
    const [role, location] = await Promise.all([
      supabaseAdmin.from("recruitment_roles").select("id,stream").eq("company_id", companyId).eq("id", roleId).eq("stream", "hr").eq("is_active", true).maybeSingle(),
      supabaseAdmin.from("recruitment_locations").select("id").eq("company_id", companyId).eq("id", locationId).eq("is_active", true).maybeSingle()
    ]);
    if (role.error || location.error || !role.data || !location.data) return NextResponse.json({ error: "Choose an active HR position and business location." }, { status: 400 });
    if (!session.isOwner && !session.allLocations && !session.locationIds.includes(locationId)) return NextResponse.json({ error: "That location is outside your access scope." }, { status: 403 });
    if (!session.isOwner && session.roleIds.length && !session.roleIds.includes(roleId)) return NextResponse.json({ error: "That position is outside your access scope." }, { status: 403 });
    const mayApprove = canUseRecruitmentMenu(session, "Job Requisitions", "all", "hr");
    const status = requestedStatus === "open" ? (mayApprove ? "open" : "pending_approval") : "draft";
    const inserted = await supabaseAdmin.from("recruitment_job_requisitions").insert({
      company_id: companyId,
      requisition_code: code(),
      title,
      role_id: roleId,
      location_id: locationId,
      worker_type: workerType,
      openings,
      status,
      priority,
      hiring_manager_profile_id: optional(form.get("hiringManagerId"), 80),
      recruiter_profile_id: optional(form.get("recruiterId"), 80) || session.profileId,
      target_joining_date: optional(form.get("targetJoiningDate"), 20),
      experience_min_years: numberValue(form.get("experienceMin")),
      experience_max_years: numberValue(form.get("experienceMax")),
      education: optional(form.get("education"), 1000),
      salary_min: numberValue(form.get("salaryMin")),
      salary_max: numberValue(form.get("salaryMax")),
      jd_text: jdText,
      must_have_skills: list(form.get("mustHaveSkills")),
      preferred_skills: list(form.get("preferredSkills")),
      source_channels: list(form.get("sourceChannels")),
      approved_by: status === "open" ? session.profileId : null,
      approved_at: status === "open" ? new Date().toISOString() : null,
      created_by: session.profileId,
      updated_by: session.profileId
    }).select("id,requisition_code,title,status").single();
    if (inserted.error) throw new Error(inserted.error.message);
    let storedFile: { path: string; name: string } | null = null;
    if (jdFile instanceof File && jdFile.size) {
      storedFile = await uploadRecruitmentDocument({ companyId, leadId: inserted.data.id, documentType: "job-description", fileName: jdFile.name, contentType: jdFile.type || "application/octet-stream", bytes: await jdFile.arrayBuffer() });
      const updated = await supabaseAdmin.from("recruitment_job_requisitions").update({ jd_storage_path: storedFile.path, jd_file_name: storedFile.name }).eq("company_id", companyId).eq("id", inserted.data.id);
      if (updated.error) throw new Error(updated.error.message);
    }
    const event = await supabaseAdmin.from("recruitment_requisition_events").insert({
      company_id: companyId, requisition_id: inserted.data.id, event_type: "created",
      summary: `Requisition created as ${status.replaceAll("_", " ")}.`,
      metadata: { worker_type: workerType, openings, jd_file: storedFile?.name ?? null },
      actor_profile_id: session.profileId, actor_email: session.email
    });
    if (event.error) throw new Error(event.error.message);
    return NextResponse.json({ saved: true, requisition: inserted.data, message: status === "pending_approval" ? "Requisition submitted for approval." : "Requisition saved." });
  } catch (error) {
    console.error("Requisition create failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to create requisition." }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase is not configured.");
    const session = await recruitmentSession(request);
    if (!session || !canUseRecruitmentMenu(session, "Job Requisitions", "edit", "hr")) return NextResponse.json({ error: "Edit access is required." }, { status: 403 });
    const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
    const body = await request.json() as Record<string, unknown>;
    const id = text(body.id, 80);
    const nextStatus = text(body.status, 30);
    if (!id || !["draft", "pending_approval", "open", "on_hold", "closed", "cancelled"].includes(nextStatus)) return NextResponse.json({ error: "Choose a valid requisition status." }, { status: 400 });
    const existing = await supabaseAdmin.from("recruitment_job_requisitions").select("id,status,location_id,role_id,approved_at").eq("company_id", companyId).eq("id", id).maybeSingle();
    if (existing.error || !existing.data) return NextResponse.json({ error: "Requisition not found." }, { status: 404 });
    if (!session.isOwner && !session.allLocations && !session.locationIds.includes(existing.data.location_id)) return NextResponse.json({ error: "Requisition not found in your scope." }, { status: 404 });
    if (!session.isOwner && session.roleIds.length && !session.roleIds.includes(existing.data.role_id)) return NextResponse.json({ error: "Requisition not found in your scope." }, { status: 404 });
    const isApprovedReopen = nextStatus === "open" && existing.data.status === "on_hold" && Boolean(existing.data.approved_at);
    if (nextStatus === "open" && !isApprovedReopen && !canUseRecruitmentMenu(session, "Job Requisitions", "all", "hr")) {
      return NextResponse.json({ error: "Approval access is required to open a new requisition." }, { status: 403 });
    }
    const updatePayload: Record<string, unknown> = { status: nextStatus, updated_by: session.profileId };
    if (nextStatus === "open" && !isApprovedReopen) {
      updatePayload.approved_by = session.profileId;
      updatePayload.approved_at = new Date().toISOString();
    }
    const result = await supabaseAdmin.from("recruitment_job_requisitions").update(updatePayload).eq("company_id", companyId).eq("id", id).select("id,status").single();
    if (result.error) throw new Error(result.error.message);
    await supabaseAdmin.from("recruitment_requisition_events").insert({ company_id: companyId, requisition_id: id, event_type: "status_changed", summary: `${existing.data.status} → ${nextStatus}`, metadata: { from: existing.data.status, to: nextStatus }, actor_profile_id: session.profileId, actor_email: session.email });
    return NextResponse.json({ saved: true, requisition: result.data });
  } catch (error) {
    console.error("Requisition status update failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to update requisition." }, { status: 400 });
  }
}
