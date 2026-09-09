"use client";
import { useEffect, useRef, useState } from "react";
import type { AdHealth, HealthIssue } from "@/lib/ad-health";
import { formatAdScheduleDate } from "@/lib/ad-schedule";

type HealthRow = AdHealth & { monitoring?: Array<{code:string;state:string;reviewAfter?:string}>; history?: Array<{at:string;label:string;status:string}> };
type Ad = {id:string;ad_name:string;status:string;health?:HealthRow;recruitment_locations?:{code?:string};recruitment_roles?:{code?:string}};
type Props = { ads:Ad[]; loading:boolean; available:boolean|null; checkedAt:string|null; period:{since:string;until:string}|null;
  canApply:boolean; canRequest:boolean; refresh:()=>void; action:(ad:Ad,issue:HealthIssue)=>void;
  monitor:(ad:Ad,issue:HealthIssue,reviewNow?:boolean)=>Promise<void>; diagnose:(ad:Ad)=>void };
const number = (value:number|null|undefined) => value == null ? "—" : Math.round(value).toLocaleString("en-IN");
const money = (value:number|null|undefined) => value == null ? "—" : `₹${number(value)}`;
const percent = (value:number|null|undefined) => value == null ? "—" : `${value.toFixed(2)}%`;
const dateLabel = (value:string) => new Date(`${value}T12:00:00Z`).toLocaleDateString("en-IN",{day:"numeric",month:"short"});
function watched(row:HealthRow,issue:HealthIssue) { return row.monitoring?.find(item => item.code === issue.code && item.state === "monitoring"); }
function needsAttention(row:HealthRow) { return row.issues.some(issue => issue.code !== "new_run_observation" && (!watched(row,issue) || issue.severity === "critical")); }

