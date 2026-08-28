import { NextResponse } from "next/server";
import { fieldDutyViewerScope } from "@/lib/field-duty-access";
import { isFieldCandidateStatus, publicAttemptResult } from "@/lib/field-candidate-source";
import { canUseRecruitmentMenu, recruitmentSession, requiredEnv } from "@/lib/recruitment-api";
import { loadWorkforceConfig } from "@/lib/recruitment-workforce-config";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const validDay = (value: string | null) => /^\d{4}-\d{2}-\d{2}$/.test(value ?? "") ? String(value) : null;
const safeSearch = (value: string | null) => String(value ?? "").trim().replace(/[%_,]/g, "").slice(0, 80);

async function viewer(request: Request) {
  const session = await recruitmentSession(request);
  if (!session || (!canUseRecruitmentMenu(session, "Field Recruitment", "view", "workforce")
    && !canUseRecruitmentMenu(session, "Performance Center", "view", "workforce"))) {
    return { session: null, error: NextResponse.json({ error: "Field Recruitment view access is required." }, { status: 403 }) };
  }
  const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
  const workforce = await loadWorkforceConfig(companyId);
  const fullScope = canUseRecruitmentMenu(session, "Field Recruitment", "all", "workforce")
    || canUseRecruitmentMenu(session, "Performance Center", "all", "workforce");
  return {
    session,
    companyId,
    scope: fieldDutyViewerScope({
      profileId: session.profileId,
      functionName: session.recruitmentFunction,
      fullScope,
      configuredUsers: workforce.userFunctions
    }),
    workforce,
    error: null
  };
}

