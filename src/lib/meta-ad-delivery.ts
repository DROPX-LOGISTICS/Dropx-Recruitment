type MetaState = { status?: unknown; configured_status?: unknown; effective_status?: unknown };
export type MetaDeliverySnapshot = MetaState & {
  adset?: MetaState & { start_time?: unknown; end_time?: unknown };
  campaign?: MetaState;
};

const state = (value: unknown) => String(value || "").toUpperCase();
const time = (value: unknown) => value ? Date.parse(String(value)) : Number.NaN;

/** Meta ACTIVE means switched on; a finished ad set can still report ACTIVE. */
export function metaDeliveryStatus(ad: MetaDeliverySnapshot, now = Date.now()) {
  const statuses = [ad, ad.adset, ad.campaign].filter(Boolean)
    .map((item) => state(item?.effective_status || item?.configured_status || item?.status));
  if (statuses.includes("DELETED")) return "DELETED";
  if (statuses.includes("ARCHIVED")) return "ARCHIVED";
  const end = time(ad.adset?.end_time);
  if (Number.isFinite(end) && end <= now) return "COMPLETED";
  if (statuses.some((value) => ["PAUSED", "ADSET_PAUSED", "CAMPAIGN_PAUSED"].includes(value))) return "PAUSED";
  const unavailable = statuses.find((value) => value && value !== "ACTIVE" && value !== "SCHEDULED");
  if (unavailable) return unavailable;
  if (statuses[0] !== "ACTIVE" && statuses[0] !== "SCHEDULED") return "UNKNOWN";
  const start = time(ad.adset?.start_time);
  return Number.isFinite(start) && start > now ? "SCHEDULED" : "ACTIVE";
}

/** Re-evaluate schedules on every read, including between successful syncs. */
export function storedAdDelivery<T extends { status?: unknown; raw_payload?: unknown }>(ad: T, now = Date.now()) {
  const raw = (ad.raw_payload && typeof ad.raw_payload === "object" ? ad.raw_payload : {}) as MetaDeliverySnapshot;
  return {
    ...ad,
    status: metaDeliveryStatus({ ...raw, effective_status: ad.status || raw.effective_status }, now),
    starts_at: raw.adset?.start_time ? String(raw.adset.start_time) : null,
    ends_at: raw.adset?.end_time ? String(raw.adset.end_time) : null
  };
}

export function metaAdSyncDue(lastSuccessfulSync: string | null | undefined, now = Date.now()) {
  const last = time(lastSuccessfulSync);
  return !Number.isFinite(last) || now - last >= 30 * 60_000;
}
