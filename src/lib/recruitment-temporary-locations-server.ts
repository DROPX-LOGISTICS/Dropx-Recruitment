import { supabaseAdmin } from "./supabase-admin";
import { withTemporaryLocations, type TemporaryLocationGrant } from "./recruitment-temporary-locations";
import type { MobileSessionContext } from "./mobile-session";

export async function activeTemporaryLocations(companyId: string, accessId?: string) {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  const now = new Date().toISOString();
  const rows: TemporaryLocationGrant[] = [];
  for (let offset = 0; ; offset += 500) {
    let query = supabaseAdmin.from("recruitment_temporary_location_grants")
      .select("id,user_access_id,location_id,starts_at,expires_at,revoked_at,recruitment_locations!inner(is_active,company_id,stations!inner(is_active)),recruitment_user_access!inner(is_active,profiles!inner(is_active))")
      .eq("company_id", companyId).is("revoked_at", null).lte("starts_at", now).gt("expires_at", now)
      .eq("recruitment_locations.company_id", companyId).eq("recruitment_locations.is_active", true)
      .eq("recruitment_locations.stations.is_active", true)
      .eq("recruitment_user_access.is_active", true).eq("recruitment_user_access.profiles.is_active", true)
      .order("id").range(offset, offset + 499);
    if (accessId) query = query.eq("user_access_id", accessId);
    const result = await query;
    if (result.error) throw new Error(result.error.message);
    rows.push(...(result.data ?? []));
    if ((result.data ?? []).length < 500) break;
  }
  return rows;
}

/** Deliberately outside the session cache: expiry/revocation must apply on the next request on every instance. */
export async function attachTemporaryLocations(companyId: string, base: MobileSessionContext) {
  const grants = await activeTemporaryLocations(companyId, base.accessId);
  if (grants.length) {
    const membership = await supabaseAdmin!.from("company_product_memberships").select("id")
      .eq("company_id", companyId).eq("user_id", base.profileId).eq("product_code", "recruit")
      .eq("is_active", true).maybeSingle();
    if (membership.error) throw new Error(membership.error.message);
    if (!membership.data) return null;
  }
  return withTemporaryLocations(base, grants);
}
