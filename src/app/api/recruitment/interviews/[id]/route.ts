import { NextResponse } from "next/server";
import { canUseRecruitmentMenu, recruitmentSession, requiredEnv } from "@/lib/recruitment-api";
import {
  interviewDecisionTransition,
  loadHrLifecycleRules,
  loadHrWorkflowSettings,
  validateHrTransition,
  type HrInterviewDecision
} from "@/lib/hr-recruitment-lifecycle";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function value(input: unknown, limit = 3000) {
  return String(input ?? "").trim().slice(0, limit);
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase is not configured.");
    const session = await recruitmentSession(request);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
    const assignment = await supabaseAdmin.from("recruitment_hr_interviews")
      .select("id,lead_id,round_no,interviewer_profile_id,status,scheduled_at")
      .eq("company_id", companyId).eq("id", params.id).maybeSingle();
    if (assignment.error) throw new Error(assignment.error.message);
    if (!assignment.data) return NextResponse.json({ error: "Interview assignment not found." }, { status: 404 });
    const isAssignee = assignment.data.interviewer_profile_id === session.profileId;
    const allowed = session.isOwner
      || (isAssignee && canUseRecruitmentMenu(session, "My Interviews", "edit", "hr"))
      || canUseRecruitmentMenu(session, "Interviews", "all", "hr");
    if (!allowed) {
      return NextResponse.json({ error: "Only the assigned interviewer or an authorised HR lead can record this decision." }, { status: 403 });
    }
    if (!["scheduled", "rescheduled"].includes(assignment.data.status)) {
      return NextResponse.json({ error: "This interview is already closed. Reschedule it before entering another decision." }, { status: 409 });
    }
    const body = await request.json() as Record<string, unknown>;
    const decision = value(body.decision, 30) as HrInterviewDecision;
    const feedback = value(body.feedback);
    if (!["advance", "selected", "hold", "rejected", "no_show"].includes(decision)) {
      return NextResponse.json({ error: "Choose a valid interview decision." }, { status: 400 });
    }
    const lead = await supabaseAdmin.from("recruitment_leads")
      .select("id,status")
      .eq("company_id", companyId).eq("id", assignment.data.lead_id).maybeSingle();
    if (lead.error) throw new Error(lead.error.message);
    if (!lead.data) return NextResponse.json({ error: "Candidate not found." }, { status: 404 });

    const [rules, workflowSettings] = await Promise.all([
      loadHrLifecycleRules(supabaseAdmin as any, companyId),
      loadHrWorkflowSettings(supabaseAdmin as any, companyId)
    ]);
    const nextStatus = interviewDecisionTransition(decision, assignment.data.round_no, workflowSettings.maxInterviewRounds);
    if (decision === "advance" || decision === "selected") {
      validateHrTransition({
        currentCode: lead.data.status,
        nextCode: "interview_completed",
        actor: session.isOwner ? "owner" : "interviewer",
        remarks: feedback,
        rules
      });
      validateHrTransition({
        currentCode: "interview_completed",
        nextCode: nextStatus,
        actor: session.isOwner ? "owner" : "interviewer",
        remarks: feedback,
        rules
      });
    } else {
      validateHrTransition({
        currentCode: lead.data.status,
        nextCode: nextStatus,
        actor: session.isOwner ? "owner" : "interviewer",
        remarks: feedback,
        rules
      });
    }
    const now = new Date().toISOString();
    const assignmentStatus = decision === "no_show" ? "no_show" : "completed";
    const [savedAssignment, savedLead, audited] = await Promise.all([
      supabaseAdmin.from("recruitment_hr_interviews").update({
        status: assignmentStatus,
        decision,
        feedback,
        completed_at: now,
        updated_at: now
      }).eq("company_id", companyId).eq("id", assignment.data.id),
      supabaseAdmin.from("recruitment_leads").update({
        status: nextStatus,
        final_remarks: feedback,
        last_updated_by: session.profileId,
        updated_at: now
      }).eq("company_id", companyId).eq("id", lead.data.id),
      supabaseAdmin.from("recruitment_lead_history").insert({
        company_id: companyId,
        lead_id: lead.data.id,
        event_type: "hr_interview_decision",
        field_name: "status",
        old_value: lead.data.status,
        new_value: nextStatus,
        remarks: feedback,
        actor_profile_id: session.profileId,
        actor_email: session.email,
        metadata: {
          assignment_id: assignment.data.id,
          round: assignment.data.round_no,
          interviewer_profile_id: assignment.data.interviewer_profile_id,
          decision
        }
      })
    ]);
    if (savedAssignment.error || savedLead.error || audited.error) {
      throw new Error(savedAssignment.error?.message || savedLead.error?.message || audited.error?.message);
    }
    return NextResponse.json({ saved: true, nextStatus, message: "Interview decision recorded and the candidate lifecycle advanced." });
  } catch (error) {
    console.error("Interview decision failed", error);
    const message = error instanceof Error ? error.message : "Unable to save interview decision.";
    return NextResponse.json({ error: message }, { status: /only|required|choose|valid|allowed|terminal/i.test(message) ? 400 : 500 });
  }
}
