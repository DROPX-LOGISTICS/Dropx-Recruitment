import { ist, type MailPerson } from "./ad-manager-mail-model";

export type DaDigestSlot = "afternoon" | "evening";

export type DaDigestStation = {
  id: string;
  code: string;
  name: string;
  cluster: string;
};

export type DaDigestRecord = {
  id: string;
  daName: string;
  transporterId: string;
  stationId: string;
  station: string;
  stationName: string;
  cluster: string;
  actionLabel: string;
  actionStatus: string;
  actionStatusLabel: string;
  sourceAction: string;
  finalOutcome: string;
  clearanceStatus: string;
  videoStatus: string;
  uanStatus: string;
  updatedAt: string;
  updatedBy: string;
  agingDays: number;
};

export type DaDigestGroup = {
  recipient: MailPerson;
  stations: DaDigestStation[];
  records: DaDigestRecord[];
};

const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
}[character]!));

const within = (now: Date, expected: string) => {
  const time = ist(now).slice(11, 16);
  const [hour, minute] = expected.slice(0, 5).split(":").map(Number);
  const actualMinutes = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  const expectedMinutes = hour * 60 + minute;
  return actualMinutes >= expectedMinutes && actualMinutes < expectedMinutes + 5;
};

export function daDigestSlot(now = new Date(), afternoon = "15:00", evening = "19:00"): DaDigestSlot | null {
  if (within(now, afternoon)) return "afternoon";
  if (within(now, evening)) return "evening";
  return null;
}

export function daFinalOutcomeLabel(value: string) {
  if (value === "pendency_cleared") return "Pendency cleared";
  if (value === "candidate_not_responding") return "Candidate not responding";
  if (value === "offboarded") return "Offboarded";
  return "Pending update";
}

export function daDigestStationSummary(station: DaDigestStation, records: DaDigestRecord[]) {
  const scoped = records.filter((record) => record.stationId === station.id);
  return {
    station,
    total: scoped.length,
    open: scoped.filter((record) => record.finalOutcome === "pending").length,
    updatePending: scoped.filter((record) => !record.updatedAt).length,
    amazonPending: scoped.filter((record) => record.actionStatus === "amazon_pending").length,
    uanPending: scoped.filter((record) => record.actionStatus === "uan_pending").length,
    uanUpdated: scoped.filter((record) => record.actionStatus === "uan_updated").length,
    provisioningCleared: scoped.filter((record) => record.actionStatus === "provisioned").length,
    videoPending: scoped.filter((record) => record.videoStatus === "pending").length,
    pendencyCleared: scoped.filter((record) => record.finalOutcome === "pendency_cleared").length,
    notResponding: scoped.filter((record) => record.finalOutcome === "candidate_not_responding").length,
    offboarded: scoped.filter((record) => record.finalOutcome === "offboarded").length
  };
}

function monthLabel(date: string) {
  return new Date(`${date.slice(0, 10)}T12:00:00+05:30`).toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata", month: "long", year: "numeric"
  });
}

function stationRows(group: DaDigestGroup) {
  return group.stations.map((station, index) => {
    const row = daDigestStationSummary(station, group.records);
    return `<tr style="background:${index % 2 ? "#ffffff" : "#f8fafc"}"><td style="padding:8px;border-bottom:1px solid #eaecf0"><strong style="color:#101828">${escapeHtml(station.code)}</strong><br><span style="font-size:10px;color:#667085">${escapeHtml(station.name)}</span></td><td style="padding:8px;border-bottom:1px solid #eaecf0;text-align:center">${row.open}</td><td style="padding:8px;border-bottom:1px solid #eaecf0;text-align:center;color:${row.updatePending ? "#b42318" : "#067647"};font-weight:700">${row.updatePending}</td><td style="padding:8px;border-bottom:1px solid #eaecf0;text-align:center">${row.amazonPending}</td><td style="padding:8px;border-bottom:1px solid #eaecf0;text-align:center">${row.uanPending}</td><td style="padding:8px;border-bottom:1px solid #eaecf0;text-align:center">${row.uanUpdated}</td><td style="padding:8px;border-bottom:1px solid #eaecf0;text-align:center">${row.provisioningCleared}</td><td style="padding:8px;border-bottom:1px solid #eaecf0;text-align:center">${row.videoPending}</td></tr>`;
  }).join("");
}

