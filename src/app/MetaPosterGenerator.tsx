"use client";
import { useEffect, useRef, useState } from "react";
import { recruitmentClientHeaders } from "@/lib/recruitment-client-headers";
import { POSTER_FORMATS, POSTER_LANGUAGES, POSTER_STYLES, validatePosterInput, type PosterInput } from "@/lib/recruitment-poster";
import SearchableAdSelect from "./SearchableAdSelect";
import styles from "./MetaPosterGenerator.module.css";

type Props = { token: string; stream: "hr" | "workforce"; location: { id: string; name: string }; role: { id: string; name: string }; onUse: (file: File) => void; close: () => void };
export default function MetaPosterGenerator({ token, stream, location, role, onUse, close }: Props) {
  const [form, setForm] = useState<PosterInput>({ language: "English", format: "story", style: "clean", phone: "85475 76282", email: stream === "hr" ? "hr@dropxlogistics.com" : "", details: "", instructions: "Light background, clear typography and contact number across the middle.", referenceAdId: "" });
  const [brand, setBrand] = useState("Checking location branding…");
  const [references, setReferences] = useState<Array<{ id: string; name: string; roleId: string }>>([]);
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ url: string; file: File; width: number; height: number } | null>(null);
  const generation = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/recruitment/poster-generator?stream=${stream}&locationId=${location.id}&roleId=${role.id}`, { headers: recruitmentClientHeaders(token), signal: controller.signal, cache: "no-store" }).then(async response => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to load previous designs.");
      setBrand(payload.brand?.label || "DropX Logistics"); setReferences(payload.references || []); setEnabled(payload.enabled === true);
    }).catch(error => { if (!controller.signal.aborted) { setError(error.message); setEnabled(false); } }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); generation.current?.abort(); };
  }, [stream, token, location.id, role.id]);
  useEffect(() => () => { if (result) URL.revokeObjectURL(result.url); }, [result]);
  function update<K extends keyof PosterInput>(key: K, value: PosterInput[K]) { setForm(current => ({ ...current, [key]: value })); setResult(null); setError(""); }
  async function generate() {
    try { validatePosterInput(form); } catch (error) { setError(error instanceof Error ? error.message : "Check the poster details."); return; }
    generation.current?.abort();
    const controller = new AbortController(); generation.current = controller;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/recruitment/poster-generator", { method: "POST", headers: { ...recruitmentClientHeaders(token), "Content-Type": "application/json" }, body: JSON.stringify({ ...form, stream, locationId: location.id, roleId: role.id }), signal: controller.signal });
      if (!response.ok) { const payload = await response.json().catch(() => ({})); throw new Error(payload.error || "Poster generation failed. Please try again."); }
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      if (blob.type !== "image/jpeg" || !blob.size) throw new Error("No usable poster was returned. Please try again.");
      const size = POSTER_FORMATS[form.format];
      const name = `DropX-${role.name.replace(/[^a-z0-9]+/gi,"-")}-${form.language}-${size.width}x${size.height}.jpg`;
      setResult({ file: new File([blob], name, { type: "image/jpeg" }), url: URL.createObjectURL(blob), width: size.width, height: size.height });
    } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Unable to generate a poster."); }
    finally { if (generation.current === controller) setBusy(false); }
  }
  return <section className={styles.panel} aria-label="Generate recruitment poster">
    <header><div><small>AI POSTER STUDIO</small><h3>Generate a recruitment poster</h3><p>{role.name} · {location.name}</p></div><button type="button" onClick={close} aria-label="Close poster generator">×</button></header>
    <p className={styles.help}>Choose a language and style, or use a previous ad as a design reference. Your selected role, location and contact details will replace the old details.</p>
    <fieldset disabled={busy || loading || !enabled}>
      <div className={styles.two}><label>Language<select value={form.language} onChange={e => update("language", e.target.value as PosterInput["language"])}>{POSTER_LANGUAGES.map(language => <option key={language}>{language}</option>)}</select></label><label>Style<select value={form.style} onChange={e => update("style", e.target.value as PosterInput["style"])}>{Object.entries(POSTER_STYLES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
      <div className={styles.brandNote}><b>1080 × 1920 px · 9:16</b><span>DropX logo and brand colours are included automatically. Every poster uses this size.</span><small>Feed crops can differ; check the placement preview before launch.</small></div>
      <div className={styles.brandNote}><b>{brand}</b><small>Branding follows the selected station’s provider and operating model. Original logos are included automatically. Unmapped locations use DropX only.</small></div>
      <SearchableAdSelect label="Design reference" value={form.referenceAdId} onChange={value => update("referenceAdId", value)} options={[{ value: "", label: "Fresh design · no previous poster" }, ...[...references].sort((a,b) => Number(b.roleId === role.id) - Number(a.roleId === role.id)).map(item => ({ value: item.id, label: item.name }))]} />
      <div className={styles.two}><label>Contact number<input type="tel" value={form.phone} maxLength={24} onChange={e => update("phone", e.target.value)} /></label><label>Resume email (optional)<input type="email" value={form.email} maxLength={180} onChange={e => update("email", e.target.value)} /></label></div>
      <label>Details to include<textarea rows={3} maxLength={1500} value={form.details} onChange={e => update("details", e.target.value)} placeholder="Experience required, salary or benefits — include only confirmed details."/><small>Leave out details you do not want printed. The AI will translate your wording into the selected language.</small></label>
      <label>Design instructions<textarea rows={2} maxLength={800} value={form.instructions} onChange={e => update("instructions", e.target.value)} placeholder="Describe the design you want, or changes for the next version."/></label>
    </fieldset>
    {loading ? <p role="status">Loading previous designs…</p> : !enabled ? <p role="status">AI generation is not configured for this deployment. You can still upload a poster.</p> : null}
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
    <div className={styles.actions}><button type="button" className={styles.primary} disabled={busy || loading || !enabled} onClick={() => void generate()}>{busy ? "Generating poster…" : result ? "Regenerate poster" : "Generate poster"}</button>{busy ? <button type="button" onClick={() => { generation.current?.abort(); setBusy(false); }}>Cancel generation</button> : null}</div>
    {busy ? <p role="status" className={styles.help}>Creating your poster. This may take about a minute.</p> : null}
    {result ? <div className={styles.result}><img src={result.url} alt={`Generated ${form.language} poster for ${role.name}`}/><p>{result.width} × {result.height} px · Check the wording, contact details and logos before use.</p><div className={styles.actions}><button type="button" className={styles.primary} disabled={busy} onClick={() => onUse(result.file)}>Use this poster</button><a href={result.url} download={result.file.name}>Download JPG</a></div></div> : null}
  </section>;
}
