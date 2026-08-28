"use client";

import { useEffect, useRef, useState } from "react";
import { PlacementGallery } from "./MetaAdPublisher";

type Workspace = "workforce" | "hr";
type Props = {
  token: string;
  stream: Workspace;
  ad: any;
  close: () => void;
  afterReplace: () => Promise<void>;
};

function requestKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().replaceAll("-", "")
    : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function authHeaders(token: string, json = false) {
  const previewProfileId = typeof window === "undefined"
    ? ""
    : localStorage.getItem("dropx_recruitment_preview_profile") ?? "";
  return {
    Authorization: `Bearer ${token}`,
    ...(json ? { "Content-Type": "application/json" } : {}),
    ...(previewProfileId ? { "X-DropX-Preview-Profile": previewProfileId } : {})
  };
}

function statusLabel(value: unknown) {
  return String(value || "Unknown").replaceAll("_", " ").toLowerCase().replace(/^./, (letter) => letter.toUpperCase());
}

export default function MetaCreativeReplacement({ token, stream, ad, close, afterReplace }: Props) {
  const [context, setContext] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [success, setSuccess] = useState<any>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [uploadedUrl, setUploadedUrl] = useState("");
  const [imageHash, setImageHash] = useState("");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [posterMeta, setPosterMeta] = useState<{ name: string; width: number; height: number; size: number } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const clientRequestId = useRef(requestKey());
  const busy = uploading || saving;

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setNotice("");
    fetch(`/api/recruitment/ads/${encodeURIComponent(ad.id)}/creative`, {
      headers: authHeaders(token),
      cache: "no-store",
      signal: controller.signal
    }).then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to load the current creative.");
      if (active) setContext(payload);
    }).catch((error) => {
      if (active && error?.name !== "AbortError") setNotice(error instanceof Error ? error.message : "Unable to load the current creative.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [ad.id, token]);

  useEffect(() => () => {
    if (previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  async function uploadPoster(file: File) {
    setNotice("");
    setSuccess(null);
    setUploading(true);
    setImageHash("");
    setUploadedUrl("");
    try {
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
        throw new Error("Choose a JPG, PNG or WebP poster.");
      }
      if (!file.size || file.size > 12 * 1024 * 1024) throw new Error("Poster must be 12 MB or smaller.");
      const localUrl = URL.createObjectURL(file);
      setPreviewUrl(localUrl);
      const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
        image.onerror = () => reject(new Error("This image could not be read."));
        image.src = localUrl;
      });
      if (dimensions.width < 500 || dimensions.height < 500) {
        throw new Error("Use a poster of at least 500 × 500 px for clear placement previews.");
      }
      setPosterMeta({ name: file.name, width: dimensions.width, height: dimensions.height, size: file.size });
      const data = new FormData();
      data.append("stream", stream);
      data.append("file", file, file.name);
      const response = await fetch("/api/recruitment/meta-ad-builder/media", {
        method: "POST",
        headers: authHeaders(token),
        body: data
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to upload the replacement poster.");
      setImageHash(payload.imageHash || "");
      setUploadedUrl(payload.previewUrl || "");
      setNotice("Replacement poster uploaded. Review the current and proposed versions before applying it.");
    } catch (error) {
      setImageHash("");
      setUploadedUrl("");
      setNotice(error instanceof Error ? error.message : "Unable to upload the replacement poster.");
    } finally {
      setUploading(false);
    }
  }

  const canSubmit = Boolean(
    context?.eligible
      && context?.creative?.creativeId
      && imageHash
      && reason.trim().length >= 3
      && confirmed
      && !busy
  );

  async function replaceCreative() {
    if (!canSubmit) return;
    setSaving(true);
    setNotice("");
    try {
      const response = await fetch(`/api/recruitment/ads/${encodeURIComponent(ad.id)}/creative`, {
        method: "POST",
        headers: authHeaders(token, true),
        body: JSON.stringify({
          imageHash,
          replacementPosterUrl: uploadedUrl || null,
          expectedCreativeId: context.creative.creativeId,
          reason: reason.trim(),
          clientRequestId: clientRequestId.current
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to replace the Meta creative.");
      setSuccess(payload);
      setNotice("");
      await afterReplace();
    } catch (error) {
      clientRequestId.current = requestKey();
      setNotice(error instanceof Error ? error.message : "Unable to replace the Meta creative.");
    } finally {
      setSaving(false);
    }
  }

  const creative = context?.creative ?? {};
  const currentPoster = context?.ad?.currentPosterUrl || creative.posterUrl || "";

  return <div className="modal-backdrop meta-publisher-backdrop" onMouseDown={(event) => {
    if (event.currentTarget === event.target && !busy) close();
  }}>
    <section className="modal meta-direct-publisher creative-replace-modal" role="dialog" aria-modal="true" aria-label={`Replace creative for ${ad.ad_name || "Meta ad"}`}>
      <header className="modal-header">
        <div><span>EXISTING META AD</span><h2>Replace poster</h2><p>{ad.ad_name} · the ad, budget, audience and performance history stay in place.</p></div>
        <button type="button" aria-label="Close creative replacement" disabled={busy} onClick={close}>×</button>
      </header>
      {loading ? <div className="publisher-loading"><span className="loader"/><b>Loading the current live creative from Meta…</b></div> : null}
      {!loading && context ? <>
        <div className="creative-replacement-note">
          <div><span className={`ad-state ad-state-${String(context.ad.localStatus || "unknown").toLowerCase()}`}>{statusLabel(context.ad.localStatus)}</span><b>Same Meta Ad ID: {context.ad.metaAdId}</b></div>
          <p>Meta may review the replacement creative. An Active ad can temporarily stop delivering while that review is completed; a Paused ad remains paused.</p>
        </div>
        {!context.eligible ? <div className="error-banner">{context.blocker || "This creative cannot be replaced."}</div> : null}
        <div className="creative-compare-grid">
          <article className="creative-compare-card">
            <header><span>CURRENT</span><b>{creative.creativeName || "Current creative"}</b></header>
            {currentPoster ? <div className="creative-compare-image"><img src={currentPoster} alt={`Current poster for ${ad.ad_name}`}/></div> : <div className="creative-compare-empty">Current poster preview is unavailable.</div>}
            <small>Creative ID {creative.creativeId || "—"}</small>
          </article>
          <article className="creative-compare-card proposed">
            <header><span>REPLACEMENT</span><b>{posterMeta?.name || "Choose a new poster"}</b></header>
            <button type="button" className={`creative-replacement-upload ${previewUrl ? "has-poster" : ""}`} disabled={!context.eligible || busy} onClick={() => fileInput.current?.click()}>
              {previewUrl ? <img src={previewUrl} alt="Replacement poster preview"/> : <><i>＋</i><strong>Upload replacement poster</strong><small>JPG, PNG or WebP · up to 12 MB · minimum 500 × 500 px</small></>}
              {previewUrl ? <span>{uploading ? "Uploading to Meta…" : "Choose another poster"}</span> : null}
            </button>
            <input ref={fileInput} type="file" hidden accept="image/jpeg,image/png,image/webp" onChange={(event) => {
              const file = event.target.files?.[0];
              event.currentTarget.value = "";
              if (file) void uploadPoster(file);
            }}/>
            <small>{posterMeta ? `${posterMeta.width} × ${posterMeta.height} · ${(posterMeta.size / 1024 / 1024).toFixed(2)} MB` : "No replacement selected"}</small>
          </article>
        </div>
        {previewUrl && posterMeta ? <PlacementGallery image={previewUrl} headline={creative.headline || ad.ad_name || "Recruitment opening"} copy={creative.primaryText || "Join DropX Logistics. Apply now."} cta={creative.callToAction || "APPLY_NOW"} width={posterMeta.width} height={posterMeta.height}/> : null}
        <div className="creative-replacement-controls">
          <label>Reason for changing this creative<textarea rows={3} maxLength={500} value={reason} disabled={!context.eligible || busy || Boolean(success)} onChange={(event) => setReason(event.target.value)} placeholder="Example: Update the recruitment poster with the corrected contact number."/><small>{reason.trim().length}/500 · saved permanently in the audit log</small></label>
          <label className="creative-replacement-confirm"><input type="checkbox" checked={confirmed} disabled={!context.eligible || !imageHash || busy || Boolean(success)} onChange={(event) => setConfirmed(event.target.checked)}/><span><b>I reviewed the replacement preview</b><small>Apply only the new poster to this same Meta ad. Keep its targeting, budget and configured Active/Paused state.</small></span></label>
        </div>
        {context.recentChanges?.length ? <details className="creative-change-history"><summary>Recent poster changes ({context.recentChanges.length})</summary><div>{context.recentChanges.map((item: any) => <article key={item.id}><b>{statusLabel(item.status)} · {new Date(item.created_at).toLocaleString("en-IN")}</b><span>{item.reason}</span><small>{item.actor_email || "System"}</small></article>)}</div></details> : null}
      </> : null}
      {notice ? <div className={imageHash && !success ? "success-banner" : "error-banner"}>{notice}</div> : null}
      {success ? <div className="success-banner"><b>Poster replaced successfully.</b> The same Meta ad is now using creative {success.creativeId}. Current Meta state: {statusLabel(success.effectiveStatus)}.</div> : null}
      <footer className="publisher-actions">
        <button type="button" disabled={busy} onClick={close}>{success ? "Done" : "Cancel"}</button>
        {!success ? <button type="button" className="primary-action" disabled={!canSubmit} onClick={() => void replaceCreative()}>{saving ? "Replacing in Meta…" : uploading ? "Uploading poster…" : "Replace creative"}</button> : null}
      </footer>
    </section>
  </div>;
}
