import { fieldPointCoordinatesAreValid } from "./field-route";

export type FieldPointIngestionOptions = {
  companyId: string;
  dutyId: string;
  earliestAllowedMs: number;
  latestAllowedMs: number;
  maximumBatchSize?: number;
};

export type ClassifiedFieldPoint = {
  clientPointId: string;
  row: Record<string, unknown>;
};

const finite = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : null;

export function classifyFieldPointBatch(rawPoints: unknown[], options: FieldPointIngestionOptions) {
  const accepted: ClassifiedFieldPoint[] = [];
  const rejectedPointIds: string[] = [];
  const rejectionReasons: Record<string, string> = {};
  // Keep the server compatible with the v1.3.0 client, which may reconnect
  // with a larger volatile batch. The durable v1.3.1 client deliberately
  // sends chunks of 100, but the server must not discard older queued points.
  const maximumBatchSize = Math.min(500, Math.max(1, options.maximumBatchSize ?? 500));

  for (const raw of rawPoints.slice(0, maximumBatchSize)) {
    const item = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const explicitClientPointId = String(item.clientPointId ?? "").trim().slice(0, 128);
    const recordedAt = String(item.recordedAt ?? "").trim();
    const recordedAtMs = Date.parse(recordedAt);
    // v1.3.0 did not send clientPointId. Generate a deterministic identifier
    // so those phones continue to upload while v1.3.1 receives explicit ACKs.
    const clientPointId = explicitClientPointId || [
      "legacy",
      Number.isFinite(recordedAtMs) ? recordedAtMs : "invalid-time",
      finite(item.sequence) ?? "no-sequence",
      finite(item.latitude) ?? "no-latitude",
      finite(item.longitude) ?? "no-longitude"
    ].join("-").slice(0, 128);
    let reason = "";
    if (!Number.isFinite(recordedAtMs)) reason = "invalid_recorded_at";
    else if (recordedAtMs < options.earliestAllowedMs || recordedAtMs > options.latestAllowedMs) reason = "outside_duty_window";
    else if (!fieldPointCoordinatesAreValid(item.latitude, item.longitude)) reason = "invalid_coordinates";

    if (reason) {
      if (clientPointId) {
        rejectedPointIds.push(clientPointId);
        rejectionReasons[clientPointId] = reason;
      }
      continue;
    }

    accepted.push({
      clientPointId,
      row: {
        company_id: options.companyId,
        duty_id: options.dutyId,
        recorded_at: new Date(recordedAtMs).toISOString(),
        latitude: finite(item.latitude),
        longitude: finite(item.longitude),
        accuracy_meters: finite(item.accuracy),
        speed_mps: finite(item.speed),
        is_mocked: Boolean(item.isMocked),
        // The sequence is a volatile client-side queue counter. Android can
        // restart the process while a duty is active and begin that counter
        // again, so it is not a safe database identity. recorded_at is already
        // unique per duty and clientPointId is used for acknowledgements.
        sequence: null,
        monotonic_ms: finite(item.monotonicMs),
        altitude_meters: finite(item.altitude),
        speed_accuracy_mps: finite(item.speedAccuracy),
        heading_degrees: finite(item.heading),
        heading_accuracy_degrees: finite(item.headingAccuracy),
        provider: String(item.provider ?? "").trim() || null,
        activity_type: String(item.activityType ?? "").trim() || null,
        activity_confidence: finite(item.activityConfidence),
        battery_percent: finite(item.batteryPercent),
        is_charging: typeof item.isCharging === "boolean" ? item.isCharging : null,
        app_version: String(item.appVersion ?? "").trim() || null,
        platform: String(item.platform ?? "").trim() || null
      }
    });
  }

  return {
    accepted,
    acknowledgedPointIds: accepted.map((point) => point.clientPointId),
    rejectedPointIds,
    rejectionReasons
  };
}
