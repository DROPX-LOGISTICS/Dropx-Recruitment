export type RecruitmentStream = "workforce" | "hr";

export type ParsedAdRoute = {
  adName: string;
  stationCode: string | null;
  roleCode: string | null;
  stream: RecruitmentStream | null;
};

export type RoutingLocation = { code: string };
export type RoutingRole = {
  code: string;
  name?: string | null;
  stream: RecruitmentStream;
  aliases?: string[] | null;
};

const ROLE_ALIASES: Array<[string, string, RecruitmentStream]> = [
  ["DRIVER CUM DELIVERY", "DCD", "workforce"],
  ["DRIVER CUM DA", "DCD", "workforce"],
  ["RENTAL VAN", "VAN", "workforce"],
  ["OWN VAN", "ODCD", "workforce"],
  ["DELIVERY ASSOCIATE", "DA", "workforce"],
  ["SORTING STATION ASSOCIATE", "SSA", "hr"],
  ["PICKER", "PC", "workforce"],
  ["WISH MASTER", "WM", "workforce"],
  ["FIELD EXECUTIVE", "WM", "workforce"],
  ["RECRUITER", "RC", "hr"],
  ["TEAM LEADER", "TL", "hr"],
  ["STATION MANAGER", "STM", "hr"],
  ["STORE MANAGER", "SM", "hr"],
  ["CLUSTER MANAGER", "CLM", "hr"],
  ["HUB INCHARGE", "HI", "hr"],
  ["SHIFT INCHARGE", "SI", "hr"],
  ["HR EXECUTIVE", "HR", "hr"],
  ["ODCD", "ODCD", "workforce"],
  ["DCD", "DCD", "workforce"],
  ["VAN", "VAN", "workforce"],
  ["SSA", "SSA", "hr"],
  ["PTDA", "PTDA", "workforce"],
  ["PTPC", "PTPC", "workforce"],
  ["DA", "DA", "workforce"],
  ["PC", "PC", "workforce"],
  ["WM", "WM", "workforce"],
  ["CLM", "CLM", "hr"],
  ["STM", "STM", "hr"],
  ["RC", "RC", "hr"],
  ["TL", "TL", "hr"],
  ["SM", "SM", "hr"],
  ["HI", "HI", "hr"],
  ["SI", "SI", "hr"],
  ["HR", "HR", "hr"]
];

export function authoritativeRoleStream(
  code: string | null | undefined,
  fallback: RecruitmentStream | null
): RecruitmentStream | null {
  return String(code ?? "").trim().toUpperCase() === "SSA" ? "hr" : fallback;
}

function tokens(value: string) {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function phraseStart(haystack: string[], phrase: string, excluded: ReadonlySet<number> = new Set()) {
  const wanted = tokens(phrase);
  if (!wanted.length || wanted.length > haystack.length) return -1;
  return haystack.findIndex((_, start) => wanted.every((part, offset) =>
    haystack[start + offset] === part && !excluded.has(start + offset)
  ));
}

function includesPhrase(haystack: string[], phrase: string) {
  return phraseStart(haystack, phrase) >= 0;
}

export function parseAdRoute(adNameInput: unknown): ParsedAdRoute {
  const adName = String(adNameInput ?? "").trim();
  const adTokens = tokens(adName);
  let roleCode: string | null = null;
  let stream: RecruitmentStream | null = null;

  for (const [alias, code, roleStream] of ROLE_ALIASES) {
    if (!includesPhrase(adTokens, alias)) continue;
    roleCode = code;
    stream = roleStream;
    break;
  }

  const roleTokens = new Set(ROLE_ALIASES.flatMap(([alias]) => tokens(alias)));
  const stationCode = adTokens.find((token) => {
    if (roleTokens.has(token)) return false;
    if (/^\d{6,}$/.test(token)) return false;
    if (/^\d{8}$/.test(token)) return false;
    return /^[A-Z][A-Z0-9]{1,9}$/.test(token);
  }) ?? null;

  return { adName, stationCode, roleCode, stream };
}

export function parseAdRouteWithMasters(
  adNameInput: unknown,
  locations: RoutingLocation[],
  roles: RoutingRole[]
): ParsedAdRoute {
  const adName = String(adNameInput ?? "").trim();
  const adTokens = tokens(adName);
  const matchedLocation = [...locations]
    .sort((left, right) => tokens(right.code).length - tokens(left.code).length)
    .find((location) => includesPhrase(adTokens, location.code));
  const fallback = parseAdRoute(adName);
  const knownFallbackLocation = locations.find((location) => location.code === fallback.stationCode);
  const location = matchedLocation ?? knownFallbackLocation ?? null;

  // A location code such as HO_CLT contains tokens that can also be role codes
  // (HO = Head of Operations), so the role is matched only outside the location.
  // An unknown or inactive station still occupies its token, but only softly:
  // when nothing else matches, that token may still name the role.
  const stationCode = location?.code ?? fallback.stationCode;
  const stationTokens = new Set<number>();
  if (stationCode) {
    const start = phraseStart(adTokens, stationCode);
    if (start >= 0) tokens(stationCode).forEach((_, offset) => stationTokens.add(start + offset));
  }
  const findRoleMatches = (excluded: ReadonlySet<number>) => roles.flatMap((role) =>
    [role.code, role.name, ...(role.aliases ?? [])]
      .filter((value): value is string => Boolean(String(value ?? "").trim()))
      .map((alias) => ({ role, length: tokens(alias).length, start: phraseStart(adTokens, alias, excluded) }))
  ).filter((match) => match.start >= 0);
  let locationTokens = stationTokens;
  let roleMatches = findRoleMatches(locationTokens);
  if (!roleMatches.length && !location && stationTokens.size) {
    locationTokens = new Set();
    roleMatches = findRoleMatches(locationTokens);
  }
  // Longest alias wins; on a tie the earliest role after the location wins,
  // matching the LOCATION_ROLE_DATE naming convention.
  roleMatches.sort((left, right) => right.length - left.length || left.start - right.start);
  const matchedRole = roleMatches[0]?.role;
  const remainingName = adTokens.filter((_, index) => !locationTokens.has(index)).join(" ");
  const fallbackRoleCode = parseAdRoute(remainingName).roleCode;
  const knownFallbackRole = roles.find((role) => role.code === fallbackRoleCode);
  const role = matchedRole ?? knownFallbackRole ?? null;

  return {
    adName,
    stationCode: location?.code ?? null,
    roleCode: role?.code ?? null,
    stream: authoritativeRoleStream(role?.code, role?.stream ?? null)
  };
}

export function normalizePhone(value: unknown) {
  const digits = String(value ?? "").replace(/\D/g, "");
  const lastTen = digits.slice(-10);
  return /^[6-9]\d{9}$/.test(lastTen) ? lastTen : null;
}

export function normalizeMetaFieldName(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function canonicalLeadKey(metaLeadId: unknown, phone: unknown) {
  const meta = String(metaLeadId ?? "").trim();
  if (meta) return `meta:${meta}`;
  const normalizedPhone = normalizePhone(phone);
  return normalizedPhone ? `phone:${normalizedPhone}` : null;
}

export function canonicalApplicationKey(
  adIdentity: unknown,
  phone: unknown,
  metaLeadId: unknown
) {
  const normalizedPhone = normalizePhone(phone);
  const normalizedAd = String(adIdentity ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (normalizedPhone && normalizedAd) {
    return `application:${normalizedAd}:${normalizedPhone}`;
  }
  return canonicalLeadKey(metaLeadId, phone);
}
