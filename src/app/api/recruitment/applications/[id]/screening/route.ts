import { NextResponse } from "next/server";
import { canAccessLead, canUseRecruitmentMenu, recruitmentSession, requiredEnv } from "@/lib/recruitment-api";
import { analyzeCandidateFit, screeningModel, screeningPromptVersion } from "@/lib/recruitment-screening";
import { extractRecruitmentDocumentText } from "@/lib/resume-text";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

async function authorizedApplication(request: Request, id: string, action: "view" | "add" | "edit") {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  const session = await recruitmentSession(request);
  if (!session || !canUseRecruitmentMenu(session, "AI Fit Review", action, "hr")) return { error: NextResponse.json({ error: `${action === "view" ? "View" : action === "add" ? "Add" : "Edit"} access to AI Fit Review is required.` }, { status: 403 }) };
  const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
  const application = await supabaseAdmin.from("recruitment_applications")
    .select("id,lead_id,requisition_id,resume_storage_path,resume_file_name,resume_content_type,recruitment_leads(id,full_name,stream,location_id,role_id),recruitment_job_requisitions(id,requisition_code,title,jd_text,version,status)")
    .eq("company_id", companyId).eq("id", id).maybeSingle();
  if (application.error) throw new Error(application.error.message);
  const lead = Array.isArray(application.data?.recruitment_leads) ? application.data?.recruitment_leads[0] : application.data?.recruitment_leads;
  if (!application.data || !lead || lead.stream !== "hr" || !canAccessLead(session, lead)) return { error: NextResponse.json({ error: "Application not found in your HR scope." }, { status: 404 }) };
  return { session, companyId, application: application.data, lead };
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const resolved = await authorizedApplication(request, params.id, "view");
    if (resolved.error) return resolved.error;
    const result = await supabaseAdmin!.from("recruitment_ai_screening_results")
      .select("id,status,fit_score,recommendation,summary,must_have_matches,strengths,gaps,evidence,interview_questions,confidence,model,prompt_version,input_tokens,output_tokens,redaction_applied,reviewer_decision,reviewer_note,reviewed_at,created_at,reviewer:profiles!recruitment_ai_screening_results_reviewed_by_fkey(full_name,email)")
      .eq("company_id", resolved.companyId!).eq("application_id", params.id).order("created_at", { ascending: false }).limit(20);
    if (result.error) throw new Error(result.error.message);
    return NextResponse.json({ results: result.data ?? [], humanDecisionRequired: true, protectedTraitsExcluded: true });
  } catch (error) {
    console.error("AI screening list failed", error);
    return NextResponse.json({ error: "Unable to load fit reviews." }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  let resolved: Awaited<ReturnType<typeof authorizedApplication>> | null = null;
  try {
    resolved = await authorizedApplication(request, params.id, "add");
    if (resolved.error) return resolved.error;
    const application = resolved.application! as any;
    const lead = resolved.lead! as any;
    const requisition = Array.isArray(application.recruitment_job_requisitions) ? application.recruitment_job_requisitions[0] : application.recruitment_job_requisitions;
    if (!requisition?.jd_text) return NextResponse.json({ error: "The requisition has no job description to compare." }, { status: 409 });
    if (!application.resume_storage_path) return NextResponse.json({ error: "Upload a resume before running fit analysis." }, { status: 409 });
    const downloaded = await supabaseAdmin!.storage.from("recruitment-documents").download(application.resume_storage_path);
    if (downloaded.error || !downloaded.data) throw new Error(downloaded.error?.message ?? "Resume download failed.");
    const resumeFile = new File([await downloaded.data.arrayBuffer()], application.resume_file_name || "resume.pdf", { type: application.resume_content_type || downloaded.data.type || "application/octet-stream" });
    const resumeText = await extractRecruitmentDocumentText(resumeFile);
    const result = await analyzeCandidateFit({ jobDescription: requisition.jd_text, resumeText, candidateName: lead.full_name });
    const saved = await supabaseAdmin!.from("recruitment_ai_screening_results").insert({
      company_id: resolved.companyId,
      application_id: params.id,
      requisition_version: requisition.version,
      model: result.model,
      prompt_version: screeningPromptVersion,
      status: "completed",
      fit_score: result.fitScore,
      recommendation: result.recommendation,
      summary: result.summary,
      must_have_matches: result.mustHaveMatches,
      strengths: result.strengths,
      gaps: result.gaps,
      evidence: result.evidence,
      interview_questions: result.interviewQuestions,
      confidence: result.confidence,
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
      redaction_applied: true,
      created_by: resolved.session!.profileId
    }).select("id,fit_score,recommendation,summary,must_have_matches,strengths,gaps,evidence,interview_questions,confidence,model,created_at").single();
    if (saved.error) throw new Error(saved.error.message);
    const updated = await supabaseAdmin!.from("recruitment_applications").update({ latest_screened_at: new Date().toISOString() }).eq("company_id", resolved.companyId).eq("id", params.id);
    if (updated.error) throw new Error(updated.error.message);
    await supabaseAdmin!.from("recruitment_lead_history").insert({
      company_id: resolved.companyId, lead_id: application.lead_id, event_type: "ai_fit_review_created",
      remarks: `Evidence fit review created for ${requisition.requisition_code}. Human review required.`,
      actor_profile_id: resolved.session!.profileId, actor_email: resolved.session!.email,
      metadata: { application_id: params.id, screening_result_id: saved.data.id, model: result.model, prompt_version: screeningPromptVersion }
    });
    return NextResponse.json({ saved: true, result: saved.data, humanDecisionRequired: true });
  } catch (error) {
    console.error("AI screening failed", error);
    if (resolved && !resolved.error && resolved.companyId && resolved.application && resolved.session) {
      const failedRequisition = Array.isArray((resolved.application as any).recruitment_job_requisitions)
        ? (resolved.application as any).recruitment_job_requisitions[0]
        : (resolved.application as any).recruitment_job_requisitions;
      await supabaseAdmin?.from("recruitment_ai_screening_results").insert({
        company_id: resolved.companyId, application_id: params.id,
        requisition_version: Number(failedRequisition?.version || 1),
        model: screeningModel, prompt_version: screeningPromptVersion, status: "failed",
        error_code: error instanceof Error ? error.message.slice(0, 300) : "screening_failed",
        created_by: resolved.session.profileId
      });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "AI screening could not be completed." }, { status: 400 });
  }
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const resolved = await authorizedApplication(request, params.id, "edit");
    if (resolved.error) return resolved.error;
    const body = await request.json() as Record<string, unknown>;
    const resultId = String(body.resultId ?? "").trim();
    const decision = String(body.decision ?? "").trim();
    const note = String(body.note ?? "").trim().slice(0, 1000);
    if (!resultId || !["advance", "hold", "decline"].includes(decision)) return NextResponse.json({ error: "Choose a valid human review decision." }, { status: 400 });
    if (decision === "decline" && note.length < 5) return NextResponse.json({ error: "Add a job-related reason when declining after review." }, { status: 400 });
    const updated = await supabaseAdmin!.from("recruitment_ai_screening_results").update({ reviewer_decision: decision, reviewer_note: note || null, reviewed_by: resolved.session!.profileId, reviewed_at: new Date().toISOString() }).eq("company_id", resolved.companyId!).eq("application_id", params.id).eq("id", resultId).select("id,reviewer_decision,reviewed_at").maybeSingle();
    if (updated.error || !updated.data) return NextResponse.json({ error: "Fit review result was not found." }, { status: 404 });
    await supabaseAdmin!.from("recruitment_lead_history").insert({
      company_id: resolved.companyId, lead_id: resolved.application!.lead_id, event_type: "ai_fit_review_human_decision",
      remarks: `Human reviewer recorded ${decision}. ${note}`.trim(), actor_profile_id: resolved.session!.profileId, actor_email: resolved.session!.email,
      metadata: { application_id: params.id, screening_result_id: resultId, decision }
    });
    return NextResponse.json({ saved: true, review: updated.data });
  } catch (error) {
    console.error("AI screening review failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to save human review." }, { status: 400 });
  }
}
