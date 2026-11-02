"use client";
import { recruitmentClientHeaders } from "@/lib/recruitment-client-headers";

import { useEffect, useRef, useState } from "react";
import MetaAudienceRadiusPicker from "./MetaAudienceRadiusPicker";
import MetaLocationPinPicker from "./MetaLocationPinPicker";
import type { AdAudiencePin } from "@/lib/meta-audience-pin";
import { isValidMetaAudienceRadius } from "@/lib/meta-audience-radius";

type Point = { latitude: number; longitude: number; radiusKm?: number };
type Context = { version: string; currentPin: (Point & { radiusKm: number }) | null; station: (Point & { stationCode: string; stationName: string }) | null; stationError: string; blocker: string | null; categories: string[]; metaAdId: string; status: string };
const mapUrl = (point: Point) => `https://www.google.com/maps?q=${point.latitude},${point.longitude}`;

export default function MetaAdAudienceEditor({ token, ad, close, afterSave }: { token: string; ad: { id: string; ad_name: string }; close: () => void; afterSave: () => Promise<void> }) {
  const [context, setContext] = useState<Context | null>(null);
  const [radius, setRadius] = useState("10");
  const [center, setCenter] = useState("station");
  const [customPin, setCustomPin] = useState<AdAudiencePin | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState(false);
  const [saved, setSaved] = useState(false);
  const [notice, setNotice] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const requestId = useRef("");
  const dialog = useRef<HTMLElement>(null);
  const headers = { ...recruitmentClientHeaders(token), "Content-Type": "application/json" };
  const url = `/api/recruitment/ads/${encodeURIComponent(ad.id)}/audience`;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setNotice(""); setReview(false); setSaved(false);
    requestId.current = crypto.randomUUID();
    fetch(url, { headers: recruitmentClientHeaders(token), cache: "no-store", signal: controller.signal }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load audience.");
      if (controller.signal.aborted) return;
      setContext(data); setCenter(data.station ? "station" : "current"); setCustomPin(null);
      setRadius(String(data.currentPin ? Math.round(data.currentPin.radiusKm) : 10));
    }).catch(error => { if (!controller.signal.aborted) setNotice(error.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [url, token, reloadKey]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => previous?.focus();
  }, []);

  const point = center === "custom" ? customPin : center === "station" ? context?.station : context?.currentPin;
  const changed = center !== "current" || Number(radius) !== context?.currentPin?.radiusKm;
  async function submit(action: "preview" | "apply") {
    setBusy(true); setNotice("");
    try {
      const response = await fetch(url, { method: "POST", headers, body: JSON.stringify({ action, radiusKm: Number(radius), center, ...(center === "custom" ? { customPin } : {}), expectedVersion: context?.version, clientRequestId: requestId.current }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to update audience.");
      if (action === "preview") setReview(true);
      else {
        setSaved(true); setReview(false);
        try { await afterSave(); } catch { setNotice("Saved in Meta. Refresh Active Ads to load the latest list."); }
      }
    } catch (error) { setReview(false); setNotice(error instanceof Error ? error.message : "Unable to update audience."); }
    finally { setBusy(false); }
  }

  return <div className="modal-backdrop"><section ref={dialog} tabIndex={-1} className="modal request-modal audience-editor" role="dialog" aria-modal="true" aria-label="Edit ad audience" onKeyDown={event => {
    if (event.key === "Escape" && !busy) close();
    if (event.key !== "Tab") return;
    const focusable = dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),a[href],select:not([disabled]),summary');
    if (!focusable?.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }}>
    <header className="modal-header"><div><span className="audience-eyebrow">META AUDIENCE</span><h2>{saved ? "Audience updated" : review ? "Review audience" : "Edit audience"}</h2><p>{ad.ad_name}</p></div><button type="button" disabled={busy} onClick={close} aria-label="Close audience editor">×</button></header>
    <div className="audience-editor-body" aria-busy={loading || busy}>
      {loading ? <p role="status">Loading the current audience from Meta…</p> : null}
      {!loading && context && !saved ? <>
        <div className="audience-current"><span>Current audience</span><strong>{context.currentPin ? `${Math.round(context.currentPin.radiusKm * 10) / 10} km radius` : "Area / multiple locations"}</strong>{context.currentPin ? <a href={mapUrl(context.currentPin)} target="_blank" rel="noreferrer">View pin ↗</a> : null}</div>
        {context.blocker ? <p className="audience-warning" role="alert">{context.blocker}</p> : null}
        {!context.blocker && !review ? <>
          <fieldset className="audience-center"><legend>Centre the audience on</legend>
            <label><input type="radio" name="audience-center" checked={center === "current"} disabled={!context.currentPin || busy} onChange={() => setCenter("current")}/><span><b>Current Meta pin</b><small>Keep the existing centre</small></span></label>
            <label><input type="radio" name="audience-center" checked={center === "station"} disabled={!context.station || busy} onChange={() => setCenter("station")}/><span><b>{context.station ? `${context.station.stationCode} · ${context.station.stationName}` : "Station pin unavailable"}</b><small>Verified Recruit station pin</small></span></label>
          </fieldset>
          {context.stationError ? <p className="audience-warning">{context.stationError}</p> : null}
          {point ? <a className="audience-pin-link" href={mapUrl(point)} target="_blank" rel="noreferrer">Check selected pin ↗ <span>{point.latitude.toFixed(5)}, {point.longitude.toFixed(5)}</span></a> : null}
          <MetaLocationPinPicker token={token} station={context.station} value={center === "current" ? context.currentPin : center === "custom" ? customPin : null} radiusKm={Number(radius)} disabled={busy} scope={{ adId: ad.id }} onChange={pin => { setCustomPin(pin); setCenter(pin ? "custom" : "station"); setReview(false); }}/>
          <MetaAudienceRadiusPicker value={radius} onChange={setRadius} disabled={busy}/>
          {center === "station" && !context.currentPin ? <p className="audience-warning">This replaces the current areas and location exclusions with one station radius.</p> : null}
          {context.categories.includes("EMPLOYMENT") ? <p className="audience-help">Meta’s Employment category can require a larger radius. Review checks the selected radius with Meta.</p> : null}
        </> : null}
        {review && point ? <div className="audience-review" aria-live="polite"><div><span>New radius</span><strong>{radius} km</strong></div><div><span>Centre</span><strong>{center === "station" ? context.station?.stationCode : center === "custom" ? "Custom pin" : "Current Meta pin"}</strong></div><p>{point.latitude.toFixed(5)}, {point.longitude.toFixed(5)} · <a href={mapUrl(point)} target="_blank" rel="noreferrer">Check map ↗</a><br/>All genders · Ages 18–65+<br/>Meta validated this audience. Applying may trigger ad review.</p><small>Budget and run dates stay the same.</small></div> : null}
      </> : null}
      {saved ? <div className="audience-saved" role="status"><strong>✓ {radius} km audience saved and verified</strong><p>Meta may review the updated ad before delivery resumes.</p></div> : null}
      {notice ? <div className="audience-warning" role="alert">{notice}</div> : null}
      {notice && !busy && !saved ? <button className="audience-reload" type="button" onClick={() => setReloadKey(key => key + 1)}>Reload current audience</button> : null}
      {busy ? <p className="audience-help" role="status">{review ? "Applying in Meta…" : "Checking with Meta…"} This can take about a minute.</p> : null}
    </div>
    <footer><button type="button" disabled={busy} onClick={review ? () => setReview(false) : close}>{saved ? "Done" : review ? "Back" : "Cancel"}</button>
      {!saved ? <button type="button" className="primary-action" disabled={busy || loading || !context || !!context.blocker || !point || !changed || !isValidMetaAudienceRadius(radius)} onClick={() => void submit(review ? "apply" : "preview")}>{busy ? "Please wait…" : review ? "Apply audience" : "Review change"}</button> : null}
    </footer>
  </section></div>;
}
