import { createHash } from "node:crypto";
import { isValidMetaAudienceRadius } from "./meta-audience-radius";
import { coordinateDistanceKm, metaRadiusKm } from "./meta-targeting";
import { validateAdAudiencePin } from "./meta-audience-pin";

export type AudiencePoint = { latitude: number; longitude: number };
export type AudienceSnapshot = {
  id: string; status?: string; effective_status?: string;
  adset?: { id: string; status?: string; targeting?: Record<string, any>; ads?: { data?: { id: string }[]; paging?: { next?: string } } };
  campaign?: { id: string; status?: string; special_ad_categories?: string[] };
};
export const AUDIENCE_EDIT_FIELDS = "id,name,status,configured_status,effective_status,adset{id,name,status,effective_status,start_time,end_time,daily_budget,targeting,ads.limit(2){id}},campaign{id,name,status,effective_status,special_ad_categories}";

function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
export function audienceVersion(snapshot: AudienceSnapshot, station: AudiencePoint | null) {
  return createHash("sha256").update(JSON.stringify(canonical({
    id: snapshot.id, adsetId: snapshot.adset?.id, campaignId: snapshot.campaign?.id,
    targeting: snapshot.adset?.targeting, categories: snapshot.campaign?.special_ad_categories,
    status: [snapshot.status, snapshot.adset?.status, snapshot.campaign?.status], station
  }))).digest("hex");
}
export function audienceEditBlocker(snapshot: AudienceSnapshot) {
  if (!snapshot.adset?.id || !snapshot.campaign?.id) return "Meta did not return this ad’s audience. Refresh and try again.";
  if (![snapshot.status, snapshot.adset.status, snapshot.campaign.status].every(status => ["ACTIVE", "PAUSED"].includes(String(status)))) return "This ad cannot be edited in its current Meta state.";
  const ads = snapshot.adset.ads;
  if (ads?.data?.length !== 1 || ads.data[0].id !== snapshot.id || ads.paging?.next) return "This audience is shared with other ads. Edit the shared ad set in Meta Ads Manager.";
  return null;
}
export function currentAudiencePin(targeting: any): (AudiencePoint & { radiusKm: number }) | null {
  const geo = targeting?.geo_locations;
  const pins = geo?.custom_locations;
  if (!Array.isArray(pins) || pins.length !== 1) return null;
  if (Object.entries(geo).some(([key, value]) => !["custom_locations", "location_types"].includes(key) && Array.isArray(value) && value.length)) return null;
  if (targeting.excluded_geo_locations) return null;
  const pin = pins[0], radiusKm = metaRadiusKm(pin.radius, pin.distance_unit);
  if (!radiusKm || pin.latitude == null || pin.longitude == null || !Number.isFinite(Number(pin.latitude)) || !Number.isFinite(Number(pin.longitude)) || Math.abs(Number(pin.latitude)) > 90 || Math.abs(Number(pin.longitude)) > 180) return null;
  return { latitude: Number(pin.latitude), longitude: Number(pin.longitude), radiusKm };
}
export function plannedAudience(snapshot: AudienceSnapshot, station: AudiencePoint | null, input: { center: unknown; radiusKm: unknown; customPin?: unknown }) {
  const blocker = audienceEditBlocker(snapshot);
  if (blocker) throw new Error(blocker);
  if (!isValidMetaAudienceRadius(input.radiusKm)) throw new Error("Choose a whole-number radius from 3 to 80 km.");
  if (!["station", "current", "custom"].includes(String(input.center))) throw new Error("Choose a location pin.");
  const point = input.center === "custom" ? validateAdAudiencePin(input.customPin) : input.center === "station" ? station : currentAudiencePin(snapshot.adset?.targeting);
  if (!point) throw new Error(input.center === "station" ? "Add a verified ad pin in Station Contacts first." : "This audience has multiple areas or exclusions. Choose the verified station pin to replace them.");
  // Only geographic controls are accepted. Hiring audiences stay inclusive.
  const targeting = { ...snapshot.adset!.targeting, age_min: 18, age_max: 65, genders: [1, 2],
    geo_locations: { custom_locations: [{ latitude: point.latitude, longitude: point.longitude, radius: Number(input.radiusKm), distance_unit: "kilometer" }], location_types: ["home", "recent"] }
  } as Record<string, any>;
  delete targeting.excluded_geo_locations;
  return { targeting, point, radiusKm: Number(input.radiusKm) };
}
export async function changeMetaAudience(input: {
  adId: string; expectedVersion: string; station: AudiencePoint | null; center: unknown; radiusKm: unknown; customPin?: unknown;
  validateOnly: boolean; read: () => Promise<AudienceSnapshot>;
  post: (id: string, values: Record<string, string>, check: () => Promise<void>) => Promise<unknown>;
  sleep?: (ms: number) => Promise<void>;
}) {
  const before = await input.read();
  const checkVersion = (snapshot: AudienceSnapshot) => {
    if (snapshot.id !== input.adId || audienceVersion(snapshot, input.station) !== input.expectedVersion) throw new Error("The audience or station pin changed. Reopen Edit audience and review it again.");
    const blocker = audienceEditBlocker(snapshot);
    if (blocker) throw new Error(blocker);
  };
  checkVersion(before);
  const plan = plannedAudience(before, input.station, input);
  await input.post(before.adset!.id, {
    targeting: JSON.stringify(plan.targeting),
    ...(input.validateOnly ? { execution_options: JSON.stringify(["validate_only"]) } : {})
  }, async () => checkVersion(await input.read()));
  if (input.validateOnly) return { before, after: before, plan };
  const wait = input.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  for (let attempt = 0; attempt < 3; attempt++) {
    const after = await input.read();
    const pin = currentAudiencePin(after.adset?.targeting);
    const target = after.adset?.targeting;
    const genders = target?.genders;
    const inclusive = Number(target?.age_min ?? 18) === 18 && Number(target?.age_max ?? 65) === 65 && (!genders?.length || (genders.length === 2 && genders.includes(1) && genders.includes(2)));
    if (after.id === before.id && after.adset?.id === before.adset?.id && after.campaign?.id === before.campaign?.id && pin && coordinateDistanceKm(pin, plan.point) < 0.1 && Math.abs(pin.radiusKm - plan.radiusKm) < 0.1 && inclusive) return { before, after, plan };
    if (attempt < 2) await wait(1000);
  }
  throw new Error("Meta accepted the update but has not confirmed the audience yet. Refresh before retrying; it may already be saved.");
}
