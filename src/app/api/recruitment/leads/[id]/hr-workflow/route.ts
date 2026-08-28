import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { canAccessLead, canUseRecruitmentMenu, recruitmentSession, requiredEnv } from "@/lib/recruitment-api";
import { resolveNetworkHiringManager } from "@/lib/main-dashboard-masters";
import {
  createGoogleInterviewEvent,
  enqueueCandidateInterviewWhatsapp,
  enqueueManagerInterviewWhatsapp
} from "@/lib/hr-interview-invitations";
import { configuredNotificationRule } from "@/lib/recruitment-notifications";
import { enqueueLeadNotification } from "@/lib/recruitment-notifications";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { loadHrLifecycleRules, loadHrWorkflowSettings, validateHrTransition } from "@/lib/hr-recruitment-lifecycle";
import { normalizeCandidateLocation } from "@/lib/hr-recruitment-overview";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function text(value: unknown, limit = 2000) {
  return String(value ?? "").trim().slice(0, limit);
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase is not configured.");
    const session = await recruitmentSession(request);
    if (!session?.hr) return NextResponse.json({ error: "HR access is required." }, { status: 403 });
    const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
    const lead = await supabaseAdmin.from("recruitment_leads")
      .select("id,status,stream,location_id,role_id,phone,full_name,email,city,post_code,remarks,callback_at,assigned_profile_id,last_updated_by,updated_at,recruitment_roles(code,name),recruitment_locations(code)")
      .eq("company_id", companyId).eq("id", params.id).maybeSingle();
    if (lead.error) throw new Error(lead.error.message);
    if (!lead.data) return NextResponse.json({ error: "Lead not found." }, { status: 404 });
    if (lead.data.stream !== "hr" || !canAccessLead(session, lead.data)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const body = await request.json() as Record<string, unknown>;
    const suppliedRequestId = text(body.clientRequestId, 64);
    if (suppliedRequestId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(suppliedRequestId)) {
      return NextResponse.json({ error: "Invalid workflow request identifier." }, { status: 400 });
    }
    const clientRequestId = suppliedRequestId || randomUUID();
    const action = text(body.action, 30);
    const actionMenu = ["profile", "candidate_location"].includes(action) ? "Screening" : action === "initial_outcome" ? "All Leads" : "Interviews";
    if (!canUseRecruitmentMenu(session, actionMenu, "edit", "hr")) {
      return NextResponse.json({ error: `Edit access to ${actionMenu} is required.` }, { status: 403 });
    }
    const now = new Date().toISOString();

    if (action === "candidate_location") {
      const location = normalizeCandidateLocation(body.city, body.postCode);
      const changes = [
        { field: "city", oldValue: lead.data.city ?? null, newValue: location.city },
        { field: "post_code", oldValue: lead.data.post_code ?? null, newValue: location.postCode }
      ].filter((change) => change.oldValue !== change.newValue);
      if (!changes.length) return NextResponse.json({ saved: true, message: "Candidate location is already up to date." });
      let saveQuery = supabaseAdmin.from("recruitment_leads").update({
        city: location.city,
        post_code: location.postCode,
        last_updated_by: session.profileId,
        updated_at: now
      }).eq("company_id", companyId).eq("id", params.id);
      saveQuery = lead.data.updated_at
        ? saveQuery.eq("updated_at", lead.data.updated_at)
        : saveQuery.is("updated_at", null);
      const saved = await saveQuery
        .select("id,city,post_code,last_updated_by,updated_at")
        .maybeSingle();
      if (saved.error) throw new Error(saved.error.message);
      if (!saved.data) {
        const latest = await supabaseAdmin.from("recruitment_leads")
          .select("id,status,city,post_code,remarks,callback_at,last_updated_by,updated_at")
          .eq("company_id", companyId).eq("id", params.id).maybeSingle();
        if (latest.error) throw new Error(latest.error.message);
        return NextResponse.json({
          error: "Another HR user updated this candidate first. The latest record has been loaded; review it before saving again.",
          lead: latest.data
        }, { status: 409 });
      }
      const audited = await supabaseAdmin.from("recruitment_lead_history").insert(changes.map((change) => ({
        company_id: companyId,
        lead_id: params.id,
        event_type: "field_update",
        field_name: change.field,
        old_value: change.oldValue,
        new_value: change.newValue,
        actor_profile_id: session.profileId,
        actor_email: session.email,
        metadata: { source: "hr_screening", client_request_id: clientRequestId }
      })));
      if (audited.error) console.error("Candidate location audit failed after lead save", audited.error);
      return NextResponse.json({
        saved: true,
        message: audited.error
          ? "Candidate city and PIN code updated. The audit entry needs attention."
          : "Candidate city and PIN code updated.",
        lead: saved.data
      });
    }

    if (action === "profile") {
      const summary = text(body.summary);
      if (!summary) return NextResponse.json({ error: "Add a screening summary." }, { status: 400 });
      const metadata = {
        current_salary: text(body.currentSalary, 100),
        expected_salary: text(body.expectedSalary, 100),
        notice_period: text(body.noticePeriod, 200)
      };
      let saveQuery = supabaseAdmin.from("recruitment_leads").update({
          status: ["", "new", "assigned"].includes(lead.data.status) ? "contacting" : lead.data.status,
          remarks: summary,
          last_updated_by: session.profileId,
          updated_at: now
        }).eq("company_id", companyId).eq("id", params.id);
      saveQuery = lead.data.updated_at
        ? saveQuery.eq("updated_at", lead.data.updated_at)
        : saveQuery.is("updated_at", null);
      const saved = await saveQuery
        .select("id,status,remarks,last_updated_by,updated_at")
        .maybeSingle();
      if (saved.error) throw new Error(saved.error.message);
      if (!saved.data) {
        const latest = await supabaseAdmin.from("recruitment_leads")
          .select("id,status,city,post_code,remarks,callback_at,last_updated_by,updated_at")
          .eq("company_id", companyId).eq("id", params.id).maybeSingle();
        if (latest.error) throw new Error(latest.error.message);
        return NextResponse.json({
          error: "Another HR user updated this candidate first. The latest record has been loaded; review it before saving again.",
          lead: latest.data
        }, { status: 409 });
      }
      const audited = await supabaseAdmin.from("recruitment_lead_history").insert({
          company_id: companyId,
          lead_id: params.id,
          event_type: "hr_screening_profile",
          remarks: summary,
          actor_profile_id: session.profileId,
          actor_email: session.email,
          metadata: { ...metadata, client_request_id: clientRequestId }
        });
      if (audited.error) console.error("HR screening audit failed after lead save", audited.error);
      return NextResponse.json({
        saved: true,
        message: audited.error
          ? "Screening profile saved. The audit entry needs attention."
          : "Screening profile saved.",
        lead: saved.data
      });
    }

    if (action === "initial_outcome") {
      const outcome = text(body.outcome, 60).toLowerCase();
      const remarks = text(body.remarks);
      const callbackAt = text(body.callbackAt, 80);
      const previousRequest = suppliedRequestId
        ? await supabaseAdmin.from("recruitment_lead_history")
            .select("id")
            .eq("company_id", companyId)
            .eq("lead_id", params.id)
            .eq("actor_profile_id", session.profileId)
            .eq("event_type", "hr_initial_call_outcome")
            .contains("metadata", { client_request_id: clientRequestId })
            .limit(1)
            .maybeSingle()
        : { data: null, error: null };
      if (previousRequest.error) throw new Error(previousRequest.error.message);
      if (previousRequest.data) {
        return NextResponse.json({
          saved: true,
          replayed: true,
          message: "This outcome was already saved.",
          lead: lead.data
        });
      }
      const lifecycleRules = await loadHrLifecycleRules(supabaseAdmin as any, companyId);
      const configured = lifecycleRules.find((item) => item.code === outcome && item.isActive && item.firstCallAvailable);
      if (!configured) {
        return NextResponse.json({ error: "Choose an active first-call outcome from HR Lifecycle Master." }, { status: 400 });
      }
      const scheduleType = configured.notificationTrigger === "interview" ? "interview" : configured.requiresSchedule ? "callback" : null;
      if (scheduleType === "interview") {
        return NextResponse.json({ error: "Choose the interviewer and date, then schedule the interview." }, { status: 400 });
      }
      if (scheduleType === "callback" && (!callbackAt || !Number.isFinite(new Date(callbackAt).getTime()))) {
        return NextResponse.json({ error: "Callback date and time are required." }, { status: 400 });
      }
      if (!remarks) return NextResponse.json({ error: "Add a call remark before saving the outcome." }, { status: 400 });
      const normalizedCallbackAt = scheduleType === "callback" ? new Date(callbackAt).toISOString() : null;
      const savedCallbackAt = lead.data.callback_at ? new Date(lead.data.callback_at).toISOString() : null;
      if (
        lead.data.status === outcome
        && lead.data.remarks === remarks
        && savedCallbackAt === normalizedCallbackAt
        && lead.data.last_updated_by === session.profileId
      ) {
        return NextResponse.json({
          saved: true,
          replayed: true,
          message: `${configured.label} was already saved.`,
          lead: lead.data
        });
      }
      validateHrTransition({
        currentCode: lead.data.status,
        nextCode: outcome,
        actor: session.isOwner ? "owner" : "recruiter",
        remarks,
        scheduledAt: normalizedCallbackAt,
        rules: lifecycleRules
      });
      const update: Record<string, unknown> = {
        status: outcome,
        remarks,
        callback_at: normalizedCallbackAt,
        assigned_profile_id: session.profileId,
        last_updated_by: session.profileId,
        updated_at: now
      };
      let saveQuery = supabaseAdmin.from("recruitment_leads").update(update)
        .eq("company_id", companyId)
        .eq("id", params.id);
      saveQuery = lead.data.updated_at
        ? saveQuery.eq("updated_at", lead.data.updated_at)
        : saveQuery.is("updated_at", null);
      const saved = await saveQuery
        .select("id,status,remarks,callback_at,assigned_profile_id,last_updated_by,updated_at")
        .maybeSingle();
      if (saved.error) throw new Error(saved.error.message);
      if (!saved.data) {
        const latest = await supabaseAdmin.from("recruitment_leads")
          .select("id,status,remarks,callback_at,assigned_profile_id,last_updated_by,updated_at")
          .eq("company_id", companyId)
          .eq("id", params.id)
          .maybeSingle();
        if (latest.error) throw new Error(latest.error.message);
        return NextResponse.json({
          error: "Another HR user updated this candidate first. The latest record has been loaded; review it before saving again.",
          lead: latest.data
        }, { status: 409 });
      }
      const audited = await supabaseAdmin.from("recruitment_lead_history").insert({
          company_id: companyId,
          lead_id: params.id,
          event_type: "hr_initial_call_outcome",
          field_name: "status",
          old_value: lead.data.status,
          new_value: outcome,
          remarks,
          actor_profile_id: session.profileId,
          actor_email: session.email,
          metadata: {
            callback_at: normalizedCallbackAt,
            source: "hr_first_call",
            lifecycle_rule: configured.code,
            client_request_id: clientRequestId
          }
        });
      let postSaveWarning = "";
      if (audited.error) {
        console.error("HR outcome audit failed after lead save", audited.error);
        postSaveWarning = " The outcome is saved, but its audit entry needs attention.";
      }
      if (outcome === "no_response") {
        try {
          const contact = lead.data.location_id
            ? await supabaseAdmin.from("recruitment_location_contacts")
                .select("address,latitude,longitude,poc_mobile")
                .eq("company_id", companyId).eq("location_id", lead.data.location_id).maybeSingle()
            : { data: null, error: null };
          if (contact.error) throw new Error(contact.error.message);
          await enqueueLeadNotification({
            companyId,
            lead: {
              id: lead.data.id,
              phone: lead.data.phone,
              full_name: lead.data.full_name,
              stream: "hr",
              location_id: lead.data.location_id,
              recruitment_roles: lead.data.recruitment_roles as { name?: string | null } | null,
              recruitment_locations: contact.data
            },
            trigger: "no_response",
            anchor: now
          });
        } catch (error) {
          console.error("No-response follow-up notification failed after HR outcome save", error);
          postSaveWarning += " The outcome is saved, but the follow-up notification could not be queued.";
        }
      }
      return NextResponse.json({
        saved: true,
        message: `${configured.label} saved with the recruiter remark.${postSaveWarning}`,
        lead: saved.data
      });
    }

    if (action === "forward") {
      const lifecycleSettings = await loadHrWorkflowSettings(supabaseAdmin as any, companyId);
      const round = Math.max(1, Math.min(lifecycleSettings.maxInterviewRounds, Number(body.round) || 1));
      const managerId = text(body.managerId, 80);
      const scheduledAt = text(body.scheduledAt, 80);
      const note = text(body.note);
      const channels = Array.isArray(body.channels)
        ? body.channels.map((item) => text(item, 20)).filter((item) => ["whatsapp", "email"].includes(item))
        : ["whatsapp"];
      const locationRelation = lead.data.recruitment_locations as { code?: string | null } | null;
      const roleRelation = lead.data.recruitment_roles as { code?: string | null; name?: string | null } | null;
      const manager = await resolveNetworkHiringManager(companyId, managerId, locationRelation?.code, roleRelation?.code);
      if (!manager || !scheduledAt || !Number.isFinite(new Date(scheduledAt).getTime())) {
        return NextResponse.json({ error: "Manager and a valid interview date are required." }, { status: 400 });
      }
      if (!channels.length) {
        return NextResponse.json({ error: "Choose WhatsApp or Email + Google Meet invitation." }, { status: 400 });
      }
      const activeAssignment = await supabaseAdmin.from("recruitment_hr_interviews")
        .select("id,status")
        .eq("company_id", companyId)
        .eq("lead_id", params.id)
        .eq("round_no", round)
        .neq("status", "cancelled")
        .maybeSingle();
      if (activeAssignment.error) throw new Error(activeAssignment.error.message);
      const nextLeadStatus = activeAssignment.data ? "interview_rescheduled" : "interview_scheduled";
      const lifecycleRules = await loadHrLifecycleRules(supabaseAdmin as any, companyId);
      validateHrTransition({
        currentCode: lead.data.status,
        nextCode: nextLeadStatus,
        actor: session.isOwner ? "owner" : "recruiter",
        remarks: note || `Round ${round} assigned to ${manager.name}.`,
        scheduledAt,
        rules: lifecycleRules
      });
      const assignmentValues = {
        interviewer_profile_id: manager.id,
        assigned_by_profile_id: session.profileId,
        status: activeAssignment.data ? "rescheduled" : "scheduled",
        scheduled_at: scheduledAt,
        duration_minutes: lifecycleSettings.defaultInterviewMinutes,
        channels,
        recruiter_note: note || null,
        decision: null,
        feedback: null,
        completed_at: null,
        updated_at: now
      };
      const assignment = activeAssignment.data
        ? await supabaseAdmin.from("recruitment_hr_interviews")
            .update(assignmentValues)
            .eq("company_id", companyId)
            .eq("id", activeAssignment.data.id)
            .select("id")
            .single()
        : await supabaseAdmin.from("recruitment_hr_interviews")
            .insert({
              company_id: companyId,
              lead_id: params.id,
              round_no: round,
              ...assignmentValues
            })
            .select("id")
            .single();
      if (assignment.error) throw new Error(assignment.error.message);
      const [saved, audited] = await Promise.all([
        supabaseAdmin.from("recruitment_leads").update({
          status: nextLeadStatus,
          follow_up_at: scheduledAt,
          remarks: note || lead.data.remarks,
          last_updated_by: session.profileId,
          updated_at: now
        }).eq("company_id", companyId).eq("id", params.id),
        supabaseAdmin.from("recruitment_lead_history").insert({
          company_id: companyId,
          lead_id: params.id,
          event_type: activeAssignment.data ? "hr_interview_rescheduled" : "hr_interview_forwarded",
          field_name: "status",
          old_value: lead.data.status,
          new_value: nextLeadStatus,
          remarks: note || `Forwarded to ${manager.name} for round ${round}.`,
          actor_profile_id: session.profileId,
          actor_email: session.email,
          metadata: { assignment_id: assignment.data.id, round, manager_id: manager.id, manager_name: manager.name, manager_email: manager.email, station_code: manager.stationCode, scheduled_at: scheduledAt, channels }
        }).select("id").single()
      ]);
      if (saved.error || audited.error) throw new Error(saved.error?.message || audited.error?.message);
      const outcomes: Record<string, unknown> = {};
      if (channels.includes("email")) {
        if (!lead.data.email || !manager.email) {
          outcomes.email = { sent: false, reason: "Candidate and manager email are both required." };
        } else {
          try {
            outcomes.email = {
              sent: true,
              ...(await createGoogleInterviewEvent({
                candidateName: lead.data.full_name || "Candidate",
                candidateEmail: lead.data.email,
                candidatePhone: lead.data.phone,
                managerName: manager.name,
                managerEmail: manager.email,
                roleName: roleRelation?.name || "Open role",
                stationCode: locationRelation?.code || null,
                round,
                scheduledAt,
                note
              }))
            };
          } catch (error) {
            outcomes.email = { sent: false, reason: error instanceof Error ? error.message : "Calendar invitation failed." };
          }
        }
      }
      const meetLink = (outcomes.email as { meetLink?: string | null } | undefined)?.meetLink ?? null;
      if (channels.includes("whatsapp")) {
        const interviewRule = await configuredNotificationRule("hr", "interview");
        if (!interviewRule?.enabled) {
          const reason = "HR Interview Scheduled WhatsApp is disabled in Notification Master.";
          outcomes.whatsapp = {
            candidate: { queued: false, reason },
            manager: { queued: false, reason }
          };
        } else {
          const candidateResult = await enqueueCandidateInterviewWhatsapp({
            companyId,
            leadId: lead.data.id,
            candidateName: lead.data.full_name || "Candidate",
            candidatePhone: lead.data.phone,
            roleName: roleRelation?.name || "Open role",
            managerName: manager.name,
            managerPhone: manager.phone,
            round,
            scheduledAt,
            note,
            meetLink
          });
          const managerResult = await enqueueManagerInterviewWhatsapp({
            companyId,
            leadId: lead.data.id,
            candidateName: lead.data.full_name || "Candidate",
            candidatePhone: lead.data.phone,
            roleName: roleRelation?.name || "Open role",
            managerName: manager.name,
            managerPhone: manager.phone,
            round,
            scheduledAt,
            note,
            meetLink
          });
          outcomes.whatsapp = { candidate: candidateResult, manager: managerResult };
        }
      }
      if (audited.data?.id) {
        await supabaseAdmin.from("recruitment_lead_history").update({
          metadata: {
            assignment_id: assignment.data.id,
            round,
            manager_id: manager.id,
            manager_name: manager.name,
            manager_email: manager.email,
            station_code: manager.stationCode,
            scheduled_at: scheduledAt,
            channels,
            invitation_outcomes: outcomes,
            meet_link: meetLink
          }
        }).eq("company_id", companyId).eq("id", audited.data.id);
      }
      const warnings = Object.values(outcomes).flatMap((outcome) => {
        const value = outcome as { sent?: boolean; reason?: string; candidate?: { queued?: boolean; reason?: string }; manager?: { queued?: boolean; reason?: string } };
        return [
          value.sent === false ? value.reason : null,
          value.candidate?.queued === false ? value.candidate.reason : null,
          value.manager?.queued === false ? value.manager.reason : null
        ].filter(Boolean);
      });
      const deliveryAudit = await supabaseAdmin.from("recruitment_lead_history").insert({
        company_id: companyId,
        lead_id: params.id,
        event_type: warnings.length ? "hr_interview_invitation_failed" : "hr_interview_invitation_sent",
        remarks: warnings.length
          ? `Interview saved, but one or more invitations failed: ${warnings.join(" ")}`
          : `Round ${round} invitations sent or queued successfully.`,
        actor_profile_id: session.profileId,
        actor_email: session.email,
        metadata: {
          assignment_id: assignment.data.id,
          round,
          manager_id: manager.id,
          manager_name: manager.name,
          scheduled_at: scheduledAt,
          outcomes,
          meet_link: meetLink
        }
      });
      if (deliveryAudit.error) {
        console.error("Interview invitation delivery audit failed", deliveryAudit.error);
      }
      const calendarEventId = (outcomes.email as { eventId?: string | null } | undefined)?.eventId ?? null;
      const assignmentDelivery = await supabaseAdmin.from("recruitment_hr_interviews").update({
        meet_link: meetLink,
        calendar_event_id: calendarEventId,
        invitation_delivery: outcomes,
        updated_at: new Date().toISOString()
      }).eq("company_id", companyId).eq("id", assignment.data.id);
      if (assignmentDelivery.error) {
        console.error("Interview assignment delivery update failed", assignmentDelivery.error);
      }
      return NextResponse.json({
        saved: true,
        assignmentId: assignment.data.id,
        message: warnings.length
          ? `Interview round ${round} scheduled. Invitation warning: ${warnings.join(" ")}`
          : `Interview round ${round} scheduled and invitations queued.`,
        outcomes
      });
    }

    if (action === "feedback") {
      return NextResponse.json({
        error: "Manager feedback must be recorded from My Interview Assignments so the assignee and round are enforced."
      }, { status: 409 });
    }

    return NextResponse.json({ error: "Unsupported HR workflow action." }, { status: 400 });
  } catch (error) {
    console.error("HR workflow update failed", error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Unable to update HR workflow."
    }, { status: 400 });
  }
}
