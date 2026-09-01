export const WORKFORCE_PROFILE_TABLE = "workforce" as const;

export function canonicalWorkforceIdentity(id: string, designationId: string) {
  return {
    id,
    designation_id: designationId,
    // The shared schema keeps this compatibility discriminator constrained to
    // the legacy source values. compatibility_mode=false and
    // migration_state=canonical make this a native Workforce record.
    source_profile_type: "field_executive",
    source_profile_id: id,
    compatibility_mode: false,
    migration_state: "canonical",
    synced_at: new Date().toISOString()
  } as const;
}
