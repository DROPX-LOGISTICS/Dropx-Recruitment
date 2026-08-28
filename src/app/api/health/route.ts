import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function GET() {
  const configured = Boolean(supabaseAdmin && process.env.RECRUITMENT_COMPANY_ID);
  return NextResponse.json({
    ok: true,
    service: "DropX Recruitment",
    configured,
    intake: {
      polling: "/api/cron/recruitment-meta",
      metaWebhook: "/api/webhooks/meta",
      indeedWebhook: "/api/webhooks/indeed"
    },
    timestamp: new Date().toISOString()
  });
}
