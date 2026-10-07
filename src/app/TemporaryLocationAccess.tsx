"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { temporaryLocationState, type TemporaryLocationGrant } from "@/lib/recruitment-temporary-locations";

type Location = { id: string; code: string; name: string };
type Grant = TemporaryLocationGrant & {
  recruitment_locations: { code: string; name: string };
  grantor: { full_name: string } | null;
  revoker: { full_name: string } | null;
  canRevoke: boolean;
};
const istTime = (value: string) => new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });

export default function TemporaryLocationAccess({ profileId, userName, locations, canManage, readOnly, active, requestHeaders, onSaved, onBusyChange }: {
  profileId: string; userName: string; locations: Location[]; canManage: boolean; readOnly: boolean; active: boolean;
  requestHeaders: Record<string, string>; onSaved: () => Promise<void>; onBusyChange: (busy: boolean) => void;
}) {
  const [grants, setGrants] = useState<Grant[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [expiry, setExpiry] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [confirm, setConfirm] = useState<"grant" | Grant | null>(null);
  const requestId = useRef<string | null>(null);
  const headerKey = JSON.stringify(requestHeaders);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/recruitment/access/temporary-locations?profileId=${encodeURIComponent(profileId)}&page=${page}`, { headers: JSON.parse(headerKey), cache: "no-store", signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setGrants(result.grants ?? []); setTotal(result.total ?? 0); setFailed(false); setLoadError("");
    } catch (error) {
      if (signal?.aborted) return;
      setFailed(true); setLoadError(error instanceof Error ? error.message : "Unable to load access.");
    } finally { if (!signal?.aborted) setLoading(false); }
  }, [profileId, page, headerKey]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  const visible = locations.filter((location) => `${location.code} ${location.name}`.toLowerCase().includes(query.trim().toLowerCase()));
  const selectedSet = new Set(selected);
  const allVisible = visible.length > 0 && visible.every((location) => selectedSet.has(location.id));
  const labels = locations.filter((location) => selectedSet.has(location.id)).map((location) => location.code);
  const changeSelection = (ids: string[]) => { setSelected(ids); requestId.current = null; setConfirm(null); };

  async function save() {
    if (!confirm || busy || readOnly || !canManage) return;
    setBusy(true); onBusyChange(true); setMessage("");
    try {
      const granting = confirm === "grant";
      if (granting && !requestId.current) requestId.current = crypto.randomUUID();
      const response = await fetch("/api/recruitment/access/temporary-locations", {
        method: granting ? "POST" : "DELETE",
        headers: { ...requestHeaders, "Content-Type": "application/json" },
        body: JSON.stringify(granting ? {
          profileId, requestId: requestId.current, locationIds: selected,
          expiresAt: new Date(`${expiry}:00+05:30`).toISOString(), reason
        } : { profileId, grantId: (confirm as Grant).id })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to save access.");
      setConfirm(null);
      if (granting) { setSelected([]); setReason(""); setExpiry(""); requestId.current = null; }
      setMessage(granting ? "Temporary access granted." : "Temporary access disabled. Normal access is unchanged.");
      await load();
      await onSaved();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to save access."); }
    finally { setBusy(false); onBusyChange(false); }
  }

  return <section className="temporary-location-access" aria-label="Temporary location access">
    <header><div><h3>Temporary locations</h3><p>Extra Recruit locations only. Normal access and role permissions stay unchanged.</p></div><span className="universal-state">Auto-expiry</span></header>
    {canManage ? <p>{readOnly ? "View as user is read-only. This user can manage temporary access to their normally assigned locations." : "Choose from your normally assigned Recruit locations."}</p> : null}
    {canManage && active ? <fieldset disabled={readOnly || busy || loading || failed}>
      <details className="temporary-location-picker"><summary>{selected.length ? `${selected.length} extra locations selected` : "Select extra locations"}</summary>
        <input aria-label="Search extra locations" placeholder="Search code or location…" value={query} onChange={(event) => setQuery(event.target.value)}/>
        <button type="button" onClick={() => changeSelection(allVisible ? selected.filter((id) => !visible.some((location) => location.id === id)) : [...new Set([...selected, ...visible.map((location) => location.id)])])}>{allVisible ? "Clear shown" : "Select shown"}</button>
        <div className="temporary-location-options">{visible.map((location) => <label key={location.id}><input type="checkbox" checked={selectedSet.has(location.id)} onChange={() => changeSelection(selectedSet.has(location.id) ? selected.filter((id) => id !== location.id) : [...selected, location.id])}/><span><b>{location.code}</b> · {location.name}</span></label>)}{!visible.length ? <p>No extra locations available.</p> : null}</div>
      </details>
      {selected.length ? <small>{labels.join(", ")}</small> : null}
      <div className="form-grid"><label>Access until (IST)<input type="datetime-local" value={expiry} onChange={(event) => { setExpiry(event.target.value); requestId.current = null; setConfirm(null); }}/></label><label>Reason<input maxLength={500} placeholder="e.g. Covering a colleague" value={reason} onChange={(event) => { setReason(event.target.value); requestId.current = null; setConfirm(null); }}/></label></div>
      <button type="button" className="primary-action" disabled={!selected.length || !expiry || reason.trim().length < 3} onClick={() => setConfirm("grant")}>Review temporary access</button>
    </fieldset> : <p>{active ? "Users & Access edit permission is required to grant or disable extra locations." : "Save and activate this user’s Recruit access before adding temporary locations."}</p>}
    {confirm ? <div className="temporary-access-confirm" role="alert">
      <p>{confirm === "grant" ? <>Give <b>{userName}</b> access to <b>{labels.join(", ")}</b> until <b>{istTime(`${expiry}:00+05:30`)} IST</b>?</> : <>Disable <b>{confirm.recruitment_locations?.code}</b> temporary access for <b>{userName}</b>?</>}</p>
      <button type="button" disabled={busy} onClick={() => setConfirm(null)}>Cancel</button><button type="button" className="primary-action" disabled={busy || readOnly || !canManage} onClick={() => void save()}>{busy ? "Saving…" : confirm === "grant" ? "Confirm grant" : "Confirm disable"}</button>
    </div> : null}
    {message ? <p role="status" className="connection-notice">{message}</p> : null}
    {loadError ? <p role="alert" className="connection-notice">{loadError}</p> : null}
    <div className="temporary-access-history"><h4>Access history <button type="button" disabled={busy || loading} onClick={() => void load()}>Refresh</button></h4>
      {loading ? <p>Loading access…</p> : grants.length ? grants.map((grant) => {
        const state = temporaryLocationState(grant);
        return <div className="temporary-access-row" key={grant.id}><div><b>{grant.recruitment_locations?.code}</b><span className={state === "Active" ? "universal-state" : "universal-state inactive"}>{state}</span><small>Until {istTime(grant.expires_at)} IST · {grant.reason}</small><small>Added by {grant.grantor?.full_name || "Administrator"} · {istTime(grant.created_at || grant.starts_at)} IST{grant.revoked_at ? ` · Disabled by ${grant.revoker?.full_name || "Administrator"} · ${istTime(grant.revoked_at)} IST` : ""}</small></div>{canManage && grant.canRevoke && !readOnly && ["Active", "Scheduled"].includes(state) ? <button type="button" disabled={busy} onClick={() => setConfirm(grant)}>Disable</button> : null}</div>;
      }) : <p>No temporary access yet.</p>}
      {total > 100 ? <div><button disabled={page === 0 || busy} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page + 1} of {Math.ceil(total / 100)}</span><button disabled={(page + 1) * 100 >= total || busy} onClick={() => setPage(page + 1)}>Next</button></div> : null}
    </div>
  </section>;
}
