export type MetaRouteMismatch = {
  metaAdId: string;
  adName: string;
  adStation: string;
  campaignName: string | null;
  campaignStation: string | null;
  adsetName: string | null;
  adsetStation: string | null;
};

function normalized(value: unknown) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();
}

export function leadingKnownStation(value: unknown, stationCodes: string[]) {
  const source = normalized(value);
  if (!source) return null;
  const ordered = [...new Set(stationCodes.map(normalized).filter(Boolean))]
    .sort((left, right) => right.length - left.length);
  return ordered.find((code) => {
    if (!source.startsWith(code)) return false;
    const next = source.charAt(code.length);
    return !next || /[^A-Z0-9]/.test(next);
  }) ?? null;
}

export function findMetaRouteMismatch(input: {
  metaAdId: string;
  adName: string;
  campaignName?: string | null;
  adsetName?: string | null;
  stationCodes: string[];
}): MetaRouteMismatch | null {
  const adStation = leadingKnownStation(input.adName, input.stationCodes);
  if (!adStation) return null;
  const campaignStation = leadingKnownStation(input.campaignName, input.stationCodes);
  const adsetStation = leadingKnownStation(input.adsetName, input.stationCodes);
  const disagrees = [campaignStation, adsetStation]
    .filter(Boolean)
    .some((station) => station !== adStation);
  if (!disagrees) return null;
  return {
    metaAdId: input.metaAdId,
    adName: input.adName,
    adStation,
    campaignName: input.campaignName ?? null,
    campaignStation,
    adsetName: input.adsetName ?? null,
    adsetStation
  };
}
