export const DA_INAPP_SOURCE_TYPE = "da_inapp_onboarding";
export const DA_INAPP_SOURCE_ALIASES = [
  DA_INAPP_SOURCE_TYPE,
  "da_in_app_onboarding",
  "dainapp_onboarding",
  "danap_onboarding"
] as const;

export type DaDependency =
  | "station_mapping"
  | "backend_provisioning"
  | "bgv"
  | "training"
  | "basic_info"
  | "driving_license"
  | "nhda"
  | "video_verification"
  | "other";

export type DaBatch = {
  id: string;
  source_type: string;
  file_name: string;
  status?: string | null;
  message?: string | null;
  report_from?: string | null;
  report_to: string | null;
  row_count?: number | null;
  imported_row_count?: number | null;
  skipped_row_count?: number | null;
  created_at: string;
};

export type DaImportRow = {
  id: string;
  batch_id: string;
  source_type: string;
  station_code: string | null;
  work_date: string | null;
  raw_data: Record<string, unknown> | null;
  normalized_data: Record<string, unknown> | null;
  created_at: string;
};

export type DaVisibility = "mine" | "all" | "permitted_locations";

export type DaSessionScope = {
  isOwner?: boolean;
  recruitmentFunction?: string | null;
  accessTemplate?: string | null;
  designationCode?: string | null;
  allLocations?: boolean;
};

export type DaOwnershipMaps = {
  stableOwners: Map<string, Set<string>>;
  contactOwners: Map<string, Set<string>>;
  fallbackOwners?: Map<string, Set<string>>;
  stableStations?: Map<string, Set<string>>;
  contactStations?: Map<string, Set<string>>;
  fallbackStations?: Map<string, Set<string>>;
};

export type DaOwnershipResolution = {
  owners: Set<string>;
  station: string;
  status: "matched" | "ambiguous" | "unmatched";
  tier: "stable" | "contact" | "fallback" | "none";
};

export type DaStationContact = {
  pocName?: string | null;
  pocMobile?: string | null;
};

export type DaSubStatusOption = {
  value: string;
  label: string;
  closesCase?: boolean;
};

export const DA_DEPENDENCY_OPTIONS: ReadonlyArray<{ value: DaDependency; label: string }> = [
  { value: "station_mapping", label: "Station / supervisor update" },
  { value: "backend_provisioning", label: "Account provisioning" },
  { value: "bgv", label: "BGC verification" },
  { value: "training", label: "Training completion" },
  { value: "basic_info", label: "Basic information" },
  { value: "driving_license", label: "Driving licence verification" },
  { value: "nhda", label: "NHDA course" },
  { value: "video_verification", label: "Video verification" },
  { value: "other", label: "Other" }
];

const SUB_STATUS_OPTIONS: Record<DaDependency, ReadonlyArray<DaSubStatusOption>> = {
  station_mapping: [
    { value: "pending", label: "Update pending" },
    { value: "updated", label: "Station / supervisor updated", closesCase: true }
  ],
  backend_provisioning: [
    { value: "pending", label: "Provisioning pending" },
    { value: "provisioned", label: "Account provisioned", closesCase: true }
  ],
  bgv: [
    { value: "pending", label: "BGC pending" },
    { value: "cleared", label: "BGC cleared", closesCase: true }
  ],
  training: [
    { value: "pending", label: "Training pending" },
    { value: "completed", label: "Training completed", closesCase: true }
  ],
  basic_info: [
    { value: "pending", label: "Basic information pending" },
    { value: "completed", label: "Basic information completed", closesCase: true }
  ],
  driving_license: [
    { value: "pending", label: "Driving licence verification pending" },
    { value: "verified", label: "Verified", closesCase: true }
  ],
  nhda: [
    { value: "pending", label: "NHDA course pending" },
    { value: "completed", label: "NHDA course completed", closesCase: true }
  ],
  video_verification: [
    { value: "pending", label: "Video verification pending" },
    { value: "completed", label: "Video verification completed", closesCase: true }
  ],
  other: [
    { value: "pending", label: "Action pending" },
    { value: "completed", label: "Action completed", closesCase: true }
  ]
};

