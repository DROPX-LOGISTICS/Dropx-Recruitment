import { supabaseAdmin } from "./supabase-admin";

type ResolvedRoute = {
  designation_id: string;
  register_code: string;
  table_name: string;
  registration_enabled: boolean;
};

export async function assertWorkforceDesignationRoute(companyId: string, designationId: string) {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  const result = await supabaseAdmin.rpc("resolve_designation_register", {
    p_company_id: companyId,
    p_designation_id: designationId,
    p_designation_value: null
  });
  if (result.error) throw new Error(result.error.message);
  const route = (result.data?.[0] ?? null) as ResolvedRoute | null;
  if (!route) throw new Error("This designation is not mapped in Workforce Master.");
  if (!route.registration_enabled) throw new Error("Registration is disabled for this designation in Workforce Master.");
  if (route.table_name !== "workforce") {
    throw new Error(`This designation is routed to ${route.register_code}, not Workforce.`);
  }
  return route;
}

export async function workforceDesignationIds(companyId: string) {
  if (!supabaseAdmin) return new Set<string>();
  const result = await supabaseAdmin
    .from("designation_register_routes")
    .select("designation_id, registration_enabled, workforce_register_master!inner(table_name, is_active)")
    .eq("company_id", companyId)
    .eq("registration_enabled", true)
    .eq("workforce_register_master.table_name", "workforce")
    .eq("workforce_register_master.is_active", true);
  if (result.error) throw new Error(result.error.message);
  return new Set((result.data ?? []).map((row) => String(row.designation_id)));
}
