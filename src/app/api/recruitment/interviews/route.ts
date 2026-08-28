import { NextResponse } from "next/server";
import { canAccessLead, canUseRecruitmentMenu, recruitmentSession, requiredEnv } from "@/lib/recruitment-api";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function startOfIstDay(value: string) {
  return `${value}T00:00:00.000+05:30`;
}

function endOfIstDay(value: string) {
  return `${value}T23:59:59.999+05:30`;
}

export async function GET(request: Request) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase is not configured.");
    const session = await recruitmentSession(request);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!canUseRecruitmentMenu(session, "My Interviews", "view", "hr")) {
      return NextResponse.json({ error: "View access to My Interview Assignments is required." }, { status: 403 });
    }
    const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
    const url = new URL(request.url);
    const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
    const limit = Math.min(100, Math.max(10, Number(url.searchParams.get("limit") ?? 50)));
    const requestedScope = url.searchParams.get("scope") === "all" ? "all" : "mine";
    const canViewAll = session.isOwner || canUseRecruitmentMenu(session, "Interviews", "all", "hr");
    const scope = requestedScope === "all" && canViewAll ? "all" : "mine";
    const fromDate = url.searchParams.get("from");
    const toDate = url.searchParams.get("to");
    const statuses = (url.searchParams.get("status") ?? "scheduled,rescheduled")
      .split(",").map((item) => item.trim()).filter(Boolean);

    let query: any = supabaseAdmin.from("recruitment_hr_interviews")
      .select("id,lead_id,round_no,interviewer_profile_id,assigned_by_profile_id,status,scheduled_at,duration_minutes,channels,recruiter_note,meet_link,calendar_event_id,invitation_delivery,decision,feedback,completed_at,created_at,updated_at", { count: "exact" })
      .eq("company_id", companyId);
    if (scope === "mine") query = query.eq("interviewer_profile_id", session.profileId);
    if (statuses.length) query = query.in("status", statuses);
    if (fromDate) query = query.gte("scheduled_at", startOfIstDay(fromDate));
    if (toDate) query = query.lte("scheduled_at", endOfIstDay(toDate));
    const from = (page - 1) * limit;
    const assignments = await query.order("scheduled_at", { ascending: true }).range(from, from + limit - 1);
    if (assignments.error) throw new Error(assignments.error.message);

    const leadIds = [...new Set((assignments.data ?? []).map((item: any) => item.lead_id).filter(Boolean))];
    const profileIds = [...new Set((assignments.data ?? []).flatMap((item: any) => [item.interviewer_profile_id, item.assigned_by_profile_id]).filter(Boolean))];
    const [leads, profiles] = await Promise.all([
      leadIds.length
        ? supabaseAdmin.from("recruitment_leads")
            .select("id,full_name,phone,email,status,remarks,location_id,role_id,stream,recruitment_locations(code,name,address),recruitment_roles(code,name)")
            .eq("company_id", companyId).in("id", leadIds)
        : Promise.resolve({ data: [], error: null }),
      profileIds.length
        ? supabaseAdmin.from("profiles").select("id,full_name,email,mobile,phone,employee_id").in("id", profileIds)
        : Promise.resolve({ data: [], error: null })
    ]);
    if (leads.error || profiles.error) throw new Error(leads.error?.message || profiles.error?.message);
    const leadById = new Map((leads.data ?? []).map((lead: any) => [lead.id, lead]));
    const profileById = new Map((profiles.data ?? []).map((profile: any) => [profile.id, profile]));
    const rows = (assignments.data ?? []).flatMap((assignment: any) => {
      const lead = leadById.get(assignment.lead_id);
      if (!lead) return [];
      // A direct interview assignment is a narrowly-scoped capability. It lets
      // the assignee open this candidate only, even when that station is not in
      // their normal recruitment queue. Team-wide views still obey lead scope.
      if (scope === "all" && !canAccessLead(session, lead)) return [];
      return [{
        ...assignment,
        lead,
        interviewer: profileById.get(assignment.interviewer_profile_id) ?? null,
        assignedBy: profileById.get(assignment.assigned_by_profile_id) ?? null,
        canReview: session.isOwner
          || (assignment.interviewer_profile_id === session.profileId
            && canUseRecruitmentMenu(session, "My Interviews", "edit", "hr"))
          || canUseRecruitmentMenu(session, "Interviews", "all", "hr")
      }];
    });
    return NextResponse.json({ assignments: rows, total: scope === "mine" ? assignments.count ?? rows.length : rows.length, page, limit, scope });
  } catch (error) {
    console.error("Recruitment interview assignments failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load interview assignments." }, { status: 500 });
  }
}
