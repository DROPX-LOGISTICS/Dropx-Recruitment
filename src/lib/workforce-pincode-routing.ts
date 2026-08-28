import { supabaseAdmin } from "./supabase-admin";

export const MANUAL_WORKFORCE_PINCODE_STATIONS: Readonly<Record<string, string>> = Object.freeze({
  "673525": "PMB",
  "673526": "CHM",
  "673527": "CHM",
  "673528": "CHM",
  "673524": "MEP",
  "754001": "PHN"
});

export type WorkforcePincodeRouteSource =
  | "manual_override"
  | "service_network"
  | "delivered_shipments"
  | "advertised_station";

export type WorkforcePincodeRoute = {
  locationId: string | null;
  stationCode: string | null;
  source: WorkforcePincodeRouteSource;
  postCode: string | null;
};

export function normalizeIndianPostCode(value: unknown) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return /^\d{6}$/.test(digits) ? digits : null;
}

export function chooseWorkforceStationCode(input: {
  postCode: unknown;
  stream: string | null | undefined;
  advertisedStationCode: string | null;
  networkStationCodes?: string[];
  deliveredStationCodes?: string[];
  manualMappings?: Readonly<Record<string, string>>;
}) {
  const advertised = String(input.advertisedStationCode ?? "").trim().toUpperCase() || null;
  const postCode = normalizeIndianPostCode(input.postCode);
  if (input.stream !== "workforce" || !postCode) {
    return { stationCode: advertised, source: "advertised_station" as const, postCode };
  }

  const manual = (input.manualMappings ?? MANUAL_WORKFORCE_PINCODE_STATIONS)[postCode];
  if (manual) {
    return { stationCode: manual.trim().toUpperCase(), source: "manual_override" as const, postCode };
  }

  const network = [...new Set((input.networkStationCodes ?? []).map((value) => value.trim().toUpperCase()).filter(Boolean))];
  const delivered = (input.deliveredStationCodes ?? []).map((value) => value.trim().toUpperCase()).filter(Boolean);
  if (network.length) {
    const counts = new Map<string, number>();
    for (const station of delivered) {
      if (network.includes(station)) counts.set(station, (counts.get(station) ?? 0) + 1);
    }
    const stationCode = [...network].sort((left, right) =>
      (counts.get(right) ?? 0) - (counts.get(left) ?? 0) || left.localeCompare(right)
    )[0];
    return { stationCode, source: "service_network" as const, postCode };
  }

  if (delivered.length) {
    const counts = new Map<string, number>();
    for (const station of delivered) counts.set(station, (counts.get(station) ?? 0) + 1);
    const stationCode = [...counts.keys()].sort((left, right) =>
      (counts.get(right) ?? 0) - (counts.get(left) ?? 0) || left.localeCompare(right)
    )[0];
    return { stationCode, source: "delivered_shipments" as const, postCode };
  }

  return { stationCode: advertised, source: "advertised_station" as const, postCode };
}

async function operationalStationEvidence(companyId: string, postCode: string) {
  if (!supabaseAdmin) return { networkStationCodes: [] as string[], deliveredStationCodes: [] as string[] };
  const today = new Date().toISOString().slice(0, 10);
  const since = new Date(Date.now() - 180 * 24 * 60 * 60_000).toISOString().slice(0, 10);

  const networkResult = await supabaseAdmin.from("ops_network_sector_pincodes")
    .select("station_id")
    .eq("company_id", companyId)
    .eq("pincode", postCode)
    .in("service_state", ["active", "temporary", "split"])
    .lte("effective_from", today)
    .or(`effective_to.is.null,effective_to.gte.${today}`)
    .limit(100);
  let networkStationCodes: string[] = [];
  if (!networkResult.error) {
    const stationIds = [...new Set((networkResult.data ?? []).map((row) => String(row.station_id ?? "")).filter(Boolean))];
    if (stationIds.length) {
      const stations = await supabaseAdmin.from("stations").select("id,station_code")
        .eq("company_id", companyId).eq("is_active", true).in("id", stationIds);
      if (!stations.error) networkStationCodes = (stations.data ?? []).map((row) => String(row.station_code ?? ""));
    }
  }

  const deliveredResult = await supabaseAdmin.from("delivered_shipment_facts")
    .select("station_code")
    .eq("company_id", companyId)
    .eq("postal_code", postCode)
    .gte("work_date", since)
    .order("work_date", { ascending: false })
    .limit(2000);
  const deliveredStationCodes = deliveredResult.error
    ? []
    : (deliveredResult.data ?? []).map((row) => String(row.station_code ?? ""));
  return { networkStationCodes, deliveredStationCodes };
}

export async function resolveWorkforceLeadLocation(input: {
  companyId: string;
  postCode: unknown;
  stream: string | null | undefined;
  advertisedLocationId: string | null;
  advertisedStationCode: string | null;
}): Promise<WorkforcePincodeRoute> {
  const normalizedPostCode = normalizeIndianPostCode(input.postCode);
  if (!supabaseAdmin || input.stream !== "workforce" || !normalizedPostCode) {
    return {
      locationId: input.advertisedLocationId,
      stationCode: input.advertisedStationCode,
      source: "advertised_station",
      postCode: normalizedPostCode
    };
  }

  const evidence = await operationalStationEvidence(input.companyId, normalizedPostCode);
  const decision = chooseWorkforceStationCode({
    postCode: normalizedPostCode,
    stream: input.stream,
    advertisedStationCode: input.advertisedStationCode,
    ...evidence
  });
  if (!decision.stationCode || decision.source === "advertised_station") {
    return { ...decision, locationId: input.advertisedLocationId };
  }

  const location = await supabaseAdmin.from("recruitment_locations").select("id,code")
    .eq("company_id", input.companyId)
    .eq("is_active", true)
    .eq("code", decision.stationCode)
    .maybeSingle();
  if (location.error || !location.data) {
    return {
      locationId: input.advertisedLocationId,
      stationCode: input.advertisedStationCode,
      source: "advertised_station",
      postCode: normalizedPostCode
    };
  }
  return {
    locationId: String(location.data.id),
    stationCode: String(location.data.code),
    source: decision.source,
    postCode: normalizedPostCode
  };
}
