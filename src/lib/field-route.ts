export type FieldLocationPoint = {
  id?: unknown;
  sequence?: unknown;
  recorded_at?: unknown;
  recordedAt?: unknown;
  recordedAtMs?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  accuracy_meters?: unknown;
  accuracy?: unknown;
  accuracyMeters?: unknown;
  speed_mps?: unknown;
  speed?: unknown;
  speedMps?: unknown;
  is_mocked?: unknown;
  isMocked?: unknown;
};

export type NormalizedFieldLocationPoint = {
  id: string | null;
  sequence: number | null;
  recordedAt: string;
  recordedAtMs: number;
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  speedMps: number | null;
  isMocked: boolean;
};

export type FieldPointQuality = "excellent" | "good" | "weak" | "unusable";
export type FieldPointDecision = "accepted" | "stationary" | "rejected";
export type FieldMotionState = "acquiring" | "stationary" | "candidate_moving" | "moving" | "candidate_stopped" | "gps_degraded" | "suspicious";

export type FieldPointEvaluation = {
  recordedAt: string | null;
  quality: FieldPointQuality;
  decision: FieldPointDecision;
  motionState: FieldMotionState;
  rejectionCodes: string[];
  acceptedDistanceMeters: number;
};

export type FieldStopSummary = {
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  durationMinutes: number;
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  pointCount: number;
};

const earthRadiusMeters = 6_371_000;
const maximumCountedAccuracyMeters = 25;
const maximumStoredAccuracyMeters = 50;
const maximumRoadSpeedMps = 45;
const movementConfirmationPoints = 3;
const movementConfirmationMs = 10_000;
const stopConfirmationMs = 60_000;
const reportableStopMs = 5 * 60_000;
const maximumContinuousGapMs = 15 * 60_000;
const maximumSparseBridgeGapMs = 5 * 60_000;
const maximumSparseBridgeMeters = 1_500;
const maximumContinuousBridgeMeters = 5_000;
const maximumStopSampleGapMs = 90_000;

function finite(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function robustAnchor(points: NormalizedFieldLocationPoint[]) {
  const window = points.slice(-9);
  return {
    ...window.at(-1)!,
    latitude: median(window.map((point) => point.latitude)),
    longitude: median(window.map((point) => point.longitude)),
    accuracyMeters: median(window.map((point) => point.accuracyMeters))
  };
}

export function fieldPointCoordinatesAreValid(latitude: unknown, longitude: unknown) {
  const lat = finite(latitude);
  const lng = finite(longitude);
  return lat != null && lng != null && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
    && !(lat === 0 && lng === 0);
}

export function haversineMeters(a: Pick<NormalizedFieldLocationPoint, "latitude" | "longitude">, b: Pick<NormalizedFieldLocationPoint, "latitude" | "longitude">) {
  const rad = (value: number) => value * Math.PI / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const value = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(value));
}

export function normalizeFieldLocationPoint(point: FieldLocationPoint): NormalizedFieldLocationPoint | null {
  const recordedAt = String(point.recorded_at ?? point.recordedAt ?? "").trim();
  const suppliedRecordedAtMs = finite(point.recordedAtMs);
  const recordedAtMs = suppliedRecordedAtMs ?? Date.parse(recordedAt);
  const latitude = finite(point.latitude);
  const longitude = finite(point.longitude);
  const accuracyMeters = finite(point.accuracy_meters ?? point.accuracy ?? point.accuracyMeters);
  if ((!recordedAt && suppliedRecordedAtMs == null) || !Number.isFinite(recordedAtMs)
    || !fieldPointCoordinatesAreValid(latitude, longitude)
    || accuracyMeters == null || accuracyMeters < 0) return null;
  return {
    id: point.id == null ? null : String(point.id),
    sequence: finite(point.sequence),
    recordedAt: new Date(recordedAtMs).toISOString(),
    recordedAtMs,
    latitude: latitude!,
    longitude: longitude!,
    accuracyMeters,
    speedMps: finite(point.speed_mps ?? point.speed ?? point.speedMps),
    isMocked: Boolean(point.is_mocked ?? point.isMocked)
  };
}

