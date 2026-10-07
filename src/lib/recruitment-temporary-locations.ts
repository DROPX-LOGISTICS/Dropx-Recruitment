export type TemporaryLocationGrant = {
  id: string;
  user_access_id: string;
  location_id: string;
  starts_at: string;
  expires_at: string;
  revoked_at: string | null;
  reason?: string;
  created_at?: string;
  granted_by?: string;
  revoked_by?: string | null;
};

export function temporaryLocationState(grant: TemporaryLocationGrant, now = Date.now()) {
  if (grant.revoked_at) return "Disabled";
  const start = Date.parse(grant.starts_at);
  const end = Date.parse(grant.expires_at);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end <= now) return "Expired";
  return start > now ? "Scheduled" : "Active";
}

/** Add only live, explicitly granted locations. Never turn an empty list into all locations. */
export function withTemporaryLocations<T extends { allLocations: boolean; locationIds: string[] }>(
  base: T,
  grants: TemporaryLocationGrant[],
  now = Date.now()
) {
  const extraIds = [...new Set(grants.filter((grant) => temporaryLocationState(grant, now) === "Active")
    .map((grant) => grant.location_id))];
  return {
    ...base,
    baseAllLocations: base.allLocations,
    baseLocationIds: [...base.locationIds],
    temporaryLocationIds: extraIds,
    locationIds: base.allLocations ? base.locationIds : [...new Set([...base.locationIds, ...extraIds])]
  };
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validAccessId(value: unknown): value is string {
  return typeof value === "string" && uuid.test(value);
}

export function validateTemporaryLocationInput(body: Record<string, unknown>, now = Date.now()) {
  if (!validAccessId(body.profileId) || !validAccessId(body.requestId)) throw new Error("Select a user and retry.");
  if (!Array.isArray(body.locationIds) || !body.locationIds.length || body.locationIds.length > 100
    || !body.locationIds.every(validAccessId)) throw new Error("Select one or more valid locations (maximum 100).");
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length < 3 || reason.length > 500) throw new Error("Enter a reason (3–500 characters).");
  const expiry = typeof body.expiresAt === "string" ? Date.parse(body.expiresAt) : NaN;
  if (!Number.isFinite(expiry) || expiry <= now) throw new Error("Choose a future expiry date and time.");
  return { profileId: body.profileId, requestId: body.requestId, locationIds: [...new Set(body.locationIds as string[])], reason, expiresAt: new Date(expiry).toISOString() };
}
