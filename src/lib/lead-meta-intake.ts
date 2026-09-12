import { supabaseAdmin } from "./supabase-admin";

/** Latest actual Meta intake for the already-authorized page of leads. */
export async function loadMetaReceivedTimes(companyId: string, leadIds: string[]) {
  const receivedTimes = new Map<string, string>();
  if (!leadIds.length) return receivedTimes;
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  const pageSize = 1000;
  // Batch the page instead of one lookup per lead. Paginate occurrences so a
  // lead with many duplicates cannot hide another lead's latest timestamp.
  for (let offset = 0; ; offset += pageSize) {
    const result = await supabaseAdmin.from("recruitment_lead_source_events")
      .select("lead_id,received_at")
      .eq("company_id", companyId)
      .in("lead_id", leadIds)
      .like("source_system", "meta%")
      .in("status", ["processed", "lead_saved"])
      .order("received_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (result.error) throw new Error(result.error.message);
    for (const event of result.data ?? []) {
      if (!receivedTimes.has(event.lead_id)) receivedTimes.set(event.lead_id, event.received_at);
    }
    if ((result.data?.length ?? 0) < pageSize || receivedTimes.size === leadIds.length) break;
  }
  return receivedTimes;
}