function clusterRows(group: DaDigestGroup) {
  const clusters = new Map<string, DaDigestStation[]>();
  for (const station of group.stations) {
    const name = station.cluster || "Owner not mapped";
    clusters.set(name, [...(clusters.get(name) ?? []), station]);
  }
  return [...clusters.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([cluster, stations], index) => {
    const stationIds = new Set(stations.map((station) => station.id));
    const records = group.records.filter((record) => stationIds.has(record.stationId));
    return `<tr style="background:${index % 2 ? "#ffffff" : "#f8fafc"}"><td style="padding:8px;border-bottom:1px solid #eaecf0"><strong>${escapeHtml(cluster)}</strong></td><td style="padding:8px;border-bottom:1px solid #eaecf0;text-align:center">${stations.length}</td><td style="padding:8px;border-bottom:1px solid #eaecf0;text-align:center">${records.filter((record) => record.finalOutcome === "pending").length}</td><td style="padding:8px;border-bottom:1px solid #eaecf0;text-align:center;color:#b42318;font-weight:700">${records.filter((record) => !record.updatedAt).length}</td></tr>`;
  }).join("");
}

function updatePendingRows(group: DaDigestGroup) {
  const rows = group.records.filter((record) => !record.updatedAt).sort((left, right) => right.agingDays - left.agingDays).slice(0, 40);
  if (!rows.length) return `<tr><td colspan="5" style="padding:14px;text-align:center;color:#067647">Every case in this scope has a portal update.</td></tr>`;
  return rows.map((record, index) => `<tr style="background:${index % 2 ? "#ffffff" : "#fff9f2"}"><td style="padding:8px;border-bottom:1px solid #eaecf0"><strong>${escapeHtml(record.station)}</strong></td><td style="padding:8px;border-bottom:1px solid #eaecf0"><strong>${escapeHtml(record.daName || "Unnamed DA")}</strong><br><span style="font-size:10px;color:#667085">${escapeHtml(record.transporterId)}</span></td><td style="padding:8px;border-bottom:1px solid #eaecf0">${escapeHtml(record.actionStatusLabel)}</td><td style="padding:8px;border-bottom:1px solid #eaecf0">${record.uanStatus === "yes" ? "Yes" : record.uanStatus === "no" ? "No" : "Not updated"}</td><td style="padding:8px;border-bottom:1px solid #eaecf0;text-align:center;color:#b42318;font-weight:700">${record.agingDays}</td></tr>`).join("");
}

function metric(label: string, value: number, color: string, background: string) {
  return `<td width="25%" style="padding:0 4px"><div style="padding:12px;border-radius:11px;background:${background}"><div style="font-size:10px;color:#667085;font-weight:700;letter-spacing:.3px">${escapeHtml(label)}</div><div style="margin-top:5px;font-size:23px;color:${color};font-weight:800">${value}</div></div></td>`;
}

