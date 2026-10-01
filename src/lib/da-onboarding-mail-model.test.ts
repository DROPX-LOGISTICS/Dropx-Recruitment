import { describe, expect, it } from "vitest";
import { daDigestSlot, daDigestStationSummary, renderDaDigestMail, type DaDigestGroup, type DaDigestRecord } from "./da-onboarding-mail-model";

const station = { id: "qlda-id", code: "QLDA", name: "Koyilandy", cluster: "Praveen Kumar" };
const record = (overrides: Partial<DaDigestRecord> = {}): DaDigestRecord => ({
  id: "case-1",
  daName: "Example Associate",
  transporterId: "A1EXAMPLE",
  stationId: station.id,
  station: station.code,
  stationName: station.name,
  cluster: station.cluster,
  actionLabel: "Account provisioning",
  actionStatus: "uan_pending",
  actionStatusLabel: "UAN pending",
  sourceAction: "Complete provisioning",
  finalOutcome: "pending",
  clearanceStatus: "pending",
  videoStatus: "pending",
  uanStatus: "no",
  updatedAt: "",
  updatedBy: "",
  agingDays: 4,
  ...overrides
});
const group: DaDigestGroup = {
  recipient: { id: "recipient", name: "QLDA", email: "qlda@dropxlogistics.com", mobile: null, role: "LOCATION", station_ids: [station.id] },
  stations: [station],
  records: [record(), record({ id: "case-2", actionStatus: "provisioned", actionStatusLabel: "Account provisioned", uanStatus: "yes", videoStatus: "done", finalOutcome: "pendency_cleared", clearanceStatus: "cleared", updatedAt: "2026-10-01T08:00:00Z" })]
};

describe("DA onboarding digest schedule and content", () => {
  it("runs only inside the 15:00 and 19:00 IST cron windows", () => {
    expect(daDigestSlot(new Date("2026-10-01T09:30:00Z"))).toBe("afternoon");
    expect(daDigestSlot(new Date("2026-10-01T13:30:00Z"))).toBe("evening");
    expect(daDigestSlot(new Date("2026-10-01T10:00:00Z"))).toBeNull();
  });

  it("provides compact station buckets without mixing final and operational status", () => {
    expect(daDigestStationSummary(station, group.records)).toMatchObject({
      total: 2,
      open: 1,
      updatePending: 1,
      uanPending: 1,
      provisioningCleared: 1,
      videoPending: 1,
      pendencyCleared: 1
    });
  });

  it("uses one stable monthly subject and explains the three final updates", () => {
    const afternoon = renderDaDigestMail({ group, date: "2026-10-01", slot: "afternoon" });
    const evening = renderDaDigestMail({ group, date: "2026-10-21", slot: "evening" });
    expect(afternoon.subject).toBe("DA In-App Onboarding Update · October 2026");
    expect(evening.subject).toBe(afternoon.subject);
    expect(afternoon.html).toContain("PORTAL UPDATE PENDING");
    expect(afternoon.html).toContain("Pendency cleared, Candidate not responding, or Offboarded");
    expect(afternoon.html).toContain("QLDA");
  });

  it("labels user-requested samples while keeping them scoped to the recipient", () => {
    const mail = renderDaDigestMail({ group, date: "2026-10-01", slot: "sample", sample: true });
    expect(mail.subject).toBe("[SAMPLE] DA In-App Onboarding Update · October 2026");
    expect(mail.html).toContain("QLDA station view");
  });
});
