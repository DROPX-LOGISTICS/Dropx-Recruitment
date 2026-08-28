import { describe, expect, it } from "vitest";
import {
  DA_INAPP_SOURCE_TYPE,
  addDaOwner,
  addDaStation,
  canOwnerAccessDaRecord,
  carryForwardDaOperations,
  daActionIsComplete,
  daAgingDays,
  daFallbackOwnershipCandidates,
  daOwnershipStatus,
  daStationForOwnership,
  inferDaDependency,
  isDaInAppBatch,
  latestDaInAppBatch,
  parseDaInAppRecord,
  resolveDaContact,
  resolveDaOwnership,
  resolveDaVisibility,
  sortDaRecords,
  validateDaUpdate,
  type DaBatch,
  type DaImportRow,
  type DaOwnershipMaps
} from "./da-inapp-onboarding";

const daBatch = (id: string, createdAt = "2026-08-03T00:00:00.000Z"): DaBatch => ({
  id,
  source_type: DA_INAPP_SOURCE_TYPE,
  file_name: "DA inapp onboarding.csv",
  report_to: "2026-08-03",
  created_at: createdAt
});

const daRow = (
  id: string,
  batchId: string,
  overrides: Partial<DaImportRow> = {}
): DaImportRow => ({
  id,
  batch_id: batchId,
  source_type: DA_INAPP_SOURCE_TYPE,
  station_code: "DLO1",
  work_date: "2026-08-01",
  raw_data: {
    transporter_id: "TR-1001",
    rabbit_id: "associate@example.com",
    employee_name: "Test Associate",
    station_code: "DLO1",
    invitation_date: "01/08/2026",
    operational_status: "ONBOARDING",
    categories: "BGC failed",
    action_item: "DA PCC required"
  },
  normalized_data: {},
  created_at: "2026-08-03T00:00:00.000Z",
  ...overrides
});

const ownershipMaps = (): DaOwnershipMaps => ({
  stableOwners: new Map(),
  contactOwners: new Map(),
  fallbackOwners: new Map(),
  stableStations: new Map(),
  contactStations: new Map(),
  fallbackStations: new Map()
});

