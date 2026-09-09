type Point = { latitude: unknown; longitude: unknown };
export function coordinateDistanceKm(a: Point, b: Point) {
  const values = [a.latitude, a.longitude, b.latitude, b.longitude];
  if (values.some((value) => value == null || String(value).trim() === "" || !Number.isFinite(Number(value)))) return Infinity;
  const [lat1, lon1, lat2, lon2] = values.map((value) => Number(value) * Math.PI / 180);
  const h = Math.sin((lat2 - lat1) / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function assertMetaTargeting(targeting: any, audience: Point & { radiusKm: number; stationCode: string }) {
  const geo = targeting?.geo_locations;
  const pins = geo?.custom_locations;
  const additional = Object.entries(geo || {}).some(([key, value]) =>
    !["custom_locations", "location_types"].includes(key) && Array.isArray(value) && value.length > 0);
  const pin = Array.isArray(pins) && pins.length === 1 ? pins[0] : null;
  const radius = pin?.distance_unit === "mile" ? Number(pin.radius) * 1.609344 : Number(pin?.radius);
  if (!pin || additional || targeting?.excluded_geo_locations || coordinateDistanceKm(pin, audience) > 0.1
    || !Number.isFinite(radius) || Math.abs(radius - audience.radiusKm) > 0.1) {
    throw new Error(`Meta targeting does not match the reviewed ${audience.stationCode} station pin and radius. The ad has not been activated. Review the ad set before retrying.`);
  }
}

export function assertReviewedAudience(reviewed: any, current: any) {
  if (!reviewed || reviewed.locationId !== current.locationId || reviewed.stationCode !== current.stationCode
    || Number(reviewed.latitude) !== current.latitude || Number(reviewed.longitude) !== current.longitude
    || Number(reviewed.radiusKm) !== current.radiusKm) {
    throw new Error("The station location or radius changed after review. Review the current map pin before publishing.");
  }
}

/** Legacy city/ZIP audiences remain explicit rather than being silently retargeted. */
export function reviewStationTargeting(targeting: any, station: Point | null) {
  const geo = targeting?.geo_locations;
  const pins = geo?.custom_locations;
  if (!station || station.latitude == null || station.longitude == null) return { state: "master_missing", distanceKm: null };
  if (!Array.isArray(pins) || pins.length !== 1) return { state: "area_audience", distanceKm: null };
  const distanceKm = coordinateDistanceKm(pins[0], station);
  const extra = Object.entries(geo || {}).some(([key,value]) => !["custom_locations","location_types"].includes(key) && Array.isArray(value) && value.length > 0);
  return { state: !extra && distanceKm <= 0.25 ? "matched" : "review_required", distanceKm: Number.isFinite(distanceKm) ? Math.round(distanceKm * 100) / 100 : null };
}
