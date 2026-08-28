import { parseAdRouteWithMasters } from "./recruitment-routing";
import { supabaseAdmin } from "./supabase-admin";

export async function remapUnmappedApplications(options: {
  companyId: string;
  actorProfileId?: string | null;
  actorEmail?: string | null;
}) {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  const [locations, roles, ads] = await Promise.all([
    supabaseAdmin.from("recruitment_locations").select("id,code")
      .eq("company_id", options.companyId).eq("is_active", true),
    supabaseAdmin.from("recruitment_roles").select("id,code,name,stream,aliases")
      .eq("company_id", options.companyId).eq("is_active", true),
    supabaseAdmin.from("recruitment_ads").select("id,ad_name,location_id,role_id,route_status")
      .eq("company_id", options.companyId)
      .or("route_status.eq.unmapped,location_id.is.null,role_id.is.null")
      .limit(2000)
  ]);
  if (locations.error || roles.error || ads.error) {
    throw new Error(locations.error?.message || roles.error?.message || ads.error?.message);
  }

  let adsRemapped = 0;
  let leadsRemapped = 0;
  for (const ad of ads.data ?? []) {
    const parsed = parseAdRouteWithMasters(ad.ad_name, locations.data ?? [], roles.data ?? []);
    const location = (locations.data ?? []).find((item) => item.code === parsed.stationCode);
    const role = (roles.data ?? []).find((item) => item.code === parsed.roleCode);
    if (!location || !role) continue;

    const leads = await supabaseAdmin.from("recruitment_leads")
      .select("id,location_id,role_id,stream,status")
      .eq("company_id", options.companyId).eq("ad_id", ad.id);
    if (leads.error) throw new Error(leads.error.message);
    const changedLeads = (leads.data ?? []).filter((lead) =>
      lead.location_id !== location.id || lead.role_id !== role.id || lead.stream !== role.stream
    );
    const updatedAd = await supabaseAdmin.from("recruitment_ads").update({
      location_id: location.id,
      role_id: role.id,
      route_status: "mapped",
      updated_at: new Date().toISOString()
    }).eq("company_id", options.companyId).eq("id", ad.id);
    if (updatedAd.error) throw new Error(updatedAd.error.message);
    adsRemapped++;

    if (changedLeads.length) {
      const updatedLeads = await supabaseAdmin.from("recruitment_leads").update({
        location_id: location.id,
        role_id: role.id,
        stream: role.stream
      }).eq("company_id", options.companyId).in("id", changedLeads.map((lead) => lead.id));
      if (updatedLeads.error) throw new Error(updatedLeads.error.message);
      const routedNewLeads = changedLeads.filter((lead) => lead.status === "unmapped").map((lead) => lead.id);
      if (routedNewLeads.length) {
        const restored = await supabaseAdmin.from("recruitment_leads").update({
          status: "",
          updated_at: new Date().toISOString()
        }).eq("company_id", options.companyId).in("id", routedNewLeads);
        if (restored.error) throw new Error(restored.error.message);
      }
      leadsRemapped += changedLeads.length;
      const history = await supabaseAdmin.from("recruitment_lead_history").insert(
        changedLeads.map((lead) => ({
          company_id: options.companyId,
          lead_id: lead.id,
          event_type: "routing_remap",
          field_name: "location_role",
          old_value: `${lead.location_id ?? "unmapped"}|${lead.role_id ?? "unmapped"}`,
          new_value: `${location.code}|${role.code}`,
          remarks: "Re-routed from the current ad name after a master update.",
          actor_profile_id: options.actorProfileId ?? null,
          actor_email: options.actorEmail ?? null,
          metadata: { ad_id: ad.id, ad_name: ad.ad_name, source_of_truth: "ad_name" }
        }))
      );
      if (history.error) throw new Error(history.error.message);
    }
  }
  return { adsRemapped, leadsRemapped };
}
