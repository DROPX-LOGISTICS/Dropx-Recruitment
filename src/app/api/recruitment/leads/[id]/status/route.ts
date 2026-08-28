import { NextResponse } from "next/server";
import { canTransition, contactAttemptUpdate } from "@/lib/lead-lifecycle";
import { canAccessLead, canUseRecruitmentMenu, recruitmentSession, requiredEnv } from "@/lib/recruitment-api";
import { enqueueLeadNotification } from "@/lib/recruitment-notifications";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { loadWorkforceConfig } from "@/lib/recruitment-workforce-config";
import type { RecruitmentMenuId } from "@/lib/recruitment-menu-roles";
import { workforceInterviewActionOptions } from "@/lib/workforce-interview-lifecycle";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const legacyWorkforceDirectStatuses = new Set([
  "no_response","call_back","interested","not_interested","not_fit","long_distance",
  "wrong_number","interview_scheduled","interview_rescheduled","interview_completed",
  "interview_no_show","selected","joined","hold","closed","document_issue"
]);
const statusMenus = new Set<RecruitmentMenuId>(["All Leads", "No Response / Call Back", "Interviews", "Screening"]);
const workforceInterviewSourceStatuses = new Set(["interview_scheduled", "interview_rescheduled", "joined"]);

function isWorkforceInterviewOutcomeUpdate(
  stream: string | null | undefined,
  menu: RecruitmentMenuId,
  fromStatus: string | null | undefined,
  toStatus: string
) {
  if (stream !== "workforce" || menu !== "Interviews") return false;
  if (!workforceInterviewSourceStatuses.has(String(fromStatus ?? "").trim())) return false;
  return workforceInterviewActionOptions().some((item) => item.code === toStatus);
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase is not configured.");
    const session = await recruitmentSession(request);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await request.json() as { status?: string; remarks?: string; callbackAt?: string; interviewAt?: string; retry?: boolean; menu?: string };
    const nextStatus = String(body.status ?? "").trim();
    const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
    const workforceConfig = await loadWorkforceConfig(companyId);
    const current = await supabaseAdmin
      .from("recruitment_leads")
      .select("id, status, location_id, role_id, stream, remarks, phone, full_name, callback_at, assigned_profile_id, total_attempts, no_response_attempts, call_back_attempts, recruitment_roles(name)")
      .eq("company_id", companyId)
      .eq("id", params.id)
      .maybeSingle();
    if (current.error) throw new Error(current.error.message);
    if (!current.data) return NextResponse.json({ error: "Lead not found." }, { status: 404 });
    if (!canAccessLead(session, current.data)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const menu = String(body.menu ?? "All Leads") as RecruitmentMenuId;
    if (!statusMenus.has(menu) || !canUseRecruitmentMenu(session, menu, "edit", current.data.stream as "workforce"|"hr")) {
      return NextResponse.json({ error: "This role has View access only." }, { status: 403 });
    }
    const isRetry = body.retry === true && nextStatus === current.data.status &&
      ["no_response", "call_back"].includes(nextStatus);
    const configuredStatuses = new Set(workforceConfig.leadStatusMaster
      .filter((item) => item.isActive && ["workforce","both"].includes(item.stream))
      .map((item) => item.code));
    const workforceDirectStatuses = configuredStatuses.size ? configuredStatuses : legacyWorkforceDirectStatuses;
    const workforceQuickUpdate = current.data.stream === "workforce" &&
      !["archived","invalid"].includes(current.data.status) &&
      workforceDirectStatuses.has(nextStatus);
    const workforceInterviewOutcomeUpdate = isWorkforceInterviewOutcomeUpdate(
      current.data.stream,
      menu,
      current.data.status,
      nextStatus
    );
    if (!isRetry && !workforceQuickUpdate && !workforceInterviewOutcomeUpdate
      && !canTransition(current.data.status, nextStatus)) {
      return NextResponse.json({ error: `Transition from ${current.data.status || "new"} to ${nextStatus} is not allowed.` }, { status: 409 });
    }
    if (nextStatus === "call_back" && !body.callbackAt && !current.data.callback_at) {
      return NextResponse.json({ error: "Callback date and time are required." }, { status: 400 });
    }
    const now = new Date().toISOString();
    const update: Record<string, unknown> = {
      status: nextStatus,
      remarks: String(body.remarks ?? "").slice(0, 2000) || current.data.remarks,
      assigned_profile_id: current.data.assigned_profile_id || session.profileId,
      last_updated_by: session.profileId,
      updated_at: now
    };
    if (nextStatus === "call_back") update.callback_at = body.callbackAt || current.data.callback_at;
    if (["interview_scheduled", "interview_rescheduled"].includes(nextStatus)) {
      if (!body.interviewAt) return NextResponse.json({ error: "Interview date and time are required." }, { status: 400 });
      update.follow_up_at = body.interviewAt;
    }
    const attempt = contactAttemptUpdate({
      nextStatus,
      totalAttempts: current.data.total_attempts,
      noResponseAttempts: current.data.no_response_attempts,
      callBackAttempts: current.data.call_back_attempts,
      now
    });
    Object.assign(update, attempt.fields);
    const actualStatus = attempt.actualStatus;
    if (nextStatus === "archived") Object.assign(update, { archived: true, archived_at: now });
    const saved = await supabaseAdmin
      .from("recruitment_leads")
      .update(update)
      .eq("company_id", companyId)
      .eq("id", params.id)
      .select("id, status, updated_at")
      .single();
    if (saved.error) throw new Error(saved.error.message);
    const history = await supabaseAdmin.from("recruitment_lead_history").insert({
      company_id: companyId,
      lead_id: params.id,
      event_type: isRetry ? "contact_attempt" : "status_change",
      field_name: "status",
      old_value: current.data.status,
      new_value: actualStatus,
      remarks: body.remarks || null,
      actor_profile_id: session.profileId,
      actor_email: session.email,
      metadata: { source: "web_or_mobile", requested_status: nextStatus, retry: isRetry }
    });
    if (history.error) throw new Error(history.error.message);
    let notificationWarning = "";
    if (nextStatus === "no_response" || nextStatus === "interview_scheduled" || nextStatus === "interview_rescheduled") {
      try {
        const contact = current.data.location_id
          ? await supabaseAdmin.from("recruitment_location_contacts")
              .select("address,latitude,longitude,poc_mobile")
              .eq("company_id", companyId).eq("location_id", current.data.location_id).maybeSingle()
          : { data: null, error: null };
        if (contact.error) throw new Error(contact.error.message);
        const notification = await enqueueLeadNotification({
          companyId,
          lead: {
            id: current.data.id,
            phone: current.data.phone,
            full_name: current.data.full_name,
            stream: current.data.stream,
            location_id: current.data.location_id,
            recruitment_roles: current.data.recruitment_roles as { name?: string | null } | null,
            recruitment_locations: contact.data
          },
          trigger: nextStatus === "no_response" ? "no_response" : "interview",
          anchor: nextStatus === "no_response"
            ? `${Number(current.data.no_response_attempts || 0) + 1}`
            : String(body.interviewAt)
        });
        if (!notification.queued) {
          notificationWarning = notification.reason
            || "The status was saved, but the WhatsApp automation could not be queued.";
        }
      } catch (error) {
        console.error("Recruitment status notification failed", error);
        notificationWarning = error instanceof Error
          ? `The status was saved, but the WhatsApp automation failed: ${error.message}`
          : "The status was saved, but the WhatsApp automation failed.";
      }
    }
    return NextResponse.json({
      lead: saved.data,
      ...(notificationWarning ? { notificationWarning } : {})
    });
  } catch (error) {
    console.error("Recruitment status update failed", error);
    return NextResponse.json({ error: "Unable to update lead." }, { status: 500 });
  }
}
