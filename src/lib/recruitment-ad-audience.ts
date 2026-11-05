import { validateMetaLocationAudience, type MetaLocationAudience } from "./meta-ad-builder";
import { META_AUDIENCE_RADIUS_DEFAULT_KM } from "./meta-audience-radius";
import { supabaseAdmin } from "./supabase-admin";
import { validateAdAudiencePin } from "./meta-audience-pin";

export async function resolveRecruitmentAdAudience(input: {
  companyId: string;
  locationId: string;
  radiusKm?: unknown;
  customPin?: unknown;
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
    .select("id,station_code,station_name,address,latitude,longitude")
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
  const override = input.customPin == null ? null : validateAdAudiencePin(input.customPin);
  // A dedicated ad pin takes precedence. Only an entirely unset pin falls back
  // to the canonical station; never combine coordinates from different sources.
  const savedPin = adPinResult.data;
  const hasSavedPin = savedPin?.ad_latitude != null || savedPin?.ad_longitude != null;
  const source = override ? "ad_override" : hasSavedPin ? "station_contacts" : "location_master";
  const pin = override || (hasSavedPin
    ? { latitude: savedPin!.ad_latitude, longitude: savedPin!.ad_longitude }
    : { latitude: station.latitude, longitude: station.longitude });
  if (pin.latitude == null || pin.longitude == null) {
    throw new Error(`Choose an ad pin below or add coordinates for ${code} in Station Contacts or the Location Master before publishing.`);
  }
  return validateMetaLocationAudience({
    locationId,
    stationCode: code,
    stationName: String(station.station_name || code).trim(),
    address: override?.label || (source === "location_master" ? station.address : null) || null,
    latitude: pin.latitude,
    longitude: pin.longitude,
    radiusKm: input.radiusKm == null || String(input.radiusKm).trim() === ""
      ? META_AUDIENCE_RADIUS_DEFAULT_KM
      : Number(input.radiusKm),
    source
  });
}
