import { NextResponse } from "next/server";
import { canUseRecruitmentMenu, recruitmentSession, requiredEnv } from "@/lib/recruitment-api";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase is not configured.");
    const session = await recruitmentSession(request);
    if (!canUseRecruitmentMenu(session, "Audit", "view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const result = await supabaseAdmin
      .from("recruitment_lead_history")
      .select("id,lead_id,event_type,field_name,old_value,new_value,remarks,actor_email,created_at,recruitment_leads(full_name,phone)")
      .eq("company_id", requiredEnv("RECRUITMENT_COMPANY_ID"))
      .order("created_at", { ascending: false })
      .limit(250);
    if (result.error) throw result.error;
    return NextResponse.json({ events: result.data ?? [] });
  } catch (error) {
    console.error("Recruitment audit failed", error);
    return NextResponse.json({ error: "Unable to load audit history." }, { status: 500 });
  }
}