export default function AdHealthPanel({ads,loading,available,checkedAt,period,canApply,canRequest,refresh,action,monitor,diagnose}:Props) {
  const [tab,setTab] = useState("attention"), [limit,setLimit] = useState(6), [busy,setBusy] = useState(""), [notice,setNotice] = useState("");
  const running = ads.filter(ad => ad.health?.eligible);
  const attention = running.filter(ad => needsAttention(ad.health!)).sort((a,b)=>Number(b.health!.issues.some(issue=>issue.severity==="critical"))-Number(a.health!.issues.some(issue=>issue.severity==="critical")));
  const observing = running.filter(ad => ad.health!.state === "observing" || ad.health!.monitoring?.some(item => item.state === "monitoring"));
  const historyAds = ads.filter(ad => ad.health?.history?.length || ad.health?.monitoring?.length);
  const selected = tab === "attention" ? attention : tab === "monitoring" ? observing : tab === "history" ? historyAds : running;
  async function watch(ad:Ad,issue:HealthIssue,reviewNow=false) {
    setBusy(`${ad.id}:${issue.code}`);setNotice("");
    try {await monitor(ad,issue,reviewNow);setNotice(reviewNow?`${ad.ad_name}: returned to review. No ad settings changed.`:`${ad.ad_name}: watching for 48 hours. No ad settings changed.`);} catch(error) {setNotice(error instanceof Error ? error.message : "Unable to save monitoring.");} finally {setBusy("");}
  }
  return <section className="ad-health-panel" aria-label="Ad health and recommendations">
    <header className="ad-health-header"><div><span className="ad-health-eyebrow">DELIVERY & RESULTS</span><h3>Ad health</h3><p>Find where delivery or applications are falling short, then apply a specific fix.</p></div><button type="button" onClick={refresh} disabled={loading}>{loading ? "Checking…" : "Refresh checks"}</button></header>
    <div className="ad-health-context"><span>{period ? `${dateLabel(period.since)}–${dateLabel(period.until)} · 7 complete days` : "Last 7 complete days"} · today excluded from performance verdicts</span><small>{checkedAt ? `Checked ${formatAdScheduleDate(checkedAt)}` : "Waiting for Meta"} · rechecks every 5 min while open</small></div>
    <div className="ad-health-tabs" role="group" aria-label="Ad health views">{[["attention",`Needs attention (${attention.length})`],["monitoring",`Monitoring (${observing.length})`],["all",`All running (${running.length})`],["history",`Recent actions (${historyAds.length})`]].map(([key,label])=><button key={key} type="button" aria-pressed={tab===key} onClick={()=>{setTab(key);setLimit(6);}}>{label}</button>)}</div>
    {notice ? <p className="ad-health-notice" role="status">{notice}</p> : null}
    {available !== true ? <p className="ad-health-empty">{loading ? "Reading Meta delivery, reach and lead results…" : "Performance checks are unavailable. Refresh before making a spend decision; missing metrics do not mean zero leads."}</p> : <>
      {!selected.length ? <p className="ad-health-empty">{tab === "attention" ? "No ad-level issues need action in these filters. Check Monitoring for new or recently reviewed ads." : tab === "monitoring" ? "No ads are in an observation period in these filters." : tab === "history" ? "No recorded actions in the last 30 days in these filters." : "No running ads match these filters."}</p> : null}
      <div className="ad-health-list">{selected.slice(0,limit).map(ad => {
        const row = ad.health!, metrics = row.metrics, urgent = row.issues.some(issue => issue.severity === "critical");
        const primary = row.issues.find(issue => issue.code !== "new_run_observation") || row.issues[0];
        const current = row.eligible && ["ACTIVE","PAUSED"].includes(ad.status);
        return <details key={ad.id} className={`ad-health-card ${urgent ? "ad-health-critical" : ""}`}>
          <summary><span className="ad-health-identity"><b>{ad.ad_name}</b><small>{ad.recruitment_locations?.code || "Unmapped"} / {ad.recruitment_roles?.code || "Unmapped"}</small></span><span className="ad-health-verdict"><b>{primary?.title || (row.state === "inactive" ? "Run is not active" : "Within review thresholds")}</b><small>{row.issues.length ? `${row.issues.length} finding${row.issues.length === 1 ? "" : "s"}` : "No intervention suggested"} · view evidence and actions</small></span><span className="ad-health-glance"><b>{money(metrics.spend)}</b><small>review spend</small></span><span className="ad-health-glance"><b>{number(metrics.leads)}</b><small>Meta leads</small></span><span aria-hidden="true">⌄</span></summary>
          <div className="ad-health-detail"><p className="ad-health-window">{row.completeDays ? `${dateLabel(row.period.since)}–${dateLabel(row.period.until)} · ${row.completeDays} complete days` : "No complete day since the latest launch or change"}{row.lastChangeAt ? ` · Latest recorded change: ${row.lastChangeLabel}, ${formatAdScheduleDate(row.lastChangeAt)}` : ""}</p>
            <div className="ad-health-metrics">{[["Reach (unique)",number(metrics.reach)],["Impressions",number(metrics.impressions)],["Link clicks",number(metrics.linkClicks)],["Link click rate",percent(metrics.linkCtr)],["Cost / 1,000 impressions",money(metrics.cpm)],["Cost / Meta lead",money(metrics.cpl)],["Frequency",metrics.frequency?.toFixed(2)||"—"],["Click → lead",percent(metrics.clickToLead)]].map(([label,value])=><div key={label}><small>{label}</small><strong>{value}</strong></div>)}</div>
            {metrics.reach == null ? <small className="ad-health-muted">Unique reach is unavailable for this adjusted window; daily reach is not added together.</small> : null}
            <div className="ad-health-issues">{row.issues.map(issue => {
              const watchState = watched(row,issue);
              const allowAction = issue.action === "diagnose" || (current && (issue.action === "replace_creative" ? canApply : canRequest));
              return <article key={issue.code} className={`ad-health-issue issue-${issue.severity}`}><div className="ad-health-issue-title"><h4>{issue.title}</h4><span>{watchState ? "Watching" : issue.severity === "notice" ? "Observe" : issue.severity === "critical" ? "Priority" : "Review"}</span></div><b className="ad-health-evidence">{issue.evidence}</b><p>{issue.explanation}</p><p><strong>Suggested next step:</strong> {issue.suggestion}</p><div className="ad-health-issue-actions">{allowAction ? <button type="button" className="primary-action" disabled={loading} onClick={()=>issue.action === "diagnose" ? diagnose(ad) : action(ad,issue)}>{issue.action === "pause" && !canApply ? "Request pause" : issue.actionLabel}</button> : <small>Ask an ad administrator to apply this change.</small>}{issue.action !== "diagnose" ? <button type="button" onClick={()=>diagnose(ad)}>Check delivery</button> : null}{canApply && watchState ? <button type="button" disabled={Boolean(busy)||loading} onClick={()=>void watch(ad,issue,true)}>Review now</button> : null}{canApply && !watchState && issue.code !== "ending_soon" ? <button type="button" disabled={Boolean(busy)||loading} onClick={()=>void watch(ad,issue)}>{busy === `${ad.id}:${issue.code}` ? "Saving…" : "Watch for 48 hours"}</button> : null}</div><small className="ad-health-followup">{watchState?.reviewAfter ? `Review due ${formatAdScheduleDate(watchState.reviewAfter)}. ` : ""}{issue.followUp}</small></article>;
            })}</div>
            {!row.issues.length ? <p>No change suggested from the current evidence. Delivery and results can still vary.</p> : null}
            {row.monitoring?.length ? <div className="ad-health-timeline"><h4>Reviews</h4>{row.monitoring.map(item=><p key={item.code}><strong>{item.code.replaceAll("_"," ")}</strong> · {item.state === "cleared" ? "Signal cleared on the latest check" : item.state === "due" ? "Review due — check the latest evidence" : item.state === "inactive" ? "Ad no longer running" : `Watching until ${item.reviewAfter ? formatAdScheduleDate(item.reviewAfter) : "next review"}`}</p>)}</div> : null}
            {row.history?.length ? <div className="ad-health-timeline"><h4>Recorded actions</h4>{row.history.map((item,index)=><p key={`${item.at}:${index}`}><strong>{item.label}</strong> · {item.status} · {formatAdScheduleDate(item.at)}</p>)}</div> : null}
          </div>
        </details>;
      })}</div>
      {selected.length > limit ? <button className="ad-health-more" type="button" onClick={()=>setLimit(value=>value+6)}>Show more ({selected.length-limit})</button> : null}
    </>}
    <details className="ad-health-method"><summary>How these checks work</summary><p>Checks use Meta's completed-day results, current schedules and recorded Recruit changes. They run independently of lead follow-up. Low impressions can come from low spend, expensive auctions, a limited audience or a delivery restriction. Weak link response and form conversion are checked separately.</p><p>Review triggers include less than 35% of the current budget reference spent, a 50% increase in cost per 1,000 impressions, link click rate below 0.7% after 3,000 impressions, and fewer than 2 leads per 100 link clicks after 80 clicks. Spend-without-lead and cost-per-lead limits use your existing company policy. These are diagnostic triggers, not guaranteed causes. Shared budgets and recent changes are taken into account.</p><p>Reach is unique within each ad's review window. Meta leads are attributed results and may differ from unique Recruit candidates. Pauses and replacements use the existing review and audit flows. Watching an ad changes no Meta settings.</p></details>
  </section>;
}

