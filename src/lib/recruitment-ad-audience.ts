import { validateMetaLocationAudience, type MetaLocationAudience } from "./meta-ad-builder";
import { META_AUDIENCE_RADIUS_DEFAULT_KM } from "./meta-audience-radius";
import { supabaseAdmin } from "./supabase-admin";

export async function resolveRecruitmentAdAudience(input: {
  companyId: string;
  locationId: string;
  radiusKm?: unknown;
}): Promise<MetaLocationAudience> {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  const locationId = String(input.locationId || "").trim();
  if (!locationId) throw new Error("Choose a station before publishing.");

  const locationResult = await supabaseAdmin.from("recruitment_locations")
      .select("id,station_id,code,name")
      .eq("company_id", input.companyId)
      .eq("id", locationId)
      .eq("is_active", true)
      .maybeSingle();
  if (locationResult.error) throw new Error(locationResult.error.message);
  if (!locationResult.data) throw new Error("The selected station is no longer active.");

  const code = String(locationResult.data.code || "").trim().toUpperCase();
  if (!locationResult.data.station_id) throw new Error(`${code} is not linked to the Location Master. Correct its station mapping before publishing.`);
  const stationResult = await supabaseAdmin.from("stations")
    .select("id,station_code,station_name")
    .eq("company_id", input.companyId).eq("id", locationResult.data.station_id)
    .eq("is_active", true).maybeSingle();
  if (stationResult.error) throw new Error(stationResult.error.message);
  const station = stationResult.data;
  if (!station || String(station.station_code).trim().toUpperCase() !== code) {
    throw new Error(`${code} does not match an active station in the Location Master. Correct the mapping before publishing.`);
  }
  const adPinResult = await supabaseAdmin.from("recruitment_location_contacts")
    .select("ad_latitude,ad_longitude")
    .eq("company_id", input.companyId)
    .eq("location_id", locationId)
    .maybeSingle();
  if (adPinResult.error) throw new Error(adPinResult.error.message);
  const adPin = adPinResult.data;
  if (adPin?.ad_latitude == null || adPin?.ad_longitude == null) {
    throw new Error(`Add the Meta ad pin for ${code} in Station Contacts before publishing.`);
  }
  return validateMetaLocationAudience({
    locationId,
    stationCode: code,
    stationName: String(station.station_name || code).trim(),
    address: null,
    latitude: adPin.ad_latitude,
    longitude: adPin.ad_longitude,
    radiusKm: input.radiusKm == null || String(input.radiusKm).trim() === ""
      ? META_AUDIENCE_RADIUS_DEFAULT_KM
      : Number(input.radiusKm),
    source: "station_contacts"
  });
}