export function fieldPointQuality(accuracyMeters: number): FieldPointQuality {
  if (accuracyMeters <= 10) return "excellent";
  if (accuracyMeters <= maximumCountedAccuracyMeters) return "good";
  if (accuracyMeters <= maximumStoredAccuracyMeters) return "weak";
  return "unusable";
}

export function fieldTrackingPointIsUsable(point: FieldLocationPoint, options?: {
  maximumAccuracyMeters?: number;
  nowMs?: number;
  maximumAgeMs?: number;
}) {
  const normalized = normalizeFieldLocationPoint(point);
  if (!normalized || normalized.isMocked) return false;
  const maximumAccuracyMeters = options?.maximumAccuracyMeters ?? maximumCountedAccuracyMeters;
  if (normalized.accuracyMeters > maximumAccuracyMeters) return false;
  const maximumAgeMs = options?.maximumAgeMs;
  if (maximumAgeMs != null) {
    const nowMs = options?.nowMs ?? Date.now();
    if (Math.abs(nowMs - normalized.recordedAtMs) > maximumAgeMs) return false;
  }
  return true;
}

function uncertaintyMeters(left: NormalizedFieldLocationPoint, right: NormalizedFieldLocationPoint) {
  return Math.sqrt(left.accuracyMeters ** 2 + right.accuracyMeters ** 2);
}

function movementThreshold(left: NormalizedFieldLocationPoint, right: NormalizedFieldLocationPoint) {
  return Math.max(30, 0.8 * uncertaintyMeters(left, right));
}

function segmentNoiseFloor(left: NormalizedFieldLocationPoint, right: NormalizedFieldLocationPoint) {
  return Math.max(8, 0.65 * uncertaintyMeters(left, right));
}

function plausibleSegment(left: NormalizedFieldLocationPoint, right: NormalizedFieldLocationPoint) {
  const elapsedSeconds = (right.recordedAtMs - left.recordedAtMs) / 1000;
  if (elapsedSeconds <= 0) return false;
  const distance = haversineMeters(left, right);
  return distance <= Math.max(100, elapsedSeconds * maximumRoadSpeedMps + uncertaintyMeters(left, right));
}

function routeContinuityIsBroken(left: NormalizedFieldLocationPoint, right: NormalizedFieldLocationPoint) {
  const elapsedMs = right.recordedAtMs - left.recordedAtMs;
  if (elapsedMs <= 0) return true;
  const distance = haversineMeters(left, right);
  // A recovered accurate fix must never be joined to a stale anchor across a
  // prolonged poor-GPS interval. Short, modest bridges remain allowed so an
  // offline route with sparse but believable fixes is still reconstructed.
  return elapsedMs > maximumContinuousGapMs
    || distance > maximumContinuousBridgeMeters
    || (elapsedMs > maximumSparseBridgeGapMs && distance > maximumSparseBridgeMeters);
}

function movementCandidateIsConfirmed(anchor: NormalizedFieldLocationPoint, candidates: NormalizedFieldLocationPoint[]) {
  if (candidates.length < movementConfirmationPoints) return false;
  const first = candidates[0];
  const last = candidates.at(-1)!;
  if (last.recordedAtMs - first.recordedAtMs < movementConfirmationMs) return false;
  const direct = haversineMeters(anchor, last);
  if (direct < Math.max(40, movementThreshold(anchor, last))) return false;
  let path = 0;
  let progressive = 0;
  let previous = anchor;
  let previousFromAnchor = 0;
  for (const point of candidates) {
    path += haversineMeters(previous, point);
    const fromAnchor = haversineMeters(anchor, point);
    if (fromAnchor + 5 >= previousFromAnchor) progressive += 1;
    previousFromAnchor = fromAnchor;
    previous = point;
  }
  return direct / Math.max(path, 1) >= 0.7 && progressive >= candidates.length - 1;
}