export function AdDeliveryDiagnostics({ad,token,close}:{ad:Ad;token:string;close:()=>void}) {
  const [data,setData]=useState<any>(null), [error,setError]=useState("");
  const dialog=useRef<HTMLElement>(null);
  useEffect(()=>{const previous=document.activeElement as HTMLElement|null;dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();return()=>previous?.focus();},[]);
  useEffect(()=>{
    const controller=new AbortController();
    const preview=localStorage.getItem("dropx_recruitment_preview_profile");
    fetch(`/api/recruitment/ads/${encodeURIComponent(ad.id)}/diagnostics`,{headers:{Authorization:`Bearer ${token}`,...(preview?{"X-DropX-Preview-Profile":preview}:{})},signal:controller.signal,cache:"no-store"})
      .then(async response=>{const payload=await response.json();if(!response.ok)throw new Error(payload.error||"Unable to check delivery.");setData(payload);})
      .catch(error=>{if(error?.name!=="AbortError")setError(error.message);});
    return()=>controller.abort();
  },[ad.id,token]);

  return <div className="modal-backdrop"><section ref={dialog} className="modal ad-diagnostics-modal" onKeyDown={event=>{
    if(event.key==="Escape"){event.stopPropagation();close();}
    if(event.key==="Tab"){const items=dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href]');if(!items?.length)return;const first=items[0],last=items[items.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}
  }} role="dialog" aria-modal="true" aria-label={`Delivery checks for ${ad.ad_name}`}><header className="modal-header"><div><h2>Delivery checks</h2><p>{ad.ad_name}</p></div><button type="button" onClick={close} aria-label="Close delivery checks">×</button></header><div className="ad-diagnostics-body">{error ? <p role="alert" className="error-banner">{error}</p> : !data ? <p role="status">Reading the live ad, campaign, budget and station pin…</p> : <><p className="ad-health-window">Checked {formatAdScheduleDate(data.checkedAt)}</p>{data.checks.map((check:any)=><article key={check.label} className={`ad-diagnostic-check check-${check.tone}`}><small>{check.label}</small><strong>{check.value}</strong><p>{check.detail}</p></article>)}<p>{data.note}</p></>}</div><footer><button type="button" onClick={close}>Close</button>{data?.metaUrl ? <a className="primary-action" href={data.metaUrl} target="_blank" rel="noreferrer">Open this ad in Meta</a> : null}</footer></section></div>;
}
