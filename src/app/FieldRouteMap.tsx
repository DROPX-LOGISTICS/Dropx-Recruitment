"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { calculateFieldRouteMetrics, type FieldLocationPoint } from "@/lib/field-route";

type ContactPoint = {
  full_name?: string | null;
  latitude?: unknown;
  longitude?: unknown;
  outcome?: string | null;
};

type VisitPoint = {
  location_name?: string | null;
  visit_type?: string | null;
  latitude?: unknown;
  longitude?: unknown;
};

type Props = {
  points: FieldLocationPoint[];
  contacts?: ContactPoint[];
  visits?: VisitPoint[];
  status?: string;
  distanceMeters?: number;
};

function relativeTime(value: string | null) {
  if (!value) return "No GPS signal received";
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

export default function FieldRouteMap({ points, contacts = [], visits = [], status = "", distanceMeters }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [mapError, setMapError] = useState("");
  const metrics = useMemo(() => calculateFieldRouteMetrics(points), [points]);
  const displayedDistance = Number.isFinite(Number(distanceMeters)) ? Number(distanceMeters) : metrics.distanceMeters;
  const lastSignalAge = metrics.lastPointAt ? Date.now() - Date.parse(metrics.lastPointAt) : Number.POSITIVE_INFINITY;
  const trackingWarning = status === "active" && lastSignalAge > 5 * 60_000;
  const first = metrics.qualityPoints[0];
  const last = metrics.qualityPoints.at(-1);
  const mapUrl = first && last
    ? `https://www.google.com/maps/dir/?api=1&origin=${first.latitude},${first.longitude}&destination=${last.latitude},${last.longitude}`
    : null;

  useEffect(() => {
    if (!containerRef.current || !metrics.qualityPoints.length) return;
    let disposed = false;
    let map: any;
    setMapError("");
    void import("leaflet").then((leaflet) => {
      if (disposed || !containerRef.current) return;
      const L = leaflet.default ?? leaflet;
      map = L.map(containerRef.current, { zoomControl: true, attributionControl: true });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap contributors"
      }).addTo(map);

      const routeBounds: [number, number][] = [];
      metrics.routeSegments.forEach((segment) => {
        const positions = segment.map((point) => [point.latitude, point.longitude] as [number, number]);
        routeBounds.push(...positions);
        if (positions.length >= 2) L.polyline(positions, { color: "#d82459", weight: 5, opacity: 0.9 }).addTo(map);
      });
      if (first) L.circleMarker([first.latitude, first.longitude], {
        radius: 8, color: "#ffffff", weight: 3, fillColor: "#12a56a", fillOpacity: 1
      }).bindTooltip("Duty started").addTo(map);
      if (last) L.circleMarker([last.latitude, last.longitude], {
        radius: 8, color: "#ffffff", weight: 3, fillColor: "#d82459", fillOpacity: 1
      }).bindTooltip(status === "active" ? "Latest GPS point" : "Duty ended").addTo(map);
      contacts.forEach((contact) => {
        const latitude = Number(contact.latitude);
        const longitude = Number(contact.longitude);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
        routeBounds.push([latitude, longitude]);
        const popup = document.createElement("div");
        const name = document.createElement("strong");
        name.textContent = String(contact.full_name ?? "Field contact");
        popup.append(name, document.createElement("br"), document.createTextNode(String(contact.outcome ?? "Contact recorded")));
        L.circleMarker([latitude, longitude], {
          radius: 6, color: "#ffffff", weight: 2, fillColor: "#2e6bd9", fillOpacity: 0.95
        }).bindPopup(popup).addTo(map);
      });
      visits.filter((visit) => String(visit.visit_type ?? "").startsWith("hotspot_")).forEach((visit) => {
        const latitude = Number(visit.latitude);
        const longitude = Number(visit.longitude);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
        routeBounds.push([latitude, longitude]);
        L.circleMarker([latitude, longitude], {
          radius: 7, color: "#ffffff", weight: 2, fillColor: "#f79009", fillOpacity: 0.95
        }).bindTooltip(String(visit.location_name ?? "Reported hotspot")).addTo(map);
      });
      if (routeBounds.length === 1) map.setView(routeBounds[0], 16);
      else map.fitBounds(routeBounds, { padding: [28, 28], maxZoom: 17 });
    }).catch(() => {
      if (!disposed) setMapError("The base map could not load. The GPS trace is still stored safely.");
    });
    return () => {
      disposed = true;
      if (map) map.remove();
    };
  }, [contacts, first, last, metrics, status, visits]);

  return <section className="field-route-map-card">
    <header>
      <div><b>GPS travel map</b><span>Exact recorded breadcrumb trace — not an estimated road route</span></div>
      {mapUrl ? <a href={mapUrl} target="_blank" rel="noreferrer">Open start/end in Maps</a> : null}
    </header>
    <div className="field-route-health">
      <span><b>{(displayedDistance / 1000).toFixed(2)} km</b>Calculated distance</span>
      <span><b>{metrics.validPointCount}/{metrics.totalPointCount}</b>Valid GPS points</span>
      <span><b>{metrics.coveragePercent.toFixed(0)}%</b>GPS quality</span>
      <span className={trackingWarning ? "warning" : ""}><b>{relativeTime(metrics.lastPointAt)}</b>Last GPS update</span>
    </div>
    {trackingWarning ? <div className="field-route-warning">Tracking signal is stale. Ask the recruiter to keep Location enabled, allow background location and remove battery restriction for DropX Recruitment.</div> : null}
    {metrics.rejectedSegmentCount ? <div className="field-route-note">{metrics.rejectedSegmentCount} impossible GPS jump{metrics.rejectedSegmentCount === 1 ? " was" : "s were"} excluded from distance.</div> : null}
    {metrics.qualityPoints.length ? <div className="field-leaflet-map" ref={containerRef} /> : <div className="field-route-empty">No valid GPS points are available yet. The map will appear after the first accepted signal.</div>}
    {mapError ? <div className="field-route-warning">{mapError}</div> : null}
    <footer><span className="map-key start">Start</span><span className="map-key latest">Latest / end</span><span className="map-key contact">Contact recorded</span><span className="map-key hotspot">Reported hotspot</span><span>Mocked, inaccurate and impossible GPS movement is excluded.</span></footer>
  </section>;
}
