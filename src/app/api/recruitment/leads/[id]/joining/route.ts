import { NextResponse } from "next/server";
import { canAccessLead, canUseRecruitmentMenu, recruitmentSession, requiredEnv } from "@/lib/recruitment-api";
import { createWorkforceFieldExecutive } from "@/lib/workforce-onboarding";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function clean(value: unknown, limit = 100) {
  return String(value ?? "").trim().slice(0, limit);
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase is not configured.");
    const session = await recruitmentSession(request);
    if (!session || !canUseRecruitmentMenu(session, "Interviews", "edit", "workforce")) return NextResponse.json({ error: "Workforce Interviews edit access is required." }, { status: 403 });
    const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
    const lead = await supabaseAdmin.from("recruitment_leads")
      .select("id,status,stream,location_id,role_id,assigned_profile_id")
      .eq("company_id", companyId).eq("id", params.id).maybeSingle();
    if (lead.error) throw new Error(lead.error.message);
    if (!lead.data || lead.data.stream !== "workforce" || !canAccessLead(session, lead.data)) {
      return NextResponse.json({ error: "Lead not found in your Workforce scope." }, { status: 404 });
    }
    if (lead.data.status !== "joined") {
      return NextResponse.json({ error: "Mark the candidate as Joined before completing onboarding." }, { status: 409 });
    }
    const body = await request.json() as Record<string, unknown>;
    const created = await createWorkforceFieldExecutive(companyId, session, {
      leadId: params.id,
      email: clean(body.email, 180) || null,
      joiningDate: clean(body.joiningDate, 20),
      employeeId: clean(body.employeeId),
      providerEmployeeId: clean(body.providerEmployeeId),
      telecallerProfileId: clean(body.telecallerProfileId, 80) || null,
      fieldRecruiterProfileId: clean(body.fieldRecruiterProfileId, 80) || null
    });
    return NextResponse.json({
      saved: true,
      created,
      message: `Workforce onboarding invitation created. ${created.dropxId} is reserved and remains inactive until HO approval and checklist completion.`
    });
  } catch (error) {
    console.error("Workforce joining record failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to save joining record." }, { status: 400 });
  }
}