describe("DA In-App import refresh and aging", () => {
  it("selects the newest DA upload even when unrelated imports are newer", () => {
    const batches: DaBatch[] = [
      { ...daBatch("fuel-new", "2026-08-03T01:00:00.000Z"), source_type: "fuel", file_name: "fuel.csv" },
      daBatch("da-new", "2026-08-03T00:00:00.000Z"),
      daBatch("da-old", "2026-08-02T00:00:00.000Z")
    ];
    const rows = [
      daRow("old", "da-old"),
      daRow("new", "da-new"),
      { ...daRow("fuel", "fuel-new"), source_type: "fuel", raw_data: { fuel: 1 } }
    ];

    const latest = latestDaInAppBatch(batches, rows);

    expect(latest.batch?.id).toBe("da-new");
    expect(latest.rows.map((row) => row.id)).toEqual(["new"]);
  });

  it("never falls back to an older DA file when the newest upload has no rows", () => {
    const batches = [
      daBatch("da-empty-new", "2026-08-04T03:00:00.000Z"),
      daBatch("da-old", "2026-07-25T15:31:46.000Z")
    ];
    const latest = latestDaInAppBatch(batches, [daRow("old", "da-old")]);

    expect(latest.batch?.id).toBe("da-empty-new");
    expect(latest.rows).toEqual([]);
    expect(latest.historyRows.map((row) => row.id)).toEqual(["old"]);
  });

  it("recognises legacy source codes and the DA In-App filename", () => {
    expect(isDaInAppBatch({ source_type: "danap_onboarding", file_name: "daily.csv" })).toBe(true);
    expect(isDaInAppBatch({ source_type: "generic_table", file_name: "DA inapp onboarding.csv" })).toBe(true);
    expect(isDaInAppBatch({ source_type: "amazon_shipments", file_name: "shipment.csv" })).toBe(false);

    const latest = latestDaInAppBatch([
      { ...daBatch("filename-match", "2026-08-04T03:00:00.000Z"), source_type: "generic_table" },
      daBatch("exact-old", "2026-08-03T03:00:00.000Z")
    ], [
      { ...daRow("filename-row", "filename-match"), source_type: "generic_table" },
      daRow("old-row", "exact-old")
    ]);

    expect(latest.batch?.id).toBe("filename-match");
    expect(latest.rows.map((row) => row.id)).toEqual(["filename-row"]);
  });

  it("carries closure metadata to the same associate and reason on the next daily import", () => {
    const previous = daRow("previous", "da-old", {
      normalized_data: {
        ops_dependency: "bgv",
        ops_sub_status: "pcc_applied",
        ops_clearance_status: "cleared",
        ops_remarks: "Applied on portal"
      },
      created_at: "2026-08-02T00:00:00.000Z"
    });
    const current = daRow("current", "da-new", { created_at: "2026-08-03T00:00:00.000Z" });

    const [carried] = carryForwardDaOperations([current], [current, previous]);

    expect(carried.normalized_data).toMatchObject({
      ops_sub_status: "pcc_applied",
      ops_clearance_status: "cleared",
      ops_remarks: "Applied on portal"
    });
  });

  it("does not carry an old closure when the imported pending reason changes", () => {
    const previous = daRow("previous", "da-old", {
      normalized_data: { ops_clearance_status: "cleared" }
    });
    const current = daRow("current", "da-new", {
      raw_data: { ...previous.raw_data, categories: "Training completion >2 days" }
    });

    const [carried] = carryForwardDaOperations([current], [current, previous]);

    expect(carried.normalized_data).not.toHaveProperty("ops_clearance_status");
  });

  it("maps real import reasons and computes calendar-day aging in IST", () => {
    expect(inferDaDependency("BGC failed - DA PCC required")).toBe("bgv");
    expect(inferDaDependency("Training completion >2 days")).toBe("training");
    expect(inferDaDependency("NHDA course incomplete")).toBe("nhda");
    expect(inferDaDependency("DL verification failed")).toBe("driving_license");
    expect(inferDaDependency("Station/supervisor update")).toBe("station_mapping");
    expect(daAgingDays("01/08/2026", Date.parse("2026-08-03T00:00:00.000Z"))).toBe(2);
  });

  it("parses the production-shaped BGC record without relying on email as the key", () => {
    const record = parseDaInAppRecord(daRow("case", "da-new"), daBatch("da-new"), Date.parse("2026-08-03T00:00:00.000Z"));

    expect(record).toMatchObject({
      daName: "Test Associate",
      transporterId: "TR-1001",
      sourceReason: "BGC failed",
      sourceAction: "DA PCC required",
      dependency: "bgv",
      subStatus: "pending",
      agingDays: 2
    });
    expect(record.identityCandidates[0]).toBe("tr-1001");
  });

  it("reads the candidate contact independently of repeated email and mobile attribution", () => {
    const record = parseDaInAppRecord(daRow("case", "da-new", {
      raw_data: { ...(daRow("shape", "da-new").raw_data ?? {}), candidate_contact_number: "+91 98765 43210" }
    }), daBatch("da-new"));

    expect(record.candidatePhone).toBe("+91 98765 43210");
    expect(record.identityCandidates[0]).toBe("tr-1001");
  });

  it("keeps the imported reason authoritative over a previously saved action type", () => {
    const record = parseDaInAppRecord(daRow("case", "da-new", { normalized_data: { ops_dependency: "training" } }), daBatch("da-new"));
    expect(record.dependency).toBe("bgv");
  });
});