function jumpReturnsToRoute(points: NormalizedFieldLocationPoint[], index: number, previous: NormalizedFieldLocationPoint) {
  const current = points[index];
  const next = points[index + 1];
  if (!next) return false;
  const jump = haversineMeters(previous, current);
  const returned = haversineMeters(previous, next);
  const elapsed = next.recordedAtMs - current.recordedAtMs;
  return jump > 150 && returned < 40 && elapsed > 0 && elapsed <= 60_000;
}

function acceptedSegmentDistance(left: NormalizedFieldLocationPoint, right: NormalizedFieldLocationPoint) {
  if (!plausibleSegment(left, right)) return 0;
  const distance = haversineMeters(left, right);
  return distance >= segmentNoiseFloor(left, right) ? distance : 0;
}

function detectedStops(
  points: NormalizedFieldLocationPoint[],
  evaluationByTime: Map<string, FieldPointEvaluation>
) {
  const stops: FieldStopSummary[] = [];
  let active: NormalizedFieldLocationPoint[] = [];
  const finish = () => {
    if (active.length < 2) {
      active = [];
      return;
    }
    const first = active[0];
    const last = active.at(-1)!;
    const durationMs = last.recordedAtMs - first.recordedAtMs;
    if (durationMs >= reportableStopMs) {
      stops.push({
        startedAt: first.recordedAt,
        endedAt: last.recordedAt,
        durationSeconds: Math.round(durationMs / 1000),
        durationMinutes: Math.round(durationMs / 60_000),
        latitude: Math.round(median(active.map((point) => point.latitude)) * 1e6) / 1e6,
        longitude: Math.round(median(active.map((point) => point.longitude)) * 1e6) / 1e6,
        accuracyMeters: Math.round(median(active.map((point) => point.accuracyMeters)) * 10) / 10,
        pointCount: active.length
      });
    }
    active = [];
  };
  for (const point of points) {
    const previous = active.at(-1);
    if (previous && point.recordedAtMs - previous.recordedAtMs > maximumStopSampleGapMs) finish();
    const evaluation = evaluationByTime.get(point.recordedAt);
    const stationary = evaluation?.decision === "stationary"
      && ["stationary", "candidate_stopped", "candidate_moving"].includes(evaluation.motionState);
    if (stationary) active.push(point);
    else finish();
  }
  finish();
  return stops;
}

