"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { recruitmentClientHeaders } from "@/lib/recruitment-client-headers";
import { uploadCreativeFile } from "@/lib/meta-media-upload";
import type { PromotionDemographics, PromotionPurpose } from "@/lib/promotion-audience";
import type { AdAudiencePin } from "@/lib/meta-audience-pin";
import MetaAudienceRadiusPicker from "./MetaAudienceRadiusPicker";
import MetaLocationPinPicker from "./MetaLocationPinPicker";
import styles from "./MetaPromotionsPanel.module.css";

type Location = { id: string; code: string; name: string };
type Props = { token: string; stream: "workforce" | "hr"; locations: Location[]; close: () => void };
type Form = { locationId: string; purpose: PromotionPurpose; campaignCategory: string; adName: string; dailyBudget: string; daysRequired: string; destinationUrl: string; headline: string; primaryText: string; description: string; imageHash: string; posterUrl: string; audienceRadiusKm: string; customPin: AdAudiencePin | null; demographics: PromotionDemographics };
type Promotion = { id: string; ad_name: string; status: string; meta_ad_id?: string; error_message?: string; location_id: string; draft: Form; snapshot?: any };
type Loaded = { ad: Promotion; version: string; status: string; point: (AdAudiencePin & { radiusKm: number }) | null; demographics: PromotionDemographics };
const initialForm = (): Form => ({ locationId: "", purpose: "service_offer", campaignCategory: "STANDARD_INDIA", adName: "", dailyBudget: "150", daysRequired: "7", destinationUrl: "", headline: "", primaryText: "", description: "", imageHash: "", posterUrl: "", audienceRadiusKm: "10", customPin: null, demographics: { ageMin: 18, ageMax: 65, gender: "all" } });
const ages = Array.from({ length: 48 }, (_, i) => i + 18);
const ageLabel = (age: number) => age === 65 ? "65+" : String(age);
const money = (value: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);
const date = (value?: string) => value ? new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) + " IST" : "Unavailable";
async function api(token: string, path: string, body?: unknown, signal?: AbortSignal) {
  const response = await fetch(`/api/recruitment/promotions${path}`, { method: body ? "POST" : "GET", headers: { ...recruitmentClientHeaders(token), "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined, cache: "no-store", signal });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Unable to load promotions. Please retry.");
  return data;
}
export function PromotionDemographicFields({ value, onChange }: { value: PromotionDemographics; onChange: (value: PromotionDemographics) => void }) {
  return <div className={styles.three}>
    <label>Gender<select value={value.gender} onChange={e => onChange({ ...value, gender: e.target.value as PromotionDemographics["gender"] })}><option value="all">All genders</option><option value="male">Men</option><option value="female">Women</option></select></label>
    <label>Minimum age<select value={value.ageMin} onChange={e => onChange({ ...value, ageMin: Number(e.target.value) })}>{ages.map(n => <option key={n} value={n}>{ageLabel(n)}</option>)}</select></label>
    <label>Maximum age<select value={value.ageMax} onChange={e => onChange({ ...value, ageMax: Number(e.target.value) })}>{ages.map(n => <option key={n} value={n}>{ageLabel(n)}</option>)}</select></label>
  </div>;
}
export default function MetaPromotionsPanel({ token, stream, locations, close }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const reviewBox = useRef<HTMLElement>(null);
  const uploadController = useRef<AbortController | null>(null);
  const [ads, setAds] = useState<Promotion[]>([]), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"list" | "new" | "edit" | "delivery">("list");
  const [form, setForm] = useState(initialForm), [station, setStation] = useState<AdAudiencePin | null>(null);
  const [selected, setSelected] = useState<Loaded | null>(null), [review, setReview] = useState<any>(null);
  const [confirmed, setConfirmed] = useState(false), [notice, setNotice] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID()), [preview, setPreview] = useState("");
  const [delivery, setDelivery] = useState<"ACTIVE" | "PAUSED">("ACTIVE");
  const reload = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try { const data = await api(token, `?stream=${stream}`, undefined, signal); setAds(data.ads); }
    catch (error) { if (!(error instanceof Error && error.name === "AbortError")) setNotice(error instanceof Error ? error.message : "Unable to load promotions."); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [token, stream]);
  useEffect(() => { dialog.current?.showModal(); const controller = new AbortController(); void reload(controller.signal); return () => { controller.abort(); uploadController.current?.abort(); }; }, [reload]);
  useEffect(() => () => { if (preview.startsWith("blob:")) URL.revokeObjectURL(preview); }, [preview]);
  useEffect(() => { if (review) reviewBox.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [review]);
  useEffect(() => {
    if (!form.locationId || mode === "list") { setStation(null); return; }
    const controller = new AbortController(); setStation(null);
    api(token, `?stream=${stream}&locationId=${encodeURIComponent(form.locationId)}`, undefined, controller.signal)
      .then(data => setStation(data.audience)).catch(error => { if (error.name !== "AbortError") setNotice(error.message); });
    return () => controller.abort();
  }, [token, stream, form.locationId, mode]);
  function update<K extends keyof Form>(key: K, value: Form[K]) {
    setForm(current => ({ ...current, [key]: value, ...(key === "locationId" ? { customPin: null } : {}) }));
    setReview(null); setNotice("");
  }
  function startNew() { setForm(initialForm()); setSelected(null); setReview(null); setConfirmed(false); setNotice(""); setPreview(""); setRequestId(crypto.randomUUID()); setMode("new"); }
  async function open(ad: Promotion, next: "edit" | "delivery") {
    setBusy(true); setNotice(""); setReview(null); setConfirmed(false); setRequestId(crypto.randomUUID());
    try {
      const data: Loaded = await api(token, `/${ad.id}?stream=${stream}`);
      setSelected(data); setForm({ ...initialForm(), ...ad.draft, locationId: ad.location_id, customPin: data.point, audienceRadiusKm: String(data.point?.radiusKm || 10), demographics: data.demographics });
      setDelivery(data.status === "ACTIVE" ? "PAUSED" : "ACTIVE"); setMode(next);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Unable to open promotion."); }
    finally { setBusy(false); }
  }
  async function upload(file?: File) {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) { setNotice("Use a JPG, PNG or WebP image."); return; }
    setBusy(true); setReview(null); setForm(f => ({ ...f, imageHash: "", posterUrl: "" }));
    const controller = new AbortController(); uploadController.current = controller;
    try { const image = await uploadCreativeFile({ file, stream, headers: recruitmentClientHeaders(token), signal: controller.signal, onPreview: value => setPreview(value.url), onStatus: setNotice }); setForm(f => ({ ...f, imageHash: image.imageHash, posterUrl: image.previewUrl || image.posterUrl || "" })); setNotice(""); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Upload failed."); }
    finally { setBusy(false); }
  }
  async function submit() {
    setBusy(true); setNotice("");
    try {
      if (mode === "new") {
        const data = await api(token, "", { action: review ? "create" : "review", stream, locationId: form.locationId, draft: form, confirmPurpose: confirmed, reviewVersion: review?.reviewVersion, clientRequestId: requestId });
        if (!review) { setReview(data); return; }
        setMode("list"); await reload(); setNotice("Promotion created paused. Open Start / pause when you are ready to launch.");
      } else if (selected) {
        const data = await api(token, `/${selected.ad.id}?stream=${stream}`, { action: mode === "delivery" ? delivery : review ? "apply_audience" : "review_audience", version: selected.version, clientRequestId: requestId, point: form.customPin || station, radiusKm: Number(form.audienceRadiusKm), demographics: form.demographics, confirmLaunch: confirmed });
        if (mode === "edit" && !review) { setReview(data); return; }
        setMode("list"); await reload(); setNotice(mode === "edit" ? "Audience saved and checked against Meta." : `Delivery updated: ${data.status || delivery}.`);
      }
    } catch (error) { setNotice(error instanceof Error ? error.message : "Unable to save promotion."); }
    finally { setBusy(false); }
  }
  const validAge = form.demographics.ageMin <= form.demographics.ageMax;
  const point = form.customPin || station;
  const selectedLocation = locations.find(l => l.id === form.locationId);
  const canSubmit = mode === "delivery" ? delivery === "PAUSED" || confirmed : validAge && !!point && (mode !== "new" || (confirmed && !!form.imageHash && !!form.locationId && !!form.adName && !!form.destinationUrl && !!form.headline && !!form.primaryText));
  return <dialog ref={dialog} className={`${styles.dialog} ${mode === "new" ? styles.createDialog : ""}`} onCancel={event => { event.preventDefault(); if (!busy) close(); }} aria-labelledby="promotions-title">
    <header className={styles.header}><div><small>SERVICE & CUSTOMER ADS · STANDARD INDIA</small><h2 id="promotions-title">{mode === "list" ? "Promotions" : mode === "new" ? "New promotion" : mode === "edit" ? "Edit promotion audience" : "Change delivery"}</h2></div><button type="button" aria-label="Close promotions" disabled={busy} onClick={close}>×</button></header>
    <div className={styles.body}>
      {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
      {mode === "list" ? <><div className={styles.intro}><p>Service offers and brand ads.<br/>Manage age, gender and location audiences.</p><button type="button" className={styles.primary} disabled={busy || loading} onClick={startNew}>New promotion</button></div>
        {loading ? <p>Loading promotions…</p> : !ads.length ? <div className={styles.empty}>No promotions created in this workspace yet.</div> : <div className={styles.list}>{ads.map(ad => <article key={ad.id}><div><strong>{ad.ad_name}</strong><small>{locations.find(l => l.id === ad.location_id)?.code || "Location"} · {ad.status} · {money(Number(ad.draft.dailyBudget))} / day</small>{ad.error_message ? <p role="alert">{ad.error_message}</p> : null}</div><div><button type="button" disabled={busy || !ad.meta_ad_id || ad.status === "failed"} onClick={() => void open(ad, "edit")}>Edit audience</button><button type="button" disabled={busy || !ad.meta_ad_id || ad.status === "failed"} onClick={() => void open(ad, "delivery")}>Start / pause</button></div></article>)}</div>}
      </> : <fieldset className={styles.fields} disabled={busy}>
        <div className={mode === "new" ? styles.composer : styles.stack}>
        {mode === "new" ? <section className={styles.creative} aria-label="Promotion details">
          <h3>Ad details</h3>
          <div className={`${styles.two} ${styles.mobileStack}`}><label>Promotion type<select value={form.purpose} onChange={e => update("purpose", e.target.value as PromotionPurpose)}><option value="service_offer">Delivery / service promotion</option><option value="customer_offer">Customer offer</option><option value="brand">Brand promotion</option></select></label><label>Location<select value={form.locationId} onChange={e => update("locationId", e.target.value)}><option value="">Choose station / store</option>{locations.map(l => <option key={l.id} value={l.id}>{l.code} — {l.name}</option>)}</select></label></div>
          <label>Ad name<input value={form.adName} maxLength={200} onChange={e => update("adName", e.target.value)} placeholder="Calicut delivery service offer" /></label>
          <div className={styles.two}><label>Daily budget (₹)<input type="number" min="100" value={form.dailyBudget} onChange={e => update("dailyBudget", e.target.value)} /></label><label>Run for (days)<input type="number" min="1" max="90" value={form.daysRequired} onChange={e => update("daysRequired", e.target.value)} /></label></div>
          <label>Website destination<input type="url" value={form.destinationUrl} onChange={e => update("destinationUrl", e.target.value)} placeholder="https://your-service-page.example" /></label>
          <div className={`${styles.two} ${styles.mobileStack}`}><label>Headline<input maxLength={255} value={form.headline} onChange={e => update("headline", e.target.value)} /></label><label>Image · JPG, PNG or WebP<input type="file" accept="image/jpeg,image/png,image/webp" onChange={e => void upload(e.target.files?.[0])} /></label></div>
          <label>Ad text<textarea rows={2} maxLength={2000} value={form.primaryText} onChange={e => update("primaryText", e.target.value)} /></label>
          {preview ? <img className={styles.preview} src={preview} alt="Promotion image preview" /> : null}
        </section> : <div className={styles.adContext}><strong>{selected?.ad.ad_name}</strong><span>{selectedLocation?.code}</span></div>}
        {mode !== "delivery" ? <section className={styles.audience}>
          <h3>Audience</h3><PromotionDemographicFields value={form.demographics} onChange={value => update("demographics", value)} />
          {!validAge ? <p role="alert">Maximum age must be at least the minimum age.</p> : null}
          <MetaAudienceRadiusPicker value={form.audienceRadiusKm} disabled={busy} showHiringSettings={false} onChange={value => update("audienceRadiusKm", value)} />
          <MetaLocationPinPicker token={token} station={station} value={form.customPin} radiusKm={Number(form.audienceRadiusKm)} disabled={busy} scope={{ stream, locationId: form.locationId }} onChange={value => update("customPin", value)} />
          {point ? <small className={styles.pinSummary}>{form.customPin ? "Selected pin" : "Station pin"} · {point.latitude.toFixed(5)}, {point.longitude.toFixed(5)}</small> : null}
        </section> : <section className={styles.review}><h3>{delivery === "ACTIVE" ? "Start this promotion" : "Pause this promotion"}</h3><p>{money(Number(selected?.ad.draft.dailyBudget))} daily budget · Ends {date(selected?.ad.snapshot?.adset?.end_time)}</p><p>{delivery === "ACTIVE" ? "Delivery can start spending after Meta accepts the ad." : "This stops delivery of this ad."}</p>{delivery === "ACTIVE" ? <label className={styles.check}><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />Confirm this budget and end date.</label> : null}</section>}
        </div>
        {mode === "new" ? <label className={styles.check}><input type="checkbox" checked={confirmed} onChange={e => { setConfirmed(e.target.checked); setReview(null); }} />This ad, image and destination promote a service, customer offer or brand; they do not advertise jobs or another restricted opportunity.</label> : null}
        {review ? <section ref={reviewBox} className={styles.review}><strong>Review your {mode === "new" ? "promotion" : "audience change"}</strong><p>{form.demographics.gender === "all" ? "All genders" : form.demographics.gender === "male" ? "Men" : "Women"} · Ages {ageLabel(form.demographics.ageMin)}–{ageLabel(form.demographics.ageMax)} · {form.audienceRadiusKm} km · {point?.latitude.toFixed(5)}, {point?.longitude.toFixed(5)}</p>{mode === "new" ? <p>{money(Number(form.dailyBudget))} / day · {form.daysRequired} days · Website traffic · Learn more. Created paused; start it separately when ready.</p> : <p>The current promotion will use this audience after you save.</p>}</section> : null}
      </fieldset>}
    </div>
    <footer className={styles.footer}>{mode !== "list" ? <><button type="button" disabled={busy} onClick={() => { setMode("list"); setNotice(""); }}>Back</button><button type="button" className={styles.primary} disabled={busy || !canSubmit} onClick={() => void submit()}>{busy ? "Working…" : mode === "delivery" ? delivery === "ACTIVE" ? "Start promotion" : "Pause promotion" : review ? mode === "new" ? "Create paused promotion" : "Save audience" : "Review"}</button></> : <button type="button" disabled={busy || loading} onClick={() => void reload()}>Refresh list</button>}</footer>
  </dialog>;
}
