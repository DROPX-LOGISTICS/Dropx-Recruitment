import { describe, expect, it } from "vitest";
import {
  buildManualPunchRemarks,
  canApproveManualPunch,
  canReviewManualPunchRequest,
  minimumFieldDutyPunchSeparationMs,
  normalizeManualPunchReasonInput,
  parseManualPunchRemarks,
  resolveBiometricStationId,
  selectFieldDutyPunches
} from "./manual-punch";

describe("manual punch authorization", () => {
  const session = (
    level: "none" | "view" | "edit" | "all",
    readOnly = false,
    recruitmentFunction: "telecaller" | "field_recruiter" | "manager" | "viewer" = "manager"
  ) => ({
    menuAccess: { workforce: { "Field Recruitment": level }, hr: {} },
    menuActions: { workforce: {}, hr: {} },
    readOnly,
    isPreview: readOnly,
    isOwner: false,
    recruitmentFunction
  });

  it("uses configured menu access instead of role names", () => {
    expect(canApproveManualPunch(session("edit"))).toBe(true);
    expect(canApproveManualPunch(session("all"))).toBe(true);
  });

  it("uses the current action matrix and grants the signed-in owner", () => {
    expect(canApproveManualPunch({
      ...session("none"),
      menuActions: { workforce: { "Field Recruitment": { view: true, add: false, edit: true } }, hr: {} }
    })).toBe(true);
    expect(canApproveManualPunch({ ...session("none"), isOwner: true })).toBe(true);
  });

  it("blocks view-only, missing, and impersonated sessions", () => {
    expect(canApproveManualPunch(session("view"))).toBe(false);
    expect(canApproveManualPunch(session("none"))).toBe(false);
    expect(canApproveManualPunch(session("all", true))).toBe(false);
    expect(canApproveManualPunch({ ...session("all"), isPreview: true })).toBe(false);
  });

  it("never grants a field recruiter approval access, even with edit or all menu access", () => {
    expect(canApproveManualPunch(session("edit", false, "field_recruiter"))).toBe(false);
    expect(canApproveManualPunch(session("all", false, "field_recruiter"))).toBe(false);
  });

  it("never permits a requester to review their own manual punch", () => {
    expect(canReviewManualPunchRequest("anees", "anees")).toBe(false);
    expect(canReviewManualPunchRequest("manager", "anees")).toBe(true);
    expect(canReviewManualPunchRequest("", "anees")).toBe(false);
  });
});

describe("biometric duty location resolution", () => {
  it("uses the active Device Master station instead of a stale punch location", () => {
    expect(resolveBiometricStationId({ punchLocationId: "HO_KL", deviceId: "DEVICE", deviceSerial: "A241006311", deviceMasterLocationId: "ERSE" })).toBe("ERSE");
  });
  it("does not trust a stale location when an identified device lacks an active master mapping", () => {
    expect(resolveBiometricStationId({ punchLocationId: "STALE", deviceId: "DEVICE", deviceMasterLocationId: null })).toBeNull();
  });
  it("uses the punch station for legacy punches without device identity", () => {
    expect(resolveBiometricStationId({ punchLocationId: "ERSE" })).toBe("ERSE");
  });
});

describe("field duty punch pairing", () => {
  const start = "2026-08-03T09:00:00+05:30";

  it("selects the first calculated biometric IN and a later calculated OUT", () => {
    expect(selectFieldDutyPunches({
      biometricPunches: [start, "2026-08-03T18:00:00+05:30"],
      dutyStartedAt: "2026-08-03T09:05:00+05:30"
    })).toMatchObject({
      punchInAt: start,
      punchInSource: "biometric",
      punchOutAt: "2026-08-03T18:00:00+05:30",
      punchOutSource: "biometric"
    });
  });

  it("does not treat an early duplicate punch as OUT", () => {
    const early = new Date(Date.parse(start) + minimumFieldDutyPunchSeparationMs - 1).toISOString();
    expect(selectFieldDutyPunches({
      biometricPunches: [start, early],
      dutyStartedAt: start
    }).punchOutAt).toBeNull();
  });

  it("uses the last valid biometric punch when a person punches three or four times", () => {
    expect(selectFieldDutyPunches({
      biometricPunches: [
        start,
        "2026-08-03T10:00:00+05:30",
        "2026-08-03T15:00:00+05:30",
        "2026-08-03T18:30:00+05:30"
      ],
      dutyStartedAt: "2026-08-03T09:05:00+05:30"
    }).punchOutAt).toBe("2026-08-03T18:30:00+05:30");
  });

  it("accepts an approved manual OUT after a verified IN", () => {
    expect(selectFieldDutyPunches({
      biometricPunches: [start],
      approvedManualOutAt: "2026-08-03T18:00:00+05:30",
      dutyStartedAt: start
    })).toMatchObject({
      punchInSource: "biometric",
      punchOutSource: "manual_approved"
    });
  });

  it("tolerates a delayed biometric import after approved manual IN", () => {
    expect(selectFieldDutyPunches({
      biometricPunches: ["2026-08-03T18:15:00+05:30"],
      approvedManualInAt: start,
      dutyStartedAt: "2026-08-03T09:05:00+05:30"
    })).toMatchObject({
      punchInAt: start,
      punchInSource: "manual_approved",
      punchOutAt: "2026-08-03T18:15:00+05:30",
      punchOutSource: "biometric"
    });
  });
});

describe("manual punch audit details", () => {
  it("accepts the legacy mobile reason field while new clients use a master code", () => {
    expect(normalizeManualPunchReasonInput({ reason: "No biometric device at ERSN" })).toEqual({
      reasonCode: "",
      reasonDetail: "No biometric device at ERSN",
      legacy: true
    });
    expect(normalizeManualPunchReasonInput({ reasonCode: "NO_DEVICE", reasonDetail: "Device offline" })).toEqual({
      reasonCode: "NO_DEVICE",
      reasonDetail: "Device offline",
      legacy: false
    });
  });

  it("keeps location, reason, and GPS in the master request", () => {
    const remarks = buildManualPunchRemarks({
      reason: "No biometric device at the new hub",
      locationName: "New Ramanattukara hub",
      latitude: 11.1782,
      longitude: 75.8575,
      accuracy: 14
    });
    expect(parseManualPunchRemarks(remarks)).toEqual({
      reason: "No biometric device at the new hub",
      locationName: "New Ramanattukara hub",
      gps: "11.178200,75.857500 (14m accuracy)"
    });
  });
});
