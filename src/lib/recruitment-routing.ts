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

function includesPhrase(haystack: string[], phrase: string) {
  const wanted = tokens(phrase);
  if (!wanted.length || wanted.length > haystack.length) return false;
  return haystack.some((_, start) => wanted.every((part, offset) => haystack[start + offset] === part));
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
  const roleCandidates = roles.flatMap((role) =>
    [role.code, role.name, ...(role.aliases ?? [])]
      .filter((value): value is string => Boolean(String(value ?? "").trim()))
      .map((alias) => ({ alias, role }))
  ).sort((left, right) => tokens(right.alias).length - tokens(left.alias).length);
  const matchedRole = roleCandidates.find(({ alias }) => includesPhrase(adTokens, alias))?.role;
  const matchedLocation = [...locations]
    .sort((left, right) => tokens(right.code).length - tokens(left.code).length)
    .find((location) => includesPhrase(adTokens, location.code));
  const fallback = parseAdRoute(adName);
  const knownFallbackLocation = locations.find((location) => location.code === fallback.stationCode);
  const knownFallbackRole = roles.find((role) => role.code === fallback.roleCode);
  const role = matchedRole ?? knownFallbackRole ?? null;

  return {
    adName,
    stationCode: matchedLocation?.code ?? knownFallbackLocation?.code ?? null,
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