describe("DA In-App role and ownership authorization", () => {
  it("restricts recruiter and telecaller roles while allowing oversight roles full visibility", () => {
    expect(resolveDaVisibility({ recruitmentFunction: "telecaller" })).toBe("mine");
    expect(resolveDaVisibility({ recruitmentFunction: "field_recruiter", allLocations: true })).toBe("mine");
    expect(resolveDaVisibility({ designationCode: "RECRUITER" })).toBe("mine");
    expect(resolveDaVisibility({ recruitmentFunction: "manager" })).toBe("permitted_locations");
    expect(resolveDaVisibility({ recruitmentFunction: "manager", allLocations: true })).toBe("all");
    expect(resolveDaVisibility({ isOwner: true })).toBe("all");
    expect(resolveDaVisibility({ designationCode: "HEAD_HR" })).toBe("permitted_locations");
    expect(resolveDaVisibility({ designationCode: "HR_EXECUTIVE", allLocations: true })).toBe("all");
    expect(resolveDaVisibility({ designationCode: "OPERATIONS_ASSOCIATE" })).toBe("permitted_locations");
  });

  it("uses unique stable ownership before repeated email/mobile contacts", () => {
    const maps = ownershipMaps();
    addDaOwner(maps.stableOwners, "TR-1001", "recruiter-a");
    addDaOwner(maps.contactOwners, "associate@example.com", "recruiter-a");
    addDaOwner(maps.contactOwners, "associate@example.com", "recruiter-b");

    expect(daOwnershipStatus(["TR-1001", "associate@example.com"], maps)).toBe("matched");
    expect(canOwnerAccessDaRecord("recruiter-a", ["TR-1001", "associate@example.com"], maps)).toBe(true);
    expect(canOwnerAccessDaRecord("recruiter-b", ["TR-1001", "associate@example.com"], maps)).toBe(false);
  });

  it("denies both recruiters when only a repeated contact creates ambiguous attribution", () => {
    const maps = ownershipMaps();
    addDaOwner(maps.contactOwners, "associate@example.com", "recruiter-a");
    addDaOwner(maps.contactOwners, "associate@example.com", "recruiter-b");

    expect(daOwnershipStatus(["associate@example.com"], maps)).toBe("ambiguous");
    expect(canOwnerAccessDaRecord("recruiter-a", ["associate@example.com"], maps)).toBe(false);
    expect(canOwnerAccessDaRecord("recruiter-b", ["associate@example.com"], maps)).toBe(false);
  });

  it("links a DA to the initiator when Amazon and Workforce email station suffixes are transposed", () => {
    const maps = ownershipMaps();
    const workforceCandidates = daFallbackOwnershipCandidates("abdulgafoor.peau@outlook.com", "ABDUL GAFOOR");
    for (const candidate of workforceCandidates) {
      addDaOwner(maps.fallbackOwners!, candidate, "shaheen");
      addDaStation(maps.fallbackStations!, candidate, "PEUA");
    }
    const amazonCandidates = daFallbackOwnershipCandidates("abdulgafoor.peua@outlook.com", "Kuniyil Abdulgafoor");

    expect(resolveDaOwnership(["A18XQLFXJUS6I3", "abdulgafoor.peua@outlook.com"], maps, amazonCandidates)).toMatchObject({
      status: "matched",
      tier: "fallback",
      station: "PEUA"
    });
    expect(canOwnerAccessDaRecord("shaheen", ["A18XQLFXJUS6I3", "abdulgafoor.peua@outlook.com"], maps, amazonCandidates)).toBe(true);
    expect(daStationForOwnership(["A18XQLFXJUS6I3"], maps, amazonCandidates)).toBe("PEUA");
  });

  it("links a uniquely named associate even when the Workforce email has a spelling error", () => {
    const maps = ownershipMaps();
    for (const candidate of daFallbackOwnershipCandidates("subaib.peau@outlook.com", "SHUHAIB")) {
      addDaOwner(maps.fallbackOwners!, candidate, "shaheen");
    }
    const amazonCandidates = daFallbackOwnershipCandidates("shuhaib.peau@outlook.com", "Shuhaib Vp");

    expect(daOwnershipStatus(["A1S1IIZBQG7X21", "shuhaib.peau@outlook.com"], maps, amazonCandidates)).toBe("matched");
    expect(canOwnerAccessDaRecord("shaheen", ["A1S1IIZBQG7X21"], maps, amazonCandidates)).toBe(true);
  });

  it("keeps fuzzy aliases closed when they identify associates initiated by different users", () => {
    const maps = ownershipMaps();
    const candidates = daFallbackOwnershipCandidates("abdulgafoor.peau@outlook.com", "ABDUL GAFOOR");
    for (const candidate of candidates) {
      addDaOwner(maps.fallbackOwners!, candidate, "recruiter-a");
      addDaOwner(maps.fallbackOwners!, candidate, "recruiter-b");
      addDaStation(maps.fallbackStations!, candidate, "PEUA");
      addDaStation(maps.fallbackStations!, candidate, "TLPA");
    }

    expect(daOwnershipStatus([], maps, candidates)).toBe("ambiguous");
    expect(canOwnerAccessDaRecord("recruiter-a", [], maps, candidates)).toBe(false);
    expect(daStationForOwnership([], maps, candidates)).toBe("");
  });

  it("always prefers a stable provider ID over ambiguous name and email aliases", () => {
    const maps = ownershipMaps();
    const fallbackCandidates = daFallbackOwnershipCandidates("associate@example.com", "Common Associate");
    addDaOwner(maps.stableOwners, "A18XQLFXJUS6I3", "recruiter-a");
    addDaStation(maps.stableStations!, "A18XQLFXJUS6I3", "PEUA");
    for (const candidate of fallbackCandidates) {
      addDaOwner(maps.fallbackOwners!, candidate, "recruiter-a");
      addDaOwner(maps.fallbackOwners!, candidate, "recruiter-b");
    }

    expect(resolveDaOwnership(["A18XQLFXJUS6I3"], maps, fallbackCandidates)).toMatchObject({
      status: "matched",
      tier: "stable",
      station: "PEUA"
    });
  });
});