export function calculateFieldRouteMetrics(points: FieldLocationPoint[]) {
  const parsed = points.map((point) => ({ raw: point, normalized: normalizeFieldLocationPoint(point) }));
  const normalized = parsed.map((item) => item.normalized).filter((point): point is NormalizedFieldLocationPoint => Boolean(point));
  const sorted = [...normalized].sort((left, right) => left.recordedAtMs - right.recordedAtMs || (left.sequence ?? 0) - (right.sequence ?? 0));
  const eligible = sorted.filter((point) => !point.isMocked && fieldPointQuality(point.accuracyMeters) !== "unusable");
  const strong = eligible.filter((point) => fieldPointQuality(point.accuracyMeters) !== "weak");
  const evaluationByTime = new Map<string, FieldPointEvaluation>();
  const evaluate = (point: NormalizedFieldLocationPoint, decision: FieldPointDecision, motionState: FieldMotionState, rejectionCodes: string[] = [], acceptedDistanceMeters = 0) => {
    evaluationByTime.set(point.recordedAt, {
      recordedAt: point.recordedAt,
      quality: fieldPointQuality(point.accuracyMeters),
      decision,
      motionState,
      rejectionCodes,
      acceptedDistanceMeters: Math.round(acceptedDistanceMeters * 100) / 100
    });
  };

  for (const point of sorted) {
    if (point.isMocked) evaluate(point, "rejected", "suspicious", ["mock_location"]);
    else if (fieldPointQuality(point.accuracyMeters) === "unusable") evaluate(point, "rejected", "gps_degraded", ["accuracy_unusable"]);
    else if (fieldPointQuality(point.accuracyMeters) === "weak") evaluate(point, "stationary", "gps_degraded", ["accuracy_weak"]);
  }

  const acceptedPoints: NormalizedFieldLocationPoint[] = [];
  const routeSegments: NormalizedFieldLocationPoint[][] = [];
  let activeRoute: NormalizedFieldLocationPoint[] = [];
  let state: FieldMotionState = "acquiring";
  let stationaryWindow: NormalizedFieldLocationPoint[] = [];
  let anchor: NormalizedFieldLocationPoint | null = null;
  let lastAccepted: NormalizedFieldLocationPoint | null = null;
  let lastContinuousPoint: NormalizedFieldLocationPoint | null = null;
  let moveCandidates: NormalizedFieldLocationPoint[] = [];
  let stopCandidates: NormalizedFieldLocationPoint[] = [];
  let distanceMeters = 0;
  let rejectedSegmentCount = 0;
  let movingSegmentCount = 0;

  const beginRoute = (point: NormalizedFieldLocationPoint) => {
    activeRoute = [point];
    routeSegments.push(activeRoute);
    acceptedPoints.push(point);
  };
  const accept = (point: NormalizedFieldLocationPoint, from: NormalizedFieldLocationPoint) => {
    const distance = acceptedSegmentDistance(from, point);
    if (!distance) return false;
    distanceMeters += distance;
    movingSegmentCount += 1;
    if (!activeRoute.length) beginRoute(from);
    activeRoute.push(point);
    acceptedPoints.push(point);
    lastAccepted = point;
    evaluate(point, "accepted", "moving", [], distance);
    return true;
  };

  for (let index = 0; index < strong.length; index += 1) {
    const point = strong[index];
    if (!anchor) {
      anchor = point;
      lastAccepted = point;
      lastContinuousPoint = point;
      stationaryWindow = [point];
      state = "stationary";
      evaluate(point, "stationary", "stationary", ["initial_anchor"]);
      continue;
    }
    if (jumpReturnsToRoute(strong, index, lastAccepted ?? anchor)) {
      rejectedSegmentCount += 1;
      evaluate(point, "rejected", "suspicious", ["jump_return"]);
      activeRoute = [];
      continue;
    }
    if (routeContinuityIsBroken(lastContinuousPoint ?? lastAccepted ?? anchor, point)) {
      // Start a new trusted segment at the recovered fix. The gap itself is
      // not distance and cannot be treated as a stop.
      rejectedSegmentCount += 1;
      evaluate(point, "stationary", "acquiring", ["route_gap_reset"]);
      activeRoute = [];
      anchor = point;
      lastAccepted = point;
      lastContinuousPoint = point;
      stationaryWindow = [point];
      moveCandidates = [];
      stopCandidates = [];
      state = "stationary";
      continue;
    }
    if (!plausibleSegment(lastAccepted ?? anchor, point)) {
      rejectedSegmentCount += 1;
      evaluate(point, "rejected", "suspicious", ["impossible_speed"]);
      activeRoute = [];
      continue;
    }
    lastContinuousPoint = point;

    if (state !== "moving" && state !== "candidate_stopped") {
      const displacement = haversineMeters(anchor, point);
      const threshold = movementThreshold(anchor, point);
      if (displacement < threshold) {
        stationaryWindow.push(point);
        stationaryWindow = stationaryWindow.slice(-9);
        anchor = robustAnchor(stationaryWindow);
        lastAccepted = anchor;
        moveCandidates = [];
        state = "stationary";
        evaluate(point, "stationary", "stationary", ["within_stationary_radius"]);
        continue;
      }
      moveCandidates.push(point);
      state = "candidate_moving";
      evaluate(point, "stationary", "candidate_moving", ["movement_not_confirmed"]);
      if (!movementCandidateIsConfirmed(anchor, moveCandidates)) continue;

      state = "moving";
      beginRoute(anchor);
      let previous = anchor;
      for (const candidate of moveCandidates) {
        if (accept(candidate, previous)) previous = candidate;
      }
      lastAccepted = previous;
      moveCandidates = [];
      stopCandidates = [];
      continue;
    }

    const from = lastAccepted ?? anchor;
    const segment = haversineMeters(from, point);
    const slowBySensor = from.speedMps != null && point.speedMps != null && from.speedMps < 0.8 && point.speedMps < 0.8;
    const lowDisplacement = segment < movementThreshold(from, point);
    if (slowBySensor || lowDisplacement) {
      stopCandidates.push(point);
      state = "candidate_stopped";
      evaluate(point, "stationary", "candidate_stopped", ["stop_confirmation_pending"]);
      const stopDuration = point.recordedAtMs - stopCandidates[0].recordedAtMs;
      const stopAnchor = robustAnchor([from, ...stopCandidates]);
      if (stopDuration >= stopConfirmationMs && haversineMeters(from, stopAnchor) < Math.max(40, movementThreshold(from, stopAnchor))) {
        state = "stationary";
        anchor = stopAnchor;
        lastAccepted = stopAnchor;
        stationaryWindow = [stopAnchor];
        stopCandidates = [];
        moveCandidates = [];
        activeRoute = [];
      }
      continue;
    }

    if (stopCandidates.length) {
      // Resume from the last trusted point directly. Do not add the zig-zag
      // accumulated while the device was stationary or GPS was settling.
      stopCandidates = [];
    }
    state = "moving";
    if (!accept(point, from)) evaluate(point, "stationary", "moving", ["below_dynamic_noise_floor"]);
  }

  const rejectedPointCount = parsed.filter((item) => !item.normalized).length;
  const mockedPointCount = normalized.filter((point) => point.isMocked).length;
  const weakPointCount = normalized.filter((point) => !point.isMocked && fieldPointQuality(point.accuracyMeters) === "weak").length;
  const inaccuratePointCount = normalized.filter((point) => !point.isMocked && fieldPointQuality(point.accuracyMeters) === "unusable").length;
  const qualityRatio = points.length ? (strong.length + weakPointCount * 0.35) / points.length : 0;
  const suspiciousCount = [...evaluationByTime.values()].filter((item) => item.motionState === "suspicious").length;
  const confidencePercent = Math.max(0, Math.min(100, Math.round((qualityRatio * 100) - suspiciousCount * 4)));
  const evaluations: FieldPointEvaluation[] = points.map((raw) => {
    const normalizedPoint = normalizeFieldLocationPoint(raw);
    return normalizedPoint ? evaluationByTime.get(normalizedPoint.recordedAt) ?? {
      recordedAt: normalizedPoint.recordedAt,
      quality: fieldPointQuality(normalizedPoint.accuracyMeters),
      decision: "stationary",
      motionState: "stationary",
      rejectionCodes: ["not_counted"],
      acceptedDistanceMeters: 0
    } : {
      recordedAt: null,
      quality: "unusable",
      decision: "rejected",
      motionState: "gps_degraded",
      rejectionCodes: ["invalid_point"],
      acceptedDistanceMeters: 0
    };
  });
  const stops = detectedStops(strong, evaluationByTime);

  return {
    algorithmVersion: "dropx-route-v2.2",
    distanceMeters: Math.round(distanceMeters),
    rawDistanceMeters: Math.round(rawPolylineDistance(strong)),
    totalPointCount: points.length,
    validPointCount: strong.length,
    acceptedPointCount: acceptedPoints.length,
    mockedPointCount,
    weakPointCount,
    inaccuratePointCount,
    rejectedPointCount,
    rejectedSegmentCount,
    movingSegmentCount,
    stationaryPointCount: evaluations.filter((item) => item.decision === "stationary").length,
    stationaryDurationSeconds: stops.reduce((sum, stop) => sum + stop.durationSeconds, 0),
    stops,
    coveragePercent: points.length ? Math.round(strong.length / points.length * 10_000) / 100 : 0,
    confidencePercent,
    firstPointAt: strong[0]?.recordedAt ?? null,
    lastPointAt: strong.at(-1)?.recordedAt ?? null,
    qualityPoints: acceptedPoints,
    acceptedPoints,
    routeSegments: routeSegments.filter((segment) => segment.length > 1),
    evaluations
  };
}

function rawPolylineDistance(points: NormalizedFieldLocationPoint[]) {
  let distance = 0;
  for (let index = 1; index < points.length; index += 1) {
    if (plausibleSegment(points[index - 1], points[index])) distance += haversineMeters(points[index - 1], points[index]);
  }
  return distance;
}
