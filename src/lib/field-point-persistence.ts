const DATABASE_MANAGED_FIELD_POINT_COLUMNS = new Set([
  "id",
  "created_at",
  "received_at"
]);

/**
 * Location points are read back with their database identity before route
 * evaluation. Never send generated columns back through an upsert: Postgres
 * rejects explicit values for GENERATED ALWAYS identity columns before it can
 * resolve the duty/recorded_at conflict.
 */
export function fieldPointForEvaluation(point: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(point).filter(([column]) => !DATABASE_MANAGED_FIELD_POINT_COLUMNS.has(column))
  );
}
