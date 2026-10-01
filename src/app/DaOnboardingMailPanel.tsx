"use client";

import { useCallback, useEffect, useState } from "react";

export default function DaOnboardingMailPanel({ token }: { token: string }) {
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    const response = await fetch("/api/recruitment/da-onboarding-mail", {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store"
    });
    if (response.ok) setData(await response.json());
  }, [token]);
  useEffect(() => { void load(); }, [load]);
  async function update(body: object) {
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/recruitment/da-onboarding-mail", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to update mail settings.");
      setNotice("sent" in payload
        ? `${payload.sent} sample emails sent. ${payload.missing?.length ? `Missing mappings: ${payload.missing.join(", ")}.` : "Nisar, Praveen and QLDA received their own scoped sample."}`
        : payload.queued ? "Retry queued for the next scheduled delivery check." : "Schedule updated.");
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to update mail settings.");
    } finally {
      setBusy(false);
    }
  }
  if (!data) return null;
  const attention = data.recent?.filter((item: any) => ["failed", "needs_review"].includes(item.status)) ?? [];
  return <details className="content-card danap-mail-panel">
    <summary>DA onboarding emails · {data.enabled ? "Live" : "Off"} · 15:00 and 19:00 IST {attention.length ? `· ${attention.length} need review` : ""}</summary>
    <div>
      <p>Direct, station-scoped mail only · {data.recipientGroups} mapped recipients · {data.mappedStations} stations · {data.cases} current cases.</p>
      <p>Each recipient gets one monthly thread. The 15:00 and 19:00 updates reply within it, using the latest People/station scope at send time.</p>
      <div className="danap-mail-actions"><button disabled={busy} onClick={() => void update({ enabled: !data.enabled })}>{data.enabled ? "Pause emails" : "Enable emails"}</button><button disabled={busy} onClick={() => void update({ action: "samples" })}>Send Nisar, Praveen &amp; QLDA samples</button><button disabled={busy} onClick={() => void load()}>Refresh log</button></div>
      {notice ? <p role="status">{notice}</p> : null}
      <details><summary>Recent delivery log ({data.recent?.length || 0})</summary><table><thead><tr><th>Recipient type</th><th>Mail</th><th>Status</th><th>Time (IST)</th><th>Note</th></tr></thead><tbody>{data.recent?.slice(0, 30).map((item: any) => <tr key={item.id}><td>{item.recipient_role}</td><td>{item.slot}</td><td>{item.status}</td><td>{new Date(item.sent_at || item.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</td><td>{item.error || "—"}{["failed", "needs_review"].includes(item.status) ? <button disabled={busy} onClick={() => { if (item.status === "failed" || window.confirm("Confirm from the email provider that this message was not delivered. Retrying an uncertain message can create a duplicate.")) void update({ action: "retry", id: item.id, confirmedUndelivered: true }); }}>Retry after verification</button> : null}</td></tr>)}</tbody></table></details>
    </div>
  </details>;
}
