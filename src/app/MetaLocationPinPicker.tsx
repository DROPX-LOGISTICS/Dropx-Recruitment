"use client";
import { recruitmentClientHeaders } from "@/lib/recruitment-client-headers";
import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, Marker, Circle } from "leaflet";
import { validateAdAudiencePin, type AdAudiencePin } from "@/lib/meta-audience-pin";

type Props = { token: string; station: AdAudiencePin | null; value: AdAudiencePin | null; radiusKm: number; disabled?: boolean;
  scope: { adId?: string; stream?: string; locationId?: string; roleId?: string }; onChange: (pin: AdAudiencePin | null) => void };

function AudiencePinMap({ point, radiusKm, disabled, onChange }: { point: AdAudiencePin; radiusKm: number; disabled: boolean; onChange: (pin: AdAudiencePin) => void }) {
  const element = useRef<HTMLDivElement>(null);
  const layer = useRef<{ map: LeafletMap; marker: Marker; circle: Circle } | null>(null);
  const current = useRef({ point, radiusKm, disabled, onChange });
  current.current = { point, radiusKm, disabled, onChange };
  const [error, setError] = useState("");
  useEffect(() => {
    let disposed = false;
    void import("leaflet").then(({ default: L }) => {
      if (disposed || !element.current) return;
      const p = current.current.point, radius = Math.max(1, current.current.radiusKm || 10) * 1000;
      const map = L.map(element.current, { scrollWheelZoom: false }).setView([p.latitude, p.longitude], 11);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(map);
      const marker = L.marker([p.latitude, p.longitude], { draggable: !current.current.disabled, keyboard: true, title: "Ad audience pin", icon: L.divIcon({ className: "audience-map-marker", html: "<span></span>", iconSize: [24, 24], iconAnchor: [12, 12] }) }).addTo(map);
      const circle = L.circle([p.latitude, p.longitude], { radius, color: "#cb235e", fillOpacity: .08, weight: 2 }).addTo(map);
      const choose = (lat: number, lng: number) => {
        if (current.current.disabled) return;
        try { const pin = validateAdAudiencePin({ latitude: lat, longitude: lng, label: "Custom map pin" }); setError(""); current.current.onChange(pin); }
        catch (error) { marker.setLatLng([current.current.point.latitude, current.current.point.longitude]); setError(error instanceof Error ? error.message : "Choose a valid pin."); }
      };
      map.on("click", event => choose(event.latlng.lat, event.latlng.lng));
      marker.on("dragend", () => { const next = marker.getLatLng(); choose(next.lat, next.lng); });
      map.fitBounds(circle.getBounds(), { padding: [15, 15] });
      layer.current = { map, marker, circle };
    }).catch(() => setError("Map unavailable. Use search or coordinates below."));
    return () => { disposed = true; layer.current?.map.remove(); layer.current = null; };
  }, []);
  useEffect(() => {
    const l = layer.current; if (!l) return;
    const coords: [number, number] = [point.latitude, point.longitude];
    l.marker.setLatLng(coords); l.circle.setLatLng(coords); l.circle.setRadius(Math.max(1, radiusKm || 10) * 1000);
    l.map.panTo(coords); disabled ? l.marker.dragging?.disable() : l.marker.dragging?.enable();
  }, [point.latitude, point.longitude, radiusKm, disabled]);
  return <><div ref={element} className="audience-pin-map" aria-label="Audience map. Click to move the pin or use coordinates below."/>{error ? <p role="alert" className="audience-help">{error}</p> : null}</>;
}

export default function MetaLocationPinPicker({ token, station, value, radiusKm, disabled = false, scope, onChange }: Props) {
  const point = value || station;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Array<AdAudiencePin & { key: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [coords, setCoords] = useState({ latitude: String(point?.latitude ?? ""), longitude: String(point?.longitude ?? "") });
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => setCoords({ latitude: String(point?.latitude ?? ""), longitude: String(point?.longitude ?? "") }), [point?.latitude, point?.longitude]);
  async function search() {
    controller.current?.abort(); const request = new AbortController(); controller.current = request;
    setBusy(true); setNotice(""); setResults([]);
    try {
      const params = new URLSearchParams({ q: query.trim(), ...Object.fromEntries(Object.entries(scope).filter(([, v]) => v != null)) as Record<string, string> });
      const response = await fetch(`/api/recruitment/meta-location-search?${params}`, { headers: recruitmentClientHeaders(token), signal: request.signal, cache: "no-store" });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Location search unavailable.");
      setResults(data.locations || []); if (!data.locations?.length) setNotice("No matching Meta pin. Try a nearby city or PIN code, or place the pin on the map.");
    } catch (error) { if (!request.signal.aborted) setNotice(error instanceof Error ? error.message : "Search unavailable. Use the map or coordinates."); }
    finally { if (!request.signal.aborted) setBusy(false); }
  }
  return <section className="audience-pin-editor" aria-label="Location pin controls">
    <div className="audience-pin-editor-content">
      <b className="audience-pin-title">{value ? "Custom audience pin" : "Location pin"}</b>
      <div className="audience-location-search"><input aria-label="Search city or PIN code" placeholder="Search city or PIN code in Meta" value={query} disabled={disabled || busy} maxLength={120} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); if (query.trim().length >= 3 && !busy) void search(); } }}/><button type="button" disabled={disabled || busy || query.trim().length < 3} onClick={() => void search()}>{busy ? "Searching…" : "Search"}</button></div>
      {results.length ? <div className="audience-location-results">{results.map(result => <button type="button" disabled={disabled} key={result.key} onClick={() => { onChange(result); setResults([]); setOpen(true); setNotice("Check the pin on the map before saving."); }}>{result.label}</button>)}</div> : null}
      {notice ? <p className="audience-help" role="status">{notice}</p> : null}
      <details className="audience-map-disclosure" open={open} onToggle={event => setOpen(event.currentTarget.open)}><summary>Move pin on map / enter coordinates</summary>
      {open ? <div className="audience-map-fields">{point ? <AudiencePinMap point={point} radiusKm={radiusKm} disabled={disabled} onChange={onChange}/> : <p className="audience-help">Search a location or enter coordinates to show the map.</p>}
      <div className="audience-coordinates"><label>Latitude<input type="number" step="any" value={coords.latitude} disabled={disabled} onChange={event => setCoords({ ...coords, latitude: event.target.value })}/></label><label>Longitude<input type="number" step="any" value={coords.longitude} disabled={disabled} onChange={event => setCoords({ ...coords, longitude: event.target.value })}/></label><button type="button" disabled={disabled} onClick={() => { try { onChange(validateAdAudiencePin(coords)); setNotice(""); } catch (error) { setNotice(error instanceof Error ? error.message : "Invalid pin."); } }}>Use pin</button></div>
      </div> : null}</details>
      <div className="audience-pin-bottom"><small>Only this ad’s audience changes. The station master stays unchanged.</small><button type="button" disabled={disabled || !station} onClick={() => { onChange(null); setResults([]); setNotice(""); }}>Reset to station</button></div>
    </div>
  </section>;
}