describe("DA In-App status, proof, and closure rules", () => {
  it("requires the certificate before the NHDA course can be completed", () => {
    expect(validateDaUpdate({
      dependency: "nhda",
      subStatus: "completed",
      videoStatus: "pending",
      hasCertificate: false
    })).toContain("NHDA certificate");
    expect(validateDaUpdate({
      dependency: "nhda",
      subStatus: "completed",
      videoStatus: "done",
      hasCertificate: true
    })).toBeNull();
  });

  it("keeps legacy NSTA certificate proof readable after the NHDA rename", () => {
    const record = parseDaInAppRecord(daRow("case", "da-new", {
      raw_data: { ...(daRow("shape", "da-new").raw_data ?? {}), categories: "NHDA course incomplete", action_item: "Complete NHDA course" },
      normalized_data: { ops_nsta_certificate: { storage_bucket: "recruitment-documents", storage_path: "legacy-proof.pdf" } }
    }), daBatch("da-new"));

    expect(record.dependency).toBe("nhda");
    expect(record.certificate).toMatchObject({ storage_path: "legacy-proof.pdf" });
  });

  it("allows only BGC cleared as the BGC completion action", () => {
    expect(validateDaUpdate({ dependency: "bgv", subStatus: "cleared", videoStatus: "pending", hasCertificate: false })).toBeNull();
    expect(validateDaUpdate({ dependency: "bgv", subStatus: "pcc_applied", videoStatus: "pending", hasCertificate: false })).toContain("source-required action status");
  });

  it("derives closure from the one reason-specific completion value", () => {
    expect(daActionIsComplete("bgv", "pending")).toBe(false);
    expect(daActionIsComplete("bgv", "cleared")).toBe(true);
  });

  it("keeps the common video action consistent for a video-specific case", () => {
    expect(validateDaUpdate({ dependency: "video_verification", subStatus: "completed", videoStatus: "pending", hasCertificate: false })).toContain("must match");
  });
});

describe("DA In-App contact fallback and sorting", () => {
  it("prefers the candidate number and labels the station POC fallback explicitly", () => {
    expect(resolveDaContact("9876543210", { pocName: "Station Team", pocMobile: "9123456780" })).toMatchObject({ phone: "9876543210", source: "candidate", label: "Candidate contact number" });
    expect(resolveDaContact("", { pocName: "Station Team", pocMobile: "9123456780" })).toEqual({ phone: "9123456780", source: "station_poc", label: "Station POC contact number", name: "Station Team" });
    expect(resolveDaContact("", null)).toEqual({ phone: "", source: "missing", label: "Contact unavailable", name: "" });
  });

  it("sorts oldest pending cases first by default and supports station sorting", () => {
    const rows = [
      { daName: "B", station: "ZZZ", agingDays: 2 },
      { daName: "A", station: "AAA", agingDays: 20 },
      { daName: "C", station: "AAA", agingDays: 5 }
    ];
    expect(sortDaRecords(rows, "oldest").map((item) => item.agingDays)).toEqual([20, 5, 2]);
    expect(sortDaRecords(rows, "newest").map((item) => item.agingDays)).toEqual([2, 5, 20]);
    expect(sortDaRecords(rows, "station").map((item) => `${item.station}:${item.agingDays}`)).toEqual(["AAA:20", "AAA:5", "ZZZ:2"]);
    expect(sortDaRecords(rows, "candidate").map((item) => item.daName)).toEqual(["A", "B", "C"]);
  });
});