export async function GET(request: Request) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase is not configured.");
    const access = await viewer(request);
    if (access.error || !access.session || !access.companyId || !access.scope) {
      return access.error ?? NextResponse.json({ error: "Field Recruitment access could not be resolved." }, { status: 403 });
    }
    const url = new URL(request.url);
    const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
    const limit = Math.min(100, Math.max(10, Number.parseInt(url.searchParams.get("limit") ?? "50", 10) || 50));
    const from = validDay(url.searchParams.get("from"));
    const to = validDay(url.searchParams.get("to"));
    const search = safeSearch(url.searchParams.get("search"));
    const statuses = String(url.searchParams.get("status") ?? "").split(",").filter(isFieldCandidateStatus);
    const requestedRecruiter = String(url.searchParams.get("recruiter") ?? "").trim();

    let dutyQuery = supabaseAdmin.from("recruitment_field_duties")
      .select("id,recruiter_profile_id,duty_date,profiles!recruitment_field_duties_recruiter_profile_id_fkey(full_name,email)")
      .eq("company_id", access.companyId);
    if (access.scope.visibility !== "all") dutyQuery = dutyQuery.in("recruiter_profile_id", access.scope.profileIds.length ? access.scope.profileIds : ["00000000-0000-0000-0000-000000000000"]);
    if (requestedRecruiter) {
      const allowed = access.scope.visibility === "all" || access.scope.profileIds.includes(requestedRecruiter);
      dutyQuery = dutyQuery.eq("recruiter_profile_id", allowed ? requestedRecruiter : "00000000-0000-0000-0000-000000000000");
    }
    if (from) dutyQuery = dutyQuery.gte("duty_date", from);
    if (to) dutyQuery = dutyQuery.lte("duty_date", to);
    const duties = await dutyQuery.order("duty_date", { ascending: false }).limit(5000);
    if (duties.error) throw duties.error;
    const dutyIds = (duties.data ?? []).map((item) => item.id);
    const dutyById = new Map((duties.data ?? []).map((item) => [item.id, item]));

    if (!dutyIds.length) {
      return NextResponse.json({ page, limit, total: 0, candidates: [], attempts: [], recruiters: [], summary: { unique: 0, duplicates: 0, joiningReported: 0 }, canUpdate: false });
    }

    let candidatesQuery = supabaseAdmin.from("recruitment_field_contacts")
      .select("id,duty_id,full_name,phone,normalized_phone,source_type,source_validation_status,pipeline_status,pipeline_status_updated_at,outcome,follow_up_at,notes,latitude,longitude,created_at,updated_at,recruitment_locations(code,name),recruitment_roles(code,name)", { count: "exact" })
      .eq("company_id", access.companyId)
      .eq("source_validation_status", "verified_unique")
      .in("duty_id", dutyIds);
    if (statuses.length) candidatesQuery = candidatesQuery.in("pipeline_status", statuses);
    if (search) candidatesQuery = candidatesQuery.or(`full_name.ilike.%${search}%,phone.ilike.%${search}%`);
    const start = (page - 1) * limit;
    const candidates = await candidatesQuery.order("created_at", { ascending: false }).range(start, start + limit - 1);
    if (candidates.error) throw candidates.error;

    const attempts = await supabaseAdmin.from("recruitment_field_contact_attempts")
      .select("id,duty_id,result,created_at")
      .eq("company_id", access.companyId)
      .in("duty_id", dutyIds)
      .neq("result", "accepted")
      .order("created_at", { ascending: false })
      .limit(250);
    if (attempts.error) throw attempts.error;

    const allVisibleCandidates = await supabaseAdmin.from("recruitment_field_contacts")
      .select("pipeline_status")
      .eq("company_id", access.companyId)
      .eq("source_validation_status", "verified_unique")
      .in("duty_id", dutyIds);
    if (allVisibleCandidates.error) throw allVisibleCandidates.error;

    const recruiterMap = new Map<string, { profileId: string; name: string; email: string; }>();
    for (const duty of duties.data ?? []) {
      const profile = Array.isArray(duty.profiles) ? duty.profiles[0] : duty.profiles as any;
      recruiterMap.set(String(duty.recruiter_profile_id), {
        profileId: String(duty.recruiter_profile_id),
        name: String(profile?.full_name ?? "Field recruiter"),
        email: String(profile?.email ?? "")
      });
    }
    const duplicateCount = attempts.data?.length ?? 0;
    const statusRows = allVisibleCandidates.data ?? [];
    return NextResponse.json({
      page,
      limit,
      total: candidates.count ?? 0,
      visibility: access.scope.visibility,
      canUpdate: access.session.recruitmentFunction === "field_recruiter" && !access.session.readOnly && !access.session.isPreview,
      recruiters: [...recruiterMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
      summary: {
        unique: statusRows.length,
        duplicates: duplicateCount,
        interested: statusRows.filter((item) => item.pipeline_status === "interested").length,
        followUp: statusRows.filter((item) => item.pipeline_status === "follow_up").length,
        interviews: statusRows.filter((item) => item.pipeline_status === "interview_scheduled").length,
        joiningReported: statusRows.filter((item) => item.pipeline_status === "joining_reported").length
      },
      candidates: (candidates.data ?? []).map((item) => ({
        ...item,
        duty: dutyById.get(item.duty_id) ?? null
      })),
      attempts: (attempts.data ?? []).map((item) => ({
        id: item.id,
        duty: dutyById.get(item.duty_id) ?? null,
        result: item.result,
        label: publicAttemptResult(String(item.result)),
        createdAt: item.created_at
      }))
    });
  } catch (error) {
    console.error("Field candidate pool read failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load field candidates." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase is not configured.");
    const access = await viewer(request);
    if (access.error || !access.session || !access.companyId) {
      return access.error ?? NextResponse.json({ error: "Field Recruitment access could not be resolved." }, { status: 403 });
    }
    if (access.session.recruitmentFunction !== "field_recruiter") {
      return NextResponse.json({ error: "Only the field recruiter who sourced this candidate can update its follow-up status." }, { status: 403 });
    }
    const body = await request.json();
    const contactId = String(body.contactId ?? "").trim();
    const status = String(body.status ?? "").trim();
    if (!contactId || !isFieldCandidateStatus(status)) {
      return NextResponse.json({ error: "Choose a valid field candidate and status." }, { status: 400 });
    }
    const updated = await supabaseAdmin.rpc("recruitment_update_field_contact_status_v1", {
      p_company_id: access.companyId,
      p_contact_id: contactId,
      p_actor_profile_id: access.session.profileId,
      p_status: status,
      p_notes: String(body.notes ?? "").trim() || null
    });
    if (updated.error) throw updated.error;
    const result = updated.data as Record<string, unknown> | null;
    if (result?.updated !== true) {
      const code = String(result?.code ?? "UPDATE_FAILED");
      const responseStatus = code === "FORBIDDEN" ? 403 : code === "NOT_FOUND" ? 404 : 409;
      return NextResponse.json({ error: code === "DUPLICATE_CONTACT" ? "Duplicate contacts cannot be advanced in the field pipeline." : "This candidate status could not be updated.", code }, { status: responseStatus });
    }
    return NextResponse.json({ ok: true, status, authoritativeJoining: false, message: status === "joining_reported" ? "Joining reported. It will count only after operational verification." : "Candidate status updated." });
  } catch (error) {
    console.error("Field candidate status update failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to update field candidate." }, { status: 500 });
  }
}
