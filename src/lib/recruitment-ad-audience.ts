import {
  META_AUDIENCE_RADIUS_DEFAULT_KM,
  validateMetaLocationAudience,
  type MetaLocationAudience
} from "./meta-ad-builder";
import { supabaseAdmin } from "./supabase-admin";

export async function resolveRecruitmentAdAudience(input: {
  companyId: string;
  locationId: string;
  radiusKm?: unknown;
}): Promise<MetaLocationAudience> {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  const locationId = String(input.locationId || "").trim();
  if (!locationId) throw new Error("Choose a station before publishing.");

  const [locationResult, contactResult] = await Promise.all([
    supabaseAdmin.from("recruitment_locations")
      .select("id,code,name")
      .eq("company_id", input.companyId)
      .eq("id", locationId)
      .eq("is_active", true)
      .maybeSingle(),
    supabaseAdmin.from("recruitment_location_contacts")
      .select("location_id,address,latitude,longitude")
      .eq("company_id", input.companyId)
      .eq("location_id", locationId)
      .maybeSingle()
  ]);
  if (locationResult.error || contactResult.error) {
    throw new Error(locationResult.error?.message || contactResult.error?.message);
  }
  if (!locationResult.data) throw new Error("The selected station is no longer active.");

  const code = String(locationResult.data.code || "").trim().toUpperCase();
  if (!contactResult.data) {
    throw new Error(`Add latitude and longitude for ${code || "this station"} in Master → Station Contacts before publishing.`);
  }
  return validateMetaLocationAudience({
    locationId,
    stationCode: code,
    stationName: String(locationResult.data.name || code).trim(),
    address: String(contactResult.data.address || "").trim() || null,
    latitude: contactResult.data.latitude,
    longitude: contactResult.data.longitude,
    radiusKm: input.radiusKm == null || String(input.radiusKm).trim() === ""
      ? META_AUDIENCE_RADIUS_DEFAULT_KM
      : Number(input.radiusKm),
    source: "station_contacts"
  });
}