const clean = (value: unknown) => String(value ?? "").trim();
const key = (value: unknown) => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
export const normalizeDaStation = (value: unknown) => clean(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
export const normalizeDaIdentity = (value: unknown) => clean(value).toLowerCase().replace(/\s+/g, "");

export function daFallbackOwnershipCandidates(email: unknown, name: unknown) {
  const candidates = new Set<string>();
  const normalizedEmail = normalizeDaIdentity(email);
  const emailMatch = /^([^@]+)@([^@]+)$/.exec(normalizedEmail);
  if (emailMatch) {
    const mailboxRoot = emailMatch[1].split(/[._-]+/).map((part) => part.replace(/[^a-z0-9]/g, "")).find((part) => part.length >= 6);
    if (mailboxRoot) candidates.add(`email:${mailboxRoot}@${emailMatch[2]}`);
  }
  const words = clean(name).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
  for (let start = 0; start < words.length; start += 1) {
    let joined = "";
    for (let end = start; end < words.length; end += 1) {
      joined += words[end];
      if (joined.length >= 6) candidates.add(`name:${joined}`);
    }
  }
  return [...candidates];
}

export function isDaInAppBatch(batch: Pick<DaBatch, "source_type" | "file_name">) {
  const source = key(batch.source_type);
  const fileName = key(batch.file_name);
  const knownSources = new Set(DA_INAPP_SOURCE_ALIASES.map(key));
  return knownSources.has(source)
    || source.includes("dainapponboarding")
    || source.includes("danaponboarding")
    || fileName.includes("dainapponboarding")
    || fileName.includes("danaponboarding");
}

function recordFor(row: DaImportRow, includeOperations = true) {
  return {
    ...(row.raw_data ?? {}),
    ...(includeOperations ? row.normalized_data ?? {} : {})
  };
}

export function findDaValue(record: Record<string, unknown>, aliases: string[]) {
  const aliasesByKey = aliases.map(key);
  const exact = Object.entries(record).find(([label]) => aliasesByKey.includes(key(label)));
  if (exact) return clean(exact[1]);
  return clean(Object.entries(record).find(([label]) =>
    aliasesByKey.some((alias) => key(label).includes(alias))
  )?.[1]);
}

export function isDaInAppRow(row: DaImportRow) {
  if (row.source_type === DA_INAPP_SOURCE_TYPE) return true;
  const labels = Object.keys(recordFor(row)).map(key);
  return labels.some((label) => label.includes("transporter"))
    && labels.some((label) => label.includes("rabbit") || label.includes("email") || label.includes("mailid"))
    && labels.some((label) => label.includes("station"));
}

export function latestDaInAppBatch(batches: DaBatch[], rows: DaImportRow[]) {
  const sourceBatches = batches
    .filter(isDaInAppBatch)
    .sort((left, right) => right.created_at.localeCompare(left.created_at));
  const batchIds = new Set(sourceBatches.map((batch) => batch.id));
  const sourceRows = rows.filter((row) => batchIds.has(row.batch_id));
  // The newest DA upload is authoritative even when it failed or produced no
  // usable rows. Falling back to an older batch makes the dashboard look
  // refreshed while silently serving stale cases.
  const batch = sourceBatches[0] ?? null;
  return {
    batch,
    rows: batch ? sourceRows.filter((row) => row.batch_id === batch.id) : [],
    historyRows: sourceRows
  };
}

function rawSourceReason(row: DaImportRow) {
  const raw = row.raw_data ?? {};
  return findDaValue(raw, ["categories", "pending reason", "reason", "action item", "action_item"]);
}

function rawSourceAction(row: DaImportRow) {
  return findDaValue(row.raw_data ?? {}, ["action item", "action_item", "action required"]);
}

function rawSourceStatus(row: DaImportRow) {
  return findDaValue(row.raw_data ?? {}, ["operational status", "operational_status", "onboarding status", "pending status", "status"]);
}

export function daIdentityCandidates(row: DaImportRow) {
  const record = recordFor(row, false);
  return [
    findDaValue(record, ["transporter id", "transporter_id", "provider id"]),
    findDaValue(record, ["rabbit id", "rabbit_id", "mail id", "email id", "email"]),
    findDaValue(record, ["accountid", "account id"]),
    findDaValue(record, ["login id", "login_id"])
  ].map(normalizeDaIdentity).filter(Boolean);
}

export function daCaseKey(row: DaImportRow) {
  const identity = daIdentityCandidates(row)[0] || `row:${row.id}`;
  const reason = key(`${rawSourceStatus(row)} ${rawSourceReason(row)} ${rawSourceAction(row)}`) || "pending";
  return `${identity}|${reason}`;
}

function operationFields(row: DaImportRow) {
  return Object.fromEntries(Object.entries(row.normalized_data ?? {}).filter(([label]) => label.startsWith("ops_")));
}

export function carryForwardDaOperations(currentRows: DaImportRow[], historyRows: DaImportRow[]) {
  const currentIds = new Set(currentRows.map((row) => row.id));
  const priorByCase = new Map<string, Record<string, unknown>>();
  [...historyRows]
    .filter((row) => !currentIds.has(row.id))
    .sort((left, right) => right.created_at.localeCompare(left.created_at))
    .forEach((row) => {
      const operations = operationFields(row);
      const caseKey = daCaseKey(row);
      if (!priorByCase.has(caseKey) && Object.keys(operations).length) priorByCase.set(caseKey, operations);
    });
  return currentRows.map((row) => ({
    ...row,
    normalized_data: {
      ...(priorByCase.get(daCaseKey(row)) ?? {}),
      ...(row.normalized_data ?? {})
    }
  }));
}

export function inferDaDependency(value: string): DaDependency {
  if (/nhda|nsta|nsda/i.test(value)) return "nhda";
  if (/bg[cv]|background/i.test(value)) return "bgv";
  if (/driving\s*licen[cs]e|\bdl\b/i.test(value)) return "driving_license";
  if (/training|learning\s*app|course/i.test(value)) return "training";
  if (/basic\s*info|residential\s*address|phone\s*number/i.test(value)) return "basic_info";
  if (/video/i.test(value)) return "video_verification";
  if (/station|supervisor|service\s*area/i.test(value)) return "station_mapping";
  if (/provision|backend|amazon\s*team/i.test(value)) return "backend_provisioning";
  return "other";
}

export function daSubStatusOptions(dependency: string) {
  return SUB_STATUS_OPTIONS[(dependency in SUB_STATUS_OPTIONS ? dependency : "other") as DaDependency];
}

export function daDependencyLabel(dependency: string) {
  return DA_DEPENDENCY_OPTIONS.find((option) => option.value === dependency)?.label ?? "Other";
}

function defaultSubStatus(dependency: DaDependency, clearanceStatus: "pending" | "cleared") {
  const options = daSubStatusOptions(dependency);
  return clearanceStatus === "cleared"
    ? options.find((option) => option.closesCase)?.value ?? options[0].value
    : options.find((option) => !option.closesCase)?.value ?? options[0].value;
}

function dateParts(value: string) {
  const text = value.trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  if (iso) return [Number(iso[1]), Number(iso[2]), Number(iso[3])] as const;
  const indian = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/.exec(text);
  if (!indian) return null;
  return [Number(indian[3].length === 2 ? `20${indian[3]}` : indian[3]), Number(indian[2]), Number(indian[1])] as const;
}

export function daAgingDays(value: string, now = Date.now()) {
  const parts = dateParts(value);
  if (!parts) return 0;
  const pending = Date.UTC(parts[0], parts[1] - 1, parts[2]);
  const currentIst = new Date(now + 330 * 60_000).toISOString().slice(0, 10).split("-").map(Number);
  const today = Date.UTC(currentIst[0], currentIst[1] - 1, currentIst[2]);
  return Number.isFinite(pending) ? Math.max(0, Math.floor((today - pending) / 86_400_000)) : 0;
}

function savedDependency(value: unknown): DaDependency | null {
  const normalized = clean(value);
  if (["nsta", "nsda"].includes(normalized)) return "nhda";
  return DA_DEPENDENCY_OPTIONS.some((option) => option.value === normalized)
    ? normalized as DaDependency
    : null;
}

export function parseDaInAppRecord(row: DaImportRow, batch: DaBatch, now = Date.now()) {
  const record = recordFor(row);
  const normalized = row.normalized_data ?? {};
  const sourceReason = rawSourceReason(row) || "Onboarding review required";
  const sourceAction = rawSourceAction(row) || "Review and complete onboarding";
  const sourceStatus = rawSourceStatus(row) || "ONBOARDING";
  // The import's source reason/action is authoritative. A user cannot change
  // the required action by editing a dashboard dropdown.
  const dependency = inferDaDependency(`${sourceStatus} ${sourceReason} ${sourceAction}`);
  const savedClearance = clean(normalized.ops_clearance_status) === "cleared" ? "cleared" as const : "pending" as const;
  const rawCertificate = normalized.ops_nhda_certificate
    ?? normalized.ops_nsda_certificate
    ?? normalized.ops_nsta_certificate;
  const certificate = rawCertificate && typeof rawCertificate === "object"
    ? rawCertificate as Record<string, unknown>
    : null;
  const savedSubStatus = clean(normalized.ops_sub_status);
  const videoStatus = clean(normalized.ops_video_verification_status) === "done" ? "done" as const : "pending" as const;
  const subStatus = dependency === "video_verification"
    ? videoStatus === "done" ? "completed" : "pending"
    : daSubStatusOptions(dependency).some((option) => option.value === savedSubStatus)
      ? savedSubStatus
      : defaultSubStatus(dependency, savedClearance);
  const clearanceStatus = daActionIsComplete(dependency, subStatus) ? "cleared" as const : "pending" as const;
  const pendingSince = findDaValue(record, ["invitation date", "invitation_date", "pending since", "pending from", "report date", "date"])
    || row.work_date
    || batch.report_to
    || row.created_at.slice(0, 10);
  return {
    id: row.id,
    daName: findDaValue(record, ["employee name", "employee_name", "da name", "associate name", "delivery associate name", "name"]),
    rabbitId: findDaValue(record, ["rabbit id", "rabbit_id", "mail id", "email id", "email"]),
    transporterId: findDaValue(record, ["transporter id", "transporter_id", "transporter", "provider id"]),
    candidatePhone: findDaValue(record, [
      "candidate contact number", "candidate_contact_number", "candidate mobile", "candidate_mobile",
      "contact number", "contact_number", "mobile number", "mobile_number", "phone number", "phone_number",
      "mobile", "phone"
    ]),
    station: normalizeDaStation(row.station_code || findDaValue(record, ["station code", "station_code", "station", "location code"])),
    pendingSince,
    agingDays: daAgingDays(pendingSince, now),
    sourceStatus,
    sourceReason,
    sourceAction,
    remarks: clean(normalized.ops_remarks || normalized.ops_action_item),
    dependency,
    subStatus,
    subStatusOptions: daSubStatusOptions(dependency),
    clearanceStatus,
    videoStatus,
    certificate,
    updatedBy: clean(normalized.ops_updated_by_email || normalized.ops_updated_by),
    updatedById: clean(normalized.ops_updated_by),
    updatedByEmail: clean(normalized.ops_updated_by_email),
    updatedAt: clean(normalized.ops_updated_at),
    identityCandidates: daIdentityCandidates(row)
  };
}

function normalizedRole(value: unknown) {
  return clean(value).toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

export function resolveDaVisibility(session: DaSessionScope): DaVisibility {
  const designation = normalizedRole(session.designationCode);
  const recruiterRestricted = ["telecaller", "recruiter", "field_recruiter"].includes(clean(session.recruitmentFunction))
    || /(^|_)(TELECALLER|TELE_CALLER|FIELD_RECRUITER|RECRUITER)(_|$)/.test(designation);
  if (recruiterRestricted) return "mine";
  const oversight = clean(session.recruitmentFunction) === "manager"
    || ["owner", "admin", "hr"].includes(clean(session.accessTemplate).toLowerCase())
    || /(^|_)(OWNER|ADMIN|MANAGER|HEAD_HR|HR_HEAD|HR_EXECUTIVE|EXECUTIVE|HR)(_|$)/.test(designation);
  const globalOversight = session.isOwner === true
    || clean(session.accessTemplate).toLowerCase() === "owner"
    || (oversight && session.allLocations === true);
  return globalOversight ? "all" : "permitted_locations";
}

export function resolveDaContact(candidatePhone: unknown, stationContact?: DaStationContact | null) {
  const candidate = clean(candidatePhone);
  if (candidate) {
    return { phone: candidate, source: "candidate" as const, label: "Candidate contact number", name: "" };
  }
  const stationPhone = clean(stationContact?.pocMobile);
  if (stationPhone) {
    return { phone: stationPhone, source: "station_poc" as const, label: "Station POC contact number", name: clean(stationContact?.pocName) };
  }
  return { phone: "", source: "missing" as const, label: "Contact unavailable", name: "" };
}

export function addDaOwner(map: Map<string, Set<string>>, value: unknown, ownerProfileId: unknown) {
  const identity = normalizeDaIdentity(value);
  const owner = clean(ownerProfileId);
  if (!identity || !owner) return;
  const owners = map.get(identity) ?? new Set<string>();
  owners.add(owner);
  map.set(identity, owners);
}

export function addDaStation(map: Map<string, Set<string>>, value: unknown, stationCode: unknown) {
  const identity = normalizeDaIdentity(value);
  const station = normalizeDaStation(stationCode);
  if (!identity || !station) return;
  const stations = map.get(identity) ?? new Set<string>();
  stations.add(station);
  map.set(identity, stations);
}

function ownershipAtTier(
  candidates: string[],
  ownersMap: Map<string, Set<string>> | undefined,
  stationsMap: Map<string, Set<string>> | undefined,
  phoneTail = false
) {
  const owners = new Set<string>();
  const stations = new Set<string>();
  for (const candidate of candidates) {
    const normalized = normalizeDaIdentity(candidate);
    const keys = [normalized];
    const digits = normalized.replace(/\D/g, "");
    if (phoneTail && digits) keys.push(digits.slice(-10));
    for (const candidateKey of new Set(keys.filter(Boolean))) {
      for (const owner of ownersMap?.get(candidateKey) ?? []) owners.add(owner);
      for (const station of stationsMap?.get(candidateKey) ?? []) stations.add(station);
    }
  }
  return {
    owners,
    station: owners.size === 1 && stations.size === 1 ? [...stations][0] : ""
  };
}

export function resolveDaOwnership(
  candidates: string[],
  maps: DaOwnershipMaps,
  fallbackCandidates: string[] = []
): DaOwnershipResolution {
  const tiers = [
    { tier: "stable" as const, ...ownershipAtTier(candidates, maps.stableOwners, maps.stableStations) },
    { tier: "contact" as const, ...ownershipAtTier(candidates, maps.contactOwners, maps.contactStations, true) },
    { tier: "fallback" as const, ...ownershipAtTier(fallbackCandidates, maps.fallbackOwners, maps.fallbackStations) }
  ];
  const resolved = tiers.find((item) => item.owners.size) ?? { tier: "none" as const, owners: new Set<string>(), station: "" };
  return {
    ...resolved,
    status: resolved.owners.size === 1 ? "matched" : resolved.owners.size > 1 ? "ambiguous" : "unmatched"
  };
}

export function daOwnersForCandidates(candidates: string[], maps: DaOwnershipMaps, fallbackCandidates: string[] = []) {
  return resolveDaOwnership(candidates, maps, fallbackCandidates).owners;
}

export function daStationForOwnership(candidates: string[], maps: DaOwnershipMaps, fallbackCandidates: string[] = []) {
  return resolveDaOwnership(candidates, maps, fallbackCandidates).station;
}

export function daOwnershipStatus(candidates: string[], maps: DaOwnershipMaps, fallbackCandidates: string[] = []) {
  return resolveDaOwnership(candidates, maps, fallbackCandidates).status;
}

export function canOwnerAccessDaRecord(
  profileId: string,
  candidates: string[],
  maps: DaOwnershipMaps,
  fallbackCandidates: string[] = []
) {
  const owners = daOwnersForCandidates(candidates, maps, fallbackCandidates);
  return owners.size === 1 && owners.has(profileId);
}

export function validateDaUpdate(input: {
  dependency: string;
  subStatus: string;
  videoStatus: string;
  hasCertificate: boolean;
}) {
  const dependency = savedDependency(input.dependency);
  if (!dependency) return "Choose a valid onboarding dependency.";
  const subStatus = daSubStatusOptions(dependency).find((option) => option.value === input.subStatus);
  if (!subStatus) return "Choose the source-required action status.";
  if (!["pending", "done"].includes(input.videoStatus)) return "Choose a valid video-verification status.";
  if (dependency === "video_verification") {
    const expected = input.videoStatus === "done" ? "completed" : "pending";
    if (input.subStatus !== expected) return "Video action status must match video verification.";
  }
  if (dependency === "nhda" && input.subStatus === "completed" && !input.hasCertificate) {
    return "Attach the NHDA certificate before marking the NHDA course completed.";
  }
  return null;
}

export function daActionIsComplete(dependency: string, subStatus: string) {
  return daSubStatusOptions(dependency).some((option) => option.value === subStatus && option.closesCase === true);
}

export type DaSortOption = "oldest" | "newest" | "station" | "candidate";

export function sortDaRecords<T extends { agingDays?: number; station?: string; daName?: string }>(records: T[], sort: string) {
  const option: DaSortOption = ["oldest", "newest", "station", "candidate"].includes(sort) ? sort as DaSortOption : "oldest";
  return [...records].sort((left, right) => {
    if (option === "newest") return Number(left.agingDays ?? 0) - Number(right.agingDays ?? 0);
    if (option === "station") return String(left.station ?? "").localeCompare(String(right.station ?? "")) || Number(right.agingDays ?? 0) - Number(left.agingDays ?? 0);
    if (option === "candidate") return String(left.daName ?? "").localeCompare(String(right.daName ?? ""));
    return Number(right.agingDays ?? 0) - Number(left.agingDays ?? 0);
  });
}
