import { supabaseAdmin } from "./supabase-admin";

const authoritativeStreams = [
  { code: "SSA", stream: "hr" }
] as const;

export async function reconcileRecruitmentStreams(companyId: string) {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  let leadsMigrated = 0;

  for (const definition of authoritativeStreams) {
    const role = await supabaseAdmin
      .from("recruitment_roles")
      .select("id,stream")
      .eq("company_id", companyId)
      .eq("code", definition.code)
      .maybeSingle();
    if (role.error) throw new Error(role.error.message);
    if (!role.data) continue;

    if (role.data.stream !== definition.stream) {
      const updatedRole = await supabaseAdmin
        .from("recruitment_roles")
        .update({
          stream: definition.stream,
          updated_at: new Date().toISOString()
        })
        .eq("company_id", companyId)
        .eq("id", role.data.id);
      if (updatedRole.error) throw new Error(updatedRole.error.message);
    }

    const mismatched = await supabaseAdmin
      .from("recruitment_leads")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("role_id", role.data.id)
      .neq("stream", definition.stream);
    if (mismatched.error) throw new Error(mismatched.error.message);
    if (!mismatched.count) continue;

    const updatedLeads = await supabaseAdmin
      .from("recruitment_leads")
      .update({
        stream: definition.stream,
        updated_at: new Date().toISOString()
      })
      .eq("company_id", companyId)
      .eq("role_id", role.data.id)
      .neq("stream", definition.stream);
    if (updatedLeads.error) throw new Error(updatedLeads.error.message);
    leadsMigrated += mismatched.count;
  }

  return { leadsMigrated };
}
