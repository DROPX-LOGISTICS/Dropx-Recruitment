export type FieldLocationScope = { allLocations: boolean; locationIds: string[] };

export function assignedLocationAllowed(scope: FieldLocationScope, locationId: unknown) {
  const id = String(locationId ?? "").trim();
  if (!id) return true;
  return scope.locationIds.length ? scope.locationIds.includes(id) : scope.allLocations;
}

export function lockedFieldDutyLocation(duty: {
  primary_location_id?: unknown;
  primary_location_name?: unknown;
  primary_location_code?: unknown;
}) {
  return {
    locationId: String(duty.primary_location_id ?? "").trim() || null,
    locationName: String(duty.primary_location_name ?? duty.primary_location_code ?? "").trim() || null,
    locationCode: String(duty.primary_location_code ?? "").trim() || null
  };
}

const hotspotTypes = new Set([
  "college", "training_institute", "club_community", "market_transit", "event_camp", "other"
]);

export function normalizeFieldHotspots(value: unknown) {
  return (Array.isArray(value) ? value : []).slice(0, 12).map((raw) => {
    const item = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const type = String(item.type ?? "");
    return {
      name: String(item.name ?? "").trim().slice(0, 120),
      type: hotspotTypes.has(type) ? type : "other"
    };
  }).filter((item) => item.name.length >= 2);
}
