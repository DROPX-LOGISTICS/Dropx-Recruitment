import { requiredEnv } from "./recruitment-api";
import { enqueueLeadNotification } from "./recruitment-notifications";
import { supabaseAdmin } from "./supabase-admin";

export async function enqueueStoredLeadWelcome(leadId: string) {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
  const stored = await supabaseAdmin.from("recruitment_leads")
    .select("id,phone,full_name,stream,location_id,role_id")
    .eq("company_id", companyId).eq("id", leadId).single();
  if (stored.error) throw new Error(stored.error.message);
  const [role, contact] = await Promise.all([
    stored.data.role_id
      ? supabaseAdmin.from("recruitment_roles").select("name")
          .eq("company_id", companyId).eq("id", stored.data.role_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    stored.data.location_id
      ? supabaseAdmin.from("recruitment_location_contacts").select("address,latitude,longitude,poc_mobile")
          .eq("company_id", companyId).eq("location_id", stored.data.location_id).maybeSingle()
      : Promise.resolve({ data: null, error: null })
  ]);
  if (role.error || contact.error) throw new Error(role.error?.message || contact.error?.message);
  return enqueueLeadNotification({
    companyId,
    lead: {
      id: stored.data.id,
      phone: stored.data.phone,
      full_name: stored.data.full_name,
      stream: stored.data.stream,
      location_id: stored.data.location_id,
      recruitment_roles: role.data,
      recruitment_locations: contact.data
    },
    trigger: "new_lead",
    anchor: "initial"
  });
}
