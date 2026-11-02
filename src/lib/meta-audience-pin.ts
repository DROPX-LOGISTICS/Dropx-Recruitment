export type AdAudiencePin = { latitude: number; longitude: number; label?: string };

/** Recruit currently publishes only Indian station recruitment campaigns. */
export function validateAdAudiencePin(value: unknown): AdAudiencePin {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Choose a location on the map.");
  const pin = value as Record<string, unknown>;
  const coordinate = (n: unknown) => n == null || String(n).trim() === "" ? NaN : Number(n);
  const latitude = coordinate(pin.latitude), longitude = coordinate(pin.longitude);
  if (!Number.isFinite(latitude) || latitude < 5 || latitude > 38 || !Number.isFinite(longitude) || longitude < 67 || longitude > 98) throw new Error("Choose a valid recruitment location in India.");
  return { latitude, longitude, label: String(pin.label || "Custom ad pin").trim().slice(0, 180) };
}