export function renderDaDigestMail(input: { group: DaDigestGroup; date: string; slot: DaDigestSlot | "sample"; sample?: boolean }) {
  const { group, date, slot, sample = false } = input;
  const pending = group.records.filter((record) => record.finalOutcome === "pending").length;
  const updatePending = group.records.filter((record) => !record.updatedAt).length;
  const uanPending = group.records.filter((record) => record.uanStatus !== "yes").length;
  const finalised = group.records.filter((record) => record.finalOutcome !== "pending").length;
  const descriptor = group.recipient.role === "LOCATION"
    ? `${group.stations[0]?.code || "Station"} station view`
    : `${group.recipient.role} · ${group.stations.length} mapped station${group.stations.length === 1 ? "" : "s"}`;
  const subject = `${sample ? "[SAMPLE] " : ""}DA In-App Onboarding Update · ${monthLabel(date)}`;
  const slotLabel = slot === "afternoon" ? "15:00 update" : slot === "evening" ? "19:00 update" : "Sample update";
  const tableHead = (labels: string[]) => `<thead><tr>${labels.map((label) => `<th style="padding:8px;background:#17213a;color:#ffffff;text-align:left;font-size:10px;white-space:nowrap">${escapeHtml(label)}</th>`).join("")}</tr></thead>`;
  const html = `<!doctype html><html><body style="margin:0;background:#f3f5f9;font-family:Arial,Helvetica,sans-serif;color:#344054"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 10px"><table role="presentation" width="760" cellpadding="0" cellspacing="0" style="width:100%;max-width:760px;background:#ffffff;border:1px solid #e4e7ec;border-radius:17px;overflow:hidden;box-shadow:0 8px 26px rgba(16,24,40,.08)"><tr><td style="height:7px;background:linear-gradient(90deg,#d4275a,#f79009,#12b76a)"></td></tr><tr><td style="padding:24px 26px;background:#17213a;color:#ffffff"><div style="font-size:11px;color:#fda4c5;font-weight:800;letter-spacing:1px">DROPX · RECRUIT${sample ? " · SAMPLE" : ""}</div><h1 style="margin:8px 0 5px;font-size:23px;color:#ffffff">DA In-App Onboarding</h1><div style="font-size:12px;color:#cbd5e1">${escapeHtml(slotLabel)} · ${escapeHtml(date)} · ${escapeHtml(descriptor)}</div></td></tr><tr><td style="padding:22px 24px 8px"><p style="margin:0 0 16px;font-size:15px">Hello <strong>${escapeHtml(group.recipient.name)}</strong>,</p><p style="margin:0 0 17px;color:#475467;font-size:12px;line-height:18px">This is the current station-scoped DA onboarding position. The red <strong>Portal update pending</strong> count is the primary action: it means no update has yet been saved in Recruit for that case.</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${metric("OPEN PENDENCY", pending, "#b42318", "#fff1f0")}${metric("PORTAL UPDATE PENDING", updatePending, "#c4320a", "#fff6ed")}${metric("UAN NOT YES", uanPending, "#6941c6", "#f4f3ff")}${metric("FINALISED", finalised, "#067647", "#ecfdf3")}</tr></table><h2 style="margin:24px 0 9px;font-size:14px;color:#101828">Station-level pendency</h2><div style="overflow-x:auto"><table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:11px">${tableHead(["Station","Open","Update pending","Amazon","UAN pending","UAN updated","Provisioned","Video pending"])}<tbody>${stationRows(group)}</tbody></table></div><h2 style="margin:24px 0 9px;font-size:14px;color:#101828">Cluster / operational-owner breakup</h2><table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:11px">${tableHead(["Owner","Stations","Open","Update pending"])}<tbody>${clusterRows(group)}</tbody></table><h2 style="margin:24px 0 9px;font-size:14px;color:#101828">Portal updates still required</h2><table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:11px">${tableHead(["Station","DA / ID","Action bucket","UAN in Rabbit","Age (days)"])}<tbody>${updatePendingRows(group)}</tbody></table></td></tr><tr><td style="padding:18px 24px 22px"><div style="height:1px;background:#eaecf0;margin-bottom:13px"></div><p style="margin:0;color:#667085;font-size:10px;line-height:16px">Final update values are Pendency cleared, Candidate not responding, or Offboarded. This message stays in one monthly thread for this recipient; the next 15:00 or 19:00 update will reply to the same thread.</p></td></tr></table></td></tr></table></body></html>`;
  const text = `DA In-App Onboarding — ${slotLabel}\n${descriptor}\nOpen: ${pending} | Portal update pending: ${updatePending} | UAN not yes: ${uanPending} | Finalised: ${finalised}\n\nPortal updates still required:\n${group.records.filter((record) => !record.updatedAt).slice(0, 40).map((record) => `${record.station} | ${record.daName} | ${record.actionStatusLabel} | UAN ${record.uanStatus} | ${record.agingDays} days`).join("\n") || "All cases have a portal update."}`;
  return { subject, html, text };
}
