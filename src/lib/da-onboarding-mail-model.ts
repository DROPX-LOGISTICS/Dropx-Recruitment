import { ist, type MailPerson } from "./ad-manager-mail-model";

export type DaDigestSlot = "afternoon" | "evening";

export type DaDigestStation = {
  id: string;
  code: string;
  name: string;
  region: string;
  clusterManager: string;
  areaOpsManager: string;
};

export type DaDigestRecord = {
  id: string;
  daName: string;
  transporterId: string;
  emailId: string;
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
  unmappedRecords: DaDigestRecord[];
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
  if (value === "pendency_cleared") return "Cleared";
  if (value === "candidate_not_responding") return "DA not responding";
  if (value === "offboarded") return "Offboarded";
  return "Pending update";
}

export function daDigestStationSummary(station: DaDigestStation, records: DaDigestRecord[]) {
  const scoped = records.filter((record) => record.stationId === station.id);
  return {
    station,
    total: scoped.length,
    open: scoped.length,
    updated: scoped.filter((record) => Boolean(record.updatedAt)).length,
    notUpdated: scoped.filter((record) => !record.updatedAt).length,
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

const regionOrder = ["KL", "AP", "ODCG"];
const regionNames: Record<string, string> = { KL: "Kerala", AP: "Andhra Pradesh", ODCG: "Odisha & Chhattisgarh" };
const regionLabel = (value: string) => regionNames[value] || value || "Other";

function orderedStations(stations: DaDigestStation[]) {
  return [...stations].sort((left, right) => {
    const leftRank = regionOrder.indexOf(left.region);
    const rightRank = regionOrder.indexOf(right.region);
    return (leftRank < 0 ? 99 : leftRank) - (rightRank < 0 ? 99 : rightRank)
      || left.region.localeCompare(right.region)
      || left.clusterManager.localeCompare(right.clusterManager)
      || left.areaOpsManager.localeCompare(right.areaOpsManager)
      || left.code.localeCompare(right.code);
  });
}

function stationSections(group: DaDigestGroup) {
  const regions = new Map<string, DaDigestStation[]>();
  for (const station of orderedStations(group.stations)) {
    const region = station.region || "OTHER";
    regions.set(region, [...(regions.get(region) ?? []), station]);
  }
  return [...regions.entries()].map(([region, stations]) => {
    const rows = stations.map((station, index) => {
      const row = daDigestStationSummary(station, group.records);
      return `<tr style="background:${index % 2 ? "#ffffff" : "#f8fafc"}"><td style="padding:10px;border-bottom:1px solid #eaecf0"><strong style="color:#101828">${escapeHtml(station.code)}</strong><br><span style="font-size:10px;color:#667085">${escapeHtml(station.name)}</span></td><td style="padding:10px;border-bottom:1px solid #eaecf0">${escapeHtml(station.clusterManager || "N/A")}</td><td style="padding:10px;border-bottom:1px solid #eaecf0">${escapeHtml(station.areaOpsManager || "N/A")}</td><td style="padding:10px;border-bottom:1px solid #eaecf0;text-align:center;font-weight:700">${row.open}</td><td style="padding:10px;border-bottom:1px solid #eaecf0;text-align:center;color:#067647;font-weight:800">${row.updated}</td><td style="padding:10px;border-bottom:1px solid #eaecf0;text-align:center;color:${row.notUpdated ? "#b42318" : "#067647"};font-weight:800">${row.notUpdated}</td></tr>`;
    }).join("");
    return `<div style="margin:20px 0 0"><div style="padding:9px 12px;background:#fff3e8;border-left:4px solid #f79009;color:#7a2e0e;font-size:12px;font-weight:800">${escapeHtml(regionLabel(region))} · ${stations.length} station${stations.length === 1 ? "" : "s"}</div><div style="overflow-x:auto"><table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:11px"><thead><tr>${["Station","Cluster manager","Area ops manager","Open","Updated","Not updated"].map((label) => `<th style="padding:9px;background:#17213a;color:#ffffff;text-align:left;font-size:10px;white-space:nowrap">${escapeHtml(label)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div></div>`;
  }).join("");
}

function metric(label: string, value: number, color: string, background: string) {
  return `<td width="33.33%" style="padding:0 4px"><div style="padding:12px;border-radius:11px;background:${background}"><div style="font-size:10px;color:#667085;font-weight:700;letter-spacing:.3px">${escapeHtml(label)}</div><div style="margin-top:5px;font-size:23px;color:${color};font-weight:800">${value}</div></div></td>`;
}

function unmappedAlert(records: DaDigestRecord[]) {
  if (!records.length) return "";
  const visible = records.slice(0, 25);
  const rows = visible.map((record, index) => `<tr style="background:${index % 2 ? "#ffffff" : "#fff8f7"}"><td style="padding:7px;border-bottom:1px solid #fee4e2;font-weight:800;white-space:nowrap">${escapeHtml(record.transporterId || "N/A")}</td><td style="padding:7px;border-bottom:1px solid #fee4e2">${escapeHtml(record.daName || "N/A")}</td><td style="padding:7px;border-bottom:1px solid #fee4e2;word-break:break-word">${escapeHtml(record.emailId || "N/A")}</td></tr>`).join("");
  const more = records.length > visible.length ? `<p style="margin:8px 0 0;color:#912018;font-size:10px">${records.length - visible.length} more unmapped IDs are included in the attached Excel file.</p>` : "";
  return `<div style="margin:0 0 18px;padding:15px 16px;background:#fff1f0;border:1px solid #fda29b;border-left:5px solid #d92d20;border-radius:12px"><div style="font-size:13px;font-weight:900;color:#912018">${records.length} Amazon ID${records.length === 1 ? " is" : "s are"} not mapped</div><p style="margin:7px 0 10px;color:#912018;font-size:11px;line-height:17px">These IDs are not mapped to an active station or operational owner, so they are shown to every station and manager recipient. Map each ID to the correct Amazon EDSP/XPT station and update the Amazon Badge ID in Recruit.</p><div style="overflow-x:auto;border-radius:7px;background:#ffffff"><table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;color:#7a271a;font-size:10px"><thead><tr><th style="padding:7px;background:#b42318;color:#ffffff;text-align:left">Amazon Badge ID</th><th style="padding:7px;background:#b42318;color:#ffffff;text-align:left">DA name</th><th style="padding:7px;background:#b42318;color:#ffffff;text-align:left">Email ID</th></tr></thead><tbody>${rows}</tbody></table></div>${more}<p style="margin:8px 0 0;color:#912018;font-size:10px">The complete unmapped list is included in the attached Excel file.</p></div>`;
}

export function renderDaDigestMail(input: { group: DaDigestGroup; date: string; slot: DaDigestSlot | "sample"; sample?: boolean }) {
  const { group, date, slot, sample = false } = input;
  const open = group.records.length;
  const updated = group.records.filter((record) => Boolean(record.updatedAt)).length;
  const notUpdated = open - updated;
  const descriptor = group.recipient.role === "LOCATION"
    ? `${group.stations[0]?.code || "Station"} station view`
    : `${group.recipient.role} · ${group.stations.length} mapped station${group.stations.length === 1 ? "" : "s"}`;
  const subject = `${sample ? "[SAMPLE] " : ""}DA In-App Onboarding Update · ${monthLabel(date)}`;
  const slotLabel = slot === "afternoon" ? "15:00 update" : slot === "evening" ? "19:00 update" : "Sample update";
  const html = `<!doctype html><html><body style="margin:0;background:#f3f5f9;font-family:Arial,Helvetica,sans-serif;color:#344054"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 10px"><table role="presentation" width="760" cellpadding="0" cellspacing="0" style="width:100%;max-width:760px;background:#ffffff;border:1px solid #e4e7ec;border-radius:17px;overflow:hidden;box-shadow:0 8px 26px rgba(16,24,40,.08)"><tr><td style="height:7px;background:#ed4f20"></td></tr><tr><td style="padding:24px 26px;background:#17213a;color:#ffffff"><div style="font-size:11px;color:#fdbb8b;font-weight:800;letter-spacing:1px">DROPX · RECRUIT${sample ? " · SAMPLE" : ""}</div><h1 style="margin:8px 0 5px;font-size:23px;color:#ffffff">DA In-App Onboarding Update</h1><div style="font-size:12px;color:#cbd5e1">${escapeHtml(slotLabel)} · ${escapeHtml(date)} · ${escapeHtml(descriptor)} · Amazon EDSP & XPT only</div></td></tr><tr><td style="padding:22px 24px 8px"><p style="margin:0 0 12px;font-size:15px">Hello <strong>${escapeHtml(group.recipient.name)}</strong>,</p><p style="margin:0 0 17px;color:#475467;font-size:12px;line-height:18px">This mail answers one question: <strong>has the team updated each open DA onboarding case in Recruit?</strong> Associate-level details are in the attached Excel file.</p>${unmappedAlert(group.unmappedRecords)}<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${metric("TOTAL OPEN CASES", open, "#344054", "#f2f4f7")}${metric("UPDATED", updated, "#067647", "#ecfdf3")}${metric("NOT UPDATED", notUpdated, "#b42318", "#fff1f0")}</tr></table><div style="margin:20px 0;padding:15px 16px;background:#fff9f2;border:1px solid #fedf89;border-radius:12px"><div style="font-size:12px;font-weight:800;color:#7a2e0e">How to update the pendency</div><ol style="margin:9px 0 0;padding-left:19px;color:#7a2e0e;font-size:11px;line-height:18px"><li>Open <a style="color:#175cd3;font-weight:700" href="https://recruit.dropxlogistics.com">recruit.dropxlogistics.com</a> and sign in.</li><li>Keep the <strong>Workforce</strong> view selected.</li><li>From the left menu, open <strong>Onboarding → DA In-App Onboarding</strong>.</li><li>Search the station or DA, expand <strong>Update</strong>, record the current action and UAN Yes/No, then choose <strong>Cleared</strong>, <strong>Offboarded</strong>, or <strong>DA not responding</strong> only when final.</li><li>Click <strong>Save update</strong>. The next mail will count that case under Updated.</li></ol><a href="https://recruit.dropxlogistics.com" style="display:inline-block;margin-top:12px;padding:10px 15px;background:#ed4f20;color:#ffffff;text-decoration:none;border-radius:8px;font-size:11px;font-weight:800">Open DA In-App Onboarding</a></div><h2 style="margin:24px 0 8px;font-size:14px;color:#101828">Station-level update status</h2><p style="margin:0;color:#667085;font-size:10px;line-height:15px">Stations are grouped Kerala → Andhra Pradesh → Odisha & Chhattisgarh, then by Cluster Manager / Area Ops Manager. N/A means no active mapping exists in People.</p>${stationSections(group)}</td></tr><tr><td style="padding:18px 24px 22px"><div style="height:1px;background:#eaecf0;margin-bottom:13px"></div><p style="margin:0;color:#667085;font-size:10px;line-height:16px">Scope: Amazon EDSP and XPT stations mapped to you in People. Unmapped Amazon IDs are shown to every recipient until corrected. This email stays in one monthly thread; the next 15:00 or 19:00 update replies to the same thread.</p></td></tr></table></td></tr></table></body></html>`;
  const text = `DA In-App Onboarding — ${slotLabel}\n${descriptor}\nAmazon EDSP & XPT only\n${group.unmappedRecords.length ? `ALERT: ${group.unmappedRecords.length} Amazon IDs are not mapped. Map them to the correct station/owner and update the Amazon Badge ID.\n` : ""}Total open: ${open} | Updated: ${updated} | Not updated: ${notUpdated}\n\nUpdate steps:\n1. Open https://recruit.dropxlogistics.com\n2. Select Workforce.\n3. Open Onboarding > DA In-App Onboarding.\n4. Search the station or DA, expand Update, record action/UAN/final update, and Save update.\n\nAssociate-level detail and unmapped IDs are attached as Excel.`;
  return { subject, html, text };
}
