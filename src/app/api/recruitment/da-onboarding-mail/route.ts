import { NextResponse } from "next/server";
import { runDaOnboardingMail, sendDaOnboardingSamples } from "@/lib/da-onboarding-mail";
import { recruitmentSession, requiredEnv } from "@/lib/recruitment-api";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const SAMPLE_RECIPIENTS = [
  "nisar@dropxlogistics.com",
  "praveen@dropxlogistics.com",
  "qlda@dropxlogistics.com"
];

export async function GET(request: Request) {
  const session = await recruitmentSession(request);
  if (!session?.isOwner || !supabaseAdmin) return NextResponse.json({ error: "Owner access required" }, { status: 403 });
  try {
    const company = requiredEnv("RECRUITMENT_COMPANY_ID");
    const [overview, rows] = await Promise.all([
      runDaOnboardingMail(company, true),
      supabaseAdmin.from("recruitment_da_onboarding_mail_deliveries")
        .select("id,recipient_role,slot,status,created_at,sent_at,error")
        .eq("company_id", company)
        .order("created_at", { ascending: false })
        .limit(100)
    ]);
    if (rows.error) throw rows.error;
    return NextResponse.json({ ...overview, recent: rows.data, sampleRecipients: SAMPLE_RECIPIENTS });
  } catch (error) {
    console.error("recruit-da-onboarding-mail status", error);
    return NextResponse.json({ error: "Unable to load DA onboarding mail status." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await recruitmentSession(request);
  if (!session?.isOwner || !supabaseAdmin) return NextResponse.json({ error: "Owner access required" }, { status: 403 });
  try {
    const company = requiredEnv("RECRUITMENT_COMPANY_ID");
    const body = await request.json();
    if (body.action === "samples") {
      return NextResponse.json(await sendDaOnboardingSamples(company, SAMPLE_RECIPIENTS));
    }
    if (body.action === "retry" && typeof body.id === "string") {
      const row = await supabaseAdmin.from("recruitment_da_onboarding_mail_deliveries")
        .select("status").eq("company_id", company).eq("id", body.id).single();
      if (row.error || !["failed", "needs_review"].includes(row.data?.status)) {
        return NextResponse.json({ error: "Only failed or uncertain deliveries can be retried." }, { status: 400 });
      }
      if (row.data.status === "needs_review" && body.confirmedUndelivered !== true) {
        return NextResponse.json({ error: "Verify that the message was not delivered before retrying." }, { status: 400 });
      }
      const saved = await supabaseAdmin.from("recruitment_da_onboarding_mail_deliveries")
        .update({ status: "queued", error: null })
        .eq("company_id", company).eq("id", body.id).eq("status", row.data.status);
      if (saved.error) throw saved.error;
      return NextResponse.json({ queued: true });
    }
    if (typeof body.enabled !== "boolean") {
      return NextResponse.json({ error: "Choose enabled or disabled." }, { status: 400 });
    }
    const saved = await supabaseAdmin.from("recruitment_da_onboarding_mail_settings")
      .upsert({ company_id: company, enabled: body.enabled, updated_at: new Date().toISOString() }, { onConflict: "company_id" });
    if (saved.error) throw saved.error;
    return NextResponse.json({ enabled: body.enabled });
  } catch (error) {
    console.error("recruit-da-onboarding-mail update", error);
    return NextResponse.json({ error: "Unable to update DA onboarding mail." }, { status: 500 });
  }
}
