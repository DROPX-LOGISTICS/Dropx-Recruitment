"use client";

import { useEffect, useRef, useState } from "react";
import { PlacementGallery } from "./MetaAdPublisher";
import { META_MEDIA_ACCEPT } from "@/lib/meta-media";
import { uploadCreativeFile, type CreativePreview } from "@/lib/meta-media-upload";

type Workspace = "workforce" | "hr";
type Props = {
  token: string;
  stream: Workspace;
  ad: any;
  close: () => void;
  afterReplace: () => Promise<void>;
  onRunAgain?: (schedule: { endsAt: string; startsAt: string | null }) => void;
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

export default function MetaCreativeReplacement({ token, stream, ad, close, afterReplace, onRunAgain }: Props) {
  const [context, setContext] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [success, setSuccess] = useState<any>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [uploadedUrl, setUploadedUrl] = useState("");
  const [imageHash, setImageHash] = useState("");
  const [videoId, setVideoId] = useState("");
  const [uploadStatus, setUploadStatus] = useState("");
  const [reason, setReason] = useState(String(ad?.recommendationReason || ""));
  const [confirmed, setConfirmed] = useState(false);
  const [posterMeta, setPosterMeta] = useState<CreativePreview | null>(null);
  const uploadController = useRef<AbortController | null>(null);
  useEffect(() => () => uploadController.current?.abort(), []);
  const fileInput = useRef<HTMLInputElement>(null);
  const clientRequestId = useRef(requestKey());
  const busy = uploading || saving;
  const completed = String(context?.creative?.deliveryStatus || ad.status).toUpperCase() === "COMPLETED";

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
    setVideoId("");
    setConfirmed(false);
    setPreviewUrl("");
    setPosterMeta(null);
    setUploadedUrl("");
    uploadController.current?.abort();
    const controller = new AbortController();
    uploadController.current = controller;
    try {
      const payload = await uploadCreativeFile({ file,stream,headers:authHeaders(token),signal:controller.signal,
        onPreview: preview => { setPreviewUrl(preview.url); setPosterMeta(preview); }, onStatus:setUploadStatus
      });
      setImageHash(payload.imageHash || "");
      setVideoId(payload.videoId || "");
      setUploadedUrl(payload.previewUrl || "");
      setNotice("Creative uploaded. Review the current and replacement versions before saving.");
    } catch (error) {
      setImageHash("");
      setUploadedUrl("");
      setVideoId(""); setPreviewUrl(""); setPosterMeta(null);
      if (!controller.signal.aborted) setNotice(error instanceof Error ? error.message : "Unable to upload the replacement creative.");
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
      && !success
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
          videoId: videoId || null,
          replacementPosterUrl: uploadedUrl || null,
          expectedCreativeId: context.creative.creativeId,
          ...(completed ? { expectedEndTime: context.creative.endsAt } : {}),
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
        <div><span>{completed ? "COMPLETED META AD · STEP 1 OF 2" : "EXISTING META AD"}</span><h2>{completed ? "Replace creative & run again" : "Replace creative"}</h2><p>{ad.ad_name} · {completed ? "Save the new creative, then choose a duration and budget for the next run." : "the ad, budget, audience and performance history stay in place."}</p></div>
        <button type="button" aria-label="Close creative replacement" disabled={busy} onClick={close}>×</button>
      </header>
      {loading ? <div className="publisher-loading"><span className="loader"/><b>Loading the current live creative from Meta…</b></div> : null}
      {!loading && context ? <>
        <div className="creative-replacement-note">
          <div><span className={`ad-state ad-state-${String(context.ad.localStatus || "unknown").toLowerCase()}`}>{statusLabel(context.ad.localStatus)}</span><b>Same Meta Ad ID: {context.ad.metaAdId}</b></div>
          <p>{completed ? "Saving the creative keeps this ad completed and holds its switch paused. The next step lets you review the new end date and budget before starting it. Meta may review the replacement before it delivers." : "Meta may review the replacement creative. An Active ad can temporarily stop delivering while that review is completed; a Paused ad remains paused."}</p>
        </div>
        {!context.eligible ? <div className="error-banner">{context.blocker || "This creative cannot be replaced."}</div> : null}
        <div className="creative-compare-grid">
          <article className="creative-compare-card">
            <header><span>CURRENT</span><b>{creative.creativeName || "Current creative"}</b></header>
            {creative.videoUrl ? <div className="creative-compare-image"><video src={creative.videoUrl} poster={currentPoster} controls playsInline preload="metadata" aria-label="Current video creative"/></div> : currentPoster ? <div className="creative-compare-image"><img src={currentPoster} alt={`Current creative for ${ad.ad_name}`}/></div> : <div className="creative-compare-empty">Current creative preview is unavailable.</div>}
            <small>Creative ID {creative.creativeId || "—"}</small>
          </article>
          <article className="creative-compare-card proposed">
            <header><span>REPLACEMENT</span><b>{posterMeta?.name || "Choose an image or video"}</b></header>
            {posterMeta?.kind === "video" && previewUrl ? <div className="creative-video-upload"><video src={previewUrl} controls playsInline preload="metadata" aria-label="Replacement video preview"/><button type="button" disabled={busy || Boolean(success)} onClick={() => fileInput.current?.click()}>Choose another file</button></div> : <button type="button" className={`creative-replacement-upload ${previewUrl ? "has-poster" : ""}`} disabled={!context.eligible || busy || Boolean(success)} onClick={() => fileInput.current?.click()}>
              {previewUrl ? <img src={previewUrl} alt="Replacement poster preview"/> : <><i>＋</i><strong>Upload image or video</strong><small>Images up to 12 MB · MP4/MOV up to 50 MB · 1 second–3 minutes</small></>}
              {previewUrl ? <span>{uploading ? "Uploading to Meta…" : "Choose another file"}</span> : null}
            </button>}
            <input ref={fileInput} type="file" hidden accept={META_MEDIA_ACCEPT} onChange={(event) => {
              const file = event.target.files?.[0];
              event.currentTarget.value = "";
              if (file) void uploadPoster(file);
            }}/>
            <small>{posterMeta ? `${posterMeta.width} × ${posterMeta.height} · ${(posterMeta.size / 1024 / 1024).toFixed(2)} MB` : "No replacement selected"}</small>
          </article>
        </div>
        {uploading ? <p className="success-banner" role="status">{uploadStatus}</p> : null}
        {previewUrl && posterMeta ? <PlacementGallery image={previewUrl} kind={posterMeta.kind} headline={creative.headline || ad.ad_name || "Recruitment opening"} copy={creative.primaryText || "Join DropX Logistics. Apply now."} cta={creative.callToAction || "APPLY_NOW"} width={posterMeta.width} height={posterMeta.height}/> : null}
        <div className="creative-replacement-controls">
          <label>Reason for changing this creative<textarea rows={3} maxLength={500} value={reason} disabled={!context.eligible || busy || Boolean(success)} onChange={(event) => setReason(event.target.value)} placeholder="Example: Update the recruitment poster with the corrected contact number."/><small>{reason.trim().length}/500 · saved permanently in the audit log</small></label>
          <label className="creative-replacement-confirm"><input type="checkbox" checked={confirmed} disabled={!context.eligible || !imageHash || busy || Boolean(success)} onChange={(event) => setConfirmed(event.target.checked)}/><span><b>I reviewed the replacement preview</b><small>{completed ? "Save this creative to the same ad and keep it stopped. I will choose the new duration and budget in the next step." : "Apply the new creative to this same Meta ad. Keep its targeting, budget and configured Active/Paused state."}</small></span></label>
        </div>
        {context.recentChanges?.length ? <details className="creative-change-history"><summary>Recent creative changes ({context.recentChanges.length})</summary><div>{context.recentChanges.map((item: any) => <article key={item.id}><b>{statusLabel(item.status)} · {new Date(item.created_at).toLocaleString("en-IN")}</b><span>{item.reason}</span><small>{item.actor_email || "System"}</small></article>)}</div></details> : null}
      </> : null}
      {notice ? <div className={imageHash && !success ? "success-banner" : "error-banner"}>{notice}</div> : null}
      {success ? <div className="success-banner" role="status"><b>Creative replaced successfully.</b> {completed ? "This ad remains completed. Continue to set its next run, or finish later. No new run has started." : `The same Meta ad is now using creative ${success.creativeId}. Current Meta state: ${statusLabel(success.effectiveStatus)}.`}</div> : null}
      <footer className="publisher-actions">
        <button type="button" disabled={busy} onClick={close}>{success ? completed ? "Finish later" : "Done" : "Cancel"}</button>
        {!success ? <button type="button" className="primary-action" disabled={!canSubmit} onClick={() => void replaceCreative()}>{saving ? "Replacing in Meta…" : uploading ? "Uploading creative…" : completed ? "Save creative" : "Replace creative"}</button> : null}
        {success && completed && onRunAgain ? <button type="button" className="primary-action" disabled={busy} onClick={() => onRunAgain({ endsAt: success.endsAt || context.creative.endsAt, startsAt: success.startsAt || context.creative.startsAt || null })}>Set duration & run again</button> : null}
      </footer>
    </section>
  </div>;
}
