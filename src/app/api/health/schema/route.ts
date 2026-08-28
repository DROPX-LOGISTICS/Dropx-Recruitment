import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

type SchemaCheck = {
  name: string;
  run: () => PromiseLike<{ error: { message: string } | null }>;
};

export async function GET() {
  if (!supabaseAdmin || !process.env.RECRUITMENT_COMPANY_ID) {
    return NextResponse.json(
      { ok: false, schemaReady: false, configured: false },
      { status: 503 }
    );
  }

  const companyId = process.env.RECRUITMENT_COMPANY_ID;
  const db = supabaseAdmin;
  const checks: SchemaCheck[] = [
    {
      name: "hr_lifecycle",
      run: () => db.from("recruitment_hr_lifecycle_rules").select("id").limit(1)
    },
    {
      name: "hr_workflow",
      run: () => db.from("recruitment_hr_workflow_settings").select("company_id").limit(1)
    },
    {
      name: "hr_interviews",
      run: () => db.from("recruitment_hr_interviews").select("id").limit(1)
    },
    {
      name: "hr_offer_versions",
      run: () => db.from("recruitment_hr_offer_versions").select("id").limit(1)
    },
    {
      name: "notification_observability",
      run: () => db
        .from("recruitment_whatsapp_outbox")
        .select("notification_trigger,recruitment_stream,notification_context")
        .limit(1)
    },
    {
      name: "source_adapters",
      run: () => db.rpc("recruitment_list_connection_settings", {
        p_company_id: companyId
      })
    },
    {
      name: "indeed_job_mappings",
      run: () => db.from("recruitment_indeed_job_mappings").select("id").limit(1)
    },
    {
      name: "indeed_applications",
      run: () => db.from("recruitment_indeed_applications").select("id").limit(1)
    },
    {
      name: "role_menu_permissions",
      run: () => db.from("recruitment_role_menu_permissions").select("menu_id").limit(1)
    }
  ];

  const results = await Promise.all(checks.map(async (check) => {
    const result = await check.run();
    return { name: check.name, ready: !result.error };
  }));
  const schemaReady = results.every((result) => result.ready);

  return NextResponse.json({
    ok: schemaReady,
    configured: true,
    schemaReady,
    checks: results,
    timestamp: new Date().toISOString()
  }, { status: schemaReady ? 200 : 503 });
}
