"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { daDependencyLabel, daSubStatusOptions } from "@/lib/da-inapp-onboarding";
import { workforceStatusFilterOptions } from "@/lib/recruitment-workforce-status-filter";
import {
  matchingMetaFormsForDesignation,
  recommendedMetaFormForDesignation
} from "@/lib/meta-form-matching";
import { activeCompanyUserOptions, isRecruitmentUserWorkspaceEnabled } from "@/lib/recruitment-user-workspaces";
import { workspaceRoleCatalog } from "@/lib/recruitment-role-catalog";
import { HR_PIPELINE_STAGES, candidateJourney, hrLifecycleFilterOptions, hrQueueStatusQuery } from "@/lib/hr-ats-product";
import { allowedHrFirstCallOutcomeCodes } from "@/lib/hr-recruitment-lifecycle";
import {
  WORKFORCE_ACTIVE_INTERVIEW_STATUS_QUERY,
  workforceInterviewActionOptions,
  workforceInterviewFilterOptions
} from "@/lib/workforce-interview-lifecycle";
import {
  workforceOnboardingStage,
  workforceOnboardingStatusLabel
} from "@/lib/workforce-profile-changes";
import AuthPanel from "./AuthPanel";
import FieldRouteMap from "./FieldRouteMap";
import MetaAdPublisher from "./MetaAdPublisher";
import { AiFitReviewWorkspace, JobRequisitionsWorkspace, ResumeIntakeWorkspace } from "./RecruitmentHiringWorkspace";

const MetaCreativeReplacement = dynamic(() => import("./MetaCreativeReplacement"), { ssr: false });

type RecruitmentMenuAccessLevel = "none"|"view"|"edit"|"all";
type RecruitmentPermissionAction = "view"|"add"|"edit";
type RecruitmentMenuActionGrant = Record<RecruitmentPermissionAction,boolean>;
type User = { profileId: string; name: string | null; email: string | null; workforce: boolean; hr: boolean; allLocations: boolean; manageMasters: boolean; manageAds: boolean; manageUsers: boolean; accessTemplate?: string; menuPermissions?: string[]; webMenuPermissions?: string[]; mobileMenuPermissions?: string[]; menuAccess?: Record<"workforce"|"hr",Record<string,RecruitmentMenuAccessLevel>>; menuActions?: Record<"workforce"|"hr",Record<string,RecruitmentMenuActionGrant>>; adRequestActions?: string[]; recruitmentFunction?: "telecaller"|"field_recruiter"|"influencer"|"manager"|"viewer"; trackPerformance?: boolean; reportingManagerProfileId?: string|null; designationCode?: string|null; isOwner?: boolean; canPreviewUsers?: boolean; isPreview?: boolean; viewerProfileId?: string; previewProfileId?: string|null; readOnly?: boolean };
type Metrics = { total: number; noStatus: number; noResponse: number; callBack: number; interviews: number; joined: number; pending24h: number; unmapped: number };
type Lead = {
  id: string; full_name: string | null; phone: string | null; email: string | null; city: string | null; post_code: string | null; ad_name: string | null;
  source: string | null; status: string; remarks: string | null; archived: boolean; lead_created_at: string | null; updated_at: string | null;
  location_id?: string | null; role_id?: string | null;
  callback_at: string | null; follow_up_at: string | null; duplicate_count: number;
  total_attempts: number; no_response_attempts: number; call_back_attempts: number;
  assigned_profile_id?: string | null;
  assigned_profile?: { id: string; full_name: string | null; email: string | null } | null;
  last_updated_by?: string | null;
  last_updated_profile?: { id: string; full_name: string | null; email: string | null } | null;
  recruitment_locations: { code: string; name: string } | null;
  recruitment_roles: { code: string; name: string } | null;
};
type LeadDetail = { lead: any; history: any[]; interviews?: any[]; messages: any[]; sources: any[]; documents?: any[] };

const metricLabels: Array<[keyof Metrics, string]> = [
  ["total","Total Leads"],["noStatus","No Status"],["noResponse","No Response"],["callBack","Call Back"],
  ["interviews","Interviews"],["joined","Joined"],["pending24h","24H+ Pending"],["unmapped","Unmapped"]
];
const emptyLeadFilters = {
  status: "",
  finalStatus: "",
  station: "",
  cluster: "",
  role: "",
  updatedAge: "",
  interviewFrom: "",
  interviewTo: "",
  stale24: false
};
const headers = (token: string) => {
  const previewProfileId = typeof window === "undefined"
    ? ""
    : localStorage.getItem("dropx_recruitment_preview_profile") ?? "";
  return {
    Authorization: `Bearer ${token}`,
    ...(previewProfileId ? { "X-DropX-Preview-Profile": previewProfileId } : {})
  };
};
const istDate = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit"
}).format(new Date());
const localInputToIso = (value: string | null | undefined) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};
const isoToLocalInput = (value: string | null | undefined) => {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
};
const phoneDigits = (value: string | null | undefined) => String(value ?? "").replace(/\D/g, "").slice(-10);
const displayPhone = (value: string | null | undefined) => {
  const digits = phoneDigits(value);
  return digits.length === 10 ? `+91 ${digits.slice(0, 5)} ${digits.slice(5)}` : (value || "No phone");
};
const sourceChannel = (value: string | null | undefined) => {
  const normalized = String(value ?? "").toLowerCase();
  if (!normalized) return "—";
  if (normalized.includes("instagram") || normalized.includes("insta")) return "Instagram";
  if (normalized.includes("meta")) return "Meta direct";
  if (normalized.includes("sheet") || normalized.includes("legacy")) return "Legacy sync";
  if (normalized.includes("facebook") || normalized === "fb") return "Facebook";
  return String(value).replaceAll("_", " ");
};
const statusLabel = (value: string | null | undefined) => {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized === "__BLANK__") return "No Status";
  return normalized
    .split("_")
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`)
    .join(" ");
};
const performanceStatusColumns = (rows: any[], limit = 5) => {
  const totals = new Map<string, number>();
  rows.forEach((row) => Object.entries(row?.statusCounts ?? {}).forEach(([status, count]) => {
    totals.set(status, (totals.get(status) ?? 0) + Number(count ?? 0));
  }));
  const ranked = [...totals.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  return { visible: ranked.slice(0, limit), hidden: new Set(ranked.slice(limit).map(([status]) => status)) };
};
const hiddenStatusCount = (row: any, hidden: Set<string>) => [...hidden].reduce((sum, status) => sum + Number(row?.statusCounts?.[status] ?? 0), 0);
const statusShare = (count: number, attended: number) => attended ? `${Math.round(count / attended * 100)}%` : "0%";
const statusTone = (status: string) => {
  if (["joined","selected","interview_completed"].includes(status)) return "positive";
  if (["interview_scheduled","interview_rescheduled","call_back"].includes(status)) return "active";
  if (["no_response","long_distance","not_interested","not_fit","wrong_number","rejected"].includes(status)) return "risk";
  return "neutral";
};
const leadHistoryDescription = (event: any) => {
  if (event?.remarks) return String(event.remarks);
  if (event?.field_name && event?.old_value !== event?.new_value) {
    return `${String(event.field_name).replaceAll("_", " ")}: ${event.old_value || "—"} → ${event.new_value || "—"}`;
  }
  return event?.new_value ? String(event.new_value) : "Recorded";
};

function OutcomeStrip({ rows, total }: { rows:any[]; total:number }) {
  const ranked = (rows ?? []).filter((item:any)=>Number(item.count ?? 0) > 0);
  const visible = ranked.slice(0, 6);
  const other = ranked.slice(6).reduce((sum:number,item:any)=>sum + Number(item.count ?? 0),0);
  const display = other ? [...visible,{status:"others",count:other}] : visible;
  return <section className="outcome-strip-card">
    <header><div><span>OUTCOME MIX</span><h3>Where today&apos;s work landed</h3></div><strong>{Number(total||0).toLocaleString("en-IN")} attended</strong></header>
    <div className="outcome-segments" aria-label="Recruiter outcome distribution">
      {display.map((item:any)=><i className={`outcome-${statusTone(item.status)}`} key={item.status} style={{width:`${total ? Math.max(3,Number(item.count||0)/total*100) : 0}%`}} title={`${statusLabel(item.status)}: ${item.count}`}/>) }
    </div>
    <div className="outcome-legend">{display.map((item:any)=><span key={item.status} className={`outcome-${statusTone(item.status)}`}><i/><b>{statusLabel(item.status)}</b><strong>{Number(item.count||0).toLocaleString("en-IN")}</strong><small>{statusShare(Number(item.count||0),total)}</small></span>)}</div>
    {!display.length?<p className="empty-inline">No recorded recruiter actions for the selected day.</p>:null}
  </section>;
}

function PerformanceBreakdownCards({ rows, includeRecruiter=false }: { rows:any[]; includeRecruiter?:boolean }) {
  return <div className="performance-breakdown-mobile">
    {rows.map((item:any)=>{
      const ranked=Object.entries(item.statusCounts??{}).sort((left:any,right:any)=>Number(right[1])-Number(left[1]));
      const visible=ranked.slice(0,5);
      const others=ranked.slice(5).reduce((sum,[,count])=>sum+Number(count??0),0);
      return <article key={`${item.recruiterProfileId??"self"}-${item.station}-${item.designation}`}>
        <header><div>{includeRecruiter?<small>{item.recruiter}</small>:null}<b>{item.station}</b><span>{item.designation}</span></div><strong>{Number(item.attended||0).toLocaleString("en-IN")}<small>attended</small></strong></header>
        <div>{visible.map(([status,count]:any)=><span className={`outcome-${statusTone(status)}`} key={status}><b>{statusLabel(status)}</b><strong>{Number(count||0).toLocaleString("en-IN")}</strong></span>)}{others?<span className="outcome-neutral"><b>Others</b><strong>{others}</strong></span>:null}</div>
      </article>;
    })}
  </div>;
}

export default function RecruitmentApp() {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [active, setActive] = useState("Dashboard");
  const [stream, setStream] = useState<"workforce" | "hr">("workforce");
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [moduleData, setModuleData] = useState<any>(null);
  const [selectedLead, setSelectedLead] = useState<LeadDetail | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const loadVersion = useRef(0);
  const loadController = useRef<AbortController | null>(null);
  const detailCache = useRef(new Map<string, LeadDetail>());
  const detailRequestVersion = useRef(0);
  const pendingCandidateOpen = useRef<string | null>(null);
  const [adRequest, setAdRequest] = useState<{ type: "new_ad" | "budget_change" | "stop_ad" | "resume_ad"; ad?: any } | null>(null);
  const [directAdPublisher, setDirectAdPublisher] = useState(false);
  const [options, setOptions] = useState<any>({ locations: [], roles: [], statuses: [], workforceStatuses: [], finalStatuses: [], assignees: [] });
  const [filters, setFilters] = useState(emptyLeadFilters);
  const [facets, setFacets] = useState<any>(null);
  const [previewUsers, setPreviewUsers] = useState<any[]>([]);

  useEffect(() => {
    const saved = localStorage.getItem("recruitment_session");
    if (!saved) return setChecking(false);
    Promise.all([
      fetch(`/api/mobile/bootstrap?v=${Date.now()}`, { headers: headers(saved), cache: "no-store" }),
      fetch("/api/recruitment/options", { headers: headers(saved), cache:"no-store" })
    ]).then(async ([sessionResponse,optionsResponse])=>{
      if(!sessionResponse.ok)throw new Error();
      return {session:await sessionResponse.json(),options:optionsResponse.ok?await optionsResponse.json():null};
    }).then(({session,options:loadedOptions})=>{
      const initialStream: "workforce"|"hr" = session.user.workforce?"workforce":session.user.hr?"hr":"workforce";
      const firstMenu = session.user.recruitmentFunction==="influencer"
        ? "Influencer Performance"
        : Object.entries(session.user.menuAccess?.[initialStream]??{}).find(([,level])=>level!=="none")?.[0]??"Dashboard";
      setToken(saved);setUser(session.user);setStream(initialStream);setActive(firstMenu);
      if(loadedOptions)setOptions(loadedOptions);
    })
      .catch(() => localStorage.removeItem("recruitment_session"))
      .finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    if (!token || !user?.canPreviewUsers) return;
    fetch(`/api/recruitment/preview-users?v=${Date.now()}`, { headers: headers(token), cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error);
        return payload;
      })
      .then((payload) => setPreviewUsers(payload.users ?? []))
      .catch(() => setPreviewUsers([]));
  }, [token, user?.canPreviewUsers]);

  const refreshOptions = useCallback(async () => {
    if (!token) return;
    const response = await fetch("/api/recruitment/options", {
      headers: headers(token),
      cache: "no-store"
    });
    if (!response.ok) return;
    setOptions(await response.json());
  }, [token]);

  function changePreview(profileId: string) {
    if (profileId) localStorage.setItem("dropx_recruitment_preview_profile", profileId);
    else localStorage.removeItem("dropx_recruitment_preview_profile");
    location.reload();
  }

  const load = useCallback(async (overrides?: {
    page?: number;
    filterValues?: typeof emptyLeadFilters;
    searchValue?: string;
  }) => {
    if (!token) return;
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    const requestVersion = ++loadVersion.current;
    const effectivePage = overrides?.page ?? page;
    const effectiveFilters = overrides?.filterValues ?? filters;
    const effectiveSearch = overrides?.searchValue ?? search;
    setBusy(true); setError("");
    try {
      if (active === "Dashboard") {
        const params = new URLSearchParams();
        params.set("stream", stream);
        params.set("menu", active);
        if (effectiveFilters.station) params.set("station", effectiveFilters.station);
        if (effectiveFilters.cluster) params.set("cluster", effectiveFilters.cluster);
        if (effectiveFilters.role) params.set("role", effectiveFilters.role);
        const summaryParams = new URLSearchParams(params);
        summaryParams.set("mode", "summary");
        const summaryResponse = await fetch(`/api/recruitment/dashboard?${summaryParams}`, {
          headers: headers(token), cache: "no-store", signal: controller.signal
        });
        const summary = await summaryResponse.json();
        if (!summaryResponse.ok) throw new Error(summary.error);
        if (requestVersion !== loadVersion.current) return;
        setMetrics(summary.metrics);
        setModuleData({ metrics: summary.metrics, loadingDetails: true });
        setBusy(false);

        const response = await fetch(`/api/recruitment/dashboard${params.size ? `?${params}` : ""}`, {
          headers: headers(token), cache: "no-store", signal: controller.signal
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error);
        if (requestVersion !== loadVersion.current) return;
        setMetrics(payload.metrics); setModuleData(payload);
      } else if (active === "My Interviews") {
        const params = new URLSearchParams({ limit: "50", page: String(effectivePage), status: "scheduled,rescheduled" });
        if (effectiveFilters.interviewFrom) params.set("from", effectiveFilters.interviewFrom);
        if (effectiveFilters.interviewTo) params.set("to", effectiveFilters.interviewTo);
        const response = await fetch(`/api/recruitment/interviews?${params}`, {
          headers: headers(token), cache: "no-store", signal: controller.signal
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error);
        if (requestVersion !== loadVersion.current) return;
        setModuleData(payload);
        setTotal(payload.total ?? 0);
      } else if (["All Leads","Archived Leads","No Response / Call Back","Interviews","Unmapped","Screening","Documents","Offers","Hired"].includes(active)) {
        const params = new URLSearchParams({ limit: "50", page: String(effectivePage) });
        // The lead API authorizes the exact queue/menu being opened. Keep this
        // on every Workforce and HR list request so Owner, View, Edit and All
        // grants are evaluated against the intended queue instead of being
        // rejected as an unidentified request.
        params.set("menu", active);
        const status = active === "No Response / Call Back" ? "no_response,call_back"
          : active === "Interviews" && stream === "workforce" ? WORKFORCE_ACTIVE_INTERVIEW_STATUS_QUERY
          : stream === "hr" ? hrQueueStatusQuery(active)
          : "";
        params.set("stream", stream);
        if (active === "Archived Leads") params.set("archive", "archived");
        if (status) params.set("status", status);
        if (effectiveFilters.status) params.set("status", effectiveFilters.status);
        if (effectiveFilters.station) params.set("station", effectiveFilters.station);
        if (effectiveFilters.cluster) params.set("cluster", effectiveFilters.cluster);
        if (effectiveFilters.role) params.set("role", effectiveFilters.role);
        if (active === "No Response / Call Back" && effectiveFilters.updatedAge) params.set("updatedAge", effectiveFilters.updatedAge);
        if (active === "Interviews" && effectiveFilters.interviewFrom) params.set("interviewFrom", effectiveFilters.interviewFrom);
        if (active === "Interviews" && effectiveFilters.interviewTo) params.set("interviewTo", effectiveFilters.interviewTo);
        if (active === "Interviews" && stream === "hr" && effectiveFilters.finalStatus) params.set("finalStatus", effectiveFilters.finalStatus);
        if (effectiveFilters.stale24) params.set("stale24", "true");
        if (active === "Unmapped") params.set("unmapped", "true");
        if (effectiveSearch.trim()) params.set("search", effectiveSearch.trim());
        const response = await fetch(`/api/recruitment/leads?${params}`, {
          headers: headers(token), cache: "no-store", signal: controller.signal
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error);
        if (requestVersion !== loadVersion.current) return;
        // A filter, page or queue change can remove the selected candidate.
        // Cancel any older detail request and clear that selection so a late
        // response can never render one candidate under another candidate's
        // highlighted row.
        detailRequestVersion.current += 1;
        setLeads(payload.leads);
        setSelectedLead((current) => current && payload.leads.some((lead: Lead) => lead.id === current.lead.id)
          ? current
          : null);
        setDetailBusy(false);
        setTotal(payload.total);
        if (payload.facets) setFacets(payload.facets);
        if (pendingCandidateOpen.current) {
          const candidateId = pendingCandidateOpen.current;
          pendingCandidateOpen.current = null;
          await openLead(candidateId, true);
        }
      } else {
        const endpoint = active === "Job Requisitions" ? "requisitions" : ["Resume Intake","AI Fit Review"].includes(active) ? "applications" : active === "Active Ads" ? "ads" : active === "Ad Requests" ? "ad-requests" : active === "Reports" ? "reports" : active === "Recruiter Performance" ? "recruiter-performance" : active === "Field Recruitment" ? "field-duty" : active === "Field Executive Onboarding" ? "field-executives" : active === "Incentive Master" ? "incentives" : active === "Master Reports" ? "master-reports" : ["Station Directory","Station Contacts","Roles","Lead Status Master","HR Lifecycle","Notification Rules"].includes(active) ? "masters" : ["User Master","User Roles","Access Control"].includes(active) ? "access" : active === "Connections" ? "connections" : active === "System Health" ? "system-health" : active === "Audit" ? "audit" : "";
        if (endpoint) {
          const reportStream = endpoint === "applications"
            ? `?menu=${encodeURIComponent(active)}`
            : ["reports","ads","ad-requests"].includes(endpoint)
            ? `?stream=${stream}`
            : endpoint === "field-duty"
              ? `?from=${istDate().slice(0,7)}-01&to=${istDate()}`
            : endpoint === "masters"
              ? `?resource=${encodeURIComponent(active)}&stream=${stream}`
              : "";
          const response = await fetch(`/api/recruitment/${endpoint}${reportStream}`, { headers: headers(token) });
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error);
          if (requestVersion !== loadVersion.current) return;
          setModuleData(payload);
        }
      }
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      if (requestVersion === loadVersion.current) {
        setError(caught instanceof Error ? caught.message : "Unable to load data.");
      }
    } finally {
      if (requestVersion === loadVersion.current) setBusy(false);
    }
  }, [active, filters, page, search, stream, token]);

  useEffect(() => { setPage(1); }, [active, stream]);
  useEffect(() => { if (user) void load(); }, [active, page, stream, user]); // eslint-disable-line react-hooks/exhaustive-deps

  async function updateStatus(lead: Lead, status: string, details: {
    interviewAt?: string | null;
    callbackAt?: string | null;
    remarks?: string;
  } = {}) {
    if (!status || !token) return;
    if (!canEditMenu(stream,active)) { setError(`Your role has View access only for ${active}.`); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/recruitment/leads/${lead.id}/status`, {
        method: "PATCH",
        headers: { ...headers(token), "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          menu: active,
          interviewAt: details.interviewAt,
          callbackAt: details.callbackAt,
          remarks: details.remarks || undefined
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      if (payload.notificationWarning) setError(payload.notificationWarning);
      await load();
      if (stream === "workforce" && active === "Interviews" && status === "joined") {
        detailCache.current.delete(lead.id);
        await openLead(lead.id, true);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to update lead.");
    } finally { setBusy(false); }
  }

  async function retryLead(lead: Lead) {
    if (!token || !["no_response", "call_back"].includes(lead.status)) return;
    if (!canEditMenu(stream,active)) { setError(`Your role has View access only for ${active}.`); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/recruitment/leads/${lead.id}/status`, {
        method: "PATCH",
        headers: { ...headers(token), "Content-Type": "application/json" },
        body: JSON.stringify({
          status: lead.status,
          menu: active,
          retry: true,
          callbackAt: lead.callback_at || undefined,
          remarks: prompt("Attempt remarks (optional)") || undefined
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to record attempt.");
    } finally { setBusy(false); }
  }

  async function fetchLeadDetail(id: string) {
    if (!token) throw new Error("Session expired.");
    const response = await fetch(`/api/recruitment/leads/${id}?menu=${encodeURIComponent(active)}`, {
      headers: headers(token),
      cache: "no-store"
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error);
    detailCache.current.set(id, payload);
    return payload as LeadDetail;
  }

  async function prefetchLead(id: string) {
    if (!token || detailCache.current.has(id)) return;
    try { await fetchLeadDetail(id); } catch { /* Opening the lead will show a useful error. */ }
  }

  async function openLead(id: string, force = false) {
    if (!token) return;
    const requestVersion = ++detailRequestVersion.current;
    const cached = !force ? detailCache.current.get(id) : null;
    if (cached) {
      setSelectedLead(cached);
      setDetailBusy(false);
      return;
    }
    const summary = leads.find((item) => item.id === id);
    if (summary) setSelectedLead({ lead: summary, history: [], messages: [], sources: [] });
    setDetailBusy(true); setError("");
    try {
      const payload = await fetchLeadDetail(id);
      if (detailRequestVersion.current === requestVersion) setSelectedLead(payload);
    } catch (caught) {
      if (detailRequestVersion.current === requestVersion) {
        setError(caught instanceof Error ? caught.message : "Unable to load lead details.");
      }
    } finally {
      if (detailRequestVersion.current === requestVersion) setDetailBusy(false);
    }
  }

  async function saveLead(fields: Record<string, unknown>) {
    if (!token || !selectedLead) return;
    if (!canEditMenu(stream,active)) { setError(`Your role has View access only for ${active}.`); return; }
    setDetailBusy(true);
    try {
      const response = await fetch(`/api/recruitment/leads/${selectedLead.lead.id}`, {
        method: "PATCH", headers: { ...headers(token), "Content-Type": "application/json" }, body: JSON.stringify({...fields,menu:active})
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      detailCache.current.delete(selectedLead.lead.id);
      await openLead(selectedLead.lead.id, true);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save lead.");
    } finally { setDetailBusy(false); }
  }

  function navigate(label: string) {
    setMobileMenuOpen(false);
    loadVersion.current++;
    setSearch("");
    setFilters(label === "Interviews" ? {...emptyLeadFilters, interviewFrom:istDate(), interviewTo:istDate()} : emptyLeadFilters);
    setFacets(null);
    setPage(1);
    setLeads([]);
    setTotal(0);
    setModuleData(null);
    setSelectedLead(null);
    setError("");
    setActive(label);
  }

  function switchStream(next: "workforce" | "hr") {
    setMobileMenuOpen(false);
    loadVersion.current++;
    setStream(next);
    const firstMenu = user?.recruitmentFunction==="influencer"
      ? "Influencer Performance"
      : Object.entries(user?.menuAccess?.[next]??{}).find(([,level])=>level!=="none")?.[0]??"Dashboard";
    setActive(firstMenu);
    setSelectedLead(null);
    setSearch("");
    setFilters(emptyLeadFilters);
    setFacets(null);
    setPage(1);
    setLeads([]);
    setTotal(0);
    setModuleData(null);
    setError("");
  }

  if (checking) return <main className="login-screen"><div className="loader" /></main>;
  if (!user || !token) return <main className="login-screen"><AuthPanel /></main>;

  const workforceNav: Array<[string,string,string]> = [
    ["Overview","Command Center","Dashboard"],["Leads","All Leads","All Leads"],["Leads","No Response / Call Back","No Response / Call Back"],
    ["Leads","Interviews","Interviews"],["Leads","Archived Leads","Archived Leads"],["Leads","Unmapped","Unmapped"],["Leads","Reports","Reports"],
    ["Communication","WhatsApp Messages","WhatsApp Messages"],
    ["Onboarding",user.recruitmentFunction==="influencer"?"Refer an Associate":"Workforce Onboarding","Field Executive Onboarding"],
    ["Onboarding","DA In-app Onboarding","DA In-app Onboarding"],
    ["Performance","Performance Center","Performance Center"],
    ["Performance","Telecaller Performance","Recruiter Performance"],
    ["Performance","Field Recruiter Performance","Field Recruitment"],
    ["Performance","Influencer Performance","Influencer Performance"],
    ["Advertising","Active Ads","Active Ads"],["Advertising","Ad Requests","Ad Requests"],["Master","Station Directory","Station Directory"],
    ["Master","Station Contacts","Station Contacts"],["Master","Roles","Roles"],["Master","Lead Status Master","Lead Status Master"],["Master","Notification Rules","Notification Rules"],["Master","Incentive Master","Incentive Master"],["Master","Users & Access","Access Control"],["Master","User Roles","User Roles"],["Admin","Master Reports","Master Reports"],["Admin","Connections","Connections"],["Admin","System Health","System Health"],["Admin","System Logs","Audit"]
  ];
  const hrNav: Array<[string,string,string]> = [
    ["Overview","Recruitment Dashboard","Dashboard"],
    ["My Work","My Interview Assignments","My Interviews"],
    ["Talent Pipeline","Candidates","All Leads"],["Talent Pipeline","Screening","Screening"],["Talent Pipeline","Interviews","Interviews"],
    ["Talent Pipeline","Documents","Documents"],["Talent Pipeline","Offers","Offers"],["Talent Pipeline","Hired","Hired"],
    ["Talent Pipeline","Archived Candidates","Archived Leads"],["Talent Pipeline","Unmapped Intake","Unmapped"],
    ["Hiring","Job Requisitions & JDs","Job Requisitions"],
    ["Hiring","Candidate Database & CV Pool","Resume Intake"],
    ["Hiring","AI Fit Review","AI Fit Review"],
    ["Advertising","Active Ads","Active Ads"],["Advertising","Ad Requests","Ad Requests"],
    ["Analytics","Recruitment Reports","Reports"],
    ["Communication","WhatsApp Messages","WhatsApp Messages"],
    ["Master","Business Locations","Station Directory"],["Master","Positions & Designations","Roles"],
    ["Master","Candidate Statuses","Lead Status Master"],["Master","HR Lifecycle & Interview Rules","HR Lifecycle"],["Master","Notification Automation","Notification Rules"],["Master","Users & Access","Access Control"],["Master","User Roles","User Roles"],
    ["Administration","Executive Reports","Master Reports"],
    ["Administration","Source Integrations","Connections"],["Administration","System Health","System Health"],["Administration","System Logs","Audit"]
  ];
  const hasExplicitMenuPermissions = Array.isArray(user.webMenuPermissions)
    || Array.isArray(user.menuPermissions);
  const allowedMenus = new Set(user.webMenuPermissions ?? user.menuPermissions ?? []);
  const menuLevel = (workspace:"workforce"|"hr",menuId:string):RecruitmentMenuAccessLevel =>
    user.isOwner ? "all" : user.menuAccess?.[workspace]?.[menuId] ?? (allowedMenus.has(menuId) ? "edit" : "none");
  const canUseMenu = (workspace:"workforce"|"hr",menuId:string) => {
    if(user.recruitmentFunction==="influencer")return workspace==="workforce"&&[
      "Field Executive Onboarding","Influencer Performance"
    ].includes(menuId);
    if(workspace==="workforce"&&menuId==="Recruiter Performance"&&user.recruitmentFunction==="telecaller")return true;
    if(workspace==="workforce"&&menuId==="Field Recruitment"&&user.recruitmentFunction==="field_recruiter")return true;
    if(menuId==="WhatsApp Messages"){
      const leadGrant=user.menuActions?.[workspace]?.["All Leads"];
      if(leadGrant)return Boolean(leadGrant.view||leadGrant.add||leadGrant.edit);
      return menuLevel(workspace,"All Leads")!=="none";
    }
    const grant=user.menuActions?.[workspace]?.[menuId];
    return grant ? Boolean(grant.view||grant.add||grant.edit) : menuLevel(workspace,menuId)!=="none";
  };
  const canEditMenu = (workspace:"workforce"|"hr",menuId:string) => ["edit","all"].includes(menuLevel(workspace,menuId));
  const canAddMenu = (workspace:"workforce"|"hr",menuId:string) => {
    if (user.isOwner) return true;
    const grant=user.menuActions?.[workspace]?.[menuId];
    return grant ? Boolean(grant.add) : ["edit","all"].includes(menuLevel(workspace,menuId));
  };
  const nav = (stream === "workforce" ? workforceNav : hrNav).filter((item) =>
    user.menuAccess ? canUseMenu(stream,item[2]) : (!hasExplicitMenuPermissions || allowedMenus.has(item[2]))
  );
  const streamAllowed = stream === "workforce" ? user.workforce : user.hr;
  const navGroups = nav.reduce<Array<[string, Array<[string,string,string]>]>>((groups, item) => {
    const current = groups.at(-1);
    if (current?.[0] === item[0]) current[1].push(item);
    else groups.push([item[0], [item]]);
    return groups;
  }, []);
  const showLeads = ["All Leads","Archived Leads","No Response / Call Back","Interviews","Unmapped","Screening","Documents","Offers","Hired"].includes(active);
  const streamRoles = workspaceRoleCatalog(options.roles ?? [], stream);
  const selectedStations = new Set(filters.station.split(",").filter(Boolean));
  const selectedClusters = new Set(filters.cluster.split(",").filter(Boolean));
  const facetLocationCounts = new Map((facets?.locations ?? []).map((item:any) => [item.value, item.count]));
  const facetClusterCounts = new Map((facets?.clusters ?? []).map((item:any) => [item.value, item.count]));
  const facetRoleCounts = new Map((facets?.roles ?? []).map((item:any) => [item.value, item.count]));
  const availableLocations = facets ? options.locations.filter((item:any) => facetLocationCounts.has(item.code) || selectedStations.has(item.code)) : options.locations;
  const allClusters = [...new Set<string>(options.locations.map((item:any)=>String(item.cluster||"")).filter(Boolean))];
  const availableClusters = facets ? allClusters.filter((value) => facetClusterCounts.has(value) || selectedClusters.has(value)) : allClusters;
  const availableRoles = streamRoles;
  const withCount = (label: string, count: unknown) => typeof count === "number" ? `${label} (${count.toLocaleString("en-IN")})` : label;
  const applyLeadFilters = () => { setPage(1); void load({ page: 1 }); };
  const resetLeadFilters = () => {
    setSearch(""); setFilters({...emptyLeadFilters}); setFacets(null); setPage(1);
    void load({ page: 1, filterValues: {...emptyLeadFilters}, searchValue: "" });
  };
  const openWorkforceMetric = (key: keyof Metrics) => {
    const next = {...emptyLeadFilters};
    let route = "All Leads";
    if (key === "noStatus") next.status = "__BLANK__";
    if (key === "noResponse") { route = "No Response / Call Back"; next.status = "no_response"; }
    if (key === "callBack") { route = "No Response / Call Back"; next.status = "call_back"; }
    if (key === "interviews") { route = "Interviews"; next.status = "interview_scheduled,interview_rescheduled"; }
    if (key === "joined") next.status = "joined";
    if (key === "pending24h") next.stale24 = true;
    if (key === "unmapped") route = "Unmapped";
    setActive(route); setFilters(next); setSearch(""); setPage(1); setFacets(null);
  };
  const pageTitle = active === "Dashboard"
    ? (stream === "workforce" ? "Recruitment Command Center" : "Talent Command Center")
    : active === "All Leads" ? (stream === "workforce" ? "Workforce Queue" : "HR Candidates")
    : active === "Audit" ? "System Logs" : active;
  const pageSubtitle = active === "Dashboard"
    ? (stream === "workforce" ? "Source. Connect. Hire. Scale." : "Find the right people. Move them forward.")
    : active === "Audit" ? "Meaningful additions, updates, approvals, access changes and deletions — ordinary clicks are excluded"
    : (stream === "workforce" ? "Every lead, action and outcome in one operating view" : "Candidate progress from screening to joining");

  return <main className="shell">
    <aside className={`sidebar ${mobileMenuOpen ? "mobile-open" : ""}`} aria-label="Recruitment navigation">
      <div className="brand"><img src="/dropx-logo.png" alt="DropX" /><small>Recruitment</small><button className="mobile-menu-close" aria-label="Close menu" onClick={()=>setMobileMenuOpen(false)}>×</button></div>
      <nav>{navGroups.map(([section,items]) => section === "Master"
        ? <details className="nav-submenu" key={section} open={items.some(([, ,route])=>route===active)}>
            <summary>Master</summary>
            <div>{items.map(([,label,route])=><button key={route} className={route===active?"active":""} onClick={()=>navigate(route)}><i>≡</i>{label}</button>)}</div>
          </details>
        : <div className="nav-section" key={section}><p>{section}</p>{items.map(([,label,route])=><button key={route} className={route===active?"active":""} onClick={()=>navigate(route)}><i>{route==="Dashboard"?"▦":"≡"}</i>{label}</button>)}</div>
      )}</nav>
      <button className="identity" onClick={() => { localStorage.removeItem("recruitment_session"); location.reload(); }}>
        <b>{(user.name ?? "U")[0]}</b><span>{user.name ?? "DropX user"}<small>SIGN OUT</small></span>
      </button>
    </aside>
    {mobileMenuOpen?<button className="mobile-menu-backdrop" aria-label="Close menu" onClick={()=>setMobileMenuOpen(false)}/>:null}
    <section className="workspace">
      <header><button className="mobile-menu-trigger" aria-label="Open menu" aria-expanded={mobileMenuOpen} onClick={()=>setMobileMenuOpen(true)}><i/><span><small>Recruitment</small>{pageTitle}</span></button><div className="desktop-page-title"><h1>{pageTitle}</h1><p>{pageSubtitle}</p></div>{user.canPreviewUsers?<label className="owner-preview-switcher"><span>View as</span><select value={user.isPreview?user.profileId:""} onChange={(event)=>changePreview(event.target.value)}><option value="">My Owner View</option>{previewUsers.filter((item)=>item.profileId!==user.viewerProfileId).map((item)=><option value={item.profileId} key={item.profileId}>{item.name} · {item.designationCode||item.roleName||"User"}</option>)}</select></label>:null}<div className="stream-switch" aria-label="Recruitment section">
        {user.workforce ? <button className={stream === "workforce" ? "selected" : ""} onClick={() => switchStream("workforce")}>Workforce</button> : null}
        {user.hr ? <button className={stream === "hr" ? "selected" : ""} onClick={() => switchStream("hr")}>HR</button> : null}
      </div></header>
      <div className="gradient" />
      {user.isPreview?<div className="owner-preview-banner"><b>Read-only preview:</b> {user.name} · {user.designationCode||user.accessTemplate||"User"}<button type="button" onClick={()=>changePreview("")}>Exit preview</button></div>:null}
      {error ? <div className="error-banner">{error}</div> : null}
      {!streamAllowed ? <section className="content-card access-denied-card"><h2>No access to this section</h2><p>This view is controlled by the user&apos;s company role and its Recruitment menu permissions.</p></section> : null}
      {streamAllowed && active === "Dashboard" && stream === "workforce" ? <>
        <section className="metrics">{metricLabels.filter(([key])=>key!=="unmapped").map(([key,label]) => <button type="button" className={`metric-card metric-${key.toLowerCase()}`} key={key} onClick={()=>openWorkforceMetric(key)}><span>{label}</span><strong>{busy ? "…" : (metrics?.[key] ?? 0).toLocaleString("en-IN")}</strong><small>Open queue →</small></button>)}</section>
        <section className="dash-tools-modern"><MultiFilter label="Stations" value={filters.station} options={options.locations.map((item:any)=>[item.code,`${item.code} — ${item.name}`])} onChange={(value)=>setFilters({...filters,station:value})}/><MultiFilter label="Operational owners" value={filters.cluster} options={[...new Set(options.locations.map((item:any)=>item.cluster).filter(Boolean))].map((value:any)=>[value,value])} onChange={(value)=>setFilters({...filters,cluster:value})}/><MultiFilter label="Designations" value={filters.role} options={streamRoles.map((item:any)=>[item.code,`${item.code} — ${item.name}`])} onChange={(value)=>setFilters({...filters,role:value})}/><button className="primary-action" disabled={busy} onClick={()=>void load()}>{busy?"Applying…":"Apply filters"}</button></section>
        <section className="quick-queues">
          <button onClick={()=>{setActive("All Leads");setFilters({...filters,role:"DA",status:"__BLANK__,no_response,call_back",stale24:false});}}>My DA pending</button>
          <button onClick={()=>{setActive("Interviews");setFilters({...filters,interviewFrom:istDate(),interviewTo:istDate(),stale24:false});}}>Today interviews</button>
          <button className="hot" onClick={()=>{setActive("All Leads");setFilters({...filters,status:"",stale24:true});}}>24h pending</button>
        </section>
        <PersonalPerformance token={token} user={user} />
        <CapacityDemandPanel token={token} openStation={(stationCode)=>{
          setActive("All Leads");
          setFilters({...emptyLeadFilters,station:stationCode});
          setSearch("");
          setPage(1);
          setFacets(null);
        }}/>
        <DashboardPanels data={moduleData} />
      </> : null}
      {streamAllowed && active === "Dashboard" && stream === "hr" ? <HRDashboard data={moduleData} metrics={metrics} busy={busy} openQueue={(status)=>{setActive("All Leads");setFilters({...emptyLeadFilters,status});}} openRequisitions={()=>setActive("Job Requisitions")} /> : null}
      {streamAllowed && active === "My Interviews" && stream === "hr" ? <MyInterviewAssignments data={moduleData} token={token} busy={busy} canEdit={canEditMenu("hr","My Interviews")} reload={load} /> : null}
      {streamAllowed && showLeads ? <section className="content-card leads-card">
        <div className="lead-registry-head"><div><b>{stream === "workforce" ? "Workforce calling queue" : "HR candidate pipeline"}</b><span>{stream === "workforce" ? "Call, update status and expand only when application answers are needed." : "Screen profiles, collect documents, coordinate interview rounds and capture manager decisions."}</span></div><strong>{total.toLocaleString("en-IN")} {active === "Archived Leads" ? "archived" : "active"} {stream === "workforce" ? "workforce leads" : "HR candidates"}</strong></div>
        <div className="toolbar filter-toolbar">
          <input placeholder="Name, phone, city, email or ad…" value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") applyLeadFilters(); }} />
          {!(stream==="workforce"&&active==="Interviews")?<MultiFilter label="Status" value={filters.status} options={stream==="workforce"
            ? workforceStatusFilterOptions(workforceStatusOptions(options)).map((item:any)=>[item.code,item.label])
            : hrLifecycleFilterOptions(options.hrLifecycleRules)} onChange={(value)=>setFilters({...filters,status:value,stale24:false})} onApply={applyLeadFilters} busy={busy}/>:null}
          <MultiFilter label="Stations" value={filters.station} options={availableLocations.map((item:any)=>[item.code,withCount(`${item.code} — ${item.name}`,facetLocationCounts.get(item.code))])} onChange={(value)=>setFilters({...filters,station:value})} onApply={applyLeadFilters} busy={busy}/>
          <MultiFilter label="Operational owners" value={filters.cluster} options={availableClusters.map((value:string)=>[value,withCount(value,facetClusterCounts.get(value))])} onChange={(value)=>setFilters({...filters,cluster:value})} onApply={applyLeadFilters} busy={busy}/>
          <MultiFilter label="Designations" value={filters.role} options={availableRoles.map((item:any)=>[item.code,withCount(`${item.code} — ${item.name}`,facetRoleCounts.get(item.code))])} onChange={(value)=>setFilters({...filters,role:value})} onApply={applyLeadFilters} busy={busy}/>
          {active==="No Response / Call Back"?<MultiFilter label="Updated" value={filters.updatedAge} options={[["never","Never"],["lt30","Under 30 min"],["gt60","60+ min"],["gt120","120+ min"],["gt24h","24h+"],["gt2d","2 days+"]]} onChange={(value)=>setFilters({...filters,updatedAge:value})} onApply={applyLeadFilters} busy={busy}/>:null}
          {active==="Interviews"?<>{stream==="workforce"?<MultiFilter label="Outcome" value={filters.status} options={workforceInterviewFilterOptions(workforceStatusOptions(options)).map((item)=>[item.code,item.label])} onChange={(value)=>setFilters({...filters,status:value,finalStatus:""})} onApply={applyLeadFilters} busy={busy}/>:null}<label className="compact-date">From<input type="date" aria-label="Interview from" value={filters.interviewFrom} onChange={(event)=>setFilters({...filters,interviewFrom:event.target.value})}/></label><label className="compact-date">To<input type="date" aria-label="Interview to" value={filters.interviewTo} onChange={(event)=>setFilters({...filters,interviewTo:event.target.value})}/></label>{stream==="hr"?<MultiFilter label="Final status" value={filters.finalStatus} options={options.finalStatuses.map((item:string)=>[item,item])} onChange={(value)=>setFilters({...filters,finalStatus:value})} onApply={applyLeadFilters} busy={busy}/>:null}</>:null}
          {filters.stale24?<span className="filter-chip">24h+ pending</span>:null}
          <button onClick={applyLeadFilters} disabled={busy}>{busy ? "Applying…" : "Apply filters"}</button>
          <button className="reset-btn" onClick={resetLeadFilters} disabled={busy}>Reset filters</button>
        </div>
        {stream === "workforce"
          ? <WorkforceQueue leads={leads} selected={selectedLead} busy={busy||detailBusy} active={active} token={token} statusOptions={workforceStatusOptions(options)} canEdit={canEditMenu("workforce",active)} open={async(id)=>{if(selectedLead?.lead.id===id){setSelectedLead(null);}else{await openLead(id);}}} update={updateStatus} retry={retryLead} refresh={async(id)=>{await openLead(id);await load();}}/>
          : <HRCandidateWorkspace leads={leads} selected={selectedLead} busy={busy} detailBusy={detailBusy} token={token} options={options} canManage={menuLevel("hr","All Leads")==="all"} access={{activity:menuLevel("hr","All Leads"),screening:menuLevel("hr","Screening"),interviews:menuLevel("hr","Interviews"),documents:menuLevel("hr","Documents"),offers:menuLevel("hr","Offers")}} open={openLead} close={()=>{detailRequestVersion.current+=1;setSelectedLead(null);setDetailBusy(false);}} prefetch={prefetchLead} refresh={async(id,savedLead)=>{if(savedLead){setLeads((current)=>current.map((item)=>item.id===id?{...item,...savedLead}:item));setSelectedLead((current)=>current?.lead.id===id?{...current,lead:{...current.lead,...savedLead}}:current);}detailCache.current.delete(id);await openLead(id,true);await load();}} save={saveLead}/>} 
        <div className="pager"><button disabled={page <= 1 || busy} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button><span>Page {page} of {Math.max(1, Math.ceil(total / 50))}</span><button disabled={page * 50 >= total || busy} onClick={() => setPage((value) => value + 1)}>Next</button></div>
      </section> : null}
      {active === "Station Directory" ? <StationDirectory data={moduleData} /> : null}
      {active === "Station Contacts" ? <MasterManager kind="contact" data={moduleData} token={token} canEdit={canEditMenu(stream,"Station Contacts")} reload={load} /> : null}
      {active === "Roles" ? <MasterManager key={`roles-${stream}`} kind="role" stream={stream} data={moduleData} token={token} canEdit={canEditMenu(stream,"Roles")} reload={async()=>{await load();await refreshOptions();}} /> : null}
      {active === "Lead Status Master" ? <LeadStatusMaster data={moduleData} token={token} canEdit={canEditMenu(stream,"Lead Status Master")} reload={async()=>{await load();await refreshOptions();}} /> : null}
      {active === "HR Lifecycle" && stream === "hr" ? <HrLifecycleMaster data={moduleData} token={token} canEdit={canEditMenu("hr","HR Lifecycle")} reload={load} /> : null}
      {active === "Notification Rules" ? <NotificationRulesMaster data={moduleData} token={token} canEdit={canEditMenu(stream,"Notification Rules")} reload={load} /> : null}
      {active === "Job Requisitions" && stream === "hr" ? <JobRequisitionsWorkspace data={moduleData} token={token} options={options} canAdd={canAddMenu("hr","Job Requisitions")} canEdit={canEditMenu("hr","Job Requisitions")} canApprove={menuLevel("hr","Job Requisitions")==="all"} reload={load} /> : null}
      {active === "Resume Intake" && stream === "hr" ? <ResumeIntakeWorkspace data={moduleData} token={token} canAdd={canAddMenu("hr","Resume Intake")} canEdit={canEditMenu("hr","Resume Intake")} reload={load} openCandidate={(id)=>{pendingCandidateOpen.current=id;navigate("All Leads");}} /> : null}
      {active === "AI Fit Review" && stream === "hr" ? <AiFitReviewWorkspace data={moduleData} token={token} canAdd={canAddMenu("hr","AI Fit Review")} canEdit={canEditMenu("hr","AI Fit Review")} reload={load} /> : null}
      {active === "Active Ads" ? <ActiveAds data={moduleData} token={token} stream={stream} roleCatalog={streamRoles} reload={load} canDirectPost={menuLevel(stream,"Active Ads")==="all"} openPublisher={()=>setDirectAdPublisher(true)} request={(type, ad)=>setAdRequest({type,ad})} /> : null}
      {active === "Ad Requests" ? <AdRequests data={moduleData} token={token} reload={load} openForm={() => setAdRequest({type:"new_ad"})} /> : null}
      {active === "User Roles" ? <UserRoleMaster data={moduleData} token={token} stream={stream} canEdit={canEditMenu(stream,"User Roles")} reload={load} /> : null}
      {active === "Access Control" ? <TeamAccess data={moduleData} token={token} stream={stream} canEdit={canEditMenu(stream,"Access Control")} reload={load} /> : null}
      {active === "Master Reports" ? <MasterReports data={moduleData} /> : null}
      {active === "Connections" ? <ConnectionMaster data={moduleData} token={token} canEdit={canEditMenu(stream,"Connections")} reload={load} /> : null}
      {active === "WhatsApp Messages" ? <WhatsAppMessageLog token={token} stream={stream} locations={options.locations??[]} canReplay={canEditMenu(stream,"WhatsApp Messages")||canEditMenu(stream,"Connections")} /> : null}
      {active === "System Health" ? <SystemHealth data={moduleData} token={token} canRepair={menuLevel(stream,"System Health")==="all"} reload={load} /> : null}
      {active === "Audit" ? <SystemLogs data={moduleData} /> : null}
      {active === "Reports" ? <Reports data={moduleData} busy={busy} token={token} options={options} stream={stream} /> : null}
      {active === "Recruiter Performance" && stream === "workforce" ? user.recruitmentFunction==="telecaller"?<PersonalPerformance token={token} user={user}/>:<RecruiterPerformance data={moduleData} token={token} /> : null}
      {active === "Performance Center" && stream === "workforce" ? <PerformanceCenter token={token} /> : null}
      {active === "Field Recruitment" && stream === "workforce" ? user.recruitmentFunction==="field_recruiter"?<><PersonalPerformance token={token} user={user}/><FieldRecruitment data={moduleData} token={token}/></>:<FieldRecruitment data={moduleData} token={token} showManualPunchApprovals /> : null}
      {active === "Influencer Performance" && stream === "workforce" ? <InfluencerPerformance token={token} user={user}/> : null}
      {active === "Field Executive Onboarding" && stream === "workforce" ? <FieldExecutiveOnboarding initialData={moduleData} token={token} user={user} canEdit={canEditMenu("workforce","Field Executive Onboarding")} /> : null}
      {active === "DA In-app Onboarding" && stream === "workforce" ? <DaInAppOnboarding token={token} canEdit={canEditMenu("workforce","DA In-app Onboarding")} /> : null}
      {active === "Incentive Master" && stream === "workforce" ? <IncentiveMaster data={moduleData} token={token} canEdit={canEditMenu("workforce","Incentive Master")} reload={load} /> : null}
    </section>
    {detailBusy && !selectedLead ? <div className="inline-loading"><div className="loader" /></div> : null}
    {adRequest ? <AdRequestForm token={token} options={options} stream={stream} requestType={adRequest.type} ad={adRequest.ad} directMode={menuLevel(stream,"Active Ads")==="all"} close={() => setAdRequest(null)} afterSave={async () => { setAdRequest(null); await load(); }} /> : null}
    {directAdPublisher?<MetaAdPublisher token={token} stream={stream} options={options} close={()=>setDirectAdPublisher(false)} afterPublish={async()=>{await load();}}/>:null}
  </main>;
}

const workforceQuickStatuses = [
  "no_response",
  "not_interested",
  "call_back",
  "long_distance",
  "interview_scheduled",
  "not_fit",
  "document_issue"
];

function workforceStatusScheduleType(code: string, scheduleType?: string | null) {
  if (scheduleType === "interview" || scheduleType === "callback") return scheduleType;
  if (code === "call_back") return "callback";
  if (code === "interview_scheduled" || code === "interview_rescheduled") return "interview";
  return null;
}

function workforceStatusOptions(options:any) {
  const configured = Array.isArray(options?.workforceStatuses) ? options.workforceStatuses : [];
  return configured.length ? configured : workforceQuickStatuses.map((code,index)=>({
    code,label:statusLabel(code),isActive:true,
    requiresSchedule:["call_back","interview_scheduled","interview_rescheduled"].includes(code),
    scheduleType:code==="call_back"?"callback":code.startsWith("interview_")?"interview":null,
    sortOrder:(index+1)*10
  }));
}

function statusLabelFromOptions(code:string, options:any) {
  return workforceStatusOptions(options).find((item:any)=>item.code===code)?.label || statusLabel(code);
}

function HRDashboard({ data, metrics, busy, openQueue, openRequisitions }: {
  data: any; metrics: Metrics | null; busy: boolean; openQueue: (status: string) => void; openRequisitions: () => void;
}) {
  const breakdown = new Map((data?.statusBreakdown ?? []).map((item:any)=>[String(item.label||item.status||"").toLowerCase().replaceAll(" ","_"),Number(item.value||item.count||0)]));
  const count = (...statuses:string[]) => statuses.reduce((sum,status)=>sum+Number(breakdown.get(status)||0),0);
  const cards = [
    ["New profiles",count("new","no_status"),"new"],
    ["Screening",count("contacting","screening"),"contacting,screening"],
    ["Documents",count("documents_pending"),"documents_pending"],
    ["Interview rounds",metrics?.interviews??0,"interview_scheduled,interview_rescheduled,interview_completed"],
    ["Offer stage",count("selected","offer_pending","offered"),"selected,offer_pending,offered"],
    ["Joined",metrics?.joined??0,"joined"]
  ] as const;
  const currentOpenRoles=data?.currentOpenRoles??[];
  const remainingOpenings=currentOpenRoles.reduce((sum:number,item:any)=>sum+Number(item.remaining||0),0);
  const detailsLoading=Boolean(data?.loadingDetails);
  return <section className="hr-dashboard">
    <div className="hr-dashboard-hero"><div><span>HR TALENT PIPELINE</span><h2>Move each candidate from profile to joining</h2><p>One workspace for screening, private documents, interview rounds, manager feedback and offers.</p></div><strong>{busy?"…":(metrics?.total??0).toLocaleString("en-IN")}<small>active profiles</small></strong></div>
    <section className="hr-stage-cards">{cards.map(([label,value,status])=>{
      // Interview and joined counts are available in the fast summary response.
      // The remaining stage counts come from the detailed lifecycle aggregation;
      // never render a temporary zero while that second response is still loading.
      const awaitingDetail=detailsLoading&&!['Interview rounds','Joined'].includes(label);
      return <button key={label} onClick={()=>openQueue(status)}><span>{label}</span><strong>{busy||awaitingDetail?"…":Number(value).toLocaleString("en-IN")}</strong><small>{awaitingDetail?"Calculating scoped pipeline…":"Open queue →"}</small></button>;
    })}</section>
    <article className="content-card hr-open-roles"><header><div><h2>Current open roles</h2><p>Live requisitions, remaining vacancies and hiring status for your permitted locations.</p></div><div><strong>{remainingOpenings.toLocaleString("en-IN")}<small>positions remaining</small></strong>{data?.openRolesAccess?.view?<button type="button" onClick={openRequisitions}>{data?.openRolesAccess?.edit?"Manage roles & status":"View requisitions"} →</button>:null}</div></header>{data?.openRolesAccess?.view?<div className="table-scroll"><table><thead><tr><th>Role</th><th>Location</th><th>Vacancies</th><th>Priority</th><th>Status</th><th>Target joining</th></tr></thead><tbody>{currentOpenRoles.slice(0,12).map((item:any)=><tr key={item.id}><td><b>{item.title||item.role?.name||"Untitled role"}</b><small>{item.code||item.role?.code||"—"}</small></td><td><b>{item.station?.code||"—"}</b><small>{item.station?.name||"Location not mapped"}</small></td><td><b>{Number(item.remaining||0)}</b><small>{Number(item.filled||0)} filled of {Number(item.openings||0)}</small></td><td>{statusLabel(item.priority||"normal")}</td><td><em className={`ats-status ats-${item.status}`}>{statusLabel(item.status)}</em></td><td>{item.targetJoiningDate?new Date(`${item.targetJoiningDate}T00:00:00`).toLocaleDateString("en-IN"):"Not set"}</td></tr>)}{!busy&&!currentOpenRoles.length?<tr><td colSpan={6}>No active requisitions in your scope. Create or reopen one from Job Requisitions &amp; JDs.</td></tr>:null}</tbody></table></div>:<div className="hr-open-roles-empty"><b>Open-role visibility is permission controlled</b><span>Enable View access for Job Requisitions &amp; JDs in User Roles to show this section.</span></div>}</article>
    <div className="hr-dashboard-grid"><article className="content-card"><h2>Interviews requiring action</h2><SimpleTable headers={["Candidate","Stage","Schedule"]} rows={(data?.attention??[]).filter((item:any)=>String(item.status||"").startsWith("interview_")).slice(0,8).map((item:any)=>[item.full_name||"Unnamed",statusLabel(item.status),item.follow_up_at?new Date(item.follow_up_at).toLocaleString("en-IN"):"Not scheduled"])}/></article><article className="content-card"><h2>Pipeline operating view</h2><p className="panel-help">Use HR Candidates to collect files, forward profiles to the correct manager, record round-wise feedback and move selected candidates into offer and joining.</p><div className="hr-flow-strip"><span>Profile</span><i>→</i><span>Screening</span><i>→</i><span>Documents</span><i>→</i><span>Interview</span><i>→</i><span>Offer</span><i>→</i><span>Join</span></div></article></div>
  </section>;
}

function MyInterviewAssignments({ data, token, busy, canEdit, reload }: {
  data:any;token:string;busy:boolean;canEdit:boolean;reload:()=>Promise<void>;
}) {
  const assignments=data?.assignments??[];
  const [selectedId,setSelectedId]=useState<string>(assignments[0]?.id??"");
  const [decision,setDecision]=useState("advance");
  const [feedback,setFeedback]=useState("");
  const [saving,setSaving]=useState(false);
  const [notice,setNotice]=useState("");
  const selected=assignments.find((item:any)=>item.id===selectedId)??assignments[0]??null;
  useEffect(()=>{
    if(!assignments.length){setSelectedId("");return;}
    if(!assignments.some((item:any)=>item.id===selectedId))setSelectedId(assignments[0].id);
  },[assignments,selectedId]);
  async function recordDecision() {
    if(!selected||!feedback.trim())return;
    setSaving(true);setNotice("");
    try {
      const response=await fetch(`/api/recruitment/interviews/${selected.id}`,{
        method:"PATCH",headers:{...headers(token),"Content-Type":"application/json"},
        body:JSON.stringify({decision,feedback})
      });
      const payload=await response.json();
      if(!response.ok)throw new Error(payload.error||"Unable to record the interview decision.");
      setNotice(payload.message||"Interview decision recorded.");setFeedback("");await reload();
    } catch(error) {setNotice(error instanceof Error?error.message:"Unable to record the interview decision.");}
    finally {setSaving(false);}
  }
  return <section className="my-interviews-view">
    <header className="my-interviews-hero"><div><span>MY WORK</span><h2>Interview assignments</h2><p>Only candidates directly assigned to you appear here. Record one round decision with mandatory feedback.</p></div><strong>{Number(data?.total??assignments.length).toLocaleString("en-IN")}<small>awaiting decision</small></strong></header>
    {notice?<p className="connection-notice">{notice}</p>:null}
    <div className="my-interviews-layout">
      <aside className="interview-assignment-list">{assignments.map((item:any)=>{const lead=item.lead??{};return <button type="button" key={item.id} className={selected?.id===item.id?"selected":""} onClick={()=>{setSelectedId(item.id);setFeedback("");setNotice("");}}><span><b>{lead.full_name||"Unnamed candidate"}</b><small>{lead.recruitment_roles?.name||"Unmapped role"} • {lead.recruitment_locations?.code||"No station"}</small></span><strong>Round {item.round_no}</strong><em>{new Date(item.scheduled_at).toLocaleString("en-IN",{dateStyle:"medium",timeStyle:"short"})}</em></button>;})}{!busy&&!assignments.length?<div className="empty"><h3>No interviews awaiting your decision</h3><p>New assignments will appear here after HR schedules them to you.</p></div>:null}</aside>
      <section className="interview-assignment-detail">{selected?(()=>{const lead=selected.lead??{};return <><header><div><span>{lead.recruitment_roles?.name||"Unmapped role"} • {lead.recruitment_locations?.code||"No station"}</span><h2>{lead.full_name||"Unnamed candidate"}</h2><p>{displayPhone(lead.phone)} • {lead.email||"No email"}</p></div><span className={`status status-${selected.status}`}>{statusLabel(selected.status)}</span></header>
        <div className="assignment-summary-grid"><span><small>Interview round</small><b>Round {selected.round_no}</b></span><span><small>Scheduled</small><b>{new Date(selected.scheduled_at).toLocaleString("en-IN",{dateStyle:"full",timeStyle:"short"})}</b></span><span><small>Assigned by</small><b>{selected.assignedBy?.full_name||selected.assignedBy?.email||"HR team"}</b></span><span><small>Contact</small><b>{displayPhone(lead.phone)}</b></span></div>
        <div className="assignment-actions">{phoneDigits(lead.phone).length===10?<><a href={`tel:+91${phoneDigits(lead.phone)}`}>Call candidate</a><a href={`https://wa.me/91${phoneDigits(lead.phone)}`} target="_blank" rel="noreferrer">Open WhatsApp</a></>:null}{selected.meet_link?<a href={selected.meet_link} target="_blank" rel="noreferrer">Open Google Meet</a>:null}</div>
        <article className="assignment-note"><h3>Recruiter handoff</h3><p>{selected.recruiter_note||"No additional handoff note was added."}</p><InterviewDeliveryStatus outcomes={selected.invitation_delivery}/></article>
        <article className="assignment-decision"><h3>Round {selected.round_no} decision</h3><p className="panel-help">This action updates the candidate lifecycle and remains visible in the audit trail.</p>{!selected.canReview||!canEdit?<p className="read-only-master-note">View access only — an edit grant for My Interview Assignments is required to submit feedback.</p>:null}<fieldset disabled={!selected.canReview||!canEdit||saving}><SearchSelect label="Decision" value={decision} options={[["advance","Advance to next round"],["selected","Select candidate"],["hold","Keep on hold"],["rejected","Reject candidate"],["no_show","Candidate did not attend"]]} onChange={setDecision}/><label>Mandatory feedback<textarea value={feedback} onChange={(event)=>setFeedback(event.target.value)} placeholder="Assessment, evidence and recommendation"/></label>{selected.canReview&&canEdit?<button className="primary-action" disabled={saving||!feedback.trim()} onClick={()=>void recordDecision()}>{saving?"Saving…":"Submit round decision"}</button>:null}</fieldset></article>
      </>;})():<div className="empty"><h3>Select an assignment</h3><p>Candidate details and the decision form will appear here.</p></div>}</section>
    </div>
  </section>;
}

function WorkforceQueue({ leads, selected, busy, active, token, statusOptions, canEdit, open, update, retry, refresh }: {
  leads: Lead[];
  selected: LeadDetail | null;
  busy: boolean;
  active: string;
  token: string;
  statusOptions:any[];
  canEdit:boolean;
  open: (id:string)=>Promise<void>;
  update: (lead:Lead,status:string,details?:{interviewAt?:string|null;callbackAt?:string|null;remarks?:string})=>Promise<void>;
  retry: (lead:Lead)=>Promise<void>;
  refresh: (id:string)=>Promise<void>;
}) {
  return <><div className="table-scroll workforce-desktop-table"><table className="workforce-table"><thead><tr><th>Candidate</th><th>Location</th><th>Mobile number</th><th>Designation / station</th><th>Ad source</th><th>Status &amp; remark</th><th>Updated</th><th>Details</th></tr></thead><tbody>
    {leads.map((lead)=><WorkforceLeadRow key={lead.id} lead={lead} detail={selected?.lead.id===lead.id?selected:null} busy={busy} active={active} token={token} statusOptions={statusOptions} canEdit={canEdit} open={open} update={update} retry={retry} refresh={refresh}/>) }
  </tbody></table></div><div className="workforce-mobile-list">{leads.map((lead)=><WorkforceMobileCard key={lead.id} lead={lead} detail={selected?.lead.id===lead.id?selected:null} busy={busy} active={active} token={token} statusOptions={statusOptions} canEdit={canEdit} open={open} update={update} retry={retry} refresh={refresh}/>)}</div>{!busy&&!leads.length?<div className="empty">No leads match this queue.</div>:null}</>;
}

function WorkforceMobileCard({ lead, detail, busy, active, token, statusOptions, canEdit, open, update, retry, refresh }: {
  lead:Lead; detail:LeadDetail|null; busy:boolean; active:string; token:string; statusOptions:any[];
  canEdit:boolean;
  open:(id:string)=>Promise<void>;
  update:(lead:Lead,status:string,details?:{interviewAt?:string|null;callbackAt?:string|null;remarks?:string})=>Promise<void>;
  retry:(lead:Lead)=>Promise<void>; refresh:(id:string)=>Promise<void>;
}) {
  const phone=phoneDigits(lead.phone);
  return <article className={`mobile-lead-card${detail?" expanded":""}`}>
    <button className="mobile-lead-summary" disabled={busy} aria-expanded={Boolean(detail)} onClick={()=>void open(lead.id)}>
      <span className="mobile-lead-avatar">{(lead.full_name||"?").trim().slice(0,1).toUpperCase()}</span>
      <span className="mobile-lead-identity"><b>{lead.full_name||"Unnamed"}</b><small>{lead.recruitment_locations?.code||"Unmapped"} · {lead.city||"Location missing"}{lead.post_code?` · ${lead.post_code}`:""}</small></span>
      <span className={`status status-${lead.status||"new"} status-tone-${statusTone(lead.status||"new")}`}>{statusOptions.find((item:any)=>item.code===lead.status)?.label||statusLabel(lead.status||"new")}</span>
      <i>{detail?"⌃":"⌄"}</i>
    </button>
    <div className="mobile-lead-contact"><a href={`tel:+91${phone}`}>{displayPhone(lead.phone)}</a>{phone.length===10?<><a href={`tel:+91${phone}`} aria-label={`Call ${lead.full_name||"candidate"}`}>Call</a><a href={`https://wa.me/91${phone}`} target="_blank" rel="noreferrer" aria-label={`WhatsApp ${lead.full_name||"candidate"}`}>WhatsApp</a></>:null}</div>
    {detail?<div className="mobile-lead-expanded">
      <dl className="mobile-lead-facts"><span><dt>Designation</dt><dd>{lead.recruitment_roles?.name||"Unmapped"}</dd></span><span><dt>Source</dt><dd>{lead.ad_name||sourceChannel(lead.source)}</dd></span><span><dt>Updated</dt><dd>{lead.updated_at?new Date(lead.updated_at).toLocaleString("en-IN",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}):"—"}</dd></span><span><dt>Owner</dt><dd>{lead.last_updated_profile?.full_name||lead.last_updated_profile?.email||"System"}</dd></span></dl>
      <div className="mobile-status-control">{active==="Interviews"?<InterviewOutcomeControl lead={lead} busy={busy} canEdit={canEdit} update={update} options={statusOptions}/>:<LeadStatusControl lead={lead} busy={busy} canEdit={canEdit} update={update} options={statusOptions}/>} {canEdit&&active==="No Response / Call Back"&&["no_response","call_back"].includes(lead.status)?<button className="retry-action" disabled={busy} onClick={()=>void retry(lead)}>Retry ({lead.status==="no_response"?lead.no_response_attempts:lead.call_back_attempts})</button>:null}</div>
      {lead.remarks||lead.follow_up_at||lead.callback_at?<p className="mobile-lead-remark">{lead.remarks||"Scheduled"}{lead.follow_up_at?` · ${new Date(lead.follow_up_at).toLocaleString("en-IN")}`:lead.callback_at?` · ${new Date(lead.callback_at).toLocaleString("en-IN")}`:""}</p>:null}
      <WorkforceDetailPanel detail={detail} active={active} token={token} busy={busy} canEdit={canEdit} refresh={refresh}/>
    </div>:null}
  </article>;
}

function WorkforceDetailPanel({detail,active,token,busy,canEdit,refresh}:{detail:LeadDetail;active:string;token:string;busy:boolean;canEdit:boolean;refresh:(id:string)=>Promise<void>}) {
  const answers=visibleQuestionnaireEntries(detail.lead.questionnaire);
  return <div className="inline-answer-panel"><section><h3>Application answers</h3>{answers.length?<dl>{answers.map(([key,val])=><span key={key}><dt>{key.replaceAll("_"," ")}</dt><dd>{String(val||"—")}</dd></span>)}</dl>:<p>No additional questions were submitted for this form.</p>}</section><section><h3>Station contact</h3><dl><span><dt>Address</dt><dd>{detail.lead.recruitment_locations?.address||"—"}</dd></span><span><dt>POC</dt><dd>{detail.lead.recruitment_locations?.poc_name||"—"}</dd></span><span><dt>Mobile</dt><dd>{detail.lead.recruitment_locations?.poc_mobile||"—"}</dd></span></dl></section><section className="lead-history-panel"><h3>Lead history <small>{detail.history.length} updates</small></h3><p className="panel-help">Owner: {detail.lead.assigned_profile?.full_name||detail.lead.assigned_profile?.email||"Assigned automatically on first update"}</p><div className="lead-history-list">{detail.history.map((event:any)=><div className="timeline-row" key={event.id}><b>{String(event.event_type).replaceAll("_"," ")}</b><span>{leadHistoryDescription(event)}</span><small>{new Date(event.created_at).toLocaleString("en-IN",{dateStyle:"medium",timeStyle:"medium"})}{event.actor_email?` • ${event.actor_email}`:" • System"}</small></div>)}{!detail.history.length?<p>No updates recorded yet.</p>:null}</div></section>{active==="Interviews"&&canEdit&&detail.lead.status==="joined"?<JoiningRecord lead={detail.lead} history={detail.history} token={token} busy={busy} refresh={refresh}/>:null}</div>;
}

function visibleQuestionnaireEntries(questionnaire:any):Array<[string,unknown]> {
  const source=questionnaire&&typeof questionnaire==="object"&&!Array.isArray(questionnaire)?questionnaire:{};
  let rawExtra:Record<string,unknown>={};
  const raw=source.raw_extra??source.rawExtra;
  if(raw&&typeof raw==="object"&&!Array.isArray(raw))rawExtra=raw;
  else if(typeof raw==="string")try{const parsed=JSON.parse(raw);if(parsed&&typeof parsed==="object"&&!Array.isArray(parsed))rawExtra=parsed;}catch{}
  const merged={...rawExtra,...source};
  const hidden=new Set(["id","ad_id","ad_name","form_id","form_name","campaign_id","campaign_name","adset_id","adset_name","full_name","phone_number","email","created_time","platform","raw_extra","sla_status","updated_by","reason_code","source_sheet","wa_new_sent_at","meta_lead_id","lead_id"]);
  return Object.entries(merged).filter(([key,value])=>{
    const normalized=key.trim().toLowerCase().replace(/[\s-]+/g,"_");
    if(hidden.has(normalized)||normalized.startsWith("meta_")||normalized.startsWith("system_"))return false;
    if(value==null)return false;
    if(typeof value==="string"&&(!value.trim()||value.trim()==="—"||value.trim().toLowerCase()==="null"))return false;
    if(typeof value==="object")return false;
    return true;
  }).map(([key,value])=>[key,value]);
}

function WorkforceLeadRow({ lead, detail, busy, active, token, statusOptions, canEdit, open, update, retry, refresh }: {
  lead: Lead;
  detail: LeadDetail | null;
  busy: boolean;
  active: string;
  token:string;
  statusOptions:any[];
  canEdit:boolean;
  open: (id:string)=>Promise<void>;
  update: (lead:Lead,status:string,details?:{interviewAt?:string|null;callbackAt?:string|null;remarks?:string})=>Promise<void>;
  retry: (lead:Lead)=>Promise<void>;
  refresh:(id:string,savedLead?:Record<string,unknown>|null)=>Promise<void>;
}) {
  return <>
    <tr className={`workforce-lead-row${detail?" expanded-row":""}`}>
      <td className="queue-candidate"><b>{lead.full_name||"Unnamed"}</b>{lead.email?<small title={lead.email}>{lead.email}</small>:null}</td>
      <td className="candidate-location"><b title={lead.city||""}>{lead.city||"—"}</b><small>{lead.post_code||"No pincode"}</small></td>
      <td className="queue-phone"><a className="large-phone" href={`tel:+91${phoneDigits(lead.phone)}`}>{displayPhone(lead.phone)}</a>{phoneDigits(lead.phone).length===10?<div className="contact-actions"><a href={`tel:+91${phoneDigits(lead.phone)}`} aria-label={`Call ${lead.full_name||"candidate"}`}>Call</a><a href={`https://wa.me/91${phoneDigits(lead.phone)}`} target="_blank" rel="noreferrer" aria-label={`WhatsApp ${lead.full_name||"candidate"}`}>WA</a></div>:null}</td>
      <td className="queue-role"><b>{lead.recruitment_roles?.name||"Unmapped designation"}</b><small>{lead.recruitment_locations?.code||"Unmapped station"}{lead.city?` • ${lead.city}`:""}</small></td>
      <td className="queue-source"><b title={lead.ad_name||"No ad name"}>{lead.ad_name||"No ad name"}</b><small>{sourceChannel(lead.source)}</small></td>
      <td className="queue-status-cell">{active==="Interviews"?<InterviewOutcomeControl lead={lead} busy={busy} canEdit={canEdit} update={update} options={statusOptions}/>:<LeadStatusControl lead={lead} busy={busy} canEdit={canEdit} update={update} options={statusOptions}/>} {canEdit&&active==="No Response / Call Back"&&["no_response","call_back"].includes(lead.status)?<button className="retry-action" disabled={busy} onClick={()=>void retry(lead)}>Retry ({lead.status==="no_response"?lead.no_response_attempts:lead.call_back_attempts})</button>:null}{lead.remarks||lead.follow_up_at||lead.callback_at?<small className="queue-remark" title={`${lead.remarks||""}${lead.follow_up_at?` • ${new Date(lead.follow_up_at).toLocaleString("en-IN")}`:lead.callback_at?` • ${new Date(lead.callback_at).toLocaleString("en-IN")}`:""}`}>{lead.remarks||"Scheduled"}{lead.follow_up_at?` • ${new Date(lead.follow_up_at).toLocaleString("en-IN")}`:lead.callback_at?` • ${new Date(lead.callback_at).toLocaleString("en-IN")}`:""}</small>:null}</td>
      <td className="queue-updated" title={lead.lead_created_at?`Received ${new Date(lead.lead_created_at).toLocaleString("en-IN")}`:""}><b>{lead.updated_at?new Date(lead.updated_at).toLocaleString("en-IN",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}):"—"}</b><small>By {lead.last_updated_profile?.full_name||lead.last_updated_profile?.email||"System"}</small></td>
      <td><button className="expand-action" disabled={busy} onClick={()=>void open(lead.id)}>{active==="Interviews"&&["selected","joined"].includes(lead.status)?"Onboard":detail?"Hide":"View"} {detail?"⌃":"⌄"}</button></td>
    </tr>
    {detail?<tr className="workforce-answer-row"><td colSpan={8}><WorkforceDetailPanel detail={detail} active={active} token={token} busy={busy} canEdit={canEdit} refresh={refresh}/></td></tr>:null}
  </>;
}

function LeadStatusControl({ lead, busy, canEdit, update, options }: {
  lead:Lead;
  busy:boolean;
  canEdit:boolean;
  update:(lead:Lead,status:string,details?:{interviewAt?:string|null;callbackAt?:string|null;remarks?:string})=>Promise<void>;
  options:any[];
}) {
  const [next,setNext]=useState("");
  const [when,setWhen]=useState("");
  const [remarks,setRemarks]=useState("");
  const selectedOption=options.find((item)=>item.code===next);
  const scheduleType=workforceStatusScheduleType(next,selectedOption?.scheduleType);
  const needsDate=selectedOption?.requiresSchedule===true;
  async function apply() {
    await update(lead,next,{
      interviewAt:scheduleType==="interview"?localInputToIso(when):undefined,
      callbackAt:scheduleType==="callback"?localInputToIso(when):undefined,
      remarks
    });
    setNext("");setWhen("");setRemarks("");
  }
  const available=options.filter((item)=>item.isActive!==false&&item.code!==lead.status);
  return <div className="compact-status"><span className={`status status-${lead.status||"new"} status-tone-${statusTone(lead.status||"new")}`}>{options.find((item)=>item.code===lead.status)?.label||statusLabel(lead.status||"new")}</span>{canEdit&&!lead.archived?<select aria-label={`Update ${lead.full_name||"lead"} status`} value={next} disabled={busy} onChange={(event)=>setNext(event.target.value)}><option value="">Change Status…</option>{available.map((item)=><option key={item.code} value={item.code}>{item.label}</option>)}</select>:null}{canEdit&&next?<div className="status-inline-editor">{needsDate?<input type="datetime-local" aria-label="Schedule date and time" value={when} onChange={(event)=>setWhen(event.target.value)}/>:null}<input aria-label="Status remarks" placeholder="Add remark (optional)" value={remarks} onChange={(event)=>setRemarks(event.target.value)}/><button disabled={(needsDate&&!when)||busy} onClick={()=>void apply()}>Save</button><button onClick={()=>{setNext("");setWhen("");setRemarks("");}}>×</button></div>:null}</div>;
}

function InterviewOutcomeControl({ lead, busy, canEdit, update, options }: {
  lead:Lead;
  busy:boolean;
  canEdit:boolean;
  update:(lead:Lead,status:string,details?:{interviewAt?:string|null;callbackAt?:string|null;remarks?:string})=>Promise<void>;
  options:any[];
}) {
  const [next,setNext]=useState("");
  const [when,setWhen]=useState("");
  const [remarks,setRemarks]=useState("");
  const outcomes = workforceInterviewActionOptions(options);
  const selected = outcomes.find((item)=>item.code===next);
  const scheduleType=workforceStatusScheduleType(next,selected?.scheduleType);
  const needsDate = selected?.requiresDate===true;
  async function apply() {
    await update(lead,next,{
      interviewAt:scheduleType==="interview"?localInputToIso(when):undefined,
      callbackAt:scheduleType==="callback"?localInputToIso(when):undefined,
      remarks
    });
    setNext("");setWhen("");setRemarks("");
  }
  return <div className="compact-status interview-outcome"><span className={`status status-${lead.status||"new"} status-tone-${statusTone(lead.status||"new")}`}>{statusLabel(lead.status||"new")}</span>{canEdit?<select value={next} disabled={busy} aria-label={`Interview outcome for ${lead.full_name||"candidate"}`} onChange={(event)=>{setNext(event.target.value);setWhen("");setRemarks("");}}><option value="">Record Outcome…</option>{outcomes.map((item)=><option key={item.code} value={item.code}>{item.label}</option>)}</select>:null}{canEdit&&next?<div className="status-inline-editor">{needsDate?<input type="datetime-local" aria-label={selected?.scheduleType==="interview"?"New interview date and time":"Call back date and time"} value={when} onChange={(event)=>setWhen(event.target.value)}/>:null}<input placeholder="Remarks (optional)" value={remarks} onChange={(event)=>setRemarks(event.target.value)}/><button disabled={busy||(needsDate&&!when)} onClick={()=>void apply()}>Save</button><button onClick={()=>{setNext("");setWhen("");setRemarks("");}}>×</button></div>:null}</div>;
}

function JoiningRecord({lead,history,token,busy,refresh}:{lead:any;history:any[];token:string;busy:boolean;refresh:(id:string)=>Promise<void>}) {
  const latest=history.find((event)=>["workforce_onboarding_requested","workforce_joining_record","workforce_onboarding_activated"].includes(event.event_type));
  const [email,setEmail]=useState(lead.email??"");
  const [providerEmployeeId,setProviderEmployeeId]=useState(latest?.metadata?.provider_employee_id??"");
  const [notice,setNotice]=useState("");
  async function save() {
    setNotice("");
    try {
      const response=await fetch(`/api/recruitment/leads/${lead.id}/joining`,{method:"POST",headers:{...headers(token),"Content-Type":"application/json"},body:JSON.stringify({email,providerEmployeeId,joiningDate:istDate(),telecallerProfileId:latest?.metadata?.telecaller_profile_id||lead.assigned_profile_id||undefined,fieldRecruiterProfileId:latest?.metadata?.field_recruiter_profile_id||undefined})});
      const body=await response.json();
      if(!response.ok)throw new Error(body.error||"Unable to save joining record.");
      setNotice(body.message);await refresh(lead.id);
    } catch(error){setNotice(error instanceof Error?error.message:"Unable to save joining record.");}
  }
  return <section className="joining-record"><h3>Request associate onboarding</h3><p className="panel-help">Candidate name, mobile, station and joining date come from this lead. DropX and biometric IDs are reserved by the system; only HO Workforce can activate them.</p><div className="joining-grid"><label>Email ID *<input type="email" value={email} onChange={(event)=>setEmail(event.target.value)} placeholder="candidate@example.com"/></label><label>Amazon Comp ID (if already available)<input value={providerEmployeeId} onChange={(event)=>setProviderEmployeeId(event.target.value)} placeholder="HO can complete this later"/></label></div><p className="attribution-note">Telecaller: {lead.assigned_profile?.full_name||lead.assigned_profile?.email||"Will be attributed from the acting telecaller"} • Initiator, candidate submission, HO review and activation remain separately audited.</p><button className="primary-action" disabled={Boolean(latest)||busy||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())} onClick={()=>void save()}>{latest?"Onboarding already requested":"Send onboarding invitation"}</button>{notice?<p className="connection-notice">{notice}</p>:null}{latest?<small>Requested by {latest.actor_email||"recruitment user"} on {new Date(latest.created_at).toLocaleString("en-IN")}</small>:null}</section>;
}

const invitationProfileFields = [
  ["full_name","Full name"],
  ["mobile_country_code","Mobile country code"],
  ["mobile","Mobile number"],
  ["email","Email"],
  ["date_of_join","Expected joining date"],
  ["location_code","Preferred station"],
  ["designation","Role"]
] as const;

function changedInvitationFields(request:any){
  const current=request?.current_values??{};
  const proposed=request?.proposed_values??{};
  return invitationProfileFields.filter(([key])=>String(current[key]??"")!==String(proposed[key]??""));
}

function FieldExecutiveOnboarding({initialData,token,user,canEdit}:{initialData:any;token:string;user:User;canEdit:boolean}) {
  const [data,setData]=useState<any>(initialData);
  const [search,setSearch]=useState("");
  const [scope,setScope]=useState<"mine"|"team"|"all">("mine");
  const [status,setStatus]=useState("");
  const [station,setStation]=useState("");
  const [designation,setDesignation]=useState("");
  const [page,setPage]=useState(1);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState("");
  const [showForm,setShowForm]=useState(false);
  const [selectedExecutive,setSelectedExecutive]=useState<any>(null);
  const [editingExecutive,setEditingExecutive]=useState(false);
  const [closingExecutive,setClosingExecutive]=useState<any>(null);
  const [closureForm,setClosureForm]=useState({category:"",reasonCode:"",notes:""});
  const [reviewNotes,setReviewNotes]=useState<Record<string,string>>({});
  const [form,setForm]=useState({fullName:"",mobileCountryCode:"91",mobile:"",email:"",joiningDate:istDate(),locationCode:"",designation:""});
  const [editForm,setEditForm]=useState({fullName:"",mobileCountryCode:"91",mobile:"",email:"",joiningDate:"",locationCode:"",designation:""});
  const load=useCallback(async(nextPage=page,nextScope=scope)=>{
    setBusy(true);setNotice("");
    try{
      const params=new URLSearchParams({scope:nextScope,page:String(nextPage)});
      if(search.trim())params.set("search",search.trim());
      if(status)params.set("status",status);
      if(station)params.set("station",station);
      if(designation)params.set("designation",designation);
      const response=await fetch(`/api/recruitment/field-executives?${params}`,{headers:headers(token),cache:"no-store"});
      const payload=await response.json();if(!response.ok)throw new Error(payload.error||"Unable to load Associate History.");
      setData(payload);setPage(nextPage);setScope(nextScope);
    }catch(error){setNotice(error instanceof Error?error.message:"Unable to load Associate History.");}
    finally{setBusy(false);}
  },[designation,page,scope,search,station,status,token]);
  useEffect(()=>{setData(initialData);},[initialData]);
  async function create(){
    setBusy(true);setNotice("");
    try{
      const response=await fetch("/api/recruitment/field-executives",{method:"POST",headers:{...headers(token),"Content-Type":"application/json"},body:JSON.stringify(form)});
      const payload=await response.json();if(!response.ok)throw new Error(payload.error||"Unable to create Field Executive.");
      const notification=payload.created.notification;
      const whatsapp=notification?.status==="sent"
        ? " WhatsApp onboarding sent."
        : notification?.status==="skipped"
          ? ` WhatsApp skipped: ${notification.reason||"notification is disabled or incomplete"}.`
          : notification?.status==="failed"
            ? ` WhatsApp failed: ${notification.reason||"check WhatsApp Message Logs"}.`
            : " WhatsApp status unavailable.";
      setNotice(`${payload.message} DropX ID: ${payload.created.dropxId}. Biometric ID: ${payload.created.biometricId}.${whatsapp}`);
      setForm({fullName:"",mobileCountryCode:"91",mobile:"",email:"",joiningDate:istDate(),locationCode:"",designation:""});setShowForm(false);
      await load(1,"mine");
    }catch(error){setNotice(error instanceof Error?error.message:"Unable to create Field Executive.");}
    finally{setBusy(false);}
  }
  async function resetFilters(){
    setSearch("");setStatus("");setStation("");setDesignation("");setBusy(true);setNotice("");
    try{
      const response=await fetch(`/api/recruitment/field-executives?scope=${scope}&page=1`,{headers:headers(token),cache:"no-store"});
      const payload=await response.json();if(!response.ok)throw new Error(payload.error||"Unable to reset Associate History.");
      setData(payload);setPage(1);
    }catch(error){setNotice(error instanceof Error?error.message:"Unable to reset Associate History.");}
    finally{setBusy(false);}
  }
  function openExecutive(item:any,edit=false){
    setSelectedExecutive(item);setEditingExecutive(edit);
    setEditForm({
      fullName:item.full_name??"",
      mobileCountryCode:item.mobile_country_code??"91",
      mobile:item.mobile??"",
      email:item.email??"",
      joiningDate:item.date_of_join??"",
      locationCode:item.stations?.station_code??"",
      designation:item.designation??""
    });
  }
  async function requestProfileChange(){
    if(!selectedExecutive)return;
    setBusy(true);setNotice("");
    try{
      const response=await fetch("/api/recruitment/field-executives",{method:"PATCH",headers:{...headers(token),"Content-Type":"application/json"},body:JSON.stringify({action:"request_change",id:selectedExecutive.id,...editForm})});
      const payload=await response.json();if(!response.ok)throw new Error(payload.error||"Unable to request the profile correction.");
      setNotice(payload.message);setSelectedExecutive(null);setEditingExecutive(false);await load(page,scope);
    }catch(error){setNotice(error instanceof Error?error.message:"Unable to request the profile correction.");}
    finally{setBusy(false);}
  }
  async function reviewProfileChange(requestId:string,decision:"approved"|"rejected"){
    setBusy(true);setNotice("");
    try{
      const response=await fetch("/api/recruitment/field-executives",{method:"PATCH",headers:{...headers(token),"Content-Type":"application/json"},body:JSON.stringify({action:"review_change",requestId,decision,reviewNote:reviewNotes[requestId]??""})});
      const payload=await response.json();if(!response.ok)throw new Error(payload.error||"Unable to review the profile correction.");
      setNotice(payload.message);setReviewNotes((current)=>({...current,[requestId]:""}));await load(page,scope);
    }catch(error){setNotice(error instanceof Error?error.message:"Unable to review the profile correction.");}
    finally{setBusy(false);}
  }
  function openClosure(item:any){
    setClosingExecutive(item);setClosureForm({category:"",reasonCode:"",notes:""});
  }
  async function closeInvitation(){
    if(!closingExecutive)return;
    setBusy(true);setNotice("");
    try{
      const response=await fetch("/api/recruitment/field-executives",{method:"PATCH",headers:{...headers(token),"Content-Type":"application/json"},body:JSON.stringify({action:"close_invitation",id:closingExecutive.id,...closureForm})});
      const payload=await response.json();if(!response.ok)throw new Error(payload.error||"Unable to close the invitation.");
      setNotice(payload.message);setClosingExecutive(null);setSelectedExecutive(null);await load(page,scope);
    }catch(error){setNotice(error instanceof Error?error.message:"Unable to close the invitation.");}
    finally{setBusy(false);}
  }
  const executives=data?.executives??[];
  const statusOptions=data?.facets?.statuses??["pending","submitted","under_review","returned","active","inactive"];
  const masterLocations=data?.master?.locations??[];
  const masterDesignations=data?.master?.designations??[];
  const closeReasonMaster=data?.master?.invitationCloseReasons??[];
  const closureReasons=closeReasonMaster.filter((item:any)=>item.category===closureForm.category);
  const selectedClosureReason=closureReasons.find((item:any)=>item.code===closureForm.reasonCode);
  const closureReady=Boolean(closureForm.category&&closureForm.reasonCode&&(!selectedClosureReason?.comment_required||closureForm.notes.trim().length>=5));
  const selectedLocation=masterLocations.find((item:any)=>item.code===form.locationCode);
  const availableDesignations=masterDesignations.filter((item:any)=>{
    const modelIds=Array.isArray(item.modelIds)?item.modelIds.map(String):[];
    return !modelIds.length||!selectedLocation?.modelId||modelIds.includes(String(selectedLocation.modelId));
  });
  const selectedEditLocation=masterLocations.find((item:any)=>item.code===editForm.locationCode);
  const availableEditDesignations=masterDesignations.filter((item:any)=>{
    const modelIds=Array.isArray(item.modelIds)?item.modelIds.map(String):[];
    return !modelIds.length||!selectedEditLocation?.modelId||modelIds.includes(String(selectedEditLocation.modelId));
  });
  const editReady=editForm.fullName.trim()&&/^\d{10}$/.test(editForm.mobile)&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(editForm.email.trim())&&editForm.joiningDate&&editForm.locationCode&&editForm.designation;
  const influencer=user.recruitmentFunction==="influencer";
  return <section className="onboarding-view">
    <header className="onboarding-hero"><div><span>{influencer?"INFLUENCER REFERRAL":"WORKFORCE ONBOARDING"}</span><h2>{influencer?"Refer a Delivery Associate":"Field Executive Onboarding"}</h2><p>{influencer?"Initiate a candidate registration. DropX verifies duplicates and completes screening, approval, onboarding and deployment.":"The same shared profile, location master, designation rules and ID lifecycle used by the main dashboard."}</p></div>{canEdit?<button className="primary-action" onClick={()=>setShowForm((value)=>!value)}>{showForm?"Close form":influencer?"+ Refer Candidate":"+ Onboard Field Executive"}</button>:null}</header>
    {canEdit&&showForm?<section className="content-card onboarding-form"><div className="access-section-head"><div><h2>{influencer?"New candidate referral":"New Field Executive"}</h2><p>{influencer?"Enter the candidate’s verified contact, preferred station and DA role. Existing or duplicate candidates remain with their original source.":"Create the core profile here. The associate completes the remaining identity, bank, vehicle and document fields through the existing onboarding flow."}</p></div></div><div className="onboarding-form-grid"><label>Full name<input autoFocus value={form.fullName} onChange={(event)=>setForm({...form,fullName:event.target.value})}/></label><label>Mobile number<span className="phone-entry"><input aria-label="Country code" inputMode="numeric" value={form.mobileCountryCode} onChange={(event)=>setForm({...form,mobileCountryCode:event.target.value.replace(/\D/g,"").slice(0,4)})}/><input aria-label="Mobile number" inputMode="numeric" value={form.mobile} onChange={(event)=>setForm({...form,mobile:event.target.value.replace(/\D/g,"").slice(0,15)})}/></span></label><label>Email<input type="email" value={form.email} onChange={(event)=>setForm({...form,email:event.target.value})}/></label><label>Expected joining date<input type="date" value={form.joiningDate} onChange={(event)=>setForm({...form,joiningDate:event.target.value})}/></label><SearchSelect label="Preferred station" value={form.locationCode} options={masterLocations.map((item:any)=>[item.code,`${item.code} — ${item.name}`])} onChange={(value)=>setForm({...form,locationCode:value,designation:""})}/><SearchSelect label="Role" value={form.designation} options={availableDesignations.map((item:any)=>[item.name,`${item.code} — ${item.name}`])} onChange={(value)=>setForm({...form,designation:value})}/></div><div className="form-actions"><button className="primary-action" disabled={busy||!form.fullName.trim()||form.mobile.length<6||!form.email.trim()||!form.locationCode||!form.designation||!form.joiningDate} onClick={()=>void create()}>{busy?"Checking and creating…":influencer?"Submit Referral":"Create Field Executive"}</button></div></section>:null}
    {data?.canApproveChanges&&(data?.approvalQueue??[]).length?<section className="content-card profile-change-approvals">
      <div className="onboarding-history-head"><div><h2>Profile change approvals</h2><p>Only invitation details are shown. A Business Head or Owner may approve or reject each correction.</p></div><strong>{data.approvalQueue.length} pending</strong></div>
      <div className="profile-change-approval-list">{data.approvalQueue.map((request:any)=><article key={request.id}>
        <header><div><h3>{request.executive?.full_name||"Field Executive"}</h3><p>{request.executive?.dropx_id||"ID pending"} · requested by {request.requestedBy}</p></div><time>{new Date(request.created_at).toLocaleString("en-IN")}</time></header>
        <div className="profile-change-diff">{changedInvitationFields(request).map(([key,label])=><div key={key}><span>{label}</span><del>{String(request.current_values?.[key]??"—")}</del><strong>{String(request.proposed_values?.[key]??"—")}</strong></div>)}</div>
        <footer><input aria-label={`Review note for ${request.executive?.full_name||"profile"}`} placeholder="Approval note (required for rejection)" value={reviewNotes[request.id]??""} onChange={(event)=>setReviewNotes((current)=>({...current,[request.id]:event.target.value}))}/><button className="secondary-action" disabled={busy} onClick={()=>void reviewProfileChange(request.id,"approved")}>Approve</button><button className="danger-action" disabled={busy||!(reviewNotes[request.id]??"").trim()} onClick={()=>void reviewProfileChange(request.id,"rejected")}>Reject</button></footer>
      </article>)}</div>
    </section>:null}
    {notice?<div className={/(created|sent|approved|applied|rejected)/i.test(notice)?"success-banner":"error-banner"}>{notice}</div>:null}
    <section className="content-card onboarding-history">
      <div className="onboarding-history-head"><div><h2>{influencer?"My Referrals":"Associate History"}</h2><p>Only associates initiated by {user.name||"you"} are shown by default.</p></div><div className="scope-switch"><button className={scope==="mine"?"selected":""} onClick={()=>void load(1,"mine")}>My Initiations</button>{data?.canViewTeam?<button className={scope==="team"?"selected":""} onClick={()=>void load(1,"team")}>My Team</button>:null}{data?.canViewAll?<button className={scope==="all"?"selected":""} onClick={()=>void load(1,"all")}>All</button>:null}</div></div>
      <div className="toolbar filter-toolbar"><input placeholder="Name, mobile, email, DropX or biometric ID…" value={search} onChange={(event)=>setSearch(event.target.value)} onKeyDown={(event)=>{if(event.key==="Enter")void load(1);}}/><MultiFilter label="Status" value={status} options={statusOptions.map((item:string)=>[item,workforceOnboardingStatusLabel(item)])} onChange={setStatus}/><MultiFilter label="Locations" value={station} options={masterLocations.map((item:any)=>[item.code,`${item.code} — ${item.name}`])} onChange={setStation}/><MultiFilter label="Designations" value={designation} options={masterDesignations.map((item:any)=>[item.name,`${item.code} — ${item.name}`])} onChange={setDesignation}/><button disabled={busy} onClick={()=>void load(1)}>{busy?"Applying…":"Apply filters"}</button><button className="reset-btn" onClick={()=>void resetFilters()}>Reset</button></div>
      <div className="associate-history-grid">{executives.map((item:any)=>{
        const stage=workforceOnboardingStage(item);
        return <article key={item.id}><header><span className={`status status-${stage.code}`}>{stage.label}</span><small>{item.date_of_join?new Date(`${item.date_of_join}T00:00:00`).toLocaleDateString("en-IN"):"—"}</small></header><h3>{item.full_name}</h3><a href={`tel:+${item.mobile_country_code||"91"}${item.mobile}`}>+{item.mobile_country_code||"91"} {item.mobile}</a><dl><span><dt>DropX ID</dt><dd>{item.dropx_id||"Pending"}</dd></span><span><dt>Biometric</dt><dd>{item.biometric_id||"Pending"}</dd></span><span><dt>Station</dt><dd>{item.stations?.station_code||"—"}</dd></span><span><dt>Designation</dt><dd>{item.designation||"—"}</dd></span></dl>{item.changeRequest?.status==="pending"?<p className="profile-change-state">Correction pending Business Head / Owner approval</p>:item.changeRequest?.status==="rejected"?<p className="profile-change-state rejected">Last correction rejected{item.changeRequest.review_note?`: ${item.changeRequest.review_note}`:""}</p>:null}{item.closure?<p className="invitation-closure-state"><b>{item.closure.metadata?.reason_label||"Invitation closed"}</b><span>{item.closure.closedBy} · {new Date(item.closure.created_at).toLocaleString("en-IN")}</span>{item.closure.metadata?.notes?<em>{item.closure.metadata.notes}</em>:null}</p>:null}<footer><span>Initiated by <b>{item.initiatedBy}</b></span><div><button onClick={()=>openExecutive(item,false)}>View</button>{item.canRequestEdit?<button onClick={()=>openExecutive(item,true)}>Edit</button>:null}{item.canCloseInvitation?<button className="close-invitation-action" onClick={()=>openClosure(item)}>Close invitation</button>:null}</div></footer></article>;
      })}</div>
      {!busy&&!executives.length?<div className="empty">No Field Executives match this view. “My Initiations” only shows associates created by your login.</div>:null}
      <div className="pager"><button disabled={page<=1||busy} onClick={()=>void load(page-1)}>Previous</button><span>Page {page} of {Math.max(1,Math.ceil(Number(data?.total||0)/50))}</span><button disabled={page*50>=Number(data?.total||0)||busy} onClick={()=>void load(page+1)}>Next</button></div>
    </section>
    {selectedExecutive?<div className="profile-change-backdrop" onMouseDown={(event)=>{if(event.currentTarget===event.target&&!busy)setSelectedExecutive(null);}}><section aria-modal="true" className="profile-change-dialog" role="dialog">
      <header><div><span>{editingExecutive?"REQUEST CORRECTION":"INVITATION PROFILE"}</span><h2>{selectedExecutive.full_name}</h2><p>{editingExecutive?"Only the invitation details entered during onboarding can be corrected. Approval is required before the live profile changes.":"This view intentionally excludes bank, KYC, statutory, vehicle and document details."}</p></div><button aria-label="Close profile" disabled={busy} onClick={()=>setSelectedExecutive(null)}>×</button></header>
      {editingExecutive?<><div className="profile-change-form"><label>Full name<input autoFocus value={editForm.fullName} onChange={(event)=>setEditForm({...editForm,fullName:event.target.value})}/></label><label>Mobile number<span className="phone-entry"><input aria-label="Country code" inputMode="numeric" value={editForm.mobileCountryCode} onChange={(event)=>setEditForm({...editForm,mobileCountryCode:event.target.value.replace(/\D/g,"").slice(0,4)})}/><input aria-label="Mobile number" inputMode="numeric" value={editForm.mobile} onChange={(event)=>setEditForm({...editForm,mobile:event.target.value.replace(/\D/g,"").slice(0,10)})}/></span></label><label>Email<input type="email" value={editForm.email} onChange={(event)=>setEditForm({...editForm,email:event.target.value})}/></label><label>Expected joining date<input type="date" value={editForm.joiningDate} onChange={(event)=>setEditForm({...editForm,joiningDate:event.target.value})}/></label><SearchSelect label="Preferred station" value={editForm.locationCode} options={masterLocations.map((item:any)=>[item.code,`${item.code} — ${item.name}`])} onChange={(value)=>setEditForm({...editForm,locationCode:value,designation:""})}/><SearchSelect label="Role" value={editForm.designation} options={availableEditDesignations.map((item:any)=>[item.name,`${item.code} — ${item.name}`])} onChange={(value)=>setEditForm({...editForm,designation:value})}/></div><div className="profile-change-dialog-actions"><button className="secondary-action" disabled={busy} onClick={()=>setEditingExecutive(false)}>Back to view</button><button className="primary-action" disabled={busy||!editReady} onClick={()=>void requestProfileChange()}>{busy?"Submitting…":"Send for approval"}</button></div></>:<><div className="profile-invitation-facts"><div><span>Status</span><strong>{workforceOnboardingStage(selectedExecutive).label}</strong></div><div><span>Full name</span><strong>{selectedExecutive.full_name||"—"}</strong></div><div><span>Mobile</span><strong>+{selectedExecutive.mobile_country_code||"91"} {selectedExecutive.mobile||"—"}</strong></div><div><span>Email</span><strong>{selectedExecutive.email||"—"}</strong></div><div><span>Expected joining</span><strong>{selectedExecutive.date_of_join||"—"}</strong></div><div><span>Preferred station</span><strong>{selectedExecutive.stations?.station_code||"—"}</strong></div><div><span>Role</span><strong>{selectedExecutive.designation||"—"}</strong></div><div><span>Initiated by</span><strong>{selectedExecutive.initiatedBy||"—"}</strong></div>{selectedExecutive.closure?<><div><span>Closure reason</span><strong>{selectedExecutive.closure.metadata?.reason_label||selectedExecutive.closure.remarks||"—"}</strong></div><div><span>Closed by</span><strong>{selectedExecutive.closure.closedBy||"—"} · {new Date(selectedExecutive.closure.created_at).toLocaleString("en-IN")}</strong></div></>:null}</div><div className="profile-change-dialog-actions"><button className="secondary-action" onClick={()=>setSelectedExecutive(null)}>Close</button>{selectedExecutive.canCloseInvitation?<button className="danger-action" onClick={()=>openClosure(selectedExecutive)}>Close invitation</button>:null}{selectedExecutive.canRequestEdit?<button className="primary-action" onClick={()=>setEditingExecutive(true)}>Edit invitation details</button>:null}</div></>}
    </section></div>:null}
    {closingExecutive?<div className="profile-change-backdrop" onMouseDown={(event)=>{if(event.currentTarget===event.target&&!busy)setClosingExecutive(null);}}><section aria-modal="true" aria-labelledby="close-invitation-title" className="profile-change-dialog invitation-closure-dialog" role="dialog">
      <header><div><span>AUDITED INVITATION CLOSURE</span><h2 id="close-invitation-title">Close {closingExecutive.full_name}’s invitation?</h2><p>This does not delete the profile or reserved IDs. It stops registration and keeps the decision, reason, actor and time in the audit history.</p></div><button aria-label="Close dialog" disabled={busy} onClick={()=>setClosingExecutive(null)}>×</button></header>
      <div className="invitation-closure-form"><fieldset><legend>Whose decision is this?</legend><label><input type="radio" name="closure-category" checked={closureForm.category==="business"} onChange={()=>setClosureForm({category:"business",reasonCode:"",notes:closureForm.notes})}/><span><b>Business decision</b><small>Operational requirement or eligibility changed</small></span></label><label><input type="radio" name="closure-category" checked={closureForm.category==="candidate"} onChange={()=>setClosureForm({category:"candidate",reasonCode:"",notes:closureForm.notes})}/><span><b>Candidate decision</b><small>Candidate chose not to continue</small></span></label><label><input type="radio" name="closure-category" checked={closureForm.category==="no_response"} onChange={()=>setClosureForm({category:"no_response",reasonCode:"",notes:closureForm.notes})}/><span><b>Not responding</b><small>Registration remained incomplete after follow-up</small></span></label></fieldset>{closureForm.category?<label>Reason<select autoFocus value={closureForm.reasonCode} onChange={(event)=>setClosureForm({...closureForm,reasonCode:event.target.value})}><option value="">Select a reason</option>{closureReasons.map((reason:any)=><option key={reason.code} value={reason.code}>{reason.label}</option>)}</select>{selectedClosureReason?.description?<small>{selectedClosureReason.description}</small>:null}</label>:null}{closureForm.reasonCode?<label>Decision note {selectedClosureReason?.comment_required?"*":"(optional)"}<textarea rows={4} maxLength={1000} value={closureForm.notes} onChange={(event)=>setClosureForm({...closureForm,notes:event.target.value})} placeholder={selectedClosureReason?.comment_required?"Add the specific context for audit":"Add useful follow-up or context"}/></label>:null}</div>
      <div className="profile-change-dialog-actions"><button className="secondary-action" disabled={busy} onClick={()=>setClosingExecutive(null)}>Keep invitation</button><button className="danger-action" disabled={busy||!closureReady} onClick={()=>void closeInvitation()}>{busy?"Closing…":"Close invitation"}</button></div>
    </section></div>:null}
  </section>;
}

function DaInAppOnboarding({token,canEdit}:{token:string;canEdit:boolean}) {
  const [readiness,setReadiness]=useState<any>(null);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState("");
  const [status,setStatus]=useState("pending");
  const [station,setStation]=useState("");
  const [cluster,setCluster]=useState("");
  const [sort,setSort]=useState("oldest");
  const [search,setSearch]=useState("");
  const load=useCallback(async()=>{
    setBusy(true);setNotice("");
    try{
      const params=new URLSearchParams({status,page:"1"});
      if(station)params.set("station",station);
      if(cluster)params.set("cluster",cluster);
      params.set("sort",sort);
      if(search.trim())params.set("search",search.trim());
      const response=await fetch(`/api/recruitment/danap-onboarding?${params}`,{headers:headers(token),cache:"no-store"});
      const payload=await response.json();if(!response.ok)throw new Error(payload.error||"Unable to load DA in-app onboarding.");
      setReadiness(payload);
    }catch(error){setNotice(error instanceof Error?error.message:"Unable to load DA in-app onboarding.");}
    finally{setBusy(false);}
  },[cluster,search,sort,station,status,token]);
  useEffect(()=>{void load();},[]); // eslint-disable-line react-hooks/exhaustive-deps
  const initialLoading=busy&&readiness===null;
  const metricValue=(value:unknown)=>initialLoading?"…":String(value??0);
  const latestSource=readiness?.source;
  const latestSourceStatus=String(latestSource?.status||"").trim();
  const latestSourceHasIssue=Boolean(latestSource)&&(Number(latestSource?.importedCases||0)===0||["failed","error"].includes(latestSourceStatus.toLowerCase()));
  const visibility=initialLoading
    ? "Checking secure access scope…"
    : readiness?.visibility==="mine"
      ? "Recruiter view: only DAs initiated by your login"
      : readiness?.visibility==="all"
        ? "Oversight view: all DA In-App onboarding cases"
        : readiness
          ? "Location-scoped oversight view"
          : "Access scope unavailable";
  return <section className="onboarding-view">
    <header className="onboarding-hero"><div><span>AMAZON ONBOARDING TRACKER</span><h2>DA In-App Onboarding</h2><p>Daily pending reasons, aging, proof, closure, and recruiter-safe visibility from the Report Imports feed.</p></div><strong>{initialLoading?"Loading…":`${readiness?.total??0} cases`}</strong></header>
    <section className="content-card danap-readiness" aria-busy={initialLoading}>
      <div className="danap-source-banner"><div><strong>{initialLoading?"Loading latest DA In-App import…":latestSource?.fileName||"No DA In-App import found"}</strong><span>{initialLoading?"Checking Report Imports and applying your access scope.":latestSource?`Latest upload ${new Date(latestSource.uploadedAt).toLocaleString("en-IN")} • ${latestSource.importedCases} cases${latestSourceStatus&&latestSourceStatus.toLowerCase()!=="completed"?` • ${latestSourceStatus}`:""}`:"Upload the daily DA In-App file in Report Imports."}</span></div><em>{visibility}</em></div>
      {latestSourceHasIssue?<div className="danap-link-warning danap-contact-warning"><strong>The latest DA In-App upload did not produce usable cases.</strong><span>{latestSource?.message||"Check the uploaded columns and import result."} The dashboard is intentionally not showing records from an older file.</span></div>:null}
      <div className="danap-metrics"><span><b>{metricValue(readiness?.metrics?.pending)}</b> Pending</span><span><b>{metricValue(readiness?.metrics?.cleared)}</b> Cleared</span><span><b>{metricValue(readiness?.metrics?.oldestPending)}</b> Oldest days</span><span><b>{metricValue(readiness?.metrics?.videoPending)}</b> Video pending</span><span><b>{metricValue(readiness?.metrics?.nhda)}</b> NHDA</span></div>
      {readiness?.visibility==="all"&&Number(readiness?.metrics?.unmatched||0)>0?<div className="danap-link-warning"><strong>{readiness.metrics.unmatched} imported legacy case{readiness.metrics.unmatched===1?"":"s"} are not yet linked to a recruiter initiation.</strong><span>They remain visible to oversight roles only; recruiter/telecaller access will never guess by name.</span></div>:null}
      {Number(readiness?.metrics?.missingContact||0)>0?<div className="danap-link-warning danap-contact-warning"><strong>{readiness.metrics.missingContact} case{readiness.metrics.missingContact===1?"":"s"} have no candidate or Station POC contact number.</strong><span>Add the missing number in Station Contacts master; the dashboard will use it automatically.</span></div>:null}
      <div className="toolbar filter-toolbar danap-toolbar"><input placeholder="DA, contact, ID, station or owner…" value={search} onChange={(event)=>setSearch(event.target.value)} onKeyDown={(event)=>{if(event.key==="Enter")void load();}}/><FilterSelect label="Status" value={status} options={[["pending","Pending"],["cleared","Cleared"],["all","All"]]} onChange={setStatus}/><MultiFilter label="Stations" value={station} options={(readiness?.stationOptions??[]).map((item:any)=>[item.code,`${item.code} — ${item.name}`])} onChange={setStation}/><MultiFilter label="Operational owners" value={cluster} options={(readiness?.clusters??[]).map((item:string)=>[item,item])} onChange={setCluster}/><FilterSelect label="Sort" value={sort} options={[["oldest","Oldest pending first"],["newest","Newest pending first"],["station","Station code"],["candidate","Candidate name"]]} onChange={setSort}/><button onClick={()=>void load()} disabled={busy}>{busy?"Loading…":"Apply"}</button>{station||cluster||status!=="pending"||sort!=="oldest"||search?<button className="reset-btn" onClick={()=>{setStation("");setCluster("");setStatus("pending");setSort("oldest");setSearch("");}}>Reset</button>:null}</div>
      {notice?<div className="error-banner">{notice}</div>:null}
      <div className="danap-mobile-cards">{(readiness?.records??[]).map((record:any)=><DanapReadinessCard key={record.id} record={record} token={token} canEdit={canEdit} onSaved={load}/>)}</div>
      {!busy&&readiness&&!(readiness.records??[]).length?<div className="empty">No DA in-app onboarding cases match this view.</div>:null}
    </section>
  </section>;
}

function DanapReadinessCard({record,token,canEdit,onSaved}:{record:any;token:string;canEdit:boolean;onSaved:()=>Promise<void>}) {
  const dependency=record.dependency||"other";
  const [subStatus,setSubStatus]=useState(record.subStatus||"pending");
  const [remarks,setRemarks]=useState(record.remarks||"");
  const [videoStatus,setVideoStatus]=useState(record.videoStatus||"pending");
  const [certificate,setCertificate]=useState<File|null>(null);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState("");
  const subStatusOptions=daSubStatusOptions(dependency);
  const actionLabel=daDependencyLabel(dependency);
  async function save(){
    setBusy(true);setNotice("");
    try{
      const form=new FormData();form.set("id",record.id);form.set("subStatus",dependency==="video_verification"?(videoStatus==="done"?"completed":"pending"):subStatus);form.set("remarks",remarks);form.set("videoStatus",videoStatus);if(certificate)form.set("certificate",certificate);
      const response=await fetch("/api/recruitment/danap-onboarding",{method:"PATCH",headers:headers(token),body:form});
      const payload=await response.json();if(!response.ok)throw new Error(payload.error||"Unable to save.");
      setNotice("Saved");await onSaved();
    }catch(error){setNotice(error instanceof Error?error.message:"Unable to save.");}
    finally{setBusy(false);}
  }
  return <article>
    <header><div><h3>{record.daName||"Unnamed DA"}</h3><small>{record.rabbitId||"No Rabbit ID"}</small></div><div className="danap-card-status"><span className={`status status-${record.clearanceStatus}`}>{statusLabel(record.clearanceStatus)}</span><b>{record.agingDays??0} day{record.agingDays===1?"":"s"}</b></div></header>
    <dl className="danap-card-facts"><span><dt>Transporter ID</dt><dd>{record.transporterId||"—"}</dd></span><span><dt>Station</dt><dd>{record.station||"Unmapped"}{record.stationName&&record.stationName!==record.station?<small>{record.stationName}</small>:null}</dd></span><span><dt>Operational owner</dt><dd>{record.cluster||"Not mapped in People"}{record.crmName&&record.crmName!==record.cluster?<small>{record.crmName}</small>:null}</dd></span><span><dt>Pending since</dt><dd>{record.pendingSince||"—"}</dd></span><span className={`danap-contact danap-contact-${record.contact?.source||"missing"}`}><dt>{record.contact?.label||"Contact unavailable"}</dt><dd>{record.contact?.phone?<><a href={`tel:+91${phoneDigits(record.contact.phone)}`}>{displayPhone(record.contact.phone)}</a>{record.contact.name?<small>{record.contact.name}</small>:null}</>:<small>Update the Station Contacts master</small>}</dd></span></dl>
    <p className="danap-source-action"><b>Action required:</b> {record.sourceAction||record.sourceReason||"Complete onboarding action"}<small>{record.sourceReason&&record.sourceReason!==record.sourceAction?record.sourceReason:""}</small></p>
    <details className="danap-card-update"><summary><span><b>{actionLabel}</b><small>{subStatusOptions.find((option)=>option.value===subStatus)?.label||statusLabel(subStatus)} · Video {videoStatus==="done"?"completed":"pending"}</small></span><strong>{canEdit?"Update":"View"} ▾</strong></summary><fieldset disabled={!canEdit} className={!canEdit?"read-only-fieldset":undefined}><div className="danap-card-fields"><div className="danap-action-type"><span>Source-defined action</span><strong>{actionLabel}</strong></div>{dependency!=="video_verification"?<label>Action status<select value={subStatus} onChange={(event)=>setSubStatus(event.target.value)}>{subStatusOptions.map((option)=><option key={option.value} value={option.value}>{option.label}</option>)}</select></label>:null}<label className="video-field">Video verification<select value={videoStatus} onChange={(event)=>setVideoStatus(event.target.value)}><option value="pending">Pending</option><option value="done">Completed</option></select></label>{dependency==="nhda"||record.certificate?<label>NHDA certificate<input type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={(event)=>setCertificate(event.target.files?.[0]??null)}/>{record.certificateUrl?<a href={record.certificateUrl} target="_blank" rel="noreferrer">View attached NHDA certificate</a>:<small>Required when NHDA course is completed</small>}</label>:null}<label className="danap-remarks">Remarks<textarea value={remarks} onChange={(event)=>setRemarks(event.target.value)} placeholder="Action taken or follow-up note"/></label></div></fieldset></details>
    <footer><small>{record.updatedBy?`Last updated by ${record.updatedBy}${record.updatedAt?` • ${new Date(record.updatedAt).toLocaleString("en-IN")}`:""}`:"Not yet updated"}</small><span>{notice}</span>{canEdit?<button onClick={()=>void save()} disabled={busy}>{busy?"Saving…":"Save update"}</button>:<small>View only</small>}</footer>
  </article>;
}

type HRCandidateAccess = {
  activity:RecruitmentMenuAccessLevel;
  screening:RecruitmentMenuAccessLevel;
  interviews:RecruitmentMenuAccessLevel;
  documents:RecruitmentMenuAccessLevel;
  offers:RecruitmentMenuAccessLevel;
};

function HRCandidateWorkspace({ leads, selected, busy, detailBusy, token, options, canManage, access, open, close, prefetch, refresh, save }: {
  leads:Lead[];
  selected:LeadDetail|null;
  busy:boolean;
  detailBusy:boolean;
  token:string;
  options:any;
  canManage:boolean;
  access:HRCandidateAccess;
  open:(id:string,force?:boolean)=>Promise<void>;
  close:()=>void;
  prefetch:(id:string)=>Promise<void>;
  refresh:(id:string,savedLead?:Record<string,unknown>|null)=>Promise<void>;
  save:(fields:Record<string,unknown>)=>Promise<void>;
}) {
  return <div className={`hr-workspace${selected?" has-selection":""}`}><aside className="hr-candidate-list">{leads.map((lead)=><button key={lead.id} className={selected?.lead.id===lead.id?"selected":""} onMouseEnter={()=>void prefetch(lead.id)} onFocus={()=>void prefetch(lead.id)} onClick={()=>void open(lead.id)}><span><b>{lead.full_name||"Unnamed candidate"}</b><small>{lead.recruitment_roles?.name||"Unmapped"} • {lead.recruitment_locations?.code||"No station"}</small></span><strong>{displayPhone(lead.phone)}</strong><em>{statusLabel(lead.status||"new")}</em></button>)}{!busy&&!leads.length?<p>No candidates match this pipeline.</p>:null}</aside><section className="hr-candidate-detail">{selected?<div className="hr-detail-shell"><button className="hr-mobile-back" type="button" onClick={close}>← Back to candidates</button><HRCandidatePanel key={`${selected.lead.id}:${selected.lead.updated_at}:${Object.prototype.hasOwnProperty.call(selected.lead,"questionnaire")?"full":"summary"}`} data={selected} busy={busy||detailBusy} token={token} options={options} canManage={canManage} access={access} refresh={refresh} save={save}/>{detailBusy?<div className="hr-detail-loading"><span className="loader"/><b>Loading latest profile…</b></div>:null}</div>:<div className="hr-empty-detail"><span>↗</span><h2>Select a candidate</h2><p>Open a profile here to screen, collect documents, coordinate interviews and record manager feedback without leaving the pipeline.</p></div>}</section></div>;
}

function HRCandidatePanel({ data, busy, token, options, canManage, access, refresh, save }: {
  data:LeadDetail;busy:boolean;token:string;options:any;canManage:boolean;access:HRCandidateAccess;refresh:(id:string,savedLead?:Record<string,unknown>|null)=>Promise<void>;save:(fields:Record<string,unknown>)=>Promise<void>;
}) {
  const lead=data.lead;
  const visible=(level:RecruitmentMenuAccessLevel)=>level!=="none";
  const editable=(level:RecruitmentMenuAccessLevel)=>level==="edit"||level==="all";
  const priorScreening=data.history.find((event:any)=>event.event_type==="hr_screening_profile");
  const latestForward=data.history.find((event:any)=>event.event_type==="hr_interview_forwarded");
  const [summary,setSummary]=useState(priorScreening?.remarks||lead.remarks||"");
  const [activityRemark,setActivityRemark]=useState(lead.remarks||"");
  const [activityCallback,setActivityCallback]=useState(isoToLocalInput(lead.callback_at));
  const permittedOutcomeCodes=new Set(allowedHrFirstCallOutcomeCodes(options.hrLifecycleRules,lead.status));
  const hrOutcomes=(options.hrStatuses??[]).filter((item:any)=>item.isActive!==false&&permittedOutcomeCodes.has(item.code));
  const maxInterviewRounds=Math.max(1,Math.min(10,Number(options.hrWorkflowSettings?.maxInterviewRounds)||2));
  const interviewRoundOptions=Array.from({length:maxInterviewRounds},(_,index)=>[String(index+1),`Round ${index+1}`] as [string,string]);
  const [firstOutcome,setFirstOutcome]=useState<string>(hrOutcomes[0]?.code||"");
  const selectedFirstOutcome=hrOutcomes.find((item:any)=>item.code===firstOutcome)??null;
  const firstAvailableOutcome=hrOutcomes[0]?.code||"";
  useEffect(()=>{ if(!firstOutcome&&firstAvailableOutcome)setFirstOutcome(firstAvailableOutcome); },[firstOutcome,firstAvailableOutcome]);
  const [currentSalary,setCurrentSalary]=useState(priorScreening?.metadata?.current_salary||"");
  const [expectedSalary,setExpectedSalary]=useState(priorScreening?.metadata?.expected_salary||"");
  const [noticePeriod,setNoticePeriod]=useState(priorScreening?.metadata?.notice_period||"");
  const [candidateCity,setCandidateCity]=useState(lead.city||"");
  const [candidatePostCode,setCandidatePostCode]=useState(lead.post_code||"");
  const locationOption=(options.locations??[]).find((item:any)=>item.id===lead.location_id);
  const recommendedManagerId=locationOption?.recommendedManagerByRole?.[lead.recruitment_roles?.code]||locationOption?.manager?.id||"";
  const hiringManagers=options.hiringManagers??[];
  const [managerId,setManagerId]=useState<string>(recommendedManagerId);
  const selectedManager=hiringManagers.find((item:any)=>item.id===managerId)??null;
  useEffect(()=>{
    if(recommendedManagerId)setManagerId((current)=>current||recommendedManagerId);
  },[recommendedManagerId]);
  const [round,setRound]=useState("1");
  const [scheduledAt,setScheduledAt]=useState("");
  const [interviewNote,setInterviewNote]=useState("");
  const [sendWhatsapp,setSendWhatsapp]=useState(true);
  const [sendEmail,setSendEmail]=useState(Boolean(lead.email));
  const [documentType,setDocumentType]=useState("resume");
  const [file,setFile]=useState<File|null>(null);
  const [replacementFiles,setReplacementFiles]=useState<Record<string,File|null>>({});
  const [documents,setDocuments]=useState<any[]>(data.documents??[]);
  const [documentsBusy,setDocumentsBusy]=useState(false);
  const [invitationDelivery,setInvitationDelivery]=useState<any>(latestForward?.metadata?.invitation_outcomes??null);
  const [offer,setOffer]=useState({variant:"non_statutory",jobTitle:lead.recruitment_roles?.name||"",compensation:"",joiningDate:"",probation:"3 months",notes:"",basic:"",hra:"",lta:"",specialAllowance:"",otherAllowance:"",employeePf:"",professionalTax:"",employerPf:""});
  const [offerVersions,setOfferVersions]=useState<any[]>([]);
  const [offersBusy,setOffersBusy]=useState(false);
  const [offerApprovalRequired,setOfferApprovalRequired]=useState(options.hrWorkflowSettings?.requireOfferApproval!==false);
  const [canApproveOffers,setCanApproveOffers]=useState(access.offers==="all");
  const [notice,setNotice]=useState("");
  const workflowRequestInFlight=useRef(false);
  const [workflowBusy,setWorkflowBusy]=useState(false);
  const loadDocuments=useCallback(async()=>{
    setDocumentsBusy(true);
    try{
      const response=await fetch(`/api/recruitment/leads/${lead.id}/documents`,{headers:headers(token),cache:"no-store"});
      const body=await response.json();
      if(response.ok)setDocuments(body.documents??[]);
    }finally{setDocumentsBusy(false);}
  },[lead.id,token]);
  useEffect(()=>{if(visible(access.documents))void loadDocuments();},[access.documents,loadDocuments]);
  const loadOffers=useCallback(async()=>{
    setOffersBusy(true);
    try{
      const response=await fetch(`/api/recruitment/leads/${lead.id}/offer-letter`,{headers:headers(token),cache:"no-store"});
      const body=await response.json();
      if(!response.ok)throw new Error(body.error||"Unable to load offers.");
      setOfferVersions(body.versions??[]);
      setOfferApprovalRequired(body.requireApproval!==false);
      setCanApproveOffers(body.canApprove===true);
    }catch(error){setNotice(error instanceof Error?error.message:"Unable to load offers.");}
    finally{setOffersBusy(false);}
  },[lead.id,token]);
  useEffect(()=>{if(visible(access.offers))void loadOffers();},[access.offers,loadOffers]);
  async function action(payload:Record<string,unknown>) {
    if(workflowRequestInFlight.current)return;
    workflowRequestInFlight.current=true;
    setWorkflowBusy(true);
    setNotice("");
    try {
      const clientRequestId=globalThis.crypto.randomUUID();
      const response=await fetch(`/api/recruitment/leads/${lead.id}/hr-workflow`,{method:"POST",headers:{...headers(token),"Content-Type":"application/json"},body:JSON.stringify({...payload,clientRequestId})});
      const body=await response.json();
      if(!response.ok){
        if(body.lead)await refresh(lead.id,body.lead);
        throw new Error(body.error||"Unable to update HR workflow.");
      }
      if(payload.action==="forward")setInvitationDelivery(body.outcomes??null);
      setNotice(body.message||"HR workflow updated.");
      await refresh(lead.id,body.lead??null);
    } catch(error) { setNotice(error instanceof Error?error.message:"Unable to update HR workflow."); }
    finally{
      workflowRequestInFlight.current=false;
      setWorkflowBusy(false);
    }
  }
  async function saveFirstCall() {
    if(selectedFirstOutcome?.scheduleType==="interview") {
      await action({
        action:"forward",round:1,managerId,scheduledAt:localInputToIso(scheduledAt),note:activityRemark,
        channels:[sendWhatsapp?"whatsapp":"",sendEmail?"email":""].filter(Boolean)
      });
      return;
    }
    await action({
      action:"initial_outcome",outcome:firstOutcome,remarks:activityRemark,
      callbackAt:selectedFirstOutcome?.scheduleType==="callback"?localInputToIso(activityCallback):null
    });
  }
  async function upload(replacePath?:string,replacementFile?:File|null) {
    const chosenFile=replacementFile??file;
    if(!chosenFile)return;
    setNotice("");
    const form=new FormData();form.set("file",chosenFile);form.set("documentType",documentType);
    if(replacePath)form.set("replacePath",replacePath);
    try {
      const response=await fetch(`/api/recruitment/leads/${lead.id}/documents`,{method:"POST",headers:headers(token),body:form});
      const body=await response.json();
      if(!response.ok)throw new Error(body.error||"Unable to upload document.");
      setFile(null);
      if(replacePath)setReplacementFiles((current)=>({...current,[replacePath]:null}));
      setNotice(replacePath?"Document replaced. The prior file was removed and both actions were audited.":"Document uploaded privately and added to the audit timeline.");
      await loadDocuments();
    } catch(error) { setNotice(error instanceof Error?error.message:"Unable to upload document."); }
  }
  async function removeDocument(document:any) {
    const reason=window.prompt(`Why are you deleting ${document.name}?`,`Wrong candidate document`);
    if(reason===null)return;
    setNotice("");
    try {
      const response=await fetch(`/api/recruitment/leads/${lead.id}/documents`,{method:"DELETE",headers:{...headers(token),"Content-Type":"application/json"},body:JSON.stringify({path:document.path,reason})});
      const body=await response.json();
      if(!response.ok)throw new Error(body.error||"Unable to delete document.");
      setNotice("Document deleted. The deletion and reason were added to the audit timeline.");
      await loadDocuments();
    } catch(error) { setNotice(error instanceof Error?error.message:"Unable to delete document."); }
  }
  async function offerAction(action:"draft"|"submit"|"approve"|"issue"|"withdraw",versionId?:string) {
    setNotice("");
    try {
      const note=action==="withdraw"?window.prompt("Why is this offer being withdrawn?",""):undefined;
      if(action==="withdraw"&&note===null)return;
      const response=await fetch(`/api/recruitment/leads/${lead.id}/offer-letter`,{method:"POST",headers:{...headers(token),"Content-Type":"application/json"},body:JSON.stringify({...offer,action,versionId,note})});
      const body=await response.json();
      if(!response.ok)throw new Error(body.error||"Unable to update offer.");
      setOfferVersions(body.versions??[]);
      setNotice(body.message||"Offer updated.");
      if(body.downloadUrl){
        const link=document.createElement("a");link.href=body.downloadUrl;link.target="_blank";link.rel="noreferrer";link.click();
      }
      if(action!=="draft")await refresh(lead.id);
    } catch(error) { setNotice(error instanceof Error?error.message:"Unable to update offer."); }
  }
  const managerOptions=hiringManagers.map((manager:any)=>{
    const parts=[
      manager.id===recommendedManagerId?"★ Recommended":null,
      manager.name,
      manager.roleName||manager.roleCode||null,
      manager.email||null,
      manager.phone?displayPhone(manager.phone):null
    ].filter(Boolean);
    return [manager.id,parts.join(" — ")] as [string,string];
  });
  const latestInterview=(data.interviews??[]).slice().sort((left:any,right:any)=>String(right.updated_at||right.created_at||"").localeCompare(String(left.updated_at||left.created_at||"")))[0]??null;
  const latestOffer=offerVersions[0]??null;
  const journey=candidateJourney(lead.status,options.hrLifecycleRules,{
    hasResume:documents.some((document:any)=>String(document.type).toLowerCase().includes("resume")),
    interviewCount:(data.interviews??[]).length,
    latestInterviewStatus:latestInterview?.status,
    latestInterviewHasCalendar:Boolean(latestInterview?.calendar_event_id),
    latestInterviewHasMeet:Boolean(latestInterview?.meet_link),
    latestOfferStatus:latestOffer?.status
  });
  return <div className="hr-profile">
    <header><div><span>{lead.recruitment_roles?.name||"Unmapped role"} • {lead.recruitment_locations?.code||"No station"}</span><h2>{lead.full_name||"Unnamed candidate"}</h2><p>{displayPhone(lead.phone)} • {lead.email||"No email"}</p></div><span className={`status status-${lead.status||"new"} status-tone-${statusTone(lead.status||"new")}`}>{statusLabel(lead.status||"new")}</span></header>
    <div className="hr-profile-facts"><span><small>Candidate city / locality</small><b>{lead.city||"Not captured"}</b></span><span><small>PIN code</small><b>{lead.post_code||"Not captured"}</b></span><span><small>Applied station</small><b>{lead.recruitment_locations?.code||"Not mapped"}</b></span><span><small>Current status</small><b>{statusLabel(lead.status||"new")}</b></span></div>
    <div className="hr-profile-actions">{phoneDigits(lead.phone).length===10?<><a href={`tel:+91${phoneDigits(lead.phone)}`}>Call candidate</a><a href={`https://wa.me/91${phoneDigits(lead.phone)}`} target="_blank" rel="noreferrer">Open WhatsApp</a></>:null}<span>Source: {lead.ad_name||lead.source||"—"}</span></div>
    <section className="candidate-action-center"><header><div><small>NEXT BEST ACTION</small><h3>{journey.nextAction}</h3></div><strong>{journey.label}</strong></header><div className="candidate-stage-track">{HR_PIPELINE_STAGES.map((stage,index)=><span className={index<journey.activeStage?"complete":index===journey.activeStage?"current":""} key={stage.code}><i>{index<journey.activeStage?"✓":index+1}</i><b>{stage.label}</b></span>)}</div>{journey.blockers.length?<div className="candidate-blockers">{journey.blockers.map((blocker)=><em key={blocker}>! {blocker}</em>)}</div>:<p className="candidate-ready">No lifecycle blocker detected for the current step.</p>}</section>
    {notice?<p className="connection-notice">{notice}</p>:null}
    <section className="hr-panel-grid">{visible(access.activity)?<article><h3>1. First call outcome</h3><p className="panel-help">Choose an active outcome from HR Lifecycle Master. The API validates the next step and audits every update.</p>{!editable(access.activity)?<p className="read-only-master-note">View access — updates are disabled.</p>:null}<fieldset disabled={!editable(access.activity)||workflowBusy}><label>Candidate response<select value={firstOutcome} onChange={(event)=>setFirstOutcome(event.target.value)}><option value="">Select outcome</option>{hrOutcomes.map((item:any)=><option key={item.code} value={item.code}>{item.label}</option>)}</select></label><label>Call remark<textarea value={activityRemark} onChange={(event)=>setActivityRemark(event.target.value)} placeholder="Call notes, candidate response and agreed next action"/></label>{selectedFirstOutcome?.scheduleType==="callback"?<label>Callback date and time<input type="datetime-local" value={activityCallback} onChange={(event)=>setActivityCallback(event.target.value)}/></label>:null}{selectedFirstOutcome?.scheduleType==="interview"?<><div className="field-pair"><label>Interview date and time<input type="datetime-local" value={scheduledAt} onChange={(event)=>setScheduledAt(event.target.value)}/></label><SearchSelect label="Next interviewer" value={managerId} options={managerOptions} onChange={setManagerId} placeholder="Search the DropX network…"/></div><p className="panel-help">The recommended reporting manager is preselected; any active DropX manager can be chosen.</p><div className="invite-channels"><label><input type="checkbox" checked={sendWhatsapp} onChange={(event)=>setSendWhatsapp(event.target.checked)}/> WhatsApp candidate + manager</label><label><input type="checkbox" checked={sendEmail} disabled={!lead.email||!selectedManager?.email} onChange={(event)=>setSendEmail(event.target.checked)}/> Email + Google Meet calendar invite</label></div></>:null}{editable(access.activity)?<button className="primary-action" disabled={busy||workflowBusy||!firstOutcome||!activityRemark.trim()||(selectedFirstOutcome?.scheduleType==="callback"&&!activityCallback)||(selectedFirstOutcome?.scheduleType==="interview"&&(!managerId||!scheduledAt||(!sendWhatsapp&&!sendEmail)))} onClick={()=>void saveFirstCall()}>{workflowBusy?"Saving outcome…":<>Save outcome{selectedFirstOutcome?.scheduleType==="interview"?" and send invitations":""}</>}</button>:null}</fieldset></article>:null}{visible(access.screening)?<article><h3>2. Screening profile</h3>{!editable(access.screening)?<p className="read-only-master-note">View access — screening changes are disabled.</p>:null}<fieldset disabled={!editable(access.screening)||workflowBusy}><div className="candidate-location-editor"><div className="field-pair"><label>Candidate city / locality<input value={candidateCity} onChange={(event)=>setCandidateCity(event.target.value)} placeholder="City or locality" maxLength={180}/></label><label>PIN code<input value={candidatePostCode} onChange={(event)=>setCandidatePostCode(event.target.value.replace(/\D/g,"").slice(0,6))} inputMode="numeric" maxLength={6} placeholder="6-digit PIN"/></label></div><p className="panel-help">Captured from the application and editable by users with HR Screening Edit access. Every correction is audited.</p>{editable(access.screening)?<button type="button" disabled={busy||workflowBusy||(candidateCity===(lead.city||"")&&candidatePostCode===(lead.post_code||""))||(Boolean(candidatePostCode)&&candidatePostCode.length!==6)} onClick={()=>void action({action:"candidate_location",city:candidateCity,postCode:candidatePostCode})}>Save city &amp; PIN</button>:null}</div><label>Recruiter summary<textarea value={summary} onChange={(event)=>setSummary(event.target.value)} placeholder="Fit, experience, communication and role notes"/></label><div className="field-pair"><label>Current salary<input value={currentSalary} onChange={(event)=>setCurrentSalary(event.target.value)}/></label><label>Expected salary<input value={expectedSalary} onChange={(event)=>setExpectedSalary(event.target.value)}/></label></div><label>Notice period / availability<input value={noticePeriod} onChange={(event)=>setNoticePeriod(event.target.value)}/></label>{editable(access.screening)?<button className="primary-action" disabled={busy||workflowBusy||!summary.trim()} onClick={()=>void action({action:"profile",summary,currentSalary,expectedSalary,noticePeriod})}>Save screening</button>:null}</fieldset></article>:null}
    {visible(access.documents)?<article><h3>3. Candidate documents</h3><p className="panel-help">Files load separately so opening a candidate stays fast. Secure links expire automatically.</p>{!editable(access.documents)?<p className="read-only-master-note">View access — uploads are disabled.</p>:null}<fieldset disabled={!editable(access.documents)}><SearchSelect label="Document type" value={documentType} options={[["resume","Resume / CV"],["identity","Identity proof"],["education","Education certificate"],["experience","Experience letter"],["salary","Salary proof"],["other","Other"]]} onChange={setDocumentType}/><label>Choose file<input type="file" accept=".pdf,.png,.jpg,.jpeg,.doc,.docx" onChange={(event)=>setFile(event.target.files?.[0]||null)}/></label>{editable(access.documents)?<button className="primary-action" disabled={busy||!file} onClick={()=>void upload()}>Upload privately</button>:null}</fieldset><div className="document-list">{documents.map((doc:any)=><div className="document-item" key={doc.path}><div><b>{doc.type}</b><span>{doc.name}</span><small>{doc.createdAt?new Date(doc.createdAt).toLocaleString("en-IN"):""}{doc.uploadedBy?` • ${doc.uploadedBy}`:" • Legacy upload"}</small></div><div className="document-actions"><a href={doc.url} target="_blank" rel="noreferrer">Open</a>{doc.canDelete&&editable(access.documents)?<><label className="replace-document">Replace<input type="file" accept=".pdf,.png,.jpg,.jpeg,.doc,.docx" onChange={(event)=>setReplacementFiles((current)=>({...current,[doc.path]:event.target.files?.[0]||null}))}/></label><button type="button" disabled={busy||!replacementFiles[doc.path]} onClick={()=>void upload(doc.path,replacementFiles[doc.path])}>Save replacement</button><button type="button" className="danger-action" disabled={busy} onClick={()=>void removeDocument(doc)}>Delete</button></>:null}</div></div>)}{documentsBusy?<p>Loading documents…</p>:!documents.length?<p>No documents uploaded.</p>:null}</div></article>:null}
    {visible(access.interviews)?<article><h3>4. Interview rounds</h3>{!editable(access.interviews)?<p className="read-only-master-note">View access — scheduling and feedback are disabled.</p>:null}<fieldset disabled={!editable(access.interviews)||workflowBusy}><div className="field-pair"><SearchSelect label="Interview round" value={round} options={interviewRoundOptions} onChange={setRound}/><label>Interview date and time<input type="datetime-local" value={scheduledAt} onChange={(event)=>setScheduledAt(event.target.value)}/></label></div><SearchSelect label="Hiring manager" value={managerId} options={managerOptions} onChange={setManagerId} placeholder="Search any manager by name, role, email or mobile…"/><p className="panel-help">Round 1 defaults to the reporting manager. Later rounds can be assigned to any active interviewer in the DropX hierarchy. The maximum is controlled in HR Lifecycle Master.</p><div className="invite-channels"><label><input type="checkbox" checked={sendWhatsapp} onChange={(event)=>setSendWhatsapp(event.target.checked)}/> WhatsApp candidate + manager</label><label><input type="checkbox" checked={sendEmail} disabled={!lead.email||!selectedManager?.email} onChange={(event)=>setSendEmail(event.target.checked)}/> Email + Google Meet calendar invite</label></div><label>Forwarding note<textarea value={interviewNote} onChange={(event)=>setInterviewNote(event.target.value)}/></label>{latestForward?<p className="panel-help">Latest: Round {latestForward.metadata?.round||"—"} to {latestForward.metadata?.manager_name||"—"}{latestForward.metadata?.meet_link?<> • <a href={latestForward.metadata.meet_link} target="_blank" rel="noreferrer">Meet link</a></>:null}</p>:null}{invitationDelivery?<InterviewDeliveryStatus outcomes={invitationDelivery}/>:null}{editable(access.interviews)?<button className="primary-action" disabled={busy||workflowBusy||!managerId||!scheduledAt||(!sendWhatsapp&&!sendEmail)} onClick={()=>void action({action:"forward",round:Number(round),managerId,scheduledAt:localInputToIso(scheduledAt),note:interviewNote,channels:[sendWhatsapp?"whatsapp":"",sendEmail?"email":""].filter(Boolean)})}>{workflowBusy?"Saving interview…":`Schedule round ${round} and send invitations`}</button>:null}</fieldset></article>:null}
    {visible(access.offers)?<OfferLifecyclePanel offer={offer} setOffer={setOffer} versions={offerVersions} busy={busy||offersBusy} editable={editable(access.offers)} canApprove={canApproveOffers} approvalRequired={offerApprovalRequired} action={offerAction}/>:null}</section>
    <details className="hr-details"><summary>Questionnaire responses</summary><div className="inline-answer-panel"><section><h3>Application answers</h3>{visibleQuestionnaireEntries(lead.questionnaire).length?<dl>{visibleQuestionnaireEntries(lead.questionnaire).map(([key,val])=><span key={key}><dt>{key.replaceAll("_"," ")}</dt><dd>{String(val)}</dd></span>)}</dl>:<p>No questionnaire responses were submitted.</p>}</section><section><h3>Station contact</h3><dl><span><dt>Address</dt><dd>{lead.recruitment_locations?.address||"—"}</dd></span><span><dt>POC</dt><dd>{lead.recruitment_locations?.poc_name||"—"}</dd></span><span><dt>Mobile</dt><dd>{lead.recruitment_locations?.poc_mobile||"—"}</dd></span></dl></section></div></details>
    <details className="hr-details"><summary>Audit and interview history ({data.history.length})</summary><div className="hr-history">{data.history.slice(0,60).map((event:any)=><div className="timeline-row" key={event.id}><b>{String(event.event_type).replaceAll("_"," ")}</b><span>{event.remarks||event.new_value||"Recorded"}</span><small>{new Date(event.created_at).toLocaleString("en-IN")}{event.actor_email?` • ${event.actor_email}`:""}</small></div>)}</div></details>
    {canManage?<details className="hr-details"><summary>Admin corrections</summary><AdminCorrection lead={lead} options={options} busy={busy} save={save}/></details>:null}
  </div>;
}

type OfferDraft = {
  variant:string;jobTitle:string;compensation:string;joiningDate:string;probation:string;notes:string;
  basic:string;hra:string;lta:string;specialAllowance:string;otherAllowance:string;
  employeePf:string;professionalTax:string;employerPf:string;
};

function OfferLifecyclePanel({offer,setOffer,versions,busy,editable,canApprove,approvalRequired,action}:{
  offer:OfferDraft;
  setOffer:(next:OfferDraft|((current:OfferDraft)=>OfferDraft))=>void;
  versions:any[];
  busy:boolean;
  editable:boolean;
  canApprove:boolean;
  approvalRequired:boolean;
  action:(action:"draft"|"submit"|"approve"|"issue"|"withdraw",versionId?:string)=>Promise<void>;
}) {
  const ready=offer.jobTitle.trim()&&offer.compensation.trim()&&offer.joiningDate;
  return <article className="offer-panel"><h3>5. Offer approval and issue</h3>
    <p className="panel-help">Create a versioned draft, submit it for approval, then issue one approved PDF. Saving a draft never changes the candidate status.</p>
    {!editable?<p className="read-only-master-note">View access — offer changes are disabled.</p>:null}
    <fieldset disabled={!editable||busy}>
      <SearchSelect label="Offer format" value={offer.variant} options={[["non_statutory","Non-statutory offer"],["statutory","Statutory offer with salary annexure"]]} onChange={(variant)=>setOffer({...offer,variant})}/>
      <div className="field-pair"><label>Job title<input value={offer.jobTitle} onChange={(event)=>setOffer({...offer,jobTitle:event.target.value})}/></label><label>Monthly remuneration / CTC<input value={offer.compensation} onChange={(event)=>setOffer({...offer,compensation:event.target.value})} placeholder="INR amount / CTC"/></label></div>
      <div className="field-pair"><label>Joining date<input type="date" value={offer.joiningDate} onChange={(event)=>setOffer({...offer,joiningDate:event.target.value})}/></label><label>Probation<input value={offer.probation} onChange={(event)=>setOffer({...offer,probation:event.target.value})}/></label></div>
      {offer.variant==="statutory"?<div className="salary-breakdown-grid"><label>Basic<input inputMode="numeric" value={offer.basic} onChange={(event)=>setOffer({...offer,basic:event.target.value})}/></label><label>HRA<input inputMode="numeric" value={offer.hra} onChange={(event)=>setOffer({...offer,hra:event.target.value})}/></label><label>LTA<input inputMode="numeric" value={offer.lta} onChange={(event)=>setOffer({...offer,lta:event.target.value})}/></label><label>Special allowance<input inputMode="numeric" value={offer.specialAllowance} onChange={(event)=>setOffer({...offer,specialAllowance:event.target.value})}/></label><label>Other allowance<input inputMode="numeric" value={offer.otherAllowance} onChange={(event)=>setOffer({...offer,otherAllowance:event.target.value})}/></label><label>Employee PF<input inputMode="numeric" value={offer.employeePf} onChange={(event)=>setOffer({...offer,employeePf:event.target.value})}/></label><label>Professional tax<input inputMode="numeric" value={offer.professionalTax} onChange={(event)=>setOffer({...offer,professionalTax:event.target.value})}/></label><label>Employer PF<input inputMode="numeric" value={offer.employerPf} onChange={(event)=>setOffer({...offer,employerPf:event.target.value})}/></label></div>:null}
      <label>Additional terms<textarea value={offer.notes} onChange={(event)=>setOffer({...offer,notes:event.target.value})}/></label>
      {editable?<div className="offer-draft-actions"><button type="button" disabled={busy||!ready} onClick={()=>void action("draft")}>Save draft</button><button type="button" className="primary-action" disabled={busy||!ready} onClick={()=>void action("submit")}>{approvalRequired?"Submit for approval":"Submit and approve"}</button></div>:null}
    </fieldset>
    <div className="offer-version-list"><header><b>Offer versions</b><small>{approvalRequired?"Approval required by HR Lifecycle Master":"Auto-approval enabled in HR Lifecycle Master"}</small></header>
      {versions.map((version)=><div className="offer-version-row" key={version.id}><span><b>V{version.version_no} · {version.job_title}</b><small>{version.joining_date?`Joining ${new Date(`${version.joining_date}T00:00:00`).toLocaleDateString("en-IN")}`:"No joining date"} · {new Date(version.created_at).toLocaleString("en-IN")}</small></span><em className={`offer-version-status offer-${version.status}`}>{statusLabel(version.status)}</em><div>
        {version.downloadUrl?<a href={version.downloadUrl} target="_blank" rel="noreferrer">Open PDF</a>:null}
        {version.status==="pending_approval"&&canApprove?<button type="button" disabled={busy} onClick={()=>void action("approve",version.id)}>Approve</button>:null}
        {version.status==="approved"&&(!approvalRequired||canApprove)?<button type="button" className="primary-action" disabled={busy} onClick={()=>void action("issue",version.id)}>Issue PDF</button>:null}
        {!["accepted","rejected","withdrawn"].includes(version.status)&&canApprove?<button type="button" className="danger-action" disabled={busy} onClick={()=>void action("withdraw",version.id)}>Withdraw</button>:null}
      </div></div>)}
      {busy?<p>Loading offer lifecycle…</p>:!versions.length?<p>No offer draft has been created.</p>:null}
    </div>
    <p className="panel-help">Brand, reference prefix, signatory and standard terms come from Source Integrations. Work address comes from Business Locations.</p>
  </article>;
}

function InterviewDeliveryStatus({outcomes}:{outcomes:any}) {
  const email=outcomes?.email;
  const candidate=outcomes?.whatsapp?.candidate;
  const manager=outcomes?.whatsapp?.manager;
  const items=[
    email?{label:"Email + calendar",ok:email.sent===true,detail:email.sent?(email.meetLink?"Sent with Google Meet":"Sent"):email.reason}:null,
    candidate?{label:"Candidate WhatsApp",ok:candidate.queued===true,detail:candidate.queued?"Queued for delivery":candidate.reason}:null,
    manager?{label:"Manager WhatsApp",ok:manager.queued===true,detail:manager.queued?"Queued for delivery":manager.reason}:null
  ].filter(Boolean) as Array<{label:string;ok:boolean;detail?:string}>;
  if(!items.length)return null;
  return <div className="invitation-delivery" aria-live="polite"><b>Latest invitation delivery</b>{items.map((item)=><span className={item.ok?"delivery-ok":"delivery-failed"} key={item.label}><strong>{item.ok?"✓":"!"} {item.label}</strong><small>{item.detail||"No delivery detail returned."}</small></span>)}</div>;
}

function AdminCorrection({lead,options,busy,save}:{lead:any;options:any;busy:boolean;save:(fields:Record<string,unknown>)=>Promise<void>}) {
  const [fullName,setFullName]=useState(lead.full_name??"");const [phone,setPhone]=useState(lead.phone??"");const [email,setEmail]=useState(lead.email??"");const [city,setCity]=useState(lead.city??"");const [postCode,setPostCode]=useState(lead.post_code??"");const [locationId,setLocationId]=useState(lead.location_id??"");const [roleId,setRoleId]=useState(lead.role_id??"");
  return <div className="admin-correction-inline"><label>Candidate name<input value={fullName} onChange={(event)=>setFullName(event.target.value)}/></label><label>Mobile<input value={phone} onChange={(event)=>setPhone(event.target.value)}/></label><label>Email<input value={email} onChange={(event)=>setEmail(event.target.value)}/></label><div className="field-pair"><label>City<input value={city} onChange={(event)=>setCity(event.target.value)}/></label><label>PIN code<input inputMode="numeric" maxLength={6} value={postCode} onChange={(event)=>setPostCode(event.target.value.replace(/\D/g,"").slice(0,6))}/></label></div><label>Station<select value={locationId} onChange={(event)=>setLocationId(event.target.value)}><option value="">Unmapped</option>{(options.locations??[]).map((item:any)=><option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}</select></label><label>Designation<select value={roleId} onChange={(event)=>setRoleId(event.target.value)}><option value="">Unmapped</option>{(options.roles??[]).map((item:any)=><option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}</select></label><button className="primary-action" disabled={busy||(Boolean(postCode)&&postCode.length!==6)} onClick={()=>void save({full_name:fullName||null,phone,email:email||null,city:city||null,post_code:postCode||null,location_id:locationId||null,role_id:roleId||null})}>Save corrections</button></div>;
}

function Reports({ data, busy, token, options, stream }: { data: any; busy: boolean; token: string; options: any; stream: "workforce" | "hr" }) {
  const [report, setReport] = useState("leads");
  const [reportFilters, setReportFilters] = useState({ from:"",to:"",updatedFrom:"",updatedTo:"",interviewFrom:"",interviewTo:"",spendFrom:"",spendTo:"",attemptFrom:istDate(),attemptTo:istDate(),reportUser:"",status:"",station:"",cluster:"",role:"",noStatusAge:"12",adStatus:"" });
  const reportTypes = [
    ...(stream==="workforce"?[["leadattempts","Lead Attempt Detail"]]:[]),
    ["leads","Lead Data"],["interviews","Interview Scheduled"],["spend","Spend Analysis"],
    ["weeklyspend","Ad + Lead Spend by Day / Week / Month"],["dailyleads","Daily Lead Generation"],
    ["nostatus","No Status Leads"],["designationpendency","Designation Pendency"],["leadquality","Lead Quality"],
    ["effort","No Response / Call Back Effort"],["userattempts","User Attempt Summary"]
  ];
  function download() {
    const params = new URLSearchParams({ report, format:"xlsx", stream });
    Object.entries(reportFilters).forEach(([key,value])=>{ if(value) params.set(key,value); });
    fetch(`/api/recruitment/reports?${params}`, { headers: headers(token) }).then(async(response)=>{
      if(!response.ok) throw new Error((await response.json()).error);
      const blob=await response.blob(); const url=URL.createObjectURL(blob); const link=document.createElement("a");
      link.href=url; link.download=`DropX_${report}_${new Date().toISOString().slice(0,10)}.xlsx`; link.click(); URL.revokeObjectURL(url);
    }).catch((error)=>alert(error.message));
  }
  const summary = data?.summary ?? {};
  const cards = [
    ["Total leads", summary.total],["Contacted", summary.contacted],["Interviews", summary.interviews],
    ["Selected", summary.selected],["Joined", summary.joined],["24H+ pending", summary.pending24h],
    ["Unmapped", summary.missingRoute],["Valid phones", `${summary.validPhoneRate ?? 0}%`]
  ];
  const userPerformance = stream === "hr" ? (data?.userPerformance ?? []) : [];
  return <section className="reports-view">
    <section className="content-card report-builder"><h2>Reports</h2><p>Generate the same operational reports with server-side access scope.</p>
      <div className="report-filter-grid"><label>Report type<select value={report} onChange={(event)=>setReport(event.target.value)}>{reportTypes.map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label>
        {report==="leadattempts"?<><label>Attempted from<input type="date" value={reportFilters.attemptFrom} onChange={(event)=>setReportFilters({...reportFilters,attemptFrom:event.target.value})}/></label><label>Attempted to<input type="date" value={reportFilters.attemptTo} onChange={(event)=>setReportFilters({...reportFilters,attemptTo:event.target.value})}/></label><label>Telecaller<select value={reportFilters.reportUser} onChange={(event)=>setReportFilters({...reportFilters,reportUser:event.target.value})}><option value="">All permitted telecallers</option>{(data?.reportUsers??[]).map((item:any)=><option key={item.id} value={item.id}>{item.name}{item.email?` — ${item.email}`:""}</option>)}</select></label></>:null}
        <label>Added from<input type="date" value={reportFilters.from} onChange={(event)=>setReportFilters({...reportFilters,from:event.target.value})}/></label><label>Added to<input type="date" value={reportFilters.to} onChange={(event)=>setReportFilters({...reportFilters,to:event.target.value})}/></label>
        <label>Last updated from<input type="date" value={reportFilters.updatedFrom} onChange={(event)=>setReportFilters({...reportFilters,updatedFrom:event.target.value})}/></label><label>Last updated to<input type="date" value={reportFilters.updatedTo} onChange={(event)=>setReportFilters({...reportFilters,updatedTo:event.target.value})}/></label>
        <label>Interview from<input type="date" value={reportFilters.interviewFrom} onChange={(event)=>setReportFilters({...reportFilters,interviewFrom:event.target.value})}/></label><label>Interview to<input type="date" value={reportFilters.interviewTo} onChange={(event)=>setReportFilters({...reportFilters,interviewTo:event.target.value})}/></label>
        <label>Spend from<input type="date" value={reportFilters.spendFrom} onChange={(event)=>setReportFilters({...reportFilters,spendFrom:event.target.value})}/></label><label>Spend to<input type="date" value={reportFilters.spendTo} onChange={(event)=>setReportFilters({...reportFilters,spendTo:event.target.value})}/></label>
        <div className="report-multi-field"><span>Status</span><MultiFilter label="Status" value={reportFilters.status} options={(stream==="workforce"
          ? workforceStatusOptions(options).filter((item:any)=>item.isActive!==false).map((item:any)=>[item.code,item.label])
          : hrLifecycleFilterOptions(options.hrLifecycleRules))} onChange={(value)=>setReportFilters({...reportFilters,status:value})}/></div>
        <label>No status age<select value={reportFilters.noStatusAge} onChange={(event)=>setReportFilters({...reportFilters,noStatusAge:event.target.value})}><option value="12">12 hours+</option><option value="24">1 day+</option><option value="48">2 days+</option></select></label>
        <div className="report-multi-field"><span>Station</span><MultiFilter label="Stations" value={reportFilters.station} options={options.locations.map((item:any)=>[item.code,`${item.code} — ${item.name}`])} onChange={(value)=>setReportFilters({...reportFilters,station:value})}/></div>
        <div className="report-multi-field"><span>Operational owner</span><MultiFilter label="Operational owners" value={reportFilters.cluster} options={[...new Set<string>(options.locations.map((item:any)=>String(item.cluster||"")).filter(Boolean))].map((value)=>[value,value])} onChange={(value)=>setReportFilters({...reportFilters,cluster:value})}/></div>
        <div className="report-multi-field"><span>Designation</span><MultiFilter label="Designations" value={reportFilters.role} options={options.roles.filter((item:any)=>item.stream===stream).map((item:any)=>[item.code,`${item.code} — ${item.name}`])} onChange={(value)=>setReportFilters({...reportFilters,role:value})}/></div>
        <div className="report-multi-field"><span>Ad status</span><MultiFilter label="Ad status" value={reportFilters.adStatus} options={[["ACTIVE","Running ads"],["PAUSED","Paused ads"],["INACTIVE","No running ad"]]} onChange={(value)=>setReportFilters({...reportFilters,adStatus:value})}/></div></div>
      {data?.canDownloadReports?<button className="primary-action" onClick={download}>Download XLSX Report</button>:<p className="subtle">View only. Excel download requires Reports → Edit permission.</p>}
    </section>
    <div className="metrics report-metrics">{cards.map(([label,value]) => <article key={label}><span>{label}</span><strong>{busy ? "…" : (typeof value === "number" ? value.toLocaleString("en-IN") : value ?? 0)}</strong></article>)}</div>
    <div className="report-panels">
      <ReportPanel title="Pipeline status" rows={data?.funnel} />
      <ReportPanel title="Leads by designation" rows={data?.roles} />
      <ReportPanel title="Leads by station" rows={data?.locations} />
      <ReportPanel title="Leads by ad" rows={data?.ads} />
    </div>
    {stream==="hr"?<section className="content-card hr-user-performance"><header><div><span>USER-LEVEL DELIVERY</span><h2>HR recruiter activity</h2><p>Every candidate update is attributed to the person who performed it. Counts remain restricted to your permitted candidate scope.</p></div><strong>{userPerformance.length}<small>active users</small></strong></header><div className="table-scroll"><table><thead><tr><th>User</th><th>Candidates handled</th><th>Total updates</th><th>First calls</th><th>Screenings</th><th>Interviews</th><th>Decisions</th><th>Offers</th><th>Joined</th><th>Last action</th></tr></thead><tbody>{userPerformance.map((item:any)=><tr key={item.profileId||item.email}><td><b>{item.name||item.email||"DropX user"}</b><small>{item.email||"No email"}</small></td><td><b>{Number(item.uniqueCandidates||0).toLocaleString("en-IN")}</b></td><td>{Number(item.totalUpdates||0).toLocaleString("en-IN")}</td><td>{Number(item.firstCalls||0).toLocaleString("en-IN")}</td><td>{Number(item.screenings||0).toLocaleString("en-IN")}</td><td>{Number(item.interviews||0).toLocaleString("en-IN")}</td><td>{Number(item.decisions||0).toLocaleString("en-IN")}</td><td>{Number(item.offers||0).toLocaleString("en-IN")}</td><td>{Number(item.joined||0).toLocaleString("en-IN")}</td><td>{item.lastActivityAt?new Date(item.lastActivityAt).toLocaleString("en-IN"):"—"}</td></tr>)}{!busy&&!userPerformance.length?<tr><td colSpan={10}>No attributed HR activity was recorded in this scoped reporting period.</td></tr>:null}</tbody></table></div><footer>Activity window: {userPerformance[0]?.activityFrom||"last 30 days"} to {userPerformance[0]?.activityTo||"today"}. Use User Attempt Summary for Excel export.</footer></section>:null}
  </section>;
}

function FieldRecruitment({ data, token, showManualPunchApprovals = false }: { data: any; token: string; showManualPunchApprovals?: boolean }) {
  const [payload,setPayload]=useState<any>(data);
  const [from,setFrom]=useState(data?.from??istDate());
  const [to,setTo]=useState(data?.to??istDate());
  const datesInitialized=useRef(Boolean(data?.from||data?.to));
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  const [selected,setSelected]=useState<any>(null);
  const [search,setSearch]=useState("");
  const [status,setStatus]=useState("all");
  const [lastUpdated,setLastUpdated]=useState(Date.now());
  const [manualPunches,setManualPunches]=useState<any[]>([]);
  const [canApprovePunches,setCanApprovePunches]=useState(false);
  const [punchNotice,setPunchNotice]=useState("");
  useEffect(()=>{
    setPayload(data);setLastUpdated(Date.now());
    if(!datesInitialized.current&&(data?.from||data?.to)){
      if(data?.from)setFrom(data.from);
      if(data?.to)setTo(data.to);
      datesInitialized.current=true;
    }
  },[data]);
  const load=useCallback(async (keepSelection=false)=>{
    setLoading(true);setError("");
    try{
      const params=new URLSearchParams({from,to});
      const response=await fetch(`/api/recruitment/field-duty?${params}`,{headers:headers(token),cache:"no-store"});
      const next=await response.json();if(!response.ok)throw new Error(next.error||"Unable to load field recruitment.");
      setPayload(next);setLastUpdated(Date.now());setSelected((current:any)=>keepSelection&&current?(next.duties??(next.duty?[next.duty]:[])).find((item:any)=>item.id===current.id)??current:null);
    }catch(caught){setError(caught instanceof Error?caught.message:"Unable to load field recruitment.");}
    finally{setLoading(false);}
  },[from,to,token]);
  useEffect(()=>{
    const timer=window.setInterval(()=>{if(document.visibilityState==="visible")void load(true);},30_000);
    return()=>window.clearInterval(timer);
  },[load]);
  const apply=()=>void load(false);
  const loadManualPunches=useCallback(async()=>{
    try{
      const response=await fetch(showManualPunchApprovals?"/api/recruitment/manual-punch-requests?scope=approval":"/api/recruitment/manual-punch-requests",{headers:headers(token),cache:"no-store"});
      if(response.status===403){setCanApprovePunches(false);setManualPunches([]);return;}
      const next=await response.json();if(!response.ok)throw new Error(next.error||"Unable to load manual punch requests.");
      setCanApprovePunches(next.canApprove===true);setManualPunches(next.requests??[]);
    }catch(caught){setPunchNotice(caught instanceof Error?caught.message:"Unable to load manual punch requests.");}
  },[showManualPunchApprovals,token]);
  useEffect(()=>{
    void loadManualPunches();
  },[loadManualPunches,showManualPunchApprovals]);
  async function reviewPunch(item:any,action:"approve"|"reject"){
    const remarks=window.prompt(action==="reject"?"Rejection reason (required)":"Approval comments (optional)","");
    if(remarks===null)return;if(action==="reject"&&remarks.trim().length<3){setPunchNotice("A rejection reason is required.");return;}
    setPunchNotice("");
    try{
      const response=await fetch("/api/recruitment/manual-punch-requests",{method:"PATCH",headers:{...headers(token),"Content-Type":"application/json"},body:JSON.stringify({id:item.id,action,remarks})});
      const next=await response.json();if(!response.ok)throw new Error(next.error||"Unable to review manual punch.");
      setPunchNotice(`${String(item.punchType||"in").toUpperCase()} punch ${action==="approve"?"approved":"rejected"}.`);await loadManualPunches();await load(true);
    }catch(caught){setPunchNotice(caught instanceof Error?caught.message:"Unable to review manual punch.");}
  }
  const personalDuty=payload?.duty?{...payload.duty,profiles:payload.duty.profiles??{full_name:"My field duty",email:null}}:null;
  const duties=payload?.duties??(personalDuty?[personalDuty]:[]);
  const recruiterRows=from===to?(payload?.recruiters??[]).filter((profile:any)=>!duties.some((duty:any)=>duty.recruiter_profile_id===profile.id)).map((profile:any)=>({id:`absent:${profile.id}:${from}`,duty_date:from,recruiter_profile_id:profile.id,profiles:profile,status:"not_started",contacts:[],visits:[],points:[]})):[];
  const rows=[...duties,...recruiterRows].filter((duty:any)=>{
    const haystack=`${duty.profiles?.full_name??""} ${duty.profiles?.email??""}`.toLowerCase();
    return (!search.trim()||haystack.includes(search.trim().toLowerCase()))&&(status==="all"||duty.status===status);
  });
  const contacts=duties.flatMap((duty:any)=>duty.contacts??[]);
  const qualified=contacts.filter((item:any)=>["interested","follow_up","interview_scheduled"].includes(item.outcome)).length;
  const interviews=contacts.filter((item:any)=>item.outcome==="interview_scheduled").length;
  const totalKm=duties.reduce((sum:number,item:any)=>sum+Number(item.distance_meters??0),0)/1000;
  const activeTrackers=duties.filter((item:any)=>item.status==="active").length;
  const latestSignal=duties.map((item:any)=>item.last_gps_at).filter(Boolean).sort().at(-1);
  const hotspotLabel=(visit:any)=>statusLabel(String(visit.visit_type??"").replace(/^hotspot_/,""));
  const relative=(value:any)=>{if(!value)return "No GPS yet";const mins=Math.max(0,Math.floor((Date.now()-Date.parse(value))/60_000));return mins<1?"Just now":mins<60?`${mins} min ago`:`${Math.floor(mins/60)} hr ago`;};
  const shareText=(duty:any)=>{
    const people=duty.contacts??[];const leads=people.filter((item:any)=>["interested","follow_up","interview_scheduled"].includes(item.outcome)).length;
    const hotspots=(duty.visits??[]).filter((visit:any)=>String(visit.visit_type??"").startsWith("hotspot_")).map((visit:any)=>`${visit.location_name} (${hotspotLabel(visit)})`).join(", ");
    return `FIELD RECRUITER DAILY REPORT\n\n${duty.profiles?.full_name||"Field recruiter"}\nDate: ${duty.duty_date}\nDuty station: ${duty.primary_location_code||""}${duty.primary_location_code?" — ":""}${duty.primary_location_name||"Unmapped"} (${statusLabel(duty.primary_location_source||"unknown")})\nDuty: ${duty.started_at?new Date(duty.started_at).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"}):"—"} – ${duty.ended_at?new Date(duty.ended_at).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"}):"Active"}\nDistance: ${(Number(duty.distance_meters??0)/1000).toFixed(1)} km\nPeople contacted: ${people.length}\nQualified leads: ${leads}\nInterviews scheduled: ${people.filter((item:any)=>item.outcome==="interview_scheduled").length}\nMajor hotspots: ${hotspots||"—"}\n\nTomorrow target: ${duty.tomorrow_target??"—"}\nExpected joinees: ${duty.expected_joinees??"—"}\nChallenges: ${duty.challenges||"—"}\nPlan: ${duty.tomorrow_plan||"—"}\nRemarks: ${duty.remarks||"—"}`;
  };
  async function share(duty:any){const text=shareText(duty);if(navigator.share){await navigator.share({title:"Field recruiter daily report",text});}else{await navigator.clipboard.writeText(text);alert("Daily report copied.");}}
  const selectedPunches=selected?manualPunches.filter((item:any)=>item.profileId===selected.recruiter_profile_id&&item.date===selected.duty_date):[];
  const punchMapHref=(item:any)=>item.latitude==null||item.longitude==null?"":`https://www.google.com/maps?q=${encodeURIComponent(`${Number(item.latitude).toFixed(6)},${Number(item.longitude).toFixed(6)}`)}`;
  const pointMapHref=(latitude:any,longitude:any)=>latitude==null||longitude==null?"":`https://www.google.com/maps?q=${encodeURIComponent(`${Number(latitude).toFixed(6)},${Number(longitude).toFixed(6)}`)}`;
  async function exportFieldReport(){
    const XLSX=await import("xlsx");const workbook=XLSX.utils.book_new();
    const dayRows=duties.map((item:any)=>({Date:item.duty_date,Recruiter:item.profiles?.full_name||"",Status:item.status,"Duty station":item.primary_location_code||item.primary_location_name||"","Station source":item.primary_location_source||"","Station latitude":item.primary_location_latitude??"","Station longitude":item.primary_location_longitude??"","IN device":item.punch_in_device_serial||"","IN time":item.punch_in_at||item.started_at||"","IN source":item.punch_in_source||"","OUT time":item.punch_out_at||"","OUT source":item.punch_out_source||"","Worked minutes":item.worked_minutes??"","Distance km":Number(Number(item.distance_meters||0)/1000).toFixed(2),"GPS coverage %":item.gps_coverage_percent??0,"People contacted":item.contacts?.length??0}));
    const peopleRows=duties.flatMap((duty:any)=>(duty.contacts??[]).map((item:any)=>({Date:duty.duty_date,Recruiter:duty.profiles?.full_name||"",Person:item.full_name,Mobile:item.phone,Station:item.recruitment_locations?.code||"",Role:item.recruitment_roles?.name||item.recruitment_roles?.code||"",Outcome:item.outcome,Latitude:item.latitude??"",Longitude:item.longitude??"",Recorded:item.created_at})));
    const punchRows=manualPunches.map((item:any)=>({Date:item.date,Recruiter:item.recruiterName,Type:String(item.punchType||"in").toUpperCase(),Time:item.requestedTime,Location:item.locationName||"",Latitude:item.latitude??"",Longitude:item.longitude??"","GPS accuracy metres":item.accuracy??"","Map link":punchMapHref(item),Reason:item.reasonLabel||item.reason||"",Status:item.status,Approver:item.reviewerName||"","Decision time":item.reviewedAt||"",Comments:item.reviewRemarks||""}));
    const stopRows=duties.flatMap((duty:any)=>(duty.stops??[]).map((stop:any,index:number)=>({Date:duty.duty_date,Recruiter:duty.profiles?.full_name||"","Stop number":index+1,"Start time":stop.startedAt,"End time":stop.endedAt,"Duration minutes":stop.durationMinutes,Latitude:stop.latitude,Longitude:stop.longitude,"GPS accuracy metres":stop.accuracyMeters,"Map link":pointMapHref(stop.latitude,stop.longitude)})));
    XLSX.utils.book_append_sheet(workbook,XLSX.utils.json_to_sheet(dayRows),"Field days");XLSX.utils.book_append_sheet(workbook,XLSX.utils.json_to_sheet(peopleRows),"People contacted");XLSX.utils.book_append_sheet(workbook,XLSX.utils.json_to_sheet(stopRows),"Detected stops");XLSX.utils.book_append_sheet(workbook,XLSX.utils.json_to_sheet(punchRows),"Manual IN OUT");XLSX.writeFile(workbook,`DropX_Field_Recruiter_Performance_${from}_${to}.xlsx`);
  }
  return <section className="field-recruitment-view">
    <section className="content-card field-hero"><div><span>LIVE FIELD CONTROL • VIEW ONLY</span><h2>Field Recruiter Performance</h2><p>Individual routes, contacts, conversions, manual IN/OUT decisions and day-end travel expenses in one field-specific view.</p></div><div className="performance-filter"><label>From<input type="date" value={from} onChange={(event)=>setFrom(event.target.value)}/></label><label>To<input type="date" value={to} onChange={(event)=>setTo(event.target.value)}/></label><button disabled={!duties.length&&!manualPunches.length} onClick={()=>void exportFieldReport()}>Export Excel</button><button className="primary-action" disabled={loading} onClick={apply}>{loading?"Refreshing…":"View day"}</button></div></section>
    {error?<div className="error-banner">{error}</div>:null}
    <section className="field-kpis">
      {[["Live now",activeTrackers],["Recruiters reported",duties.length],["Distance",`${totalKm.toFixed(1)} km`],["People met",contacts.length],["Qualified",qualified],["Interviews",interviews]].map(([label,value])=><article key={String(label)}><span>{label}</span><strong>{value}</strong></article>)}
    </section>
    {showManualPunchApprovals&&canApprovePunches?<section className="content-card field-day-panel"><div className="performance-panel-head"><div><h2>Manual punch requests</h2><p>Scoped to your configured field team. IN unlocks duty start; OUT unlocks day closure.</p></div><b>{manualPunches.filter((item:any)=>item.status==="pending").length} pending</b></div>{punchNotice?<div className="notice">{punchNotice}</div>:null}<div className="table-scroll"><table><thead><tr><th>Recruiter</th><th>Type</th><th>Date &amp; time</th><th>Location / GPS</th><th>Reason</th><th>Status</th><th>Action / approver</th></tr></thead><tbody>{manualPunches.map((item:any)=><tr key={item.id}><td><b>{item.recruiterName}</b></td><td><span className={`field-duty-status status-${item.status}`}>{String(item.punchType||"in").toUpperCase()}</span></td><td>{item.date} · {item.requestedTime}</td><td>{item.locationName||"—"}<small>{item.latitude==null?item.gps:`${Number(item.latitude).toFixed(6)}, ${Number(item.longitude).toFixed(6)} ±${Math.round(Number(item.accuracy||0))}m`}</small>{punchMapHref(item)?<a className="manual-punch-map-link" href={punchMapHref(item)} target="_blank" rel="noreferrer">Open map</a>:null}</td><td>{item.reasonLabel||item.reason||"—"}</td><td>{statusLabel(item.status)}</td><td>{item.status==="pending"?<div className="inline-actions"><button onClick={()=>void reviewPunch(item,"reject")}>Reject</button><button className="primary-action" onClick={()=>void reviewPunch(item,"approve")}>Approve</button></div>:<>{item.reviewRemarks||"Reviewed"}<small>{item.reviewerName?`By ${item.reviewerName}`:""}</small></>}</td></tr>)}{!manualPunches.length?<tr><td colSpan={7}>No manual punch requests in your scope.</td></tr>:null}</tbody></table></div></section>:null}
    {!showManualPunchApprovals&&manualPunches.length?<section className="content-card field-day-panel"><div className="performance-panel-head"><div><h2>My manual IN / OUT history</h2><p>Read-only request status, exact GPS point and approving manager.</p></div><b>{manualPunches.length} requests</b></div><div className="table-scroll"><table><thead><tr><th>Type</th><th>Date &amp; time</th><th>Location / GPS</th><th>Status</th><th>Approver</th></tr></thead><tbody>{manualPunches.slice(0,30).map((item:any)=><tr key={item.id}><td><b>{String(item.punchType||"in").toUpperCase()}</b></td><td>{item.date} · {item.requestedTime}</td><td>{item.locationName||"—"}<small>{item.latitude==null?item.gps:`${Number(item.latitude).toFixed(6)}, ${Number(item.longitude).toFixed(6)} ±${Math.round(Number(item.accuracy||0))}m`}</small>{punchMapHref(item)?<a className="manual-punch-map-link" href={punchMapHref(item)} target="_blank" rel="noreferrer">Open map</a>:null}</td><td>{statusLabel(item.status)}</td><td>{item.reviewerName||"Pending manager review"}<small>{item.reviewedAt?new Date(item.reviewedAt).toLocaleString("en-IN"):""}</small></td></tr>)}</tbody></table></div></section>:null}
    <section className="content-card field-day-panel"><div className="performance-panel-head"><div><h2>Recruiter day summary</h2><p>{payload?.visibility==="all"?"All permitted field recruiters":payload?.visibility==="team"?"Your reporting team":"Your permitted records"} · refreshed {new Date(lastUpdated).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"})}{latestSignal?` · latest GPS ${relative(latestSignal)}`:""}</p></div><div className="field-compact-filters"><input aria-label="Search recruiter" placeholder="Search recruiter" value={search} onChange={(event)=>setSearch(event.target.value)}/><select aria-label="Duty status" value={status} onChange={(event)=>setStatus(event.target.value)}><option value="all">All status</option><option value="active">Live now</option><option value="completed">Completed</option><option value="not_started">Not started</option></select><button onClick={()=>void load(true)} disabled={loading}>↻</button></div></div>
      <div className="field-day-grid">{rows.length?rows.map((duty:any)=>{
        const people=duty.contacts??[];const leads=people.filter((item:any)=>["interested","follow_up","interview_scheduled"].includes(item.outcome)).length;const live=duty.status==="active";const absent=duty.status==="not_started";
        return <article className={`field-day-card ${live?"is-live":""} ${absent?"is-absent":""}`} key={duty.id}><header><div className="field-avatar">{String(duty.profiles?.full_name||"F").slice(0,1).toUpperCase()}</div><div><h3>{duty.profiles?.full_name||"Unknown recruiter"}</h3><p>{duty.duty_date} · {absent?"No duty started":`${duty.primary_location_code||duty.primary_location_name||"Unmapped station"} · ${live?`Live · GPS ${relative(duty.last_gps_at)}`:"Day submitted"}`}</p></div><span className={`field-duty-status status-${duty.status}`}>{absent?"Not started":live?"Live":statusLabel(duty.status)}</span></header><div className="field-day-metrics"><span><b>{(Number(duty.distance_meters??0)/1000).toFixed(1)}</b>km</span><span><b>{people.length}</b>people</span><span><b>{leads}</b>qualified</span><span><b>{people.filter((item:any)=>item.outcome==="interview_scheduled").length}</b>interviews</span></div><div className="field-day-signal"><span>GPS quality <b>{absent?"—":`${Number(duty.gps_coverage_percent??0).toFixed(0)}%`}</b></span><span>{absent?"No field activity for this day":`${duty.gps_point_count??0}/${duty.gps_total_point_count??0} accepted points`}</span></div><footer><button disabled={absent} onClick={()=>setSelected(duty)}>{live?"Open live view":"Open day report"}</button>{!absent?<button onClick={()=>void share(duty)}>Share</button>:null}</footer></article>;
      }):<div className="field-dashboard-empty"><span>⌖</span><h3>No recruiter activity found</h3><p>No field duty report matches this date and filter. Choose another day or clear the status filter.</p></div>}</div>
    </section>
    {selected?<div className="modal-backdrop" onMouseDown={(event)=>{if(event.currentTarget===event.target)setSelected(null);}}><section className="modal field-report-modal"><header className="modal-header"><div><span>{selected.status==="active"?"LIVE FIELD VIEW":"DAY REPORT"}</span><h2>{selected.profiles?.full_name||"Field recruiter"}</h2><p>{selected.duty_date} · {(Number(selected.distance_meters??0)/1000).toFixed(2)} km · {(selected.contacts??[]).length} people · GPS {relative(selected.last_gps_at)}</p></div><button onClick={()=>setSelected(null)}>×</button></header>
      <FieldRouteMap points={selected.points??[]} contacts={selected.contacts??[]} visits={selected.visits??[]} status={selected.status} distanceMeters={selected.distance_meters}/>
      <div className="field-detail-strip"><span><b>{selected.primary_location_code||selected.primary_location_name||"Unmapped"}</b>Locked station · {statusLabel(selected.primary_location_source||"unknown")}</span><span><b>{selected.punch_in_at?new Date(selected.punch_in_at).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"}):selected.started_at?new Date(selected.started_at).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"}):"—"}</b>IN · {statusLabel(selected.punch_in_source||"unknown")}</span><span><b>{selected.punch_out_at?new Date(selected.punch_out_at).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"}):"Pending"}</b>OUT · {statusLabel(selected.punch_out_source||"not punched")}</span><span><b>{selected.worked_minutes==null?"—":`${Math.floor(Number(selected.worked_minutes)/60)}h ${Number(selected.worked_minutes)%60}m`}</b>Worked time</span><span><b>{selected.tomorrow_target??"—"}</b>Tomorrow target</span><span><b>{selected.expected_joinees??"—"}</b>Expected joins</span></div>
      {selectedPunches.length?<section className="field-hotspots"><div><h3>Manual IN / OUT provenance</h3><p>Exact request point, station, decision and approver retained for attendance and reports.</p></div><div>{selectedPunches.map((item:any)=><span key={item.id}><b>{String(item.punchType||"in").toUpperCase()} · {item.requestedTime}</b>{item.locationName||"Location not named"}<small>{item.latitude==null?item.gps:`${Number(item.latitude).toFixed(6)}, ${Number(item.longitude).toFixed(6)} ±${Math.round(Number(item.accuracy||0))}m`}</small>{punchMapHref(item)?<a className="manual-punch-map-link" href={punchMapHref(item)} target="_blank" rel="noreferrer">Open exact point</a>:null}<small>{statusLabel(item.status)}{item.reviewerName?` · ${item.reviewerName}`:""}{item.reviewedAt?` · ${new Date(item.reviewedAt).toLocaleString("en-IN")}`:""}</small></span>)}</div></section>:null}
      <section className="field-hotspots field-stops"><div><h3>Stops detected</h3><p>Only stationary periods of five minutes or more from validated GPS readings.</p></div><div>{(selected.stops??[]).map((stop:any,index:number)=><span key={`${stop.startedAt}-${index}`}><b>{stop.durationMinutes} min · {new Date(stop.startedAt).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"})}</b>{Number(stop.latitude).toFixed(6)}, {Number(stop.longitude).toFixed(6)}<a className="manual-punch-map-link" href={pointMapHref(stop.latitude,stop.longitude)} target="_blank" rel="noreferrer">Open in Google Maps</a></span>)}{!(selected.stops??[]).length?<em>No stop of five minutes or more was detected.</em>:null}</div></section>
      <section className="field-hotspots"><div><h3>Major hotspots reported</h3><p>The recruiter&apos;s day-end context; the map remains the source of actual travel.</p></div><div>{(selected.visits??[]).filter((visit:any)=>String(visit.visit_type??"").startsWith("hotspot_")).map((visit:any)=><span key={visit.id}><b>{visit.location_name}</b>{hotspotLabel(visit)}</span>)}{!(selected.visits??[]).some((visit:any)=>String(visit.visit_type??"").startsWith("hotspot_"))?<em>No major hotspots reported.</em>:null}</div></section>
      <div className="field-report-summary"><p><b>Challenges / support</b>{selected.challenges||"—"}</p><p><b>Tomorrow&apos;s plan</b>{selected.tomorrow_plan||"—"}</p><p><b>Remarks</b>{selected.remarks||"—"}</p></div>
      <section className="field-people-detail"><div className="performance-panel-head"><div><h2>People contacted</h2><p>Contact point and outcome recorded during this duty.</p></div><b>{(selected.contacts??[]).length}</b></div><div className="table-scroll"><table><thead><tr><th>Person</th><th>Contact</th><th>Nearest station</th><th>GPS tag</th><th>Role discussed</th><th>Outcome</th><th>Recorded</th></tr></thead><tbody>{(selected.contacts??[]).map((item:any)=><tr key={item.id}><td><b>{item.full_name}</b></td><td><a href={`tel:${String(item.phone||"").replace(/\D/g,"")}`}>{displayPhone(item.phone)}</a></td><td>{item.recruitment_locations?.code||"Auto location unavailable"}</td><td>{pointMapHref(item.latitude,item.longitude)?<a className="manual-punch-map-link" href={pointMapHref(item.latitude,item.longitude)} target="_blank" rel="noreferrer">{Number(item.latitude).toFixed(5)}, {Number(item.longitude).toFixed(5)}</a>:"Not captured"}</td><td>{item.recruitment_roles?.name||item.recruitment_roles?.code||"—"}</td><td><span className={`field-outcome outcome-${item.outcome}`}>{statusLabel(item.outcome)}</span></td><td>{item.created_at?new Date(item.created_at).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"}):"—"}</td></tr>)}{!(selected.contacts??[]).length?<tr><td colSpan={7}>No people were recorded for this duty.</td></tr>:null}</tbody></table></div></section>
      <footer><button onClick={()=>void share(selected)}>Share daily summary</button><button className="primary-action" onClick={()=>setSelected(null)}>Close</button></footer>
    </section></div>:null}
  </section>;
}

function PerformanceCenter({ token }: { token: string }) {
  const today=istDate();
  const monthStart=`${today.slice(0,7)}-01`;
  const [from,setFrom]=useState(monthStart);
  const [to,setTo]=useState(today);
  const [payload,setPayload]=useState<any>(null);
  const [busy,setBusy]=useState(true);
  const [error,setError]=useState("");

  const load=useCallback(async()=>{
    setBusy(true);setError("");
    try{
      const params=new URLSearchParams({from,to});
      const [recruitersResponse,fieldResponse,insightsResponse,punchResponse]=await Promise.all([
        fetch(`/api/recruitment/recruiter-performance?${params}&view=combined`,{headers:headers(token),cache:"no-store"}),
        fetch(`/api/recruitment/field-duty?${params}`,{headers:headers(token),cache:"no-store"}),
        fetch("/api/recruitment/ads/insights?stream=workforce",{headers:headers(token),cache:"no-store"}),
        fetch("/api/recruitment/manual-punch-requests?scope=approval",{headers:headers(token),cache:"no-store"})
      ]);
      const [recruiters,field,insights,punches]=await Promise.all([recruitersResponse.json(),fieldResponse.json(),insightsResponse.json(),punchResponse.json()]);
      if(!recruitersResponse.ok)throw new Error(recruiters.error||"Unable to load recruiter performance.");
      if(!fieldResponse.ok)throw new Error(field.error||"Unable to load field performance.");
      setPayload({recruiters,field,insights:insightsResponse.ok?insights:null,punches:punchResponse.ok?punches.requests??[]:[]});
    }catch(caught){setError(caught instanceof Error?caught.message:"Unable to load the Performance Center.");}
    finally{setBusy(false);}
  },[from,to,token]);
  useEffect(()=>{void load();},[load]);

  const recruiterData=payload?.recruiters??{};
  const fieldData=payload?.field??{};
  const duties=fieldData?.duties??[];
  const users=recruiterData?.users??[];
  const lifecycle=recruiterData?.lifecycle??[];
  const totals=recruiterData?.totals??{};
  const contacts=duties.flatMap((duty:any)=>(duty.contacts??[]).map((contact:any)=>({...contact,duty})));
  const manualPunches=(payload?.punches??[]).filter((item:any)=>item.date>=from&&item.date<=to);
  const completed=duties.filter((duty:any)=>duty.status==="completed").length;
  const active=duties.filter((duty:any)=>duty.status==="active").length;
  const distanceKm=duties.reduce((sum:number,duty:any)=>sum+Number(duty.distance_meters||0),0)/1000;
  const qualifiedContacts=contacts.filter((item:any)=>["interested","follow_up","interview_scheduled"].includes(String(item.outcome))).length;
  const metaDays=Object.values(payload?.insights?.insights??{}).flatMap((item:any)=>item.recent_daily??[]) as any[];
  const metaSpend=Object.values(payload?.insights?.insights??{}).reduce((sum:number,item:any)=>sum+Number(item.recent_spend||0),0);
  const metaLeads=Object.values(payload?.insights?.insights??{}).reduce((sum:number,item:any)=>sum+Number(item.recent_meta_leads||0),0);
  const insightFrom=metaDays.map((item:any)=>String(item.date||"")).filter(Boolean).sort().at(0)||null;
  const insightTo=metaDays.map((item:any)=>String(item.date||"")).filter(Boolean).sort().at(-1)||payload?.insights?.insightDate||null;
  const conversion=Number(totals.handled||0)?Number(totals.joined||0)/Number(totals.handled)*100:0;
  const retention=Number(totals.joined||0)?Number(totals.retained30||0)/Number(totals.joined||0)*100:0;
  const contactToInterview=contacts.length?contacts.filter((item:any)=>item.outcome==="interview_scheduled").length/contacts.length*100:0;
  const fieldByProfile=new Map<string,{distance:number;contacts:number;days:number;pendingPunches:number}>();
  for(const duty of duties){const id=String(duty.recruiter_profile_id||"");if(!id)continue;const current=fieldByProfile.get(id)??{distance:0,contacts:0,days:0,pendingPunches:0};current.distance+=Number(duty.distance_meters||0);current.contacts+=Number(duty.contacts?.length||0);current.days++;fieldByProfile.set(id,current);}
  for(const punch of manualPunches){const id=String(punch.profileId||"");if(!id)continue;const current=fieldByProfile.get(id)??{distance:0,contacts:0,days:0,pendingPunches:0};if(punch.status==="pending")current.pendingPunches++;fieldByProfile.set(id,current);}

  async function exportExcel(){
    if(!payload)return;
    const XLSX=await import("xlsx");
    const workbook=XLSX.utils.book_new();
    const summary=[
      {Metric:"Period",Value:`${from} to ${to}`},
      {Metric:"Leads handled",Value:Number(totals.handled||0)},
      {Metric:"Joined",Value:Number(totals.joined||0)},
      {Metric:"Lead to join conversion %",Value:Number(conversion.toFixed(1))},
      {Metric:"30-day qualified",Value:Number(totals.retained30||0)},
      {Metric:"Field contacts",Value:contacts.length},
      {Metric:"Qualified field contacts",Value:qualifiedContacts},
      {Metric:"Field distance km",Value:Number(distanceKm.toFixed(2))},
      {Metric:`Meta spend (${insightFrom||"latest"} to ${insightTo||"latest"})`,Value:Number(metaSpend.toFixed(2))},
      {Metric:"Meta platform leads",Value:metaLeads},
      {Metric:"Cost per Meta lead",Value:metaLeads?Number((metaSpend/metaLeads).toFixed(2)):0}
    ];
    const recruiterRows=users.map((item:any)=>({Recruiter:item.name,Function:item.function,Handled:item.handled,Attempts:item.attempts,Interviews:item.interviews,Selected:item.selected,Joined:item.joined,"Lead to join %":item.leadToJoinRate,"Interview to join %":item.interviewToJoinRate,"30-day qualified":item.retained30,Deliveries:item.deliveries}));
    const fieldRows=duties.map((item:any)=>({Date:item.duty_date,Recruiter:item.profiles?.full_name||"",Status:item.status,"IN time":item.punch_in_at||item.started_at,"IN source":item.punch_in_source||"","OUT time":item.punch_out_at||"","OUT source":item.punch_out_source||"","Worked minutes":item.worked_minutes??"","Distance km":Number(Number(item.distance_meters||0)/1000).toFixed(2),"GPS quality %":item.gps_coverage_percent,"People contacted":item.contacts?.length??0,"Major hotspots":(item.visits??[]).filter((visit:any)=>String(visit.visit_type).startsWith("hotspot_")).map((visit:any)=>visit.location_name).join(", ")}));
    const punchRows=manualPunches.map((item:any)=>({Date:item.date,Recruiter:item.recruiterName,Type:String(item.punchType||"in").toUpperCase(),Time:item.requestedTime,Location:item.locationName||"",Latitude:item.latitude??"",Longitude:item.longitude??"","GPS accuracy metres":item.accuracy??"",Status:item.status,Approver:item.reviewerName||"",Comments:item.reviewRemarks||""}));
    const contactRows=contacts.map((item:any)=>({Date:item.duty.duty_date,Recruiter:item.duty.profiles?.full_name||"",Person:item.full_name,Phone:item.phone,Station:item.recruitment_locations?.code||"",Role:item.recruitment_roles?.name||"",Outcome:item.outcome,Recorded:item.created_at}));
    const lifecycleRows=lifecycle.map((item:any)=>({Candidate:item.candidate,Phone:item.phone,Recruiter:item.recruiter,Station:item.station,Role:item.role,Stage:item.lifecycleStage,Outcome:item.latestOutcome,"Joining date":item.joiningDate,"Provider ID":item.providerEmployeeId,"Active days":item.activeDays,Deliveries:item.deliveries,"30-day qualified":item.retained30?"Yes":"No"}));
    for(const [name,rows] of [["Summary",summary],["Recruiters",recruiterRows],["Field days",fieldRows],["Field contacts",contactRows],["Manual IN OUT",punchRows],["Associate lifecycle",lifecycleRows]] as Array<[string,any[]]>){XLSX.utils.book_append_sheet(workbook,XLSX.utils.json_to_sheet(rows),name);}
    XLSX.writeFile(workbook,`DropX_Recruitment_Performance_${from}_${to}.xlsx`);
  }

  return <section className="performance-center">
    <header className="performance-center-hero"><div><span>EXECUTIVE OVERVIEW</span><h2>Recruitment Performance Center</h2><p>One management summary of initiation, joining, MTD retention, field output and source economics. Use the dedicated Telecaller and Field Recruiter menus for individual detail.</p></div><div className="performance-center-actions"><button disabled={!payload||busy} onClick={()=>void exportExcel()}>Export Excel</button><button className="primary-action" disabled={busy} onClick={()=>void load()}>{busy?"Refreshing…":"Refresh"}</button></div></header>
    <section className="performance-center-filter"><label>From<input type="date" value={from} onChange={(event)=>setFrom(event.target.value)}/></label><label>To<input type="date" value={to} onChange={(event)=>setTo(event.target.value)}/></label><span>{insightFrom&&insightTo?`Meta spend source: ${insightFrom}–${insightTo}`:"Meta spend is shown when the live source is available."}</span></section>
    {error?<div className="error-banner">{error}</div>:null}
    <>
      <section className="performance-center-kpis">{[
        ["Qualified joins",Number(totals.joined||0),`${conversion.toFixed(1)}% of handled leads`],
        ["30-day qualified",Number(totals.retained30||0),`${retention.toFixed(1)}% of joins`],
        ["Field contacts",contacts.length,`${qualifiedContacts} interested / follow-up`],
        ["Field movement",`${distanceKm.toFixed(1)} km`,`${active} live • ${completed} completed days`],
        ["Manual punches",manualPunches.length,`${manualPunches.filter((item:any)=>item.status==="pending").length} pending review`],
        ["Meta spend",`₹${metaSpend.toLocaleString("en-IN",{maximumFractionDigits:0})}`,`${metaLeads} platform leads`],
        ["Cost / Meta lead",metaLeads?`₹${(metaSpend/metaLeads).toFixed(0)}`:"—","Spend is never mixed with travel expense"]
      ].map(([label,value,note])=><article key={String(label)}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>)}</section>
      <section className="performance-center-grid"><article className="content-card"><div className="performance-panel-head"><div><h2>Recruitment funnel</h2><p>Action-based counts for the selected period.</p></div></div><div className="manager-funnel">{[["Handled",totals.handled],["Interviews",totals.interviews],["Selected",totals.selected],["Joined",totals.joined],["30-day",totals.retained30]].map(([label,value],index)=><div key={String(label)}><span>{label}</span><b>{Number(value||0).toLocaleString("en-IN")}</b><i style={{width:`${Math.max(4,index?Number(value||0)/Math.max(1,Number(totals.handled||0))*100:100)}%`}}/></div>)}</div></article><article className="content-card"><div className="performance-panel-head"><div><h2>Field execution</h2><p>Every kilometre comes from accepted GPS breadcrumbs.</p></div></div><dl className="field-execution-summary"><div><dt>Contact → interview</dt><dd>{contactToInterview.toFixed(1)}%</dd></div><div><dt>GPS points</dt><dd>{duties.reduce((sum:number,item:any)=>sum+Number(item.gps_point_count||0),0).toLocaleString("en-IN")}</dd></div><div><dt>Live recruiters</dt><dd>{active}</dd></div><div><dt>Qualified contacts</dt><dd>{qualifiedContacts}</dd></div></dl></article></section>
      <section className="content-card manager-scorecard"><div className="performance-panel-head"><div><h2>People requiring attention</h2><p>Telecaller funnels and field output use the same scoped source as each individual dashboard.</p></div><b>{users.length} tracked</b></div><div className="table-scroll"><table><thead><tr><th>User</th><th>Function</th><th>Handled / contacts</th><th>Interviews</th><th>Joined</th><th>Field distance</th><th>Manual punch</th><th>30-day</th></tr></thead><tbody>{users.map((item:any)=>{const field=fieldByProfile.get(item.profileId);return <tr key={item.profileId}><td><b>{item.name}</b><small>{item.email||"Registered user"}</small></td><td>{item.function==="field_recruiter"?"Field recruiter":"Telecaller"}</td><td>{item.function==="field_recruiter"?`${field?.contacts??0} contacts`:item.handled}</td><td>{item.interviews}</td><td>{item.joined}</td><td>{item.function==="field_recruiter"?`${(Number(field?.distance||0)/1000).toFixed(1)} km • ${field?.days??0} days`:"—"}</td><td>{item.function==="field_recruiter"?`${field?.pendingPunches??0} pending`:"—"}</td><td>{item.retained30}</td></tr>;})}</tbody></table></div></section>
    </>
  </section>;
}

function RecruiterPerformance({ data, token }: { data: any; token: string }) {
  const [payload, setPayload] = useState<any>(data);
  const [from, setFrom] = useState(data?.from ?? "");
  const [to, setTo] = useState(data?.to ?? "");
  const datesInitialized = useRef(Boolean(data?.from || data?.to));
  const [tab, setTab] = useState<"scorecard" | "lifecycle">("scorecard");
  const [search, setSearch] = useState("");
  const [recruiter, setRecruiter] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    setPayload(data);
    if (!datesInitialized.current && (data?.from || data?.to)) {
      if (data?.from) setFrom(data.from);
      if (data?.to) setTo(data.to);
      datesInitialized.current = true;
    }
  }, [data]);

  async function applyPeriod() {
    setLoading(true);
    setLoadError("");
    try {
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (payload?.view === "combined") params.set("view", "combined");
      const response = await fetch(`/api/recruitment/recruiter-performance?${params}`, {
        headers: headers(token),
        cache: "no-store"
      });
      const next = await response.json();
      if (!response.ok) throw new Error(next.error || "Unable to load performance.");
      setPayload(next);
      if (next?.from) setFrom(next.from);
      if (next?.to) setTo(next.to);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Unable to load performance.");
    } finally {
      setLoading(false);
    }
  }

  const users = payload?.users ?? [];
  const combinedView = payload?.view === "combined";
  const lifecycle = payload?.lifecycle ?? [];
  const breakdown = payload?.breakdown ?? [];
  const statusColumns = performanceStatusColumns(breakdown);
  const totals = payload?.totals ?? {};
  const recruiterSelection = new Set(recruiter.split(",").filter(Boolean));
  const focusedUserId = recruiterSelection.size===1 ? [...recruiterSelection][0] : "";
  const focusedUser = users.find((item:any)=>item.profileId===focusedUserId)??null;
  const visibleBreakdown = breakdown.filter((item:any)=>!recruiterSelection.size||recruiterSelection.has(item.recruiterProfileId));
  const focusedStatusTotals = visibleBreakdown.reduce((result:Record<string,number>,item:any)=>{for(const [key,value] of Object.entries(item.statusCounts??{}))result[key]=(result[key]||0)+Number(value||0);return result;},{});
  const focusedStatusBreakdown = Object.entries(focusedStatusTotals).map(([status,count])=>({status,count})).sort((left:any,right:any)=>right.count-left.count);
  const visibleLifecycle = lifecycle.filter((item:any) => {
    const text = [
      item.candidate, item.phone, item.recruiter, item.station, item.role,
      item.employeeId, item.providerEmployeeId, item.companyId,
      item.interviewOutcome, item.latestOutcome, item.lifecycleStage
    ].join(" ").toLowerCase();
    return (!recruiterSelection.size || recruiterSelection.has(item.recruiterProfileId))
      && (!search.trim() || text.includes(search.trim().toLowerCase()));
  });
  const scheduledPending = lifecycle.filter((item:any) =>
    ["interview_scheduled","interview_rescheduled"].includes(String(item.interviewOutcome ?? "").toLowerCase())
  ).length;
  const missingOpsId = lifecycle.filter((item:any) => item.joiningDate && !item.providerEmployeeId).length;
  const awaitingRetention = lifecycle.filter((item:any) => item.joiningDate && item.providerEmployeeId && !item.retained30).length;
  const zeroJoinRecruiters = users.filter((item:any) => item.interviews > 0 && item.joined === 0).length;
  const dateText = (value:string|null|undefined, withTime = false) => value
    ? new Date(value).toLocaleString("en-IN", withTime
      ? { dateStyle:"medium", timeStyle:"short" }
      : { dateStyle:"medium" })
    : "—";
  const displayed = focusedUser??totals;
  const kpis: Array<[string,number,string]> = [
    ["Leads handled", Number(displayed.handled || 0), "kpi-blue"],
    ["Profiles initiated", Number(displayed.onboarded || 0), "kpi-orange"],
    ["Contact attempts", Number(displayed.attempts || 0), "kpi-orange"],
    ["Interviews", Number(displayed.interviews || 0), "kpi-purple"],
    ["Selected", Number(displayed.selected || 0), "kpi-pink"],
    ["Joined", Number(displayed.joined || 0), "kpi-green"],
    ["MTD joined", Number(displayed.mtdJoined || 0), "kpi-teal"]
  ];

  return <section className="recruiter-performance">
    <header className="performance-hero">
      <div><span>TELECALLER FUNNEL</span><h2>{combinedView ? "Recruitment performance" : "Telecaller performance"}</h2><p>{combinedView ? "Recruitment outcomes across permitted users." : "Handled leads, calling outcomes, interviews, joins, locations and retention for each telecaller."}</p></div>
      <div className={`performance-sync ${payload?.opsSync?.available === false ? "sync-warning" : "sync-live"}`}>
        <b>{payload?.opsSync?.available === false ? "Ops link unavailable" : "Live operations linked"}</b>
        <small>{payload?.opsSync?.available === false
          ? payload?.opsSync?.message
          : `${Number(payload?.opsSync?.matchedAssociates || 0).toLocaleString("en-IN")} associates matched${payload?.opsSync?.latestActivityDate ? ` • through ${dateText(payload.opsSync.latestActivityDate)}` : ""}`}</small>
      </div>
    </header>

    <div className="performance-filter">
      <label>From<input type="date" value={from} onChange={(event)=>setFrom(event.target.value)}/></label>
      <label>To<input type="date" value={to} onChange={(event)=>setTo(event.target.value)}/></label>
      <button className="primary-action" disabled={loading} onClick={()=>void applyPeriod()}>{loading ? "Refreshing…" : "Apply period"}</button>
      <label>Telecaller<select value={focusedUserId} onChange={(event)=>setRecruiter(event.target.value)}><option value="">All permitted telecallers</option>{users.map((item:any)=><option key={item.profileId} value={item.profileId}>{item.name}</option>)}</select></label>
    </div>
    {loadError ? <div className="error-banner">{loadError}</div> : null}

    <div className="performance-kpis">{kpis.map(([label,value,className])=><article className={className} key={label}><span>{label}</span><strong>{value.toLocaleString("en-IN")}</strong></article>)}</div>

    {focusedUser?<section className="content-card manager-scorecard"><div className="performance-panel-head"><div><h2>{focusedUser.name}</h2><p>{focusedUser.email||"Registered telecaller"} · {visibleBreakdown.length} station/designation groups</p></div><button onClick={()=>setRecruiter("")}>Clear focus</button></div><div className="field-detail-strip"><span><b>{focusedUser.noResponse}</b>No response</span><span><b>{focusedUser.callBack}</b>Callbacks</span><span><b>{focusedUser.completed}</b>Outcomes recorded</span><span><b>{focusedUser.leadToJoinRate}%</b>Lead → join</span><span><b>{focusedUser.retained30}</b>30-day qualified</span></div></section>:null}

    <OutcomeStrip rows={focusedUser?focusedStatusBreakdown:(payload?.statusBreakdown??[])} total={Number(displayed.handled||0)}/>

    <section className="content-card performance-breakdown"><div className="performance-panel-head"><div><h2>Station × designation</h2><p>Latest outcome for every attended lead{focusedUser?` handled by ${focusedUser.name}`:""}.</p></div><b>{visibleBreakdown.length} groups</b></div><div className="table-scroll performance-breakdown-desktop"><table><thead><tr><th>Recruiter</th><th>Station</th><th>Designation</th><th>Attended</th>{statusColumns.visible.map(([status])=><th key={status}>{statusLabel(status)}</th>)}{statusColumns.hidden.size?<th>Others</th>:null}</tr></thead><tbody>{visibleBreakdown.slice(0,30).map((item:any)=><tr key={`${item.recruiterProfileId}-${item.station}-${item.designation}`}><td><button className="performance-user-link" onClick={()=>setRecruiter(item.recruiterProfileId)}>{item.recruiter}</button></td><td>{item.station}</td><td>{item.designation}</td><td><b>{item.attended}</b></td>{statusColumns.visible.map(([status])=>{const count=Number(item.statusCounts?.[status]??0);return <td className="performance-status-cell" key={status}><b>{count}</b><small>{statusShare(count,Number(item.attended||0))}</small></td>;})}{statusColumns.hidden.size?<td className="performance-status-cell"><b>{hiddenStatusCount(item,statusColumns.hidden)}</b><small>{statusShare(hiddenStatusCount(item,statusColumns.hidden),Number(item.attended||0))}</small></td>:null}</tr>)}</tbody></table>{!visibleBreakdown.length?<div className="empty">No recorded telecaller actions for the selected period.</div>:null}</div><PerformanceBreakdownCards rows={visibleBreakdown.slice(0,30)} includeRecruiter/></section>

    <section className="performance-insights">
      <button type="button" onClick={()=>setTab("lifecycle")}><strong>{scheduledPending.toLocaleString("en-IN")}</strong><span>Interview outcomes pending</span></button>
      <button type="button" onClick={()=>setTab("lifecycle")}><strong>{missingOpsId.toLocaleString("en-IN")}</strong><span>Joined without Rabbit / provider ID</span></button>
      <button type="button" onClick={()=>setTab("lifecycle")}><strong>{awaitingRetention.toLocaleString("en-IN")}</strong><span>30-day qualification in progress</span></button>
      <button type="button" onClick={()=>setTab("scorecard")}><strong>{zeroJoinRecruiters.toLocaleString("en-IN")}</strong><span>Recruiters with interviews but no joins</span></button>
    </section>

    <div className="performance-tabs">
      <button className={tab==="scorecard"?"selected":""} onClick={()=>setTab("scorecard")}>Recruiter Scorecard</button>
      <button className={tab==="lifecycle"?"selected":""} onClick={()=>setTab("lifecycle")}>Associate Lifecycle</button>
    </div>

    {tab === "scorecard" ? <section className="content-card performance-panel">
      <div className="performance-panel-head"><div><h2>{combinedView ? "Telecaller and field recruiter scorecard" : "Telecaller scorecard"}</h2><p>Interview and joining outcomes are attributed to the user who performed the action.</p></div><b>{users.length} users</b></div>
      <div className="table-scroll"><table className="performance-table"><thead><tr><th>Recruiter</th><th>Handled</th><th>Profiles initiated</th><th>Calling effort</th><th>Interviews</th><th>Interview outcomes</th><th>Selected</th><th>Joined</th><th>MTD</th><th>30-day</th><th>Conversion</th><th>Operations performance</th></tr></thead><tbody>
        {users.map((item:any)=><tr className={focusedUserId===item.profileId?"selected-performance-row":""} key={item.profileId}>
          <td><button className="performance-user-link" onClick={()=>setRecruiter(item.profileId)}>{item.name}</button><small>{item.email || "Registered recruitment user"}{combinedView ? ` • ${item.function === "field_recruiter" ? "Field recruiter" : "Telecaller"}` : ""}</small></td>
          <td><b>{Number(item.handled).toLocaleString("en-IN")}</b></td>
          <td><b>{Number(item.onboarded||0).toLocaleString("en-IN")}</b></td>
          <td><b>{Number(item.attempts).toLocaleString("en-IN")} attempts</b><small>{item.noResponse} no response • {item.callBack} callbacks</small></td>
          <td><b>{Number(item.interviews).toLocaleString("en-IN")}</b></td>
          <td><b>{item.completed} outcomes recorded</b><small>{item.noShow} no-show • {item.rejected} rejected / not fit</small></td>
          <td><b>{Number(item.selected).toLocaleString("en-IN")}</b></td>
          <td><b>{Number(item.joined).toLocaleString("en-IN")}</b></td>
          <td><b>{Number(item.mtdJoined).toLocaleString("en-IN")}</b></td>
          <td><span className="retention-badge">{Number(item.retained30).toLocaleString("en-IN")} qualified</span></td>
          <td><b>{item.leadToJoinRate}% lead → join</b><small>{item.interviewToJoinRate}% interview → join</small></td>
          <td><b>{Number(item.deliveries).toLocaleString("en-IN")} deliveries</b><small>{item.activeAssociates} active associates • {item.activeDays} total active days</small></td>
        </tr>)}
      </tbody></table>{!users.length?<div className="empty">No recruiter activity was recorded in this period and access scope.</div>:null}</div>
    </section> : <section className="content-card performance-panel">
      <div className="performance-panel-head lifecycle-head"><div><h2>Associate lifecycle and interview outcomes</h2><p>Complete audit view from interview scheduling through joining and operational retention.</p></div><div className="lifecycle-filters"><input placeholder="Search candidate, mobile, ID, station or outcome…" value={search} onChange={(event)=>setSearch(event.target.value)}/><MultiFilter label="Recruiters" value={recruiter} options={users.map((item:any)=>[item.profileId,item.name])} onChange={setRecruiter}/></div></div>
      <div className="table-scroll"><table className="performance-table lifecycle-table"><thead><tr><th>Associate</th><th>Recruiter</th><th>Station / role</th><th>Interview and outcome</th><th>Joining details</th><th>Operations and retention</th></tr></thead><tbody>
        {visibleLifecycle.map((item:any)=><tr key={item.leadId}>
          <td><b>{item.candidate}</b><small>{displayPhone(item.phone)}</small></td>
          <td><b>{item.recruiter}</b></td>
          <td><b>{item.station}</b><small>{item.role}</small></td>
          <td><span className={`lifecycle-stage stage-${String(item.latestOutcome||"new").toLowerCase()}`}>{statusLabel(item.latestOutcome)}</span><small>Interview: {item.interviewOutcome ? statusLabel(item.interviewOutcome) : "Not recorded"}{item.interviewAt ? ` • ${dateText(item.interviewAt,true)}` : ""}</small><small>Current stage: {statusLabel(item.lifecycleStage)} • Updated {dateText(item.outcomeAt,true)}</small></td>
          <td>{item.joiningDate ? <><b>Joined {dateText(item.joiningDate)}</b><small>Employee ID: {item.employeeId || "Not entered"}</small><small>Rabbit / provider ID: {item.providerEmployeeId || "Not entered"}</small><small>Company ID: {item.companyId || "Not entered"}</small></> : <span className="muted-stage">Not joined yet</span>}</td>
          <td>{item.opsLinked ? <><b>{Number(item.deliveries).toLocaleString("en-IN")} deliveries</b><small>{item.activeDays} active days • Last active {dateText(item.lastActiveDate)}</small><span className={item.retained30?"retention-badge":"retention-pending"}>{item.retained30?"30-day qualified":"Qualification in progress"}</span></> : <><b>No operations match</b><small>{item.providerEmployeeId ? "Provider ID has no activity in this period." : "Add Rabbit / provider ID in joining details."}</small></>}</td>
        </tr>)}
      </tbody></table>{!visibleLifecycle.length?<div className="empty">No associate lifecycle records match this period and filter.</div>:null}</div>
    </section>}
  </section>;
}

function InfluencerPerformance({token,user}:{token:string;user:User}) {
  const today=istDate();
  const [from,setFrom]=useState(`${today.slice(0,7)}-01`);
  const [to,setTo]=useState(today);
  const [selected,setSelected]=useState(user.recruitmentFunction==="influencer"?user.profileId:"");
  const [data,setData]=useState<any>(null);
  const [busy,setBusy]=useState(true);
  const [notice,setNotice]=useState("");
  const load=useCallback(async()=>{
    setBusy(true);setNotice("");
    try{
      const params=new URLSearchParams({from,to,view:"influencer"});
      const response=await fetch(`/api/recruitment/recruiter-performance?${params}`,{headers:headers(token),cache:"no-store"});
      const payload=await response.json();
      if(!response.ok)throw new Error(payload.error||"Unable to load influencer performance.");
      setData(payload);
    }catch(caught){setNotice(caught instanceof Error?caught.message:"Unable to load influencer performance.");}
    finally{setBusy(false);}
  },[from,to,token]);
  useEffect(()=>{void load();},[load]);
  const users=data?.users??[];
  const effectiveSelected=selected||(user.recruitmentFunction==="influencer"?user.profileId:"");
  const candidates=(data?.lifecycle??[]).filter((item:any)=>!effectiveSelected||item.recruiterProfileId===effectiveSelected);
  const focused=users.find((item:any)=>item.profileId===effectiveSelected);
  const registrationCompleted=candidates.filter((item:any)=>!["Registration pending","Correction required","Not approved"].includes(item.candidateStage)).length;
  const joined=candidates.filter((item:any)=>Boolean(item.joiningDate)).length;
  const milestoneCount=(days:number)=>candidates.filter((item:any)=>Number(item.activeDays||0)>=days).length;
  const earned=candidates.reduce((sum:number,item:any)=>sum+Number(item.earnedAmount||0),0);
  const milestones=data?.influencerProgram?.milestones??[];
  return <section className="influencer-performance">
    <header className="influencer-hero"><div><small>LOCAL SOURCING PARTNER PROGRAM</small><h2>{user.recruitmentFunction==="influencer"?"My Influencer Performance":"Influencer Performance"}</h2><p>Every referral stays attributed to its source. Registration, joining, operational active days and milestone value are verified from the same Workforce lifecycle.</p></div><div className="influencer-period"><label>From<input type="date" value={from} onChange={(event)=>setFrom(event.target.value)}/></label><label>To<input type="date" value={to} onChange={(event)=>setTo(event.target.value)}/></label><button onClick={()=>void load()} disabled={busy}>{busy?"Refreshing…":"Refresh"}</button></div></header>
    {notice?<div className="error-banner">{notice}</div>:null}
    {user.recruitmentFunction!=="influencer"?<section className="content-card influencer-roster"><div><h3>Influencer</h3><p>Select one partner for the complete referral and retention trail.</p></div><select value={selected} onChange={(event)=>setSelected(event.target.value)}><option value="">All permitted influencers</option>{users.map((item:any)=><option key={item.profileId} value={item.profileId}>{item.name} · {item.email||"No email"}</option>)}</select></section>:null}
    <section className="influencer-metrics">
      {[["Influencers",effectiveSelected?1:users.length],["Referrals",candidates.length],["Registration completed",registrationCompleted],["Joined",joined],["10 active days",milestoneCount(10)],["20 active days",milestoneCount(20)],["30 active days",milestoneCount(30)],["Accrued value",`₹${earned.toLocaleString("en-IN")}`]].map(([label,value])=><article key={String(label)}><span>{label}</span><strong>{typeof value==="number"?value.toLocaleString("en-IN"):value}</strong></article>)}
    </section>
    {focused?<section className="content-card influencer-focus"><div><small>INDIVIDUAL SCORECARD</small><h3>{focused.name}</h3><p>{focused.onboarded} profiles initiated · {focused.joined} joined · {focused.retained30} completed 30 active days</p></div><strong>{candidates.length?Math.round(joined/candidates.length*100):0}%<small>referral → join</small></strong></section>:null}
    <section className="content-card influencer-candidates"><div className="performance-panel-head"><div><h2>{effectiveSelected?"My referral journey":"Referral journeys"}</h2><p>Only candidates attributed to the selected influencer are shown.</p></div><b>{candidates.length} referrals</b></div><div className="influencer-candidate-grid">{candidates.map((item:any)=>{
      const lastMilestone=milestones.filter((milestone:any)=>Number(item.activeDays||0)>=Number(milestone.activeDays||0)).at(-1);
      const maxDays=Number(milestones.at(-1)?.activeDays||30);
      return <article key={`${item.recruiterProfileId}-${item.leadId}`}><header><div><small>{effectiveSelected?item.station:`${item.recruiter} · ${item.station}`}</small><h3>{item.candidate}</h3><p>{item.role}</p></div><span>{item.candidateStage||statusLabel(item.lifecycleStage)}</span></header><div className="influencer-progress"><i style={{width:`${Math.min(100,Number(item.activeDays||0)/maxDays*100)}%`}}/></div><dl><span><dt>Active days</dt><dd>{Number(item.activeDays||0)}</dd></span><span><dt>Deliveries</dt><dd>{Number(item.deliveries||0)}</dd></span><span><dt>Milestone</dt><dd>{lastMilestone?`${lastMilestone.activeDays} days`:"Not reached"}</dd></span><span><dt>Accrued</dt><dd>₹{Number(item.earnedAmount||0).toLocaleString("en-IN")}</dd></span></dl><footer>{item.nextMilestoneDays?`${item.daysRemaining} active days to ₹${Number(item.nextMilestoneAmount||0).toLocaleString("en-IN")} milestone`:"30-day pilot milestone completed"}<small>Last operations activity: {item.lastActiveDate||"Not linked yet"}</small></footer></article>;
    })}{!candidates.length&&!busy?<div className="empty">No influencer referrals match this period and scope.</div>:null}</div></section>
  </section>;
}

function PersonalPerformance({ token, user }: { token:string; user:User }) {
  const [from,setFrom]=useState(istDate());
  const [to,setTo]=useState(istDate());
  const [month,setMonth]=useState(istDate().slice(0,7));
  const [data,setData]=useState<any>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const load=useCallback(async()=>{
    setBusy(true);setError("");
    try {
      const params=new URLSearchParams({from,to,month});
      const response=await fetch(`/api/recruitment/personal-performance?${params}`,{headers:headers(token),cache:"no-store"});
      const payload=await response.json();
      if(!response.ok)throw new Error(payload.error||"Unable to load your performance.");
      setData(payload);
    } catch(caught){setError(caught instanceof Error?caught.message:"Unable to load your performance.");}
    finally{setBusy(false);}
  },[from,to,month,token]);
  useEffect(()=>{void load();},[]); // eslint-disable-line react-hooks/exhaustive-deps
  const metrics=data?.metrics??{};
  const breakdown=data?.breakdown??[];
  const statusColumns=performanceStatusColumns(breakdown);
  const mtd=data?.mtdJourney??{};
  const functionLabel=data?.function==="field_recruiter"?"Field Recruiter":data?.function==="manager"?"Manager":data?.function==="telecaller"?"Telecaller":"Recruitment User";
  return <section className="personal-performance content-card">
    <div className="personal-head"><div><span>{data?.function==="field_recruiter"?"FIELD RECRUITER PERFORMANCE":"TELECALLER PERFORMANCE"}</span><h2>{user.name||"My"} • {functionLabel}</h2><p>{from===to?new Date(`${from}T00:00:00`).toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"}):`${from} – ${to}`} daily review</p></div><div className="personal-filters"><label>From<input type="date" value={from} onChange={(event)=>setFrom(event.target.value)}/></label><label>To<input type="date" value={to} onChange={(event)=>setTo(event.target.value)}/></label><label>MTD month<input type="month" value={month} onChange={(event)=>setMonth(event.target.value)}/></label><button disabled={busy} onClick={()=>void load()}>{busy?"Refreshing…":"Apply"}</button></div></div>
    {error?<p className="error-banner">{error}</p>:null}
    <div className="personal-kpis">{[
      ["Leads attended",metrics.attended,"blue"],["Interviews",metrics.interviews,"purple"],
      ["Call Back",metrics.callBack,"pink"],["No Response",metrics.noResponse,"orange"],
      ["Profiles initiated",metrics.onboarded,"orange"],["Joined",metrics.joined,"green"],["Conversion",`${metrics.conversion??0}%`,"indigo"],["MTD joined",metrics.mtdJoined,"teal"]
    ].map(([label,value,color])=><article className={`personal-${color}`} key={label}><span>{label}</span><strong>{typeof value==="number"?value.toLocaleString("en-IN"):value??0}</strong></article>)}</div>
    <div className="personal-visual-row"><OutcomeStrip rows={data?.statusBreakdown??[]} total={Number(metrics.attended||0)}/><section className="mtd-journey"><header><h3>{month} journey</h3><b>{mtd.conversion??0}% conversion</b></header><div>{[["Attended",mtd.attended],["Interviews",mtd.interviews],["Selected",mtd.selected],["Joined",mtd.joined]].map(([label,value])=><span key={String(label)}><strong>{Number(value??0).toLocaleString("en-IN")}</strong><small>{label}</small></span>)}</div></section></div>
    <div className="personal-breakdown"><div className="performance-panel-head"><div><h2>Station × designation</h2><p>Latest outcome for every attended lead.</p></div><b>{breakdown.length} groups</b></div><div className="table-scroll performance-breakdown-desktop"><table><thead><tr><th>Station</th><th>Designation</th><th>Attended</th>{statusColumns.visible.map(([status])=><th key={status}>{statusLabel(status)}</th>)}{statusColumns.hidden.size?<th>Others</th>:null}</tr></thead><tbody>{breakdown.map((item:any)=><tr key={`${item.station}-${item.designation}`}><td><b>{item.station}</b></td><td>{item.designation}</td><td><b>{item.attended}</b></td>{statusColumns.visible.map(([status])=>{const count=Number(item.statusCounts?.[status]??0);return <td className="performance-status-cell" key={status}><b>{count}</b><small>{statusShare(count,Number(item.attended||0))}</small></td>;})}{statusColumns.hidden.size?<td className="performance-status-cell"><b>{hiddenStatusCount(item,statusColumns.hidden)}</b><small>{statusShare(hiddenStatusCount(item,statusColumns.hidden),Number(item.attended||0))}</small></td>:null}</tr>)}</tbody></table>{!breakdown.length?<div className="empty">No recorded recruiter actions for the selected day.</div>:null}</div><PerformanceBreakdownCards rows={breakdown}/></div>
    <div className={`personal-lower ${data?.incentiveVisible===false?"retention-only":""}`}><article><header><div><h3>My associate retention</h3><p>{month} • attendance, delivery activity and {data?.qualificationDays??30}-active-day qualification</p></div><b>{data?.qualifiedAssociates??0} qualified</b></header><div className="associate-cards">{(data?.associates??[]).slice(0,50).map((item:any)=><details key={item.leadId}><summary><span><b>{item.candidate}</b><small>{item.employeeId||item.providerEmployeeId||"Operations ID pending"} • {item.station}</small></span><strong>{item.deliveries} deliveries<small>{item.activeDays} active days</small></strong></summary><div className="associate-followup"><span>{displayPhone(item.phone)}</span>{item.phone?<a href={`tel:${String(item.phone).replace(/\D/g,"")}`}>Call associate</a>:null}<small>Last active: {item.lastActiveDate||"No operations activity yet"} • {item.retained30?"30-day retained":"Retention in progress"}</small></div><div className="daily-activity">{(item.daily??[]).map((day:any)=><span key={day.date}><b>{new Date(`${day.date}T00:00:00`).toLocaleDateString("en-IN")}</b><small>{day.deliveries} deliveries • {day.activity} activity</small></span>)}{!item.daily?.length?<p>No operational activity matched for this month.</p>:null}</div></details>)}</div></article>{data?.incentiveVisible!==false?<article className="incentive-summary"><span>MONTHLY INCENTIVE</span><strong>₹{Number(data?.estimatedIncentive??0).toLocaleString("en-IN")}</strong><b>{data?.incentiveState??"Provisional"}</b><p>Calculated from the effective Incentive Master rule. Payment approval and payout remain management controls.</p></article>:null}</div>
  </section>;
}

function IncentiveMaster({data,token,canEdit,reload}:{data:any;token:string;canEdit:boolean;reload:()=>Promise<void>}) {
  const [rules,setRules]=useState<any[]>(data?.rules??[]);
  const [designationOptions,setDesignationOptions]=useState<any[]>(data?.designationOptions??[]);
  const [influencerProgram,setInfluencerProgram]=useState<any>(data?.influencerProgram??{attributionWindowDays:90,milestones:[{activeDays:10,amount:300},{activeDays:20,amount:700},{activeDays:30,amount:1000}]});
  const [newDesignation,setNewDesignation]=useState({code:"",name:""});
  const [saving,setSaving]=useState(false);
  const [notice,setNotice]=useState("");
  useEffect(()=>{setRules(data?.rules??[]);setDesignationOptions(data?.designationOptions??[]);setInfluencerProgram(data?.influencerProgram??{attributionWindowDays:90,milestones:[{activeDays:10,amount:300},{activeDays:20,amount:700},{activeDays:30,amount:1000}]});},[data]);
  const change=(index:number,key:string,value:unknown)=>setRules((current)=>current.map((rule,i)=>i===index?{...rule,[key]:value}:rule));
  const add=()=>setRules((current)=>[...current,{effectiveFrom:istDate(),effectiveTo:null,qualificationDays:30,amountPerQualifiedAssociate:0,minimumQualifiedAssociates:1,eligibleDesignations:[],isActive:true}]);
  const changeInfluencerMilestone=(index:number,key:"activeDays"|"amount",value:number)=>setInfluencerProgram((current:any)=>({...current,milestones:(current.milestones??[]).map((item:any,i:number)=>i===index?{...item,[key]:value}:item)}));
  const addInfluencerMilestone=()=>setInfluencerProgram((current:any)=>({...current,milestones:[...(current.milestones??[]),{activeDays:30,amount:0}]}));
  function addDesignation(){
    const code=newDesignation.code.trim().toUpperCase();
    const name=newDesignation.name.trim();
    if(!/^[A-Z][A-Z0-9_]{1,39}$/.test(code)||!name){setNotice("Enter a valid designation code and name.");return;}
    setDesignationOptions((current)=>[...current.filter((item)=>String(item.code).toUpperCase()!==code),{code,name}].sort((a,b)=>String(a.code).localeCompare(String(b.code))));
    setNewDesignation({code:"",name:""});
    setNotice(`${code} added to this Master. Save Incentive Master to publish it.`);
  }
  async function save(){
    if(!canEdit){setNotice("View access — changes are disabled.");return;}
    setSaving(true);setNotice("");
    try{const response=await fetch("/api/recruitment/incentives",{method:"PUT",headers:{...headers(token),"Content-Type":"application/json"},body:JSON.stringify({rules,designationOptions,influencerProgram})});const payload=await response.json();if(!response.ok)throw new Error(payload.error||"Unable to save incentive rules.");setNotice("Incentive Master saved. New calculations use the effective rule without changing historical leads.");await reload();}catch(caught){setNotice(caught instanceof Error?caught.message:"Unable to save incentive rules.");}finally{setSaving(false);}
  }
  return <section className="connections-view"><section className="content-card connection-intro"><div><h2>Workforce Incentive Master</h2><p>Configure every eligible designation here. No designation receives incentive visibility unless it is selected in an effective Master rule.</p></div><dl><dt>Qualification source</dt><dd>Operations activity</dd><dt>Attribution</dt><dd>Onboarding ownership</dd></dl></section><section className="content-card incentive-master">{!canEdit?<p className="read-only-master-note">View access — Incentive Master changes are disabled.</p>:null}<fieldset disabled={!canEdit}><div className="access-section-head"><div><h2>Designation catalog</h2><p>Add recruitment-specific designations here; users receive them from Users &amp; Access.</p></div></div><div className="form-grid"><label>Designation code<input placeholder="Example: TELE_CALLER" value={newDesignation.code} onChange={(event)=>setNewDesignation({...newDesignation,code:event.target.value.toUpperCase()})}/></label><label>Designation name<input placeholder="Example: Telecaller" value={newDesignation.name} onChange={(event)=>setNewDesignation({...newDesignation,name:event.target.value})}/></label>{canEdit?<button type="button" onClick={addDesignation}>Add designation</button>:null}</div><div className="access-section-head influencer-master-head"><div><small>RINF · RECRUITMENT INFLUENCER</small><h2>Influencer milestone ladder</h2><p>Only verified delivery working days count. Joining, training and office visits do not earn value.</p></div>{canEdit?<button type="button" onClick={addInfluencerMilestone}>Add milestone</button>:null}</div><div className="influencer-master-grid"><label>Attribution window (days)<input type="number" min="1" max="366" value={influencerProgram.attributionWindowDays??90} onChange={(event)=>setInfluencerProgram((current:any)=>({...current,attributionWindowDays:Number(event.target.value)}))}/></label>{(influencerProgram.milestones??[]).map((milestone:any,index:number)=><article key={`${milestone.activeDays}-${index}`}><label>Active working days<input type="number" min="1" max="366" value={milestone.activeDays} onChange={(event)=>changeInfluencerMilestone(index,"activeDays",Number(event.target.value))}/></label><label>Incremental payout (₹)<input type="number" min="0" value={milestone.amount} onChange={(event)=>changeInfluencerMilestone(index,"amount",Number(event.target.value))}/></label>{canEdit?<button className="rule-remove" type="button" disabled={(influencerProgram.milestones??[]).length===1} onClick={()=>setInfluencerProgram((current:any)=>({...current,milestones:current.milestones.filter((_:any,i:number)=>i!==index)}))}>Remove</button>:null}</article>)}</div><div className="access-section-head"><div><h2>Effective rules</h2><p>Designation eligibility and effective rules are saved in Master; non-eligible users see retention without incentive values.</p></div>{canEdit?<button onClick={add}>Add rule</button>:null}</div>{rules.map((rule,index)=><div className="incentive-rule" key={`${rule.effectiveFrom}-${index}`}><label>Effective from<input type="date" value={rule.effectiveFrom||""} onChange={(event)=>change(index,"effectiveFrom",event.target.value)}/></label><label>Effective to<input type="date" value={rule.effectiveTo||""} onChange={(event)=>change(index,"effectiveTo",event.target.value||null)}/></label><label>Active days required<input type="number" min="1" max="366" value={rule.qualificationDays} onChange={(event)=>change(index,"qualificationDays",Number(event.target.value))}/></label><label>Minimum qualified associates<input type="number" min="1" value={rule.minimumQualifiedAssociates} onChange={(event)=>change(index,"minimumQualifiedAssociates",Number(event.target.value))}/></label><label>Amount per qualified associate<input type="number" min="0" value={rule.amountPerQualifiedAssociate} onChange={(event)=>change(index,"amountPerQualifiedAssociate",Number(event.target.value))}/></label><label>Eligible designations<select multiple value={rule.eligibleDesignations??[]} onChange={(event)=>change(index,"eligibleDesignations",Array.from(event.currentTarget.selectedOptions).map((option)=>option.value))}>{designationOptions.map((item:any)=><option value={String(item.code).toUpperCase()} key={item.code}>{item.code} — {item.name}</option>)}</select></label><label className="check-field"><input type="checkbox" checked={rule.isActive!==false} onChange={(event)=>change(index,"isActive",event.target.checked)}/>Active rule</label>{canEdit?<button className="rule-remove" disabled={rules.length===1} onClick={()=>setRules((current)=>current.filter((_,i)=>i!==index))}>Remove</button>:null}</div>)}{notice?<p className="connection-notice">{notice}</p>:null}{canEdit?<div className="form-actions"><button className="primary-action" disabled={saving||!rules.length} onClick={()=>void save()}>{saving?"Saving…":"Save Incentive Master"}</button></div>:null}</fieldset></section></section>;
}

function FilterSelect({ label, value, options, onChange }: { label: string; value: string; options: Array<[string,string]>; onChange: (value:string)=>void }) {
  return <select value={value} onChange={(event)=>onChange(event.target.value)}><option value="">{label}</option>{options.map(([option,labelText])=><option value={option} key={option}>{labelText}</option>)}</select>;
}

function MultiFilter({ label, value, options, onChange, onApply, busy = false }: { label: string; value: string; options: Array<[string,string]>; onChange: (value:string)=>void; onApply?:()=>void; busy?:boolean }) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [query,setQuery]=useState("");
  const selected = value.split(",").map((item)=>item.trim()).filter(Boolean);
  const selectedSet = new Set(selected);
  const visibleOptions = options.filter(([,labelText])=>labelText.toLowerCase().includes(query.trim().toLowerCase()));
  const allVisibleSelected = visibleOptions.length > 0 && visibleOptions.every(([option])=>selectedSet.has(option));
  function toggle(option: string) {
    const next = new Set(selectedSet);
    if (next.has(option)) next.delete(option);
    else next.add(option);
    onChange([...next].join(","));
  }
  function toggleAllVisible() {
    const next = new Set(selectedSet);
    visibleOptions.forEach(([option])=>allVisibleSelected ? next.delete(option) : next.add(option));
    onChange([...next].join(","));
  }
  return <details className="multi-filter" ref={detailsRef} onToggle={(event)=>{
    if (!event.currentTarget.open) return;
    document.querySelectorAll<HTMLDetailsElement>("details.multi-filter[open]").forEach((item)=>{
      if (item!==event.currentTarget)item.removeAttribute("open");
    });
  }}>
    <summary>{selected.length ? `${label} (${selected.length} selected)` : `All ${label}`}</summary>
    <div className="multi-filter-menu">
      <header><b>{label}</b><span><button type="button" onClick={(event)=>{event.preventDefault();toggleAllVisible();}}>{allVisibleSelected?"Clear all":query?"Select shown":"Select all"}</button>{selected.length&&!allVisibleSelected?<button type="button" onClick={(event)=>{event.preventDefault();onChange("");}}>Clear</button>:null}</span></header>
      <input className="dropdown-search" placeholder={`Search ${label.toLowerCase()}…`} value={query} onChange={(event)=>setQuery(event.target.value)}/>
      <div>{visibleOptions.map(([option,labelText])=><label key={option}><input type="checkbox" checked={selectedSet.has(option)} onChange={()=>toggle(option)}/><span>{labelText}</span></label>)}{!visibleOptions.length?<p className="dropdown-empty">No matching options</p>:null}</div>
      {onApply?<footer><button type="button" disabled={busy} onClick={(event)=>{event.preventDefault();event.stopPropagation();detailsRef.current?.removeAttribute("open");setQuery("");onApply();}}>{busy?"Applying…":"Apply filters"}</button></footer>:null}
    </div>
  </details>;
}

function SearchSelect({label,value,options,onChange,placeholder="Search and select…"}:{label:string;value:string;options:Array<[string,string]>;onChange:(value:string)=>void;placeholder?:string}) {
  const [query,setQuery]=useState("");
  const selectedLabel=options.find(([option])=>option===value)?.[1]||"";
  const filtered=options.filter(([,text])=>text.toLowerCase().includes(query.trim().toLowerCase()));
  return <label className="search-select">{label}<input placeholder={selectedLabel||placeholder} value={query} onChange={(event)=>setQuery(event.target.value)}/><select value={value} onChange={(event)=>{onChange(event.target.value);setQuery("");}}><option value="">{selectedLabel||"Select"}</option>{filtered.map(([option,text])=><option value={option} key={option}>{text}</option>)}</select></label>;
}

function AdDesignationPendencyPanel({ rows = [] }: { rows?: any[] }) {
  const [view,setView]=useState<"all"|"pending">("all");
  const visible=view==="pending"?rows.filter((row)=>Number(row.pending||0)>0):rows;
  const active=rows.filter((row)=>String(row.adStatus).toLowerCase()==="active").length;
  const paused=rows.filter((row)=>String(row.adStatus).toLowerCase()==="paused").length;
  const other=Math.max(0,rows.length-active-paused);
  const tone=(value:unknown)=>{
    const status=String(value||"not_active").toLowerCase();
    if(status==="active")return "active";
    if(status==="paused")return "paused";
    if(["disapproved","rejected","with_issues","not_active","inactive"].includes(status))return "inactive";
    return "other";
  };
  const label=(value:unknown)=>statusLabel(String(value||"not_active"));
  return <article className="content-card wide ad-pendency-card">
    <div className="command-section-head ad-pendency-head"><div><span>AD COVERAGE</span><h2>Designation pendency by ad</h2><p>Every scoped ad, its current status and open lead workload.</p></div><div className="ad-pendency-head-actions"><div className="ad-status-summary"><i className="active">{active} active</i><i className="paused">{paused} paused</i><i className="inactive">{other} other</i></div><div className="ad-pendency-toggle"><button className={view==="all"?"selected":""} onClick={()=>setView("all")}>All ads</button><button className={view==="pending"?"selected":""} onClick={()=>setView("pending")}>Pending only</button></div></div></div>
    <div className="table-scroll ad-pendency-desktop"><table><thead><tr><th>Ad / designation</th><th>Station</th><th>Ad status</th><th>Pending</th><th>No status</th><th>No response</th><th>Call back</th><th>24h+</th><th>Total leads</th></tr></thead><tbody>{visible.map((row,index)=><tr key={row.adId||`${row.station}-${row.designation}-${index}`}><td><b>{row.adName}</b><small>{row.designation} · {row.designationName}</small></td><td><b>{row.station}</b><small>{row.stationName}</small></td><td><span className={`ad-state-chip ${tone(row.adStatus)}`}>{label(row.adStatus)}</span>{row.routeStatus!=="ready"&&row.routeStatus!=="mapped"?<small>{label(row.routeStatus)}</small>:null}</td><td><strong className={Number(row.pending||0)>0?"pending-number":"clear-number"}>{Number(row.pending||0).toLocaleString("en-IN")}</strong></td><td>{Number(row.noStatus||0).toLocaleString("en-IN")}</td><td>{Number(row.noResponse||0).toLocaleString("en-IN")}</td><td>{Number(row.callBack||0).toLocaleString("en-IN")}</td><td>{Number(row.stale24h||0).toLocaleString("en-IN")}</td><td>{Number(row.totalLeads||0).toLocaleString("en-IN")}</td></tr>)}</tbody></table></div>
    <div className="ad-pendency-mobile">{visible.map((row,index)=><details key={row.adId||`${row.station}-${row.designation}-${index}`}><summary><span><b>{row.adName}</b><small>{row.station} · {row.designation}</small></span><span className={`ad-state-chip ${tone(row.adStatus)}`}>{label(row.adStatus)}</span><strong className={Number(row.pending||0)>0?"pending-number":"clear-number"}>{Number(row.pending||0)}<small>pending</small></strong></summary><dl><span><dt>Designation</dt><dd>{row.designationName}</dd></span><span><dt>Station</dt><dd>{row.stationName}</dd></span><span><dt>No status</dt><dd>{row.noStatus||0}</dd></span><span><dt>No response</dt><dd>{row.noResponse||0}</dd></span><span><dt>Call back</dt><dd>{row.callBack||0}</dd></span><span><dt>24h+</dt><dd>{row.stale24h||0}</dd></span><span><dt>Total leads</dt><dd>{row.totalLeads||0}</dd></span><span><dt>Routing</dt><dd>{label(row.routeStatus)}</dd></span></dl></details>)}</div>
    {!visible.length?<div className="empty">{view==="pending"?"No ad has pending leads in this scope.":"No ads are mapped to this scope."}</div>:null}
  </article>;
}

function DashboardPanels({ data }: { data: any }) {
  const queues = data?.queues ?? {};
  const priorityTotal=Number(queues.retryDue||0)+Number(queues.callbackDue||0)+Number(queues.interviewsToday||0)+Number(queues.noStatus24h||0);
  return <section className="dashboard-sections command-dashboard-sections">
    <article className="content-card command-action-card"><div className="command-section-head"><div><span>TODAY</span><h2>Action queue</h2></div><b>{priorityTotal.toLocaleString("en-IN")} actions</b></div><div className="queue-grid">{[
      ["Interviews",queues.interviewsToday,"positive"],["Callbacks",queues.callbackDue,"accent"],["Retries",queues.retryDue,"warning"],["24h pending",queues.noStatus24h,"danger"]
    ].map(([label,value,tone])=><div className={`queue-${tone}`} key={String(label)}><strong>{Number(value||0).toLocaleString("en-IN")}</strong><span>{label}</span></div>)}</div></article>
    <article className="content-card command-health-card"><div className="command-section-head"><div><span>PIPELINE</span><h2>Conversion health</h2></div><small>Current scope</small></div><div className="health-grid"><div><strong>{data?.health?.attendedRate??0}%</strong><span>Contacted</span></div><div><strong>{data?.health?.routedRate??0}%</strong><span>Mapped</span></div><div className={Number(data?.health?.staleRate||0)>20?"health-risk":""}><strong>{data?.health?.staleRate??0}%</strong><span>24h backlog</span></div></div></article>
    <AdDesignationPendencyPanel rows={data?.adDesignationPendency??[]}/>
    <article className="content-card wide command-station-card"><div className="command-section-head"><div><span>WHERE TO ACT</span><h2>Station focus</h2></div><small>Highest operating priority first</small></div><SimpleTable headers={["Station","Owner","Active leads","Pending","Retry","Call Back","24h+","Response","Health"]} rows={(data?.stationHealth??[]).slice(0,20).map((item:any)=>[
      `${item.code} — ${item.name}`,
      item.owner || item.ownerMobile || "Not assigned",
      item.total,item.pending,item.retryDue,item.callbackDue,item.stale,
      item.averageFirstResponseMinutes == null ? "—" : `${item.averageFirstResponseMinutes} min`,
      `${item.healthScore}% ${item.healthLabel}`
    ])}/></article>
  </section>;
}

function CapacityDemandPanel({token,openStation}:{token:string;openStation:(stationCode:string)=>void}) {
  const yesterday = useMemo(()=>{
    const today = new Date(`${istDate()}T00:00:00Z`);
    today.setUTCDate(today.getUTCDate()-1);
    return today.toISOString().slice(0,10);
  },[]);
  const [date,setDate]=useState(yesterday);
  const [appliedDate,setAppliedDate]=useState(yesterday);
  const [data,setData]=useState<any>(null);
  const [loading,setLoading]=useState(true);
  const [notice,setNotice]=useState("");
  const [view,setView]=useState<"stations"|"joiners"|"risk">("stations");
  const [stationFilter,setStationFilter]=useState("all");
  const [stageFilter,setStageFilter]=useState("all");
  useEffect(()=>{
    let active=true;
    setLoading(true);setNotice("");
    fetch(`/api/recruitment/capacity-demand?date=${encodeURIComponent(appliedDate)}`,{
      headers:headers(token),cache:"no-store"
    }).then(async(response)=>{
      const payload=await response.json();
      if(!response.ok)throw new Error(payload.error||"Unable to load capacity gaps.");
      return payload;
    }).then((payload)=>{if(active)setData(payload);})
      .catch((caught)=>{if(active)setNotice(caught instanceof Error?caught.message:"Unable to load capacity gaps.");})
      .finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[appliedDate,token]);
  const stations=(data?.rows??[]).filter((row:any)=>stationFilter==="all"||row.stationCode===stationFilter);
  const associates=(data?.visibleAssociates??[]).filter((row:any)=>(stationFilter==="all"||row.stationCode===stationFilter)&&(stageFilter==="all"||row.stage===stageFilter));
  const risks=associates.filter((row:any)=>["cooling","attrition_risk","stopped"].includes(row.stage));
  return <section className="capacity-demand-panel workforce-planning-panel">
    <header><div><span>WORKFORCE PLANNING</span><h2>Hiring command center</h2><p>Capacity gap, training pipeline and delivery activity in one reconciled view.</p></div><div className="capacity-demand-summary"><label>Date<input type="date" value={date} onChange={(event)=>setDate(event.target.value)}/></label><button type="button" disabled={loading||date===appliedDate} onClick={()=>setAppliedDate(date)}>{loading?"Loading…":"Apply"}</button></div></header>
    <div className="workforce-planning-kpis">
      <article><span>Capacity gap</span><strong>{loading?"…":Number(data?.totalCapacityGap??0).toLocaleString("en-IN")}</strong><small>Before recruitment pipeline</small></article>
      <article className="training"><span>In training</span><strong>{loading?"…":Number(data?.totalTraining??0).toLocaleString("en-IN")}</strong><small>Credited against the gap</small></article>
      <article className="hire"><span>Net hiring need</span><strong>{loading?"…":Number(data?.totalGap??0).toLocaleString("en-IN")}</strong><small>{Number(data?.gapStations??0)} stations to hire</small></article>
      <article className="risk"><span>Attrition risk</span><strong>{loading?"…":Number(data?.attritionRisk??0).toLocaleString("en-IN")}</strong><small>8–14 days without delivery</small></article>
    </div>
    <div className="workforce-planning-toolbar">
      <nav><button className={view==="stations"?"selected":""} onClick={()=>setView("stations")}>Station plan</button><button className={view==="joiners"?"selected":""} onClick={()=>setView("joiners")}>My joiners</button><button className={view==="risk"?"selected":""} onClick={()=>setView("risk")}>Attrition radar</button></nav>
      <div><label>Station<select value={stationFilter} onChange={(event)=>setStationFilter(event.target.value)}><option value="all">All permitted stations</option>{(data?.rows??[]).map((row:any)=><option value={row.stationCode} key={row.stationCode}>{row.stationCode} — {row.stationName}</option>)}</select></label>{view!=="stations"?<label>Status<select value={stageFilter} onChange={(event)=>setStageFilter(event.target.value)}><option value="all">All lifecycle stages</option><option value="scheduled">Scheduled</option><option value="training">Training</option><option value="productive">Productive</option><option value="cooling">Cooling</option><option value="attrition_risk">Attrition risk</option><option value="stopped">Stopped</option></select></label>:null}</div>
    </div>
    {notice?<div className="capacity-demand-notice">{notice}</div>:null}
    {!notice&&view==="stations"?<div className="capacity-demand-table-wrap"><table className="capacity-demand-table workforce-station-plan">
      <thead><tr><th>Station</th><th>Avg volume</th><th>Ops HC</th><th>Required</th><th>Capacity gap</th><th>Training</th><th>Net hire</th><th>Risk</th><th>Recommended action</th></tr></thead>
      <tbody>
        {stations.map((row:any)=>{
          return <tr key={row.stationCode}>
            <td><span className="capacity-code">{row.stationCode}</span><b>{row.stationName}</b></td>
            <td><strong>{Number(row.workload).toLocaleString("en-IN")}</strong><small>14-day average</small></td>
            <td><b>{Number(row.currentHeadcount).toLocaleString("en-IN")}</b></td>
            <td><b>{Number(row.requiredHeadcount).toLocaleString("en-IN")}</b></td>
            <td><strong className={row.capacityGap>0?"capacity-gap-value":"capacity-surplus-value"}>{row.capacityGap>0?`+${row.capacityGap}`:Number(row.modelledGap).toLocaleString("en-IN")}</strong></td>
            <td><strong className="training-value">{Number(row.trainingHeadcount).toLocaleString("en-IN")}</strong><small>{row.scheduledHeadcount?`${row.scheduledHeadcount} scheduled`:"14-day ramp"}</small></td>
            <td><strong className={row.netHiringNeed>0?"net-hire-value":"capacity-surplus-value"}>{Number(row.netHiringNeed).toLocaleString("en-IN")}</strong></td>
            <td><strong className={row.attritionRiskHeadcount?"risk-value":""}>{Number(row.attritionRiskHeadcount).toLocaleString("en-IN")}</strong><small>{row.coolingHeadcount?`${row.coolingHeadcount} cooling`:"No cooling"}</small></td>
            <td><span className="capacity-recommendation">{row.recommendation}</span><button className="capacity-open-leads" type="button" onClick={()=>openStation(row.stationCode)}>Open station leads →</button></td>
          </tr>;
        })}
        {!loading&&!stations.length?<tr><td colSpan={9}><div className="capacity-demand-empty"><strong>No capacity rows in this scope</strong><span>Check station access and the Capacity Master configuration.</span></div></td></tr>:null}
        {loading?<tr><td colSpan={9}><div className="capacity-demand-empty"><strong>Loading workforce plan…</strong><span>Reconciling capacity, onboarding and delivery activity.</span></div></td></tr>:null}
      </tbody>
    </table></div>:null}
    {!notice&&view!=="stations"?<div className="workforce-associate-grid">{(view==="risk"?risks:associates).map((item:any)=><article key={item.id} className={`workforce-associate-card stage-${item.stage}`}><header><span>{statusLabel(item.stage)}</span><time>{new Date(`${item.dateOfJoin}T00:00:00`).toLocaleDateString("en-IN")}</time></header><h3>{item.fullName}</h3><p>{item.stationCode} · {item.dropxId||item.biometricId||"Operations ID pending"}</p><dl><div><dt>7-day deliveries</dt><dd>{Number(item.deliveries7||0).toLocaleString("en-IN")}</dd></div><div><dt>30-day deliveries</dt><dd>{Number(item.deliveries30||0).toLocaleString("en-IN")}</dd></div><div><dt>Active days</dt><dd>{Number(item.activeDays30||0)}</dd></div><div><dt>Last delivery</dt><dd>{item.lastActivityDate?new Date(`${item.lastActivityDate}T00:00:00`).toLocaleDateString("en-IN"):"Not started"}</dd></div></dl><footer>Initiated by <b>{item.initiatedBy}</b></footer></article>)}{!loading&&!(view==="risk"?risks:associates).length?<div className="capacity-demand-empty"><strong>{view==="risk"?"No associates at risk":"No associates match this view"}</strong><span>{data?.visibility==="team"?"Showing your reporting team.":data?.visibility==="all"?"Showing all permitted initiators.":"Showing associates initiated by you."}</span></div>:null}</div>:null}
    {!loading&&!notice&&data?.unconfiguredStations?<p className="capacity-demand-footnote">{data.unconfiguredStations} permitted station{data.unconfiguredStations===1?" is":"s are"} not included because the Ops Capacity Master is not configured.</p>:null}
  </section>;
}

function ReportPanel({ title, rows = [] }: { title: string; rows?: Array<{label: string; value: number}> }) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  return <article className="content-card report-panel"><h2>{title}</h2><div className="report-bars">
    {rows.slice(0, 12).map((row) => <div className="report-row" key={row.label}>
      <span title={row.label}>{statusLabel(row.label)}</span>
      <i><b style={{width:`${Math.max(2, (row.value / max) * 100)}%`}} /></i>
      <strong>{row.value.toLocaleString("en-IN")}</strong>
    </div>)}
    {!rows.length ? <div className="empty">No report data for this scope.</div> : null}
  </div></article>;
}

type RecruitmentSystemLog = {
  id: string;
  source: string;
  entity: string;
  subject: string;
  action: string;
  change: string;
  actor: string;
  created_at: string;
};

const recruitmentLogDateTime = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });
const humanizeSystemLogValue = (value: string) => value.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

function SystemLogs({ data }: { data: { events?: RecruitmentSystemLog[]; sources?: string[]; actions?: string[] } | null }) {
  const [searchValue, setSearchValue] = useState("");
  const [source, setSource] = useState("");
  const [action, setAction] = useState("");
  const [actor, setActor] = useState("");
  const events = useMemo(() => data?.events ?? [], [data?.events]);
  const sources = useMemo(() => data?.sources ?? [...new Set(events.map((event) => event.source))].sort(), [data?.sources, events]);
  const actions = useMemo(() => data?.actions ?? [...new Set(events.map((event) => event.action))].sort(), [data?.actions, events]);
  const actors = useMemo(() => [...new Set(events.map((event) => event.actor))].sort(), [events]);
  const filtered = useMemo(() => {
    const term = searchValue.trim().toLowerCase();
    return events.filter((event) => (!source || event.source === source)
      && (!action || event.action === action)
      && (!actor || event.actor === actor)
      && (!term || `${event.source} ${event.entity} ${event.subject} ${event.action} ${event.change} ${event.actor}`.toLowerCase().includes(term)));
  }, [action, actor, events, searchValue, source]);
  const visible = filtered.slice(0, 300);
  return <section className="system-logs-view">
    <div className="system-log-kpis">
      <article><span>Recorded changes</span><strong>{events.length}</strong><small>Latest retained history</small></article>
      <article><span>Matching filters</span><strong>{filtered.length}</strong><small>Across all modules</small></article>
      <article><span>Modules</span><strong>{new Set(filtered.map((event) => event.source)).size}</strong><small>Candidate and administration</small></article>
      <article><span>Users</span><strong>{new Set(filtered.map((event) => event.actor)).size}</strong><small>Recorded actors</small></article>
    </div>
    <section className="content-card system-log-card">
      <header><div><h2>Change history</h2><p>Add, update, approval, configuration and delete activity. Navigation and ordinary clicks are not recorded.</p></div><span>{visible.length}{filtered.length > visible.length ? ` of ${filtered.length}` : ""} shown</span></header>
      <div className="system-log-filters">
        <input value={searchValue} onChange={(event) => setSearchValue(event.target.value)} placeholder="Search user, record or change" aria-label="Search system logs" />
        <select value={source} onChange={(event) => setSource(event.target.value)} aria-label="Filter log module"><option value="">All modules</option>{sources.map((item) => <option value={item} key={item}>{item}</option>)}</select>
        <select value={action} onChange={(event) => setAction(event.target.value)} aria-label="Filter log action"><option value="">All actions</option>{actions.map((item) => <option value={item} key={item}>{humanizeSystemLogValue(item)}</option>)}</select>
        <select value={actor} onChange={(event) => setActor(event.target.value)} aria-label="Filter log user"><option value="">All users</option>{actors.map((item) => <option value={item} key={item}>{item}</option>)}</select>
        <button type="button" onClick={() => { setSearchValue(""); setSource(""); setAction(""); setActor(""); }}>Clear</button>
      </div>
      <SimpleTable headers={["Time","Module","Record","Action","Change / reason","User"]} rows={visible.map((item) => [
        recruitmentLogDateTime.format(new Date(item.created_at)),
        item.source,
        item.subject || item.entity,
        humanizeSystemLogValue(item.action),
        item.change,
        item.actor
      ])} />
    </section>
  </section>;
}

function SimpleTable({ headers: labels, rows }: { headers: string[]; rows: Array<Array<string | number>> }) {
  return <><div className="table-scroll simple-table-desktop"><table><thead><tr>{labels.map((label) => <th key={label}>{label}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{row.map((value, cell) => <td key={cell}>{String(value)}</td>)}</tr>)}</tbody></table></div><div className="simple-table-mobile">{rows.map((row,index)=><details key={`${index}-${String(row[0])}`}><summary><span><b>{String(row[0]??"Record")}</b><small>{String(row[1]??"")}</small></span><i>⌄</i></summary><dl>{row.slice(2).map((value,cell)=><span key={cell}><dt>{labels[cell+2]||`Field ${cell+3}`}</dt><dd>{String(value)}</dd></span>)}</dl></details>)}</div>{!rows.length ? <div className="empty">No records available.</div> : null}</>;
}

const connectionDefinitions: Record<string, {
  title: string;
  description: string;
  publicFields: Array<[string, string, string]>;
  secretFields: Array<[string, string]>;
  advancedPublicFields: Array<[string, string, string]>;
  advancedSecretFields: Array<[string, string]>;
}> = {
  meta: {
    title: "Meta Lead Ads",
    description: "Continuously polls Meta lead forms and also accepts signed leadgen webhooks. Ad name is the only routing source of truth.",
    publicFields: [["ad_account_id","Ad Account ID","Enter Ad Account ID"]],
    secretFields: [["access_token","Access token"]],
    advancedPublicFields: [["page_id","Page ID","Optional"],["graph_version","Graph API version","v25.0"]],
    advancedSecretFields: [["page_access_token","Page access token (used for instant forms)"],["app_secret","App secret"],["verify_token","Webhook verify token"]]
  },
  indeed: {
    title: "Indeed Applications",
    description: "Receives signed Indeed Apply submissions through an isolated HR-only route. Candidates see professional job titles; DropX routing codes remain internal.",
    publicFields: [["employer_name","Employer / account name","DropX Logistics"]],
    secretFields: [["api_token","Indeed Apply API token / client ID"],["webhook_secret","Indeed Apply shared signing secret"]],
    advancedPublicFields: [["account_id","Indeed account ID","Optional"],["advertiser_number","Indeed advertiser number","Optional"],["notify_new_candidates","Send candidate WhatsApp after intake","false"]],
    advancedSecretFields: []
  },
  whatsapp: {
    title: "WhatsApp Cloud API",
    description: "Sends OTPs, candidate lifecycle messages, and standard HR interview invitations to both candidate and manager.",
    publicFields: [["phone_number_id","Phone Number ID","Enter Phone Number ID"]],
    secretFields: [["access_token","WhatsApp auth code / access token"]],
    advancedPublicFields: [["waba_id","WhatsApp Business Account ID","Optional"],["graph_version","Graph API version","v25.0"],["otp_template","OTP template","dropx_recruitment_login_otp"],["new_lead_template","New lead template","job_application_number"],["reminder_template","Reminder template","job_application_reminder"],["interview_template","Workforce interview template","job_location_share"],["hr_candidate_interview_template","HR candidate interview template","Approved template name"],["hr_manager_interview_template","HR manager interview template","Approved template name"]],
    advancedSecretFields: [["app_secret","App secret"],["verify_token","Webhook verify token"]]
  },
  google: {
    title: "Google Login, Calendar & HR Documents",
    description: "Controls Google sign-in, Calendar email invitations, automatic Meet links, and branded offer-letter defaults.",
    publicFields: [["client_id","Google OAuth web client ID","…apps.googleusercontent.com"],["calendar_id","Interview calendar ID","primary"]],
    secretFields: [["client_secret","OAuth client secret"],["calendar_refresh_token","Calendar refresh token"]],
    advancedPublicFields: [["allowed_domain","Allowed Workspace domain","dropxlogistics.com"],["calendar_time_zone","Calendar time zone","Asia/Kolkata"],["interview_duration_minutes","Default interview duration (minutes)","45"],["interview_email_subject","Interview email subject","Interview Invitation - {role}"],["interview_email_intro","Interview email introduction","Greetings from DropX Logistics"],["offer_company_name","Offer company name","DropX Logistics"],["offer_signatory_name","Offer signatory name","Authorised Signatory"],["offer_signatory_title","Offer signatory title","Human Resources"],["offer_validity_days","Offer validity (days)","7"],["offer_reference_prefix","Offer reference prefix","DROPX/HRD/OL"],["offer_non_statutory_terms","Non-statutory standard terms","One term per line"],["offer_non_statutory_incentive_terms","Non-statutory incentive clause","Editable incentive eligibility text"],["offer_statutory_terms","Statutory standard terms","One term per line"]],
    advancedSecretFields: []
  },
  mobile: {
    title: "Mobile API",
    description: "Stores the external mobile service credential for Flutter and future provider integrations.",
    publicFields: [],
    secretFields: [["api_token","Mobile API token"]],
    advancedPublicFields: [["api_base_url","API base URL","Optional"],["sender_name","Sender / connection name","DropX Recruitment"]],
    advancedSecretFields: []
  }
};

function ConnectionMaster({ data, token, canEdit, reload }: { data: any; token: string; canEdit:boolean; reload: () => Promise<void> }) {
  const rows = Object.fromEntries((data?.connections ?? []).map((item: any) => [item.provider, item]));
  return <section className="connections-view">
    <section className="content-card connection-intro"><div><h2>Connection Master</h2><p>Direct Meta and Indeed intake, WhatsApp messaging, Google login, and mobile services. Edit access is controlled from User Roles. Secret values are encrypted and never shown again.</p></div>
      <dl><dt>Meta webhook</dt><dd>{data?.endpoints?.metaWebhook || "—"}</dd><dt>Indeed webhook</dt><dd>{data?.endpoints?.indeedWebhook || "—"}</dd><dt>WhatsApp webhook</dt><dd>{data?.endpoints?.whatsappWebhook || "—"}</dd><dt>Authorized web origin</dt><dd>{data?.endpoints?.googleOrigin || "—"}</dd></dl>
    </section>
    <div className="connection-grid">{Object.entries(connectionDefinitions).map(([provider, definition]) =>
      <ConnectionCard key={provider} provider={provider} definition={definition} current={rows[provider]} token={token} canEdit={canEdit} reload={reload} />
    )}</div>
    <IndeedJobMappings token={token} canEdit={canEdit}/>
  </section>;
}

function WhatsAppMessageLog({ token, canReplay, stream, locations }: { token: string; canReplay: boolean; stream:"workforce"|"hr"; locations:any[] }) {
  const initialFrom = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date(Date.now() - 29 * 24 * 60 * 60_000));
  const [filters, setFilters] = useState({ status:"", trigger:"", search:"", locationId:"", from:initialFrom, to:istDate() });
  const [data, setData] = useState<any>({ messages:[], summary:{}, tracking:{}, pagination:{ page:1, total:0, limit:50 } });
  const [busy, setBusy] = useState(true);
  const [replayBusy, setReplayBusy] = useState(false);
  const [notice, setNotice] = useState("");

  async function load(page=1, values=filters, preserveNotice=false) {
    setBusy(true); if (!preserveNotice) setNotice("");
    try {
      const params = new URLSearchParams({ page:String(page), limit:"50" });
      params.set("stream", stream);
      if (values.status) params.set("status", values.status);
      if (values.trigger) params.set("trigger", values.trigger);
      if (values.locationId) params.set("locationId", values.locationId);
      if (values.search.trim()) params.set("search", values.search.trim());
      if (values.from) params.set("from", `${values.from}T00:00:00+05:30`);
      if (values.to) params.set("to", `${values.to}T23:59:59.999+05:30`);
      const response = await fetch(`/api/recruitment/whatsapp-log?${params}`, {
        headers:headers(token), cache:"no-store"
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to load WhatsApp messages.");
      setData(payload);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to load WhatsApp messages.");
    } finally { setBusy(false); }
  }

  useEffect(()=>{void load(1);},[token,stream]); // eslint-disable-line react-hooks/exhaustive-deps

  async function auditAndReplay() {
    if (!canReplay) return;
    setReplayBusy(true); setNotice("");
    try {
      const request = async (action:"preview"|"apply") => {
        const response = await fetch("/api/recruitment/whatsapp-log", {
          method:"POST",
          headers:{...headers(token),"Content-Type":"application/json"},
          body:JSON.stringify({action})
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Unable to audit WhatsApp messages.");
        return payload;
      };
      const preview = await request("preview");
      if (!preview.remaining) {
        const blocked = Number(preview.blockedCandidates||0);
        const reason = preview.blockedReasons?.[0]?.reason;
        setNotice(blocked
          ? `${Number(preview.covered||0).toLocaleString("en-IN")} current candidates are covered. ${blocked.toLocaleString("en-IN")} cannot be sent until candidate or Master data is fixed${reason?`: ${reason}`:"."}`
          : `${Number(preview.covered||0).toLocaleString("en-IN")} current candidates are already covered. Nothing is missing.`);
        return;
      }
      if (!confirm(`Queue ${Number(preview.missing||0).toLocaleString("en-IN")} missing and retry ${Number(preview.retryable||0).toLocaleString("en-IN")} failed WhatsApp messages? ${Number(preview.blockedCandidates||0).toLocaleString("en-IN")} candidates with incomplete data will remain blocked. Only current No Response and upcoming Interview candidates are included.`)) return;
      const totals = { queued:0, retried:0, blocked:0 };
      let remaining = Number(preview.remaining||0);
      let rounds = 0;
      while (remaining > 0 && rounds < 20) {
        const result = await request("apply");
        totals.queued += Number(result.queued||0);
        totals.retried += Number(result.retried||0);
        totals.blocked += Number(result.blocked||0);
        remaining = Number(result.remaining||0);
        rounds++;
        if (!result.queued && !result.retried && remaining > 0) break;
      }
      const blocked = Number(preview.blockedCandidates||0) + totals.blocked;
      const reason = preview.blockedReasons?.[0]?.reason;
      setNotice(`${totals.queued.toLocaleString("en-IN")} missing messages queued · ${totals.retried.toLocaleString("en-IN")} failed messages requeued${blocked?` · ${blocked.toLocaleString("en-IN")} blocked until candidate or Master data is fixed${reason?`: ${reason}`:""}`:""}.`);
      await load(1, filters, true);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to replay WhatsApp messages.");
    } finally { setReplayBusy(false); }
  }

  const summary = data.summary ?? {};
  const messages = data.messages ?? [];
  const trackingReady = data.tracking?.appSecretConfigured && data.tracking?.verifyTokenConfigured;
  const page = Number(data.pagination?.page||1);
  const total = Number(data.pagination?.total||0);
  const limit = Number(data.pagination?.limit||50);
  const timestamp = (item:any) => item.readAt || item.deliveredAt || item.sentAt || item.failedAt || item.updatedAt || item.createdAt;
  const timestampLabel = (item:any) => item.readAt ? "Read" : item.deliveredAt ? "Delivered" : item.sentAt ? "Accepted" : item.failedAt ? "Failed" : "Updated";
  return <section className="content-card whatsapp-log-card">
    <header className="whatsapp-log-head"><div><span>WHATSAPP OPERATIONS</span><h2>Candidate message log</h2><p>Provider lifecycle for every recruitment notification. “Sent” means WhatsApp accepted the request; Delivered and Read come from Meta callbacks.</p></div>{canReplay?<button className="primary-action" disabled={replayBusy} onClick={()=>void auditAndReplay()}>{replayBusy?"Auditing…":"Audit & queue missing"}</button>:null}</header>
    <div className={`whatsapp-tracking-banner ${trackingReady?"ready":"warning"}`}><b>{trackingReady?"Meta delivery tracking is configured":"Delivery/read tracking needs Meta webhook credentials"}</b><span>{trackingReady?"Delivered and Read receipts will update automatically.":"Outbound messages can still be accepted, but App Secret and Verify Token are required to receive trusted delivery/read callbacks."}</span></div>
    <div className="whatsapp-log-summary">
      {["queued","retry","sending","sent","delivered","read","failed","skipped"].map((status)=><button type="button" className={filters.status===status?"selected":""} key={status} onClick={()=>{const next={...filters,status:filters.status===status?"":status};setFilters(next);void load(1,next);}}><span>{statusLabel(status)}</span><strong>{Number(summary[status]||0).toLocaleString("en-IN")}</strong></button>)}
    </div>
    <div className="whatsapp-log-filters">
      <input aria-label="Search WhatsApp messages" placeholder="Phone ending or template…" value={filters.search} onChange={(event)=>setFilters({...filters,search:event.target.value})} onKeyDown={(event)=>{if(event.key==="Enter")void load(1);}}/>
      <select aria-label="Filter message event" value={filters.trigger} onChange={(event)=>setFilters({...filters,trigger:event.target.value})}><option value="">All message events</option><option value="new_lead">Application received</option><option value="no_response">No response</option><option value="interview">Interview scheduled</option></select>
      <select aria-label="Filter message station" value={filters.locationId} onChange={(event)=>setFilters({...filters,locationId:event.target.value})}><option value="">All permitted stations</option>{locations.map((item:any)=><option value={item.id} key={item.id}>{item.code} — {item.name}</option>)}</select>
      <label>From<input type="date" value={filters.from} onChange={(event)=>setFilters({...filters,from:event.target.value})}/></label>
      <label>To<input type="date" value={filters.to} onChange={(event)=>setFilters({...filters,to:event.target.value})}/></label>
      <button disabled={busy} onClick={()=>void load(1)}>{busy?"Loading…":"Apply"}</button>
      <button disabled={busy} onClick={()=>{const next={status:"",trigger:"",search:"",locationId:"",from:initialFrom,to:istDate()};setFilters(next);void load(1,next);}}>Reset</button>
    </div>
    {notice?<p className="connection-notice">{notice}</p>:null}
    <div className="table-scroll whatsapp-log-table"><table><thead><tr><th>Candidate</th><th>Message</th><th>Provider state</th><th>Attempts</th><th>Latest provider time</th><th>Reference / error</th></tr></thead><tbody>{messages.map((item:any)=><tr key={item.id}><td><b>{item.candidate}</b><small>{item.phone} · {item.station} / {item.role}</small></td><td><b>{statusLabel(item.trigger||item.templateName)}</b><small>{item.templateName}</small></td><td><span className={`whatsapp-state whatsapp-state-${item.status}`}>{statusLabel(item.status)}</span><small>Candidate: {statusLabel(item.candidateStatus)}</small></td><td>{Number(item.attemptCount||0).toLocaleString("en-IN")}</td><td><b>{timestampLabel(item)}</b><small>{timestamp(item)?new Date(timestamp(item)).toLocaleString("en-IN") : "—"}</small></td><td><b>{item.providerReference}</b><small className={item.lastError?"log-error":""}>{item.lastError||"No provider error"}</small></td></tr>)}</tbody></table></div>
    <div className="whatsapp-log-mobile">{messages.map((item:any)=><details key={item.id}><summary><span><b>{item.candidate}</b><small>{statusLabel(item.trigger||item.templateName)} · {item.phone}</small></span><i className={`whatsapp-state whatsapp-state-${item.status}`}>{statusLabel(item.status)}</i></summary><dl><span><dt>Template</dt><dd>{item.templateName}</dd></span><span><dt>Station / role</dt><dd>{item.station} / {item.role}</dd></span><span><dt>Attempts</dt><dd>{item.attemptCount}</dd></span><span><dt>{timestampLabel(item)}</dt><dd>{timestamp(item)?new Date(timestamp(item)).toLocaleString("en-IN"):"—"}</dd></span><span><dt>Provider reference</dt><dd>{item.providerReference}</dd></span>{item.lastError?<span><dt>Error</dt><dd>{item.lastError}</dd></span>:null}</dl></details>)}</div>
    {!busy&&!messages.length?<div className="empty">No WhatsApp messages match these filters.</div>:null}
    <footer className="whatsapp-log-pager"><span>{total.toLocaleString("en-IN")} messages · Page {page} of {Math.max(1,Math.ceil(total/limit))}</span><div><button disabled={busy||page<=1} onClick={()=>void load(page-1)}>Previous</button><button disabled={busy||page*limit>=total} onClick={()=>void load(page+1)}>Next</button></div></footer>
  </section>;
}

function IndeedJobMappings({ token, canEdit }: { token: string; canEdit: boolean }) {
  const [data,setData]=useState<any>({mappings:[],locations:[],roles:[]});
  const [selectedId,setSelectedId]=useState("");
  const [form,setForm]=useState<any>({indeedJobId:"",indeedPublishedId:"",publicTitle:"",internalCode:"",locationId:"",roleId:"",isActive:true});
  const [busy,setBusy]=useState(true);
  const [notice,setNotice]=useState("");
  async function load(preferredId=selectedId) {
    setBusy(true);
    try {
      const response=await fetch("/api/recruitment/indeed-jobs",{headers:headers(token)});
      const payload=await response.json();
      if(!response.ok)throw new Error(payload.error||"Unable to load Indeed mappings.");
      setData(payload);
      const selected=(payload.mappings??[]).find((item:any)=>item.id===preferredId)??payload.mappings?.[0];
      if(selected){setSelectedId(selected.id);setForm({...selected});}
    } catch(error){setNotice(error instanceof Error?error.message:"Unable to load Indeed mappings.");}
    finally{setBusy(false);}
  }
  useEffect(()=>{void load("");},[token]);
  function selectMapping(id:string){
    setSelectedId(id);
    const selected=data.mappings.find((item:any)=>item.id===id);
    if(selected)setForm({...selected});
  }
  function addMapping(){
    setSelectedId("");setNotice("");
    setForm({indeedJobId:"",indeedPublishedId:"",publicTitle:"",internalCode:"",locationId:"",roleId:"",isActive:true});
  }
  async function save(){
    if(!canEdit)return;
    setBusy(true);setNotice("");
    try{
      const response=await fetch("/api/recruitment/indeed-jobs",{method:"PUT",headers:{...headers(token),"Content-Type":"application/json"},body:JSON.stringify(form)});
      const payload=await response.json();
      if(!response.ok)throw new Error(payload.error||"Unable to save Indeed mapping.");
      setNotice("Indeed HR routing saved. Public titles remain candidate-facing; internal codes are used only inside DropX.");
      await load(payload.id);
    }catch(error){setNotice(error instanceof Error?error.message:"Unable to save Indeed mapping.");setBusy(false);}
  }
  const role=data.roles.find((item:any)=>item.id===form.roleId);
  return <section className="content-card indeed-mapping-master">
    <div className="access-section-head"><div><h2>Indeed job routing</h2><p>Only HR positions are available here. Match each stable Indeed job ID to a DropX location and HR designation without exposing routing codes to candidates.</p></div>{canEdit?<button type="button" onClick={addMapping}>Add mapping</button>:null}</div>
    {!canEdit?<p className="read-only-master-note">View access — Indeed job routing changes are disabled.</p>:null}
    <div className="indeed-mapping-layout">
      <div className="indeed-mapping-list">{(data.mappings??[]).map((item:any)=><button type="button" className={item.id===selectedId?"selected":""} key={item.id} onClick={()=>selectMapping(item.id)}><b>{item.publicTitle}</b><span>{item.location?.code||"—"} · {item.role?.code||"—"}</span><small>{item.internalCode} · {item.isActive?"Active":"Inactive"}{item.lastApplicationAt?` · Last application ${new Date(item.lastApplicationAt).toLocaleString("en-IN")}`:""}</small></button>)}{!busy&&!data.mappings?.length?<p>No Indeed jobs are mapped yet.</p>:null}</div>
      <fieldset disabled={!canEdit||busy} className="indeed-mapping-form">
        <div className="form-grid">
          <label className="wide">Candidate-facing job title<input value={form.publicTitle||""} onChange={(event)=>setForm({...form,publicTitle:event.target.value})} placeholder="Example: Cluster Manager – Last Mile Delivery"/><small>Shown publicly on Indeed. Do not enter the routing code here.</small></label>
          <label>Internal routing code<input value={form.internalCode||""} onChange={(event)=>setForm({...form,internalCode:event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g,"")})} placeholder="AP_CLM"/><small>Hidden from candidates; must end in {role?.code||"the selected HR code"}.</small></label>
          <SearchSelect label="Business location" value={form.locationId||""} options={(data.locations??[]).map((item:any)=>[item.id,`${item.code} — ${item.name}${item.region?` · ${item.region}`:""}`])} onChange={(locationId)=>setForm({...form,locationId})}/>
          <SearchSelect label="HR position / designation" value={form.roleId||""} options={(data.roles??[]).map((item:any)=>[item.id,`${item.code} — ${item.name}`])} onChange={(roleId)=>setForm({...form,roleId})}/>
          <label className="wide">Stable Indeed employer job ID<input value={form.indeedJobId||""} onChange={(event)=>setForm({...form,indeedJobId:event.target.value})} placeholder="Indeed EmployerJob ID"/><small>Required for signed application matching; the public title is never used as a routing key.</small></label>
          <label>Published Indeed ID<input value={form.indeedPublishedId||""} onChange={(event)=>setForm({...form,indeedPublishedId:event.target.value})} placeholder="Optional public ID"/></label>
          <label className="check-field"><input type="checkbox" checked={form.isActive!==false} onChange={(event)=>setForm({...form,isActive:event.target.checked})}/>Accept applications for this mapping</label>
        </div>
        {notice?<p className="connection-notice">{notice}</p>:null}
        {canEdit?<div className="form-actions"><button className="primary-action" disabled={busy||!form.publicTitle?.trim()||!form.internalCode?.trim()||!form.indeedJobId?.trim()||!form.locationId||!form.roleId} onClick={()=>void save()}>{busy?"Saving…":"Save Indeed routing"}</button></div>:null}
      </fieldset>
    </div>
  </section>;
}

function SystemHealth({ data, token, canRepair, reload }: { data: any; token: string; canRepair:boolean; reload: () => Promise<void> }) {
  const leads = data?.leads ?? {};
  const whatsapp = data?.whatsapp ?? {};
  const latestLeadAt = data?.latest?.lead?.lead_created_at;
  const latestSourceAt = data?.latest?.sourceEvent?.received_at;
  const recentMeta=data?.recentMeta??{};
  const indeed=data?.indeed??{};
  const intakeActivity=data?.intakeActivity??{};
  const notificationActivity=data?.notificationActivity??{};
  const latestMetaRun=data?.latest?.metaRun??null;
  const hourly=intakeActivity.hourly??[];
  const maxHourly=Math.max(1,...hourly.map((item:any)=>Number(item.count||0)));
  const [repair, setRepair] = useState<any>(null);
  const [repairBusy, setRepairBusy] = useState(false);
  const [repairNotice, setRepairNotice] = useState("");
  const [sourceSync, setSourceSync] = useState<any>(null);
  const [sourceSyncBusy, setSourceSyncBusy] = useState(false);
  const [sourceSyncNotice, setSourceSyncNotice] = useState("");
  const [identityAudit, setIdentityAudit] = useState<any>(null);
  const [identityAuditBusy, setIdentityAuditBusy] = useState(false);
  async function auditLeadIdentity() {
    setIdentityAuditBusy(true);
    try {
      const response = await fetch("/api/recruitment/system-health?audit=lead_identity", { headers: headers(token) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to audit lead identities.");
      setIdentityAudit(payload.audit);
    } catch (error) {
      setSourceSyncNotice(error instanceof Error ? error.message : "Unable to audit lead identities.");
    } finally {
      setIdentityAuditBusy(false);
    }
  }
  async function refreshLegacyLeads() {
    setSourceSyncBusy(true);
    setSourceSyncNotice("Reading the legacy dashboard…");
    let startRow = 2;
    const totals = { scanned: 0, inserted: 0, updated: 0, unchanged: 0, duplicates: 0, rejected: 0, errors: 0 };
    try {
      for (;;) {
        const response = await fetch("/api/recruitment/system-health", {
          method: "POST",
          headers: { ...headers(token), "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "full_refresh", startRow, batchSize: 400 })
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Unable to refresh legacy leads.");
        for (const key of Object.keys(totals) as Array<keyof typeof totals>) totals[key] += Number(payload[key] || 0);
        setSourceSync({ ...totals, sourceRows: payload.sourceRows, nextRow: payload.nextRow, done: payload.done });
        setSourceSyncNotice(payload.done
          ? "Legacy lead refresh completed. Newer work in this portal was preserved."
          : `Reconciled ${Math.min(Number(payload.nextRow || 2) - 2, Number(payload.sourceRows || 0)).toLocaleString("en-IN")} of ${Number(payload.sourceRows || 0).toLocaleString("en-IN")} rows…`);
        if (payload.done) break;
        startRow = Number(payload.nextRow || 0);
        if (!startRow) throw new Error("The source refresh did not return a continuation row.");
      }
      await reload();
    } catch (error) {
      setSourceSyncNotice(error instanceof Error ? error.message : "Unable to refresh legacy leads.");
    } finally {
      setSourceSyncBusy(false);
    }
  }
  async function reconcileArchive(action: "preview" | "apply") {
    setRepairBusy(true);
    setRepairNotice("");
    try {
      const response = await fetch("/api/recruitment/archive-repair", {
        method: "POST",
        headers: { ...headers(token), "Content-Type": "application/json" },
        body: JSON.stringify({ action })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to reconcile archived leads.");
      setRepair(payload);
      setRepairNotice(action === "preview"
        ? `${Number(payload.eligibleCount || 0).toLocaleString("en-IN")} open or premature records are safe to restore.`
        : `${Number(payload.applied || 0).toLocaleString("en-IN")} leads restored without changing their status or sending notifications.`);
      if (action === "apply") await reload();
    } catch (error) {
      setRepairNotice(error instanceof Error ? error.message : "Unable to reconcile archived leads.");
    } finally {
      setRepairBusy(false);
    }
  }
  return <section className="dashboard-panels">
    <article className="content-card wide"><h2>Production cutover health</h2>
      <div className="health-grid">
        <div><strong>{Number(leads.active || 0).toLocaleString("en-IN")}</strong><span>Active lead records</span></div>
        <div><strong>{Number(leads.archived || 0).toLocaleString("en-IN")}</strong><span>Archived leads</span></div>
        <div><strong>{Number(leads.sourceEvents || 0).toLocaleString("en-IN")}</strong><span>Source occurrences</span></div>
        <div><strong>{Number(leads.unmapped || 0).toLocaleString("en-IN")}</strong><span>Needs mapping</span></div>
      </div>
      <p>Direct Meta intake remains active. Legacy leads can be reconciled safely without sending historical notifications or overwriting newer portal work.</p>
    </article>
    {canRepair?<article className="content-card wide archive-repair-card">
      <div className="archive-repair-head"><div><h2>Legacy status refresh</h2><p>Matches candidates by Meta ID or phone, imports genuinely missing leads, and reconciles newer statuses, remarks, callbacks and final outcomes. Current portal updates win when they are newer.</p></div><span>Silent sync</span></div>
      <div className="archive-repair-actions">
        <button className="primary-action" disabled={sourceSyncBusy} onClick={()=>void refreshLegacyLeads()}>{sourceSyncBusy ? "Refreshing…" : "Refresh legacy statuses"}</button>
      </div>
      {sourceSyncNotice ? <p className="connection-notice">{sourceSyncNotice}</p> : null}
      {sourceSync ? <div className="health-grid archive-repair-summary">
        <div><strong>{Number(sourceSync.scanned || 0).toLocaleString("en-IN")}</strong><span>Rows checked</span></div>
        <div><strong>{Number(sourceSync.inserted || 0).toLocaleString("en-IN")}</strong><span>New leads added</span></div>
        <div><strong>{Number(sourceSync.updated || 0).toLocaleString("en-IN")}</strong><span>Statuses updated</span></div>
        <div><strong>{Number(sourceSync.unchanged || 0).toLocaleString("en-IN")}</strong><span>Already current</span></div>
      </div> : null}
      <div className="archive-repair-actions">
        <button disabled={identityAuditBusy} onClick={()=>void auditLeadIdentity()}>{identityAuditBusy ? "Auditing…" : "Audit duplicate identities"}</button>
      </div>
      {identityAudit ? <div className="health-grid archive-repair-summary identity-audit-summary">
        <div><strong>{Number(identityAudit.totalRows || 0).toLocaleString("en-IN")}</strong><span>Total lead records</span></div>
        <div><strong>{Number(identityAudit.estimatedUniqueCandidates || 0).toLocaleString("en-IN")}</strong><span>Estimated unique candidates</span></div>
        <div><strong>{Number(identityAudit.phone?.excessRows || 0).toLocaleString("en-IN")}</strong><span>Extra rows sharing a phone</span></div>
        <div><strong>{Number(identityAudit.metaLeadId?.excessRows || 0).toLocaleString("en-IN")}</strong><span>Extra rows sharing Meta ID</span></div>
        <div><strong>{Number(identityAudit.crossSourcePhones || 0).toLocaleString("en-IN")}</strong><span>Phones repeated across sources</span></div>
        <div><strong>{Number(identityAudit.sourceCounts?.google_sheet_bridge || 0).toLocaleString("en-IN")}</strong><span>Legacy bridge records</span></div>
        <div><strong>{(Number(identityAudit.totalRows || 0) - Number(identityAudit.sourceCounts?.google_sheet_bridge || 0)).toLocaleString("en-IN")}</strong><span>Pre-existing/direct records</span></div>
      </div> : null}
    </article>:null}
    <article className="content-card"><h2>Continuous intake</h2><dl>
      <dt>Meta · last 15 min</dt><dd>{Number(recentMeta.uniqueLeads||0).toLocaleString("en-IN")} leads</dd>
      <dt>Indeed mappings</dt><dd>{Number(indeed.activeMappings||0).toLocaleString("en-IN")} active HR jobs</dd>
      <dt>Indeed applications</dt><dd>{Number(indeed.applications||0).toLocaleString("en-IN")}</dd>
      <dt>Latest Indeed intake</dt><dd>{indeed.latestApplication?.received_at?new Date(indeed.latestApplication.received_at).toLocaleString("en-IN"):"No application received"}</dd>
      <dt>Locations</dt><dd>{(recentMeta.locations??[]).map((item:any)=>`${item.code} (${item.count})`).join(", ")||"No new locations"}</dd>
      <dt>Latest lead</dt><dd>{latestLeadAt ? new Date(latestLeadAt).toLocaleString("en-IN") : "No timestamp"}</dd>
      <dt>Latest source event</dt><dd>{latestSourceAt ? new Date(latestSourceAt).toLocaleString("en-IN") : "No event"}</dd>
      <dt>Source</dt><dd>{sourceChannel(data?.latest?.sourceEvent?.source_system || data?.latest?.lead?.source)}</dd>
      <dt>Processing</dt><dd>{data?.latest?.sourceEvent?.status || "—"}</dd>
    </dl></article>
    <article className="content-card"><h2>WhatsApp send safety</h2><dl>
      <dt>Queued</dt><dd>{Number(whatsapp.queued || 0).toLocaleString("en-IN")}</dd>
      <dt>Retry</dt><dd>{Number(whatsapp.retry || 0).toLocaleString("en-IN")}</dd>
      <dt>Sent</dt><dd>{Number(whatsapp.sent || 0).toLocaleString("en-IN")}</dd>
      <dt>Delivered</dt><dd>{Number(whatsapp.delivered || 0).toLocaleString("en-IN")}</dd>
      <dt>Failed</dt><dd>{Number(whatsapp.failed || 0).toLocaleString("en-IN")}</dd>
      <dt>Enablement gate</dt><dd>{whatsapp.safeToEnable ? "Safe — no pending backlog" : "Blocked — review pending backlog"}</dd>
    </dl></article>
    <article className="content-card wide intake-health-card">
      <div className="archive-repair-head"><div><h2>Meta lead intake activity</h2><p>Direct webhook and poller events grouped by hour, ad and station.</p></div><span className={recentMeta.latestReceivedAt?"intake-live":"intake-waiting"}>{recentMeta.latestReceivedAt?`${Number(recentMeta.uniqueLeads||0)} in 15 min`:"No recent event"}</span></div>
      <div className="health-grid intake-kpis"><div><strong>{Number(recentMeta.uniqueLeads||0).toLocaleString("en-IN")}</strong><span>Unique leads · 15 min</span></div><div><strong>{Number(intakeActivity.uniqueLeads||0).toLocaleString("en-IN")}</strong><span>Unique leads · 24 hours</span></div><div><strong>{Number(intakeActivity.events||0).toLocaleString("en-IN")}</strong><span>Meta source events · 24 hours</span></div></div>
      {latestMetaRun?<div className={`meta-run-status meta-run-${latestMetaRun.status}`}><b>Latest poll: {String(latestMetaRun.status||"unknown").replaceAll("_"," ")}</b><span>{latestMetaRun.completed_at?new Date(latestMetaRun.completed_at).toLocaleString("en-IN"):"Running"} · {Number(latestMetaRun.scanned_count||0)} checked · {Number(latestMetaRun.inserted_count||0)} added</span>{latestMetaRun.error?<small>{latestMetaRun.error}</small>:null}</div>:<div className="meta-run-status meta-run-waiting"><b>Poll diagnostics will appear after the next scheduled run.</b></div>}
      <div className="intake-hourly" aria-label="Hourly Meta lead intake">{hourly.map((item:any)=><article key={item.hour} title={`${new Date(item.hour).toLocaleString("en-IN")} · ${item.count} leads`}><b>{item.count}</b><i><span style={{height:`${Math.max(4,Number(item.count||0)/maxHourly*100)}%`}}/></i><small>{new Date(item.hour).toLocaleTimeString("en-IN",{hour:"2-digit"})}</small></article>)}{!hourly.length?<p>No Meta source events were recorded in the last 24 hours.</p>:null}</div>
      <div className="intake-breakdowns"><section><h3>By ad</h3><div className="table-scroll"><table><thead><tr><th>Ad</th><th>Leads</th><th>Latest</th></tr></thead><tbody>{(intakeActivity.ads??[]).map((item:any)=><tr key={item.adName}><td><b>{item.adName}</b></td><td>{item.count}</td><td>{item.lastReceivedAt?new Date(item.lastReceivedAt).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"}):"—"}</td></tr>)}</tbody></table></div></section><section><h3>By station</h3><div className="intake-station-list">{(intakeActivity.stations??[]).map((item:any)=><span key={item.station}><b>{item.station}</b><strong>{item.count}</strong></span>)}{!intakeActivity.stations?.length?<p>No routed stations in this window.</p>:null}</div></section></div>
    </article>
    <article className="content-card wide notification-health-card">
      <div className="archive-repair-head"><div><h2>New-candidate WhatsApp coverage</h2><p>Fresh Meta candidates are checked against the configured welcome-message templates.</p></div><span className={Number(notificationActivity.expectedFreshLeads||0)===0?"intake-waiting":Number(notificationActivity.missingLeads||0)===0?"intake-live":"intake-warning"}>{Number(notificationActivity.expectedFreshLeads||0)===0?"No new candidates to verify":Number(notificationActivity.missingLeads||0)===0?"Coverage complete":`${notificationActivity.missingLeads} missing`}</span></div>
      <div className="health-grid"><div><strong>{Number(notificationActivity.expectedFreshLeads||0).toLocaleString("en-IN")}</strong><span>Fresh Meta candidates · 24 hours</span></div><div><strong>{Number(notificationActivity.coveredLeads||0).toLocaleString("en-IN")}</strong><span>Message records created</span></div><div><strong>{Number(notificationActivity.blockedLeads||0).toLocaleString("en-IN")}</strong><span>Blocked by missing Master data</span></div><div><strong>{Number(notificationActivity.statuses?.delivered||0).toLocaleString("en-IN")}</strong><span>Delivered</span></div><div><strong>{Number(notificationActivity.statuses?.sent||0).toLocaleString("en-IN")}</strong><span>Sent · awaiting receipt</span></div><div><strong>{Number(notificationActivity.statuses?.failed||0).toLocaleString("en-IN")}</strong><span>Failed</span></div></div>
      {notificationActivity.latestFailures?.length?<details className="notification-failures"><summary>View recent failures</summary>{notificationActivity.latestFailures.map((item:any,index:number)=><p key={`${item.failedAt}-${index}`}><b>{item.templateName||"Template"}</b><span>{item.failedAt?new Date(item.failedAt).toLocaleString("en-IN"):"—"}</span><small>{item.lastError||"Provider rejected the message."}</small></p>)}</details>:null}
    </article>
    <article className="content-card wide"><h2>Connections</h2>
      <SimpleTable headers={["Connection","Runtime","Test","Last success"]} rows={(data?.connections ?? []).map((item:any) => [
        String(item.provider || "").toUpperCase(),
        item.enabled ? "Enabled" : "Disabled",
        String(item.status || "not tested").replaceAll("_"," "),
        item.lastSuccessAt ? new Date(item.lastSuccessAt).toLocaleString("en-IN") : "—"
      ])} />
    </article>
    {canRepair?<article className="content-card wide archive-repair-card">
      <div className="archive-repair-head"><div><h2>Archived lead reconciliation</h2><p>Owner-only correction for open leads and premature No Response archives. Legitimate terminal archives remain untouched; status, assignment, remarks, and timestamps are preserved.</p></div><span>Audited repair</span></div>
      <div className="archive-repair-actions">
        <button disabled={repairBusy} onClick={()=>void reconcileArchive("preview")}>{repairBusy ? "Working…" : "Preview safe restore"}</button>
        <button className="primary-action" disabled={repairBusy || repair?.mode !== "preview" || !repair?.eligibleCount} onClick={()=>void reconcileArchive("apply")}>Restore eligible leads</button>
      </div>
      {repairNotice ? <p className="connection-notice">{repairNotice}</p> : null}
      {repair ? <div className="health-grid archive-repair-summary">
        <div><strong>{Number(repair.mode === "applied" ? repair.applied : repair.eligibleCount || 0).toLocaleString("en-IN")}</strong><span>{repair.mode === "applied" ? "Restored" : "Eligible to restore"}</span></div>
        <div><strong>{Number(repair.mode === "applied" ? repair.after?.totalArchived : repair.preservedCount || 0).toLocaleString("en-IN")}</strong><span>Legitimate archives preserved</span></div>
        <div><strong>{Number(repair.mode === "applied" ? repair.after?.eligibleCount : repair.byReason?.premature_no_response_archive || 0).toLocaleString("en-IN")}</strong><span>{repair.mode === "applied" ? "Eligible remaining" : "Premature No Response"}</span></div>
      </div> : null}
    </article>:null}
  </section>;
}

function StationDirectory({data}:{data:any}) {
  const locations=data?.locations??[];
  return <section className="connections-view"><section className="content-card connection-intro"><div><h2>People station directory</h2><p>Station names come from the Location Master. Operational ownership comes only from active People profiles: Cluster Manager first, then Area Ops Manager when no Cluster Manager is mapped.</p></div><dl><dt>Owner source</dt><dd>People profile station scope</dd><dt>Editable here</dt><dd>Station Contacts only</dd></dl></section><section className="content-card leads-card"><SimpleTable headers={["Code","Station","Operational owner","Region","State","Mapped manager","Source"]} rows={locations.map((item:any)=>[item.code,item.name,item.cluster||"Not mapped in People",item.region||"—",item.state||"—",item.manager?.name||item.manager?.email||"Not mapped",item.source==="main_dashboard"?"People + Location Master":"Recruitment fallback"])}/></section></section>;
}

type RecruitmentPermissionWorkspace = "workforce" | "hr";

function UserRoleMaster({data,token,stream,canEdit,reload}:{data:any;token:string;stream:RecruitmentPermissionWorkspace;canEdit:boolean;reload:()=>Promise<void>}) {
  const roles=data?.mainUserRoles??[];
  const designationRows=data?.designationAccess??[];
  const menus=data?.menuCatalog??[];
  const [roleId,setRoleId]=useState("");
  const [menuActions,setMenuActions]=useState<Record<RecruitmentPermissionWorkspace,Record<string,RecruitmentMenuActionGrant>>>({workforce:{},hr:{}});
  const [mobileMenuIds,setMobileMenuIds]=useState<string[]>([]);
  const [search,setSearch]=useState("");
  const [saving,setSaving]=useState(false);
  const [notice,setNotice]=useState("");
  const [page,setPage]=useState(1);
  const [openGroups,setOpenGroups]=useState<string[]>(["Overview","Leads & talent","Onboarding","Performance","Hiring & advertising","Master","Administration"]);
  const selectedRole=roles.find((role:any)=>role.id===roleId);
  const selectedDesignation=designationRows.find((entry:any)=>entry.role?.id===roleId);
  const locationRole=data?.locationAccess?.role??null;
  const selectedLocation=Boolean(locationRole&&locationRole.id===roleId);
  const configured=data?.universalRolePermissions?.[roleId];
  const locked=String(selectedRole?.code||"").toUpperCase()==="OWNER";
  const pageSize=10;
  const pageCount=Math.max(1,Math.ceil(designationRows.length/pageSize));
  const pageDesignations=designationRows.slice((page-1)*pageSize,page*pageSize);
  const locationText=(role:any)=>role?.location_access_mode==="all_locations"?"All locations":role?.location_access_mode==="assigned_locations"?"Assigned locations":String(role?.location_access_mode||"Assigned locations").replaceAll("_"," ");
  useEffect(()=>{
    if(!roleId)return;
    const saved=data?.universalRolePermissions?.[roleId];
    const isOwner=String(roles.find((role:any)=>role.id===roleId)?.code||"").toUpperCase()==="OWNER";
    const fromLevel=(level:RecruitmentMenuAccessLevel):RecruitmentMenuActionGrant=>level==="all"?{view:true,add:true,edit:true}:level==="edit"?{view:true,add:true,edit:true}:level==="view"?{view:true,add:false,edit:false}:{view:false,add:false,edit:false};
    const savedActions=(workspace:RecruitmentPermissionWorkspace)=>Object.fromEntries(menus.filter((item:any)=>item.workspaces.includes(workspace)).flatMap((item:any)=>{
      const stored=saved?.menuActions?.[workspace]?.[item.id];
      const grant=stored?{view:Boolean(stored.view||stored.add||stored.edit),add:Boolean(stored.add),edit:Boolean(stored.edit)}:fromLevel(saved?.menuAccess?.[workspace]?.[item.id]??"none");
      return grant.view||grant.add||grant.edit?[[item.id,grant]]:[];
    }));
    setMenuActions(isOwner?{
      workforce:Object.fromEntries(menus.filter((item:any)=>item.workspaces.includes("workforce")).map((item:any)=>[item.id,{view:true,add:true,edit:true}])),
      hr:Object.fromEntries(menus.filter((item:any)=>item.workspaces.includes("hr")).map((item:any)=>[item.id,{view:true,add:true,edit:true}]))
    }:{workforce:savedActions("workforce"),hr:savedActions("hr")});
    setMobileMenuIds(isOwner
      ? menus.map((item:any)=>item.id)
      : Array.isArray(saved?.mobileMenuIds)
        ? saved.mobileMenuIds.map(String)
        : [...new Set([...Object.keys(savedActions("workforce")),...Object.keys(savedActions("hr"))])]);
    setSearch("");
    setNotice("");
  // menus is derived from the API payload; data changes whenever the access master reloads.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[data,roleId,roles]);
  const activeWorkspaceMenus=menus.filter((item:any)=>item.workspaces.includes(stream));
  const normalizedSearch=search.trim().toLowerCase();
  const visibleMenus=activeWorkspaceMenus.filter((item:any)=>!normalizedSearch||String(item.label).toLowerCase().includes(normalizedSearch)||String(item.group).toLowerCase().includes(normalizedSearch));
  const groups=[...new Set<string>(visibleMenus.map((item:any)=>String(item.group)))];
  const permissionActions:Array<{key:RecruitmentPermissionAction;label:string}>=[{key:"view",label:"View"},{key:"add",label:"Add"},{key:"edit",label:"Edit"}];
  const emptyGrant=():RecruitmentMenuActionGrant=>({view:false,add:false,edit:false});
  function currentGrant(id:string):RecruitmentMenuActionGrant{return menuActions[stream]?.[id]??emptyGrant();}
  function updateAction(ids:string[],action:RecruitmentPermissionAction,checked:boolean){
    setMenuActions((current)=>{
      const workspace={...current[stream]};
      ids.forEach((id)=>{
        const row={...(workspace[id]??emptyGrant())};
        row[action]=action==="view"&&!checked&&(row.add||row.edit)?true:checked;
        if((action==="add"||action==="edit")&&checked)row.view=true;
        if(row.view||row.add||row.edit)workspace[id]=row;else delete workspace[id];
      });
      return {...current,[stream]:workspace};
    });
    if(action==="view"&&!checked)setMobileMenuIds((current)=>current.filter((id)=>!ids.includes(id)));
  }
  function setAllActions(ids:string[],checked:boolean){
    setMenuActions((current)=>{
      const workspace={...current[stream]};
      ids.forEach((id)=>{if(checked)workspace[id]={view:true,add:true,edit:true};else delete workspace[id];});
      return {...current,[stream]:workspace};
    });
    if(!checked)setMobileMenuIds((current)=>current.filter((id)=>!ids.includes(id)));
  }
  function everyAction(ids:string[],action:RecruitmentPermissionAction){return ids.length>0&&ids.every((id)=>currentGrant(id)[action]);}
  function someAction(ids:string[],action:RecruitmentPermissionAction){return ids.some((id)=>currentGrant(id)[action]);}
  function everyPermission(ids:string[]){return ids.length>0&&ids.every((id)=>permissionActions.every((action)=>currentGrant(id)[action.key]));}
  function somePermission(ids:string[]){return ids.some((id)=>permissionActions.some((action)=>currentGrant(id)[action.key]));}
  function everyMobile(ids:string[]){return ids.length>0&&ids.every((id)=>mobileMenuIds.includes(id));}
  function someMobile(ids:string[]){return ids.some((id)=>mobileMenuIds.includes(id));}
  function setMobile(ids:string[],checked:boolean){
    setMobileMenuIds((current)=>checked?[...new Set([...current,...ids])]:current.filter((id)=>!ids.includes(id)));
    if(checked)updateAction(ids,"view",true);
  }
  function permissionCells(ids:string[],keyPrefix:string){
    const full=everyPermission(ids);const partial=!full&&somePermission(ids);
    const mobile=everyMobile(ids);const mixedMobile=!mobile&&someMobile(ids);
    return <><td><input aria-label={`${keyPrefix} all access`} aria-checked={partial?"mixed":full} checked={full} className={partial?"matrix-checkbox partial":"matrix-checkbox"} type="checkbox" onChange={(event)=>setAllActions(ids,event.target.checked)}/></td>{permissionActions.map((action)=>{const checked=everyAction(ids,action.key);const mixed=!checked&&someAction(ids,action.key);return <td key={`${keyPrefix}-${action.key}`}><input aria-label={`${keyPrefix} ${action.label}`} aria-checked={mixed?"mixed":checked} checked={checked} className={mixed?"matrix-checkbox partial":"matrix-checkbox"} disabled={action.key==="view"&&ids.some((id)=>currentGrant(id).add||currentGrant(id).edit)} type="checkbox" onChange={(event)=>updateAction(ids,action.key,event.target.checked)}/></td>;})}<td><input aria-label={`${keyPrefix} Mobile`} aria-checked={mixedMobile?"mixed":mobile} checked={mobile} className={mixedMobile?"matrix-checkbox partial":"matrix-checkbox"} type="checkbox" onChange={(event)=>setMobile(ids,event.target.checked)}/></td></>;
  }
  function toggleGroup(group:string){setOpenGroups((current)=>current.includes(group)?current.filter((item)=>item!==group):[...current,group]);}
  function closeEditor(){setRoleId("");setSearch("");setNotice("");}
  async function save(){
    const safeMenuActions=Object.fromEntries((["workforce","hr"] as RecruitmentPermissionWorkspace[]).map((workspace)=>[workspace,Object.fromEntries(Object.entries(menuActions[workspace]).filter(([id,grant])=>(grant.view||grant.add||grant.edit)&&menus.some((item:any)=>item.id===id&&item.workspaces.includes(workspace))))])) as Record<RecruitmentPermissionWorkspace,Record<string,RecruitmentMenuActionGrant>>;
    const levelFromGrant=(grant:RecruitmentMenuActionGrant):RecruitmentMenuAccessLevel=>grant.view&&grant.add&&grant.edit?"all":grant.add||grant.edit?"edit":grant.view?"view":"none";
    const safeMenuAccess=Object.fromEntries((["workforce","hr"] as RecruitmentPermissionWorkspace[]).map((workspace)=>[workspace,Object.fromEntries(Object.entries(safeMenuActions[workspace]).map(([id,grant])=>[id,levelFromGrant(grant)]).filter(([,level])=>level!=="none"))])) as Record<RecruitmentPermissionWorkspace,Record<string,RecruitmentMenuAccessLevel>>;
    const workspaces=(Object.keys(safeMenuAccess.workforce).length?["workforce"]:[]).concat(Object.keys(safeMenuAccess.hr).length?["hr"]:[]);
    const visibleIds=[...new Set([...Object.keys(safeMenuAccess.workforce),...Object.keys(safeMenuAccess.hr)])];
    const safeMobileMenuIds=mobileMenuIds.filter((id)=>visibleIds.includes(id));
    setSaving(true);setNotice("");
    try{
      const response=await fetch("/api/recruitment/access",{method:"POST",headers:{...headers(token),"Content-Type":"application/json"},body:JSON.stringify({action:"save_universal_role",roleId,workspaces,webMenuIds:visibleIds,mobileMenuIds:safeMobileMenuIds,adRequestActions:[],menuAccess:safeMenuAccess,menuActions:safeMenuActions})});
      const payload=await response.json();
      if(!response.ok)throw new Error(payload.error||"Unable to save role permissions.");
      await reload();
      closeEditor();
    }catch(error){setNotice(error instanceof Error?error.message:"Unable to save role permissions.");}
    finally{setSaving(false);}
  }
  async function prepareDesignationRole(designationId:string){
    setSaving(true);setNotice("");
    try{
      const response=await fetch("/api/recruitment/access",{method:"POST",headers:{...headers(token),"Content-Type":"application/json"},body:JSON.stringify({action:"configure_designation_role",designationId})});
      const payload=await response.json();
      if(!response.ok)throw new Error(payload.error||"Unable to prepare Recruit access.");
      await reload();
      if(payload.roleId)setRoleId(String(payload.roleId));
    }catch(error){setNotice(error instanceof Error?error.message:"Unable to prepare Recruit access.");}
    finally{setSaving(false);}
  }
  async function prepareLocationRole(){
    setSaving(true);setNotice("");
    try{
      const response=await fetch("/api/recruitment/access",{method:"POST",headers:{...headers(token),"Content-Type":"application/json"},body:JSON.stringify({action:"configure_location_role"})});
      const payload=await response.json();
      if(!response.ok)throw new Error(payload.error||"Unable to prepare Location Account access.");
      await reload();
      if(payload.roleId)setRoleId(String(payload.roleId));
    }catch(error){setNotice(error instanceof Error?error.message:"Unable to prepare Location Account access.");}
    finally{setSaving(false);}
  }
  return <section className="connections-view universal-access-view">
    <section className="content-card leads-card role-list-card">
      <div className="access-section-head role-list-toolbar"><div><h2>Recruit designation access</h2><p>Only People designations enabled for Recruit appear here. Recruit controls their Workforce and HR menus.</p></div><a className="universal-role-link" href="https://people.dropxlogistics.com/settings/designations" target="_blank" rel="noreferrer">People Designation Master ↗</a></div>
      {notice?<p className="scope-warning">{notice}</p>:null}
      <div className="access-section-head role-list-toolbar"><div><h2>Location Account</h2><p>Dashboard grants Recruit to station mailboxes. Configure only which Recruit menus those mailboxes can use.</p></div></div>
      <div className="table-scroll"><table><thead><tr><th>Account type</th><th>Portal status</th><th>Location scope</th><th>Permission summary</th><th>Action</th></tr></thead><tbody><tr><td><b>Location Account</b><small>Dashboard-managed station mailbox</small></td><td><span className="universal-state">{locationRole?"Configured":"Setup required"}</span></td><td>Dashboard-managed locations</td><td>{locationRole?(data?.universalRolePermissions?.[locationRole.id]?"Menus configured":"Not configured"):"—"}</td><td>{!canEdit?<span className="locked-role">View only</span>:locationRole?<button className="manage-access-button" onClick={()=>setRoleId(locationRole.id)}>Configure menus</button>:<button className="manage-access-button" disabled={saving} onClick={()=>void prepareLocationRole()}>{saving?"Preparing…":"Set up menus"}</button>}</td></tr></tbody></table></div>
      <div className="access-section-head role-list-toolbar"><div><h2>People designations</h2><p>Only designations enabled for Recruit are listed below.</p></div></div>
      <div className="table-scroll"><table><thead><tr><th>Designation</th><th>Portal status</th><th>Location scope</th><th>{stream==="hr"?"HR":"Workforce"} access</th><th>Permission summary</th><th>Action</th></tr></thead><tbody>{pageDesignations.map((entry:any)=>{
        const role=entry.role;
        const permission=role?data?.universalRolePermissions?.[role.id]:null;
        const isOwner=role&&String(role.code).toUpperCase()==="OWNER";
        const menuCount=menus.filter((item:any)=>item.workspaces.includes(stream)).length;
        const currentCount=permission?Object.keys(permission.menuAccess?.[stream]??{}).length:0;
        const enabled=isOwner||currentCount>0;
        const summary=isOwner?`${menuCount} menus · All access`:permission?`${currentCount} configured menus`:"Not configured";
        return <tr key={entry.designationId}><td><b>{entry.designationName}</b><small>{entry.designationCode}</small></td><td><span className="universal-state">{role?"Configured":"Setup required"}</span></td><td>{role?locationText(role):"—"}</td><td><span className={enabled?"universal-state":"universal-state inactive"}>{enabled?"Enabled":"No access"}</span></td><td>{role?summary:"—"}</td><td>{!canEdit?<span className="locked-role">View only</span>:role?<button className="manage-access-button" onClick={()=>setRoleId(role.id)}>Configure menus</button>:<button className="manage-access-button" disabled={saving} onClick={()=>void prepareDesignationRole(entry.designationId)}>{saving?"Preparing…":"Set up menus"}</button>}</td></tr>;
      })}</tbody></table></div>
      <div className="role-list-pagination"><span>Showing {designationRows.length?((page-1)*pageSize)+1:0}–{Math.min(page*pageSize,designationRows.length)} of {designationRows.length}</span><div><button disabled={page<=1} onClick={()=>setPage((current)=>Math.max(1,current-1))}>Previous</button><span>Page {page} of {pageCount}</span><button disabled={page>=pageCount} onClick={()=>setPage((current)=>Math.min(pageCount,current+1))}>Next</button></div></div>
    </section>
    {roleId&&selectedRole?<div className="modal-backdrop" onMouseDown={(event)=>{if(event.currentTarget===event.target&&!saving)closeEditor();}}>
      <section className="modal role-permission-modal" role="dialog" aria-modal="true" aria-label={`Configure ${selectedDesignation?.designationName||selectedRole.name} menus`}>
        <header className="modal-header"><div><h2>{selectedDesignation?.designationName||selectedRole.name} menu access</h2><p>{selectedLocation?"Dashboard assigns the station mailbox. Configure only Recruit menus and actions below.":"This designation comes from People. Configure only Recruit menus and actions below."}</p></div><button aria-label="Close" disabled={saving} onClick={closeEditor}>×</button></header>
        <div className="role-modal-body">
          <div className="access-inheritance-note"><b>{selectedDesignation?.designationName||selectedRole.name}</b> · {selectedLocation?"Location Account · station scope comes from Dashboard":`${selectedDesignation?.designationCode||"People designation"} · station scope comes from the person’s People profile.`}</div>
          <div className="permission-editor-head"><div><h3>{stream==="hr"?"HR":"Workforce"} menu access</h3><p>Set View, Add and Edit independently, then use Mobile to choose which permitted menus appear in the app. Enabling Mobile automatically includes View.</p></div><input className="master-search" placeholder="Search permissions…" value={search} onChange={(event)=>setSearch(event.target.value)}/></div>
          <div className="role-permission-table"><table><thead><tr><th>{stream==="hr"?"HR":"Workforce"} menu</th><th><label className="matrix-head-check"><span>All</span><input aria-label="All visible menus all access" checked={everyPermission(visibleMenus.map((item:any)=>item.id))} className={!everyPermission(visibleMenus.map((item:any)=>item.id))&&somePermission(visibleMenus.map((item:any)=>item.id))?"matrix-checkbox partial":"matrix-checkbox"} type="checkbox" onChange={(event)=>setAllActions(visibleMenus.map((item:any)=>item.id),event.target.checked)}/></label></th>{permissionActions.map((action)=><th key={action.key}><label className="matrix-head-check"><span>{action.label}</span><input aria-label={`All visible menus ${action.label}`} checked={everyAction(visibleMenus.map((item:any)=>item.id),action.key)} className={!everyAction(visibleMenus.map((item:any)=>item.id),action.key)&&someAction(visibleMenus.map((item:any)=>item.id),action.key)?"matrix-checkbox partial":"matrix-checkbox"} type="checkbox" onChange={(event)=>updateAction(visibleMenus.map((item:any)=>item.id),action.key,event.target.checked)}/></label></th>)}<th><label className="matrix-head-check"><span>Mobile</span><input aria-label="All visible menus Mobile" checked={everyMobile(visibleMenus.map((item:any)=>item.id))} className={!everyMobile(visibleMenus.map((item:any)=>item.id))&&someMobile(visibleMenus.map((item:any)=>item.id))?"matrix-checkbox partial":"matrix-checkbox"} type="checkbox" onChange={(event)=>setMobile(visibleMenus.map((item:any)=>item.id),event.target.checked)}/></label></th></tr></thead><tbody>
            <tr className="permission-all-row"><td><b>All visible menus</b><small>Tick a column to update the current filtered list.</small></td>{permissionCells(visibleMenus.map((item:any)=>item.id),"All visible menus")}</tr>
            {groups.map((group)=>{
              const groupMenus=visibleMenus.filter((item:any)=>item.group===group);
              const ids=groupMenus.map((item:any)=>item.id);
              const open=normalizedSearch||openGroups.includes(group);
              return <Fragment key={group}><tr className="permission-group-row"><td><button type="button" onClick={()=>toggleGroup(group)}><span>{open?"⌄":"›"}</span><b>{group}</b><small>{ids.length} menus</small></button></td>{permissionCells(ids,group)}</tr>{open?groupMenus.map((item:any)=><tr className="permission-menu-row" key={item.id}><td>{item.label}</td>{permissionCells([item.id],item.label)}</tr>):null}</Fragment>;
            })}
          </tbody></table>{visibleMenus.length===0?<p className="empty">No permissions match this search.</p>:null}</div>
          {!configured?<p className="scope-warning">This universal role is still using legacy Recruitment access. Saving will activate this role-specific Web and Mobile matrix without changing its users.</p>:null}
          {notice?<p className="connection-notice">{notice}</p>:null}
        </div>
        <footer className="role-modal-footer"><span>{selectedLocation?"Location identity and station scope are read-only here.":"People designation identity is read-only here."}</span><div><button disabled={saving} onClick={closeEditor}>Cancel</button><button className="primary-action" disabled={saving} onClick={()=>void save()}>{saving?"Saving…":"Save menu access"}</button></div></footer>
      </section>
    </div>:null}
  </section>;
}

function MasterReports({data}:{data:any}) {
  function download(name:string,rows:Record<string,unknown>[]) {
    if(!rows.length)return;
    const columns=Object.keys(rows[0]);
    const csv=[columns.join(","),...rows.map((row)=>columns.map((column)=>`"${String(row[column]??"").replaceAll("\"","\"\"")}"`).join(","))].join("\n");
    const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
    const link=document.createElement("a");link.href=url;link.download=`DropX_Recruitment_${name}_${istDate()}.csv`;link.click();URL.revokeObjectURL(url);
  }
  const summary=data?.retentionSummary??{};
  return <section className="reports-view"><section className="content-card report-builder"><h2>Restricted recruitment master reports</h2><p>Permission-controlled reports for recruiter productivity, joining/retention and the full manual IN/OUT audit trail.</p><div className="master-report-actions"><button className="primary-action" onClick={()=>download("Recruiter_Funnel",data?.recruiterFunnel??[])}>Download recruiter funnel</button><button className="primary-action" onClick={()=>download("Joining_Register",data?.joiningRegister??[])}>Download joining register</button><button className="primary-action" onClick={()=>download("Manual_Punch_Register",data?.manualPunchRegister??[])}>Download manual punch register</button></div></section><div className="metrics report-metrics">{[["Joined records",summary.joined],["30-day due",summary.due30],["Activity found",summary.activityFound],["Manual punches",(data?.manualPunchRegister??[]).length]].map(([label,value])=><article key={label}><span>{label}</span><strong>{Number(value||0).toLocaleString("en-IN")}</strong></article>)}</div><div className="report-panels"><article className="content-card report-panel"><h2>Recruiter funnel</h2><SimpleTable headers={["Employee ID","Recruiter","Calls / updates","No response","Callbacks","Interviews","Selected","Joined"]} rows={(data?.recruiterFunnel??[]).map((item:any)=>[item.employeeId,item.recruiter,item.calls,item.noResponse,item.callbacks,item.interviews,item.selected,item.joined])}/></article><article className="content-card report-panel"><h2>Joined associates and retention</h2><SimpleTable headers={["Candidate","Station","Employee ID","Provider ID","Recruiter","Join date","Days worked","Deliveries","30-day state"]} rows={(data?.joiningRegister??[]).map((item:any)=>[item.candidate,item.station,item.employeeId,item.providerEmployeeId,item.recruiter,item.joiningDate,item.daysWorked,item.deliveries,item.retention30])}/></article><article className="content-card report-panel"><h2>Manual IN / OUT register</h2><SimpleTable headers={["Date","Recruiter","Type","Requested","Location / GPS","Status","Reviewer","Worked min"]} rows={(data?.manualPunchRegister??[]).slice(0,200).map((item:any)=>[item.date,item.recruiter,item.punchType,item.requestedTime,[item.location,item.latitude==null?item.gps:`${Number(item.latitude).toFixed(6)}, ${Number(item.longitude).toFixed(6)} ±${Math.round(Number(item.accuracyMeters||0))}m`].filter(Boolean).join(" • "),item.status,item.reviewer,item.workedMinutes])}/></article></div></section>;
}

function TeamAccess({ data, token, stream, canEdit, reload }: { data: any; token: string; stream:RecruitmentPermissionWorkspace;canEdit:boolean;reload: () => Promise<void> }) {
  const [form, setForm] = useState({
    profileId: "",
    scopeMode: "inherit" as "inherit"|"custom", locationIds: [] as string[], roleIds: [] as string[], isActive: true
  });
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const reset = () => setForm({
    profileId: "",
    scopeMode: "inherit" as "inherit"|"custom", locationIds: [], roleIds: [], isActive: true
  });
  const profiles=data?.registeredProfiles??[];
  const profileById=new Map(profiles.map((item:any)=>[item.id,item]));
  const selectedProfile=profileById.get(form.profileId) as any;
  const accessRows = data?.access ?? [];
  const allowlistForEmail=(email:string)=>(data?.allowlist??[]).find((item:any)=>String(item.email||"").toLowerCase()===String(email||"").toLowerCase());
  const relation=(item:any)=>Array.isArray(item?.profiles)?item.profiles[0]:item?.profiles;
  function editAccess(access:any) {
    const profile=profileById.get(access.profile_id) as any;
    const allow=allowlistForEmail(profile?.email||relation(access)?.email||"");
    setForm({
      profileId: access.profile_id,
      scopeMode: access.scopeMode || (access.can_access_all_locations ? "inherit" : "custom"),
      locationIds: access.locationIds ?? [],
      roleIds: access.roleIds ?? [],
      isActive: access.is_active !== false && allow?.is_active !== false
    });
    setNotice("");
    setEditorOpen(true);
  }
  function selectProfile(profileId:string) {
    const existing=accessRows.find((item:any)=>item.profile_id===profileId);
    if (existing) {
      setForm({
        profileId,
        scopeMode:existing.scopeMode||(existing.can_access_all_locations?"inherit":"custom"),
        locationIds:existing.locationIds??[],
        roleIds:existing.roleIds??[],
        isActive:existing.is_active!==false
      });
    } else {
      setForm({profileId,scopeMode:"inherit",locationIds:[],roleIds:[],isActive:true});
    }
    setNotice("");
  }
  const universalAllLocations=Boolean(selectedProfile?.universalRole?.allLocations||selectedProfile?.is_master_owner);
  const universalLocationCodes=new Set((selectedProfile?.universalLocations??[]).map((item:any)=>item.code));
  const locationOptions=(data?.locations??[]).filter((item:any)=>universalAllLocations||universalLocationCodes.has(item.code));
  const permissionForProfile=(profile:any)=>profile?.is_master_owner
    ? {workspaces:["workforce","hr"]}
    : profile?.universalRole
      ? data?.universalRolePermissions?.[profile.universalRole.id]
        ?? data?.universalRolePermissions?.[String(profile.universalRole.code||"").toUpperCase()]
      : null;
  const profileOptions:Array<[string,string]>=activeCompanyUserOptions(profiles);
  const visibleRoles = (data?.roles ?? []).filter((item:any) => item.stream===stream);
  const roleById=new Map((data?.roles??[]).map((item:any)=>[item.id,item]));
  const visibleRoleIds=new Set(visibleRoles.map((item:any)=>item.id));
  const streamRoleIds=form.roleIds.filter((id)=>visibleRoleIds.has(id));
  const otherStreamRoleIds=form.roleIds.filter((id)=>!visibleRoleIds.has(id));
  async function save() {
    setSaving(true); setNotice("");
    try {
      const response = await fetch("/api/recruitment/access", {
        method: "POST",
        headers: { ...headers(token), "Content-Type": "application/json" },
        body: JSON.stringify({...form,workspace:stream})
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to save user.");
      if (payload.scopeMode && payload.scopeMode !== form.scopeMode) {
        throw new Error("The station scope was not saved. Please retry.");
      }
      await reload();
      reset();
      setEditorOpen(false);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to save user.");
    } finally { setSaving(false); }
  }
  const visibleAccess=accessRows.filter((item:any)=>{
    const profile=profileById.get(item.profile_id) as any;
    const text=[profile?.full_name,profile?.email,profile?.employee_id,profile?.universalRole?.name,allowlistForEmail(profile?.email||"")?.access_template].join(" ").toLowerCase();
    return profile && (!search.trim()||text.includes(search.trim().toLowerCase()));
  });
  const streamAccess=visibleAccess.filter((access:any)=>isRecruitmentUserWorkspaceEnabled(access,stream));
  const universalScope=(profile:any)=>profile?.universalRole?.allLocations
    ? "All locations"
    : (profile?.universalLocations??[]).map((item:any)=>item.code).join(", ")||"No location scope";
  return <section className="connections-view universal-access-view">
    <section className="content-card access-intro"><div><span>ONE DROPX USER</span><h2>Recruitment users</h2><p>Identity, company role and maximum location scope come from the main dashboard. Recruitment only enables the required Workforce or HR access.</p></div><div className="access-source-action"><b>{profiles.length.toLocaleString("en-IN")} active company users</b><a href={data?.universalUsersUrl||"https://dashboard.dropxlogistics.com/users?section=users"} target="_blank" rel="noreferrer">Manage company users ↗</a></div></section>
    <section className="content-card leads-card access-list-card"><div className="access-section-head"><div><h2>{stream==="hr"?"HR":"Workforce"} users</h2><p>Role permissions are configured once in User Roles. Use this page only to activate a user and narrow station or designation scope.</p></div><div className="access-list-actions"><input className="master-search" placeholder="Search user, ID, email or role…" value={search} onChange={(event)=>setSearch(event.target.value)}/>{canEdit?<button className="primary-action" onClick={()=>{reset();setNotice("");setEditorOpen(true);}}>Add user</button>:null}</div></div>
      <div className="table-scroll"><table><thead><tr><th>User</th><th>Company role</th><th>{stream==="hr"?"HR":"Workforce"} access</th><th>Station scope</th><th>Designation scope</th><th>Status</th><th>Action</th></tr></thead><tbody>{streamAccess.map((access:any)=>{
        const profile=profileById.get(access.profile_id) as any;const allow=allowlistForEmail(profile?.email||"");
        const stationScope=access.effectiveAllLocations?"All permitted stations":`${access.scopeMode==="inherit"?"Company scope":"Custom subset"} · ${access.effectiveLocationIds?.length??0} station(s)`;
        const streamDesignationCount=(access.roleIds??[]).filter((id:string)=>(roleById.get(id) as any)?.stream===stream).length;
        const designationScope=streamDesignationCount?`${streamDesignationCount} selected`:`All ${stream==="hr"?"HR":"Workforce"} designations`;
        const rolePermission=profile?.is_master_owner?{workspaces:["workforce","hr"],menuAccess:{workforce:Object.fromEntries((data?.menuCatalog??[]).map((item:any)=>[item.id,"all"])),hr:Object.fromEntries((data?.menuCatalog??[]).map((item:any)=>[item.id,"all"]))}}:profile?.universalRole?(data?.universalRolePermissions?.[profile.universalRole.id]??data?.universalRolePermissions?.[String(profile.universalRole.code||"").toUpperCase()]):null;
        const levels=Object.values(rolePermission?.menuAccess?.[stream]??{}) as string[];
        const accessLevel=levels.includes("all")?"All access":levels.includes("edit")?"Edit":levels.includes("view")?"View":"Role menus needed";
        return <tr key={access.id}><td><b>{profile?.full_name||"Unnamed"}</b><small>{profile?.employee_id||profile?.email||"No employee ID"}</small></td><td>{profile?.universalRole?.name||profile?.role||"—"}</td><td><b>{accessLevel}</b></td><td>{stationScope}</td><td>{designationScope}</td><td><span className={access.is_active&&allow?.is_active!==false?"universal-state":"universal-state inactive"}>{access.is_active&&allow?.is_active!==false?"Active":"Inactive"}</span></td><td>{canEdit?<button className="manage-access-button" onClick={()=>editAccess(access)}>Manage</button>:<span className="locked-role">View only</span>}</td></tr>;
      })}</tbody></table>{!streamAccess.length?<div className="empty">No {stream==="hr"?"HR":"Workforce"} users match this search.</div>:null}</div>
    </section>
    {editorOpen?<div className="modal-backdrop" onMouseDown={(event)=>{if(event.currentTarget===event.target&&!saving){setEditorOpen(false);reset();}}}><section className="modal access-permission-modal" role="dialog" aria-modal="true" aria-label="Recruitment user access">
      <header className="modal-header"><div><h2>{form.profileId?"Manage user access":"Add user access"}</h2><p>Choose the user, permitted scope and status. Menu permissions come from the company role.</p></div><button aria-label="Close" disabled={saving} onClick={()=>{setEditorOpen(false);reset();}}>×</button></header>
      <div className="access-modal-body">
        <section className="access-editor-card">
          <div className="form-grid">
            <SearchSelect label="Universal company user" value={form.profileId} options={profileOptions} onChange={selectProfile}/>
            <label>Company role<select value={selectedProfile?.universalRole?.id||""} disabled><option value="">Select a company user</option>{selectedProfile?.universalRole?<option value={selectedProfile.universalRole.id}>{selectedProfile.universalRole.name}</option>:null}</select></label>
            <SearchSelect label="Station access" value={selectedProfile?.is_master_owner?"inherit":form.scopeMode} options={[["inherit",universalAllLocations?"All permitted stations":`Use company scope — ${(selectedProfile?.universalLocations??[]).length} stations`],["custom","Choose a smaller station subset"]]} onChange={(scopeMode)=>setForm({...form,scopeMode:scopeMode as "inherit"|"custom",locationIds:scopeMode==="inherit"?[]:form.locationIds})} placeholder="Choose station access"/>
            {form.scopeMode==="custom"&&!selectedProfile?.is_master_owner?<div className="searchable-scope"><span>Station subset</span><MultiFilter label="Stations" value={form.locationIds.join(",")} options={locationOptions.map((item:any)=>[item.id,`${item.code} — ${item.name}`])} onChange={(value)=>setForm({...form,locationIds:value.split(",").filter(Boolean)})}/><small>Only stations within the user&apos;s company scope are available.</small></div>:null}
            {selectedProfile?<div className="searchable-scope"><span>Designation access</span><MultiFilter label="Designations" value={streamRoleIds.join(",")} options={visibleRoles.map((item:any)=>[item.id,`${item.code} — ${item.name}`])} onChange={(value)=>setForm({...form,roleIds:[...otherStreamRoleIds,...value.split(",").filter(Boolean)]})}/><small>Leave empty for all {stream==="hr"?"HR":"Workforce"} designations.</small></div>:null}
            <SearchSelect label="Status" value={form.isActive?"active":"inactive"} options={[["active","Active"],["inactive","Inactive"]]} onChange={(value)=>setForm({...form,isActive:value==="active"})}/>
          </div>
          {selectedProfile?<p className="access-inheritance-note">Company role: <b>{selectedProfile.universalRole?.name||selectedProfile.role||"Not assigned"}</b> · Maximum station access: <b>{universalScope(selectedProfile)}</b>. Recruitment can only narrow this scope.</p>:null}
          {selectedProfile&&!selectedProfile.is_master_owner&&Object.keys(permissionForProfile(selectedProfile)?.menuAccess?.[stream]??{}).length===0?<p className="connection-notice">This user can be activated now, but their company role has no {stream==="hr"?"HR":"Workforce"} Recruitment menus yet. Configure that role in User Roles before they begin work.</p>:null}
          {notice?<p className="connection-notice">{notice}</p>:null}
        </section>
      </div>
      <footer className="role-modal-footer"><a href={data?.universalUsersUrl||"https://dashboard.dropxlogistics.com/users?section=users"} target="_blank" rel="noreferrer">Edit universal user ↗</a><div><button disabled={saving} onClick={()=>{setEditorOpen(false);reset();}}>Cancel</button><button className="primary-action" disabled={saving||!form.profileId} onClick={()=>void save()}>{saving?"Saving…":"Save access"}</button></div></footer>
    </section></div>:null}
  </section>;
}

function MasterManager({ kind, stream, data, token, reload, canEdit = true }: {
  kind: "location" | "contact" | "role";
  stream?: "workforce" | "hr";
  data: any;
  token: string;
  reload: () => Promise<void>;
  canEdit?: boolean;
}) {
  const empty = kind === "role"
    ? { selected:"", code:"", name:"", stream:stream ?? "workforce", aliases:"", requiredFields:"", isActive:true }
    : kind === "contact"
      ? { selected:"", locationId:"", address:"", latitude:"", longitude:"", pocName:"", pocMobile:"" }
      : { selected:"", code:"", name:"", state:"", region:"", cluster:"", isActive:true };
  const [form, setForm] = useState<Record<string, any>>(empty);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const locations = data?.locations ?? [];
  const roles = kind === "role"
    ? (data?.roles ?? []).filter((role:any) => role.stream === (stream ?? "workforce"))
    : data?.roles ?? [];
  function choose(value:string) {
    if (!value) { setForm(empty); return; }
    if (kind === "role") {
      const item=roles.find((row:any)=>row.id===value);
      setForm({selected:value,code:item.code,name:item.name,stream:item.stream,aliases:(item.aliases??[]).join(", "),requiredFields:(item.required_fields??[]).join(", "),isActive:item.is_active!==false});
    } else if (kind === "contact") {
      const item=locations.find((row:any)=>row.id===value); const contact=item.contact??item;
      setForm({selected:value,locationId:value,address:contact.address??"",latitude:contact.latitude??"",longitude:contact.longitude??"",pocName:contact.poc_name??"",pocMobile:contact.poc_mobile??""});
    } else {
      const item=locations.find((row:any)=>row.id===value);
      setForm({selected:value,code:item.code,name:item.name,state:item.state??"",region:item.region??"",cluster:item.cluster??"",isActive:item.is_active!==false});
    }
    setNotice("");
  }
  async function save() {
    if (!canEdit) return;
    setSaving(true); setNotice("");
    try {
      const response=await fetch("/api/recruitment/masters",{method:"PUT",headers:{...headers(token),"Content-Type":"application/json"},body:JSON.stringify({resource:kind,...form})});
      const payload=await response.json();
      if(!response.ok) throw new Error(payload.error||"Unable to save master.");
      const remapped = Number(payload.remapped?.leadsRemapped || 0);
      setNotice(remapped ? `Saved successfully. ${remapped} existing lead(s) were safely re-routed from their ad name.` : "Saved successfully.");
      setForm(empty);
      await reload();
    } catch(error) { setNotice(error instanceof Error?error.message:"Unable to save master."); }
    finally { setSaving(false); }
  }
  const title=kind==="location"
    ? "Location / station master"
    : kind==="contact"
      ? "Station contact master"
      : `${stream === "hr" ? "HR" : "Workforce"} designation master`;
  return <section className="connections-view">
    {canEdit?<section className="content-card"><h2>{title}</h2><p>Select a record to update it, or choose “Add new”.</p>
      <div className="form-grid">
        <SearchSelect label={kind==="role"?"Designation":kind==="contact"?"Station":"Location"} value={form.selected||""} options={(kind==="role"?roles:locations).map((item:any)=>[item.id,`${item.code} — ${item.name}`])} onChange={choose} placeholder="Search existing records or leave blank to add new"/>
        {kind==="location"?<><label>Station code<input value={form.code||""} disabled={Boolean(form.selected)} onChange={(event)=>setForm({...form,code:event.target.value})}/></label><label>Station name<input value={form.name||""} onChange={(event)=>setForm({...form,name:event.target.value})}/></label><label>Operational owner<input value={form.cluster||"Not mapped in People"} disabled/><small>Managed in People using the active Cluster Manager or Area Ops Manager profile station scope.</small></label><label>State<input value={form.state||""} onChange={(event)=>setForm({...form,state:event.target.value})}/></label><label>Region<input value={form.region||""} onChange={(event)=>setForm({...form,region:event.target.value})}/></label><label className="check-field"><input type="checkbox" checked={form.isActive!==false} onChange={(event)=>setForm({...form,isActive:event.target.checked})}/>Active</label></>:null}
        {kind==="contact"?<><label className="wide">Address<textarea value={form.address||""} onChange={(event)=>setForm({...form,address:event.target.value})}/></label><label>Latitude<input type="number" step="any" value={form.latitude||""} onChange={(event)=>setForm({...form,latitude:event.target.value})}/></label><label>Longitude<input type="number" step="any" value={form.longitude||""} onChange={(event)=>setForm({...form,longitude:event.target.value})}/></label><label>POC name<input value={form.pocName||""} onChange={(event)=>setForm({...form,pocName:event.target.value})}/></label><label>POC mobile<input inputMode="tel" value={form.pocMobile||""} onChange={(event)=>setForm({...form,pocMobile:event.target.value})}/></label></>:null}
        {kind==="role"?<><label>Code<input value={form.code||""} disabled={Boolean(form.selected)} onChange={(event)=>setForm({...form,code:event.target.value})}/></label><label>Designation name<input value={form.name||""} onChange={(event)=>setForm({...form,name:event.target.value})}/></label><label>Category<select value={form.stream||"workforce"} onChange={(event)=>setForm({...form,stream:event.target.value})}><option value="workforce">Workforce — blue-collar</option><option value="hr">HR — white-collar</option></select></label><label>Routing aliases<input value={form.aliases||""} onChange={(event)=>setForm({...form,aliases:event.target.value})} placeholder="comma separated"/></label><label>Required application fields<input value={form.requiredFields||""} onChange={(event)=>setForm({...form,requiredFields:event.target.value})} placeholder="comma separated"/></label><label className="check-field"><input type="checkbox" checked={form.isActive!==false} onChange={(event)=>setForm({...form,isActive:event.target.checked})}/>Active</label></>:null}
      </div>
      {notice?<p className="connection-notice">{notice}</p>:null}
      <div className="form-actions"><button onClick={()=>setForm(empty)}>Clear</button><button className="primary-action" disabled={saving||(kind==="contact"?!form.locationId:!form.code||!form.name)} onClick={()=>void save()}>{saving?"Saving…":"Save master"}</button></div>
    </section>:<section className="content-card master-readonly-note"><h2>{title}</h2><p>You have View access. Edit or All access is required to change this master.</p></section>}
    <section className="content-card leads-card"><div className="toolbar"><span>{kind==="role"?roles.length:locations.length} records</span></div>
      {kind==="role"
        ? <SimpleTable headers={["Code","Role","Category","Aliases","State"]} rows={roles.map((item:any)=>[item.code,item.name,item.stream,(item.aliases??[]).join(", ")||"—",item.is_active?"Active":"Inactive"])}/>
        : kind==="contact"
          ? <SimpleTable headers={["Station","Address","POC","Mobile","Map"]} rows={locations.map((item:any)=>{const contact=item.contact??item;return[item.code,contact.address||"—",contact.poc_name||"—",contact.poc_mobile||"—",contact.latitude!=null?`${contact.latitude}, ${contact.longitude}`:"—"];})}/>
          : <SimpleTable headers={["Code","Location","Operational owner","State","Region","Status"]} rows={locations.map((item:any)=>[item.code,item.name,item.cluster||"Not mapped in People",item.state||"—",item.region||"—",item.is_active?"Active":"Inactive"])}/>}
    </section>
  </section>;
}

function LeadStatusMaster({data,token,canEdit,reload}:{data:any;token:string;canEdit:boolean;reload:()=>Promise<void>}) {
  const rows=data?.leadStatuses??[];
  const empty={selected:"",code:"",label:"",stream:"workforce",isActive:true,requiresSchedule:false,scheduleType:"",sortOrder:(rows.length+1)*10};
  const [form,setForm]=useState<any>(empty);
  const [saving,setSaving]=useState(false);
  const [notice,setNotice]=useState("");
  useEffect(()=>{if(!form.selected)setForm((current:any)=>({...current,sortOrder:(rows.length+1)*10}));},[rows.length]); // eslint-disable-line react-hooks/exhaustive-deps
  function choose(code:string){
    const item=rows.find((row:any)=>row.code===code);
    setForm(item?{selected:code,...item}:empty);setNotice("");
  }
  async function save(){
    if(!canEdit)return;
    setSaving(true);setNotice("");
    try{
      const response=await fetch("/api/recruitment/masters",{method:"PUT",headers:{...headers(token),"Content-Type":"application/json"},body:JSON.stringify({resource:"status",...form})});
      const payload=await response.json();if(!response.ok)throw new Error(payload.error||"Unable to save status.");
      setNotice("Status saved. Web and mobile dropdowns now use this Master.");setForm(empty);await reload();
    }catch(error){setNotice(error instanceof Error?error.message:"Unable to save status.");}finally{setSaving(false);}
  }
  return <section className="connections-view">
    <section className="content-card">
      <div className="access-section-head"><div><h2>Lead Status Master</h2><p>Controls the workforce status dropdown on web and mobile. Disable a status to remove it without changing historical leads.</p></div></div>
      {!canEdit?<p className="master-readonly-inline">View only · Edit or All access is required to change statuses.</p>:null}
      <fieldset disabled={!canEdit}>
        <div className="form-grid">
          <SearchSelect label="Status" value={form.selected||""} options={rows.map((item:any)=>[item.code,`${item.label} · ${item.code}`])} onChange={choose} placeholder="Select an existing status or add new"/>
          <label>Status code<input value={form.code||""} disabled={Boolean(form.selected)} onChange={(event)=>setForm({...form,code:event.target.value.toLowerCase().replace(/[^a-z0-9_]+/g,"_")})}/></label>
          <label>Display label<input value={form.label||""} onChange={(event)=>setForm({...form,label:event.target.value})}/></label>
          <label>Workspace<select value={form.stream||"workforce"} onChange={(event)=>setForm({...form,stream:event.target.value})}><option value="workforce">Workforce</option><option value="hr">HR</option><option value="both">Both</option></select></label>
          <label>Order<input type="number" min="0" value={form.sortOrder??10} onChange={(event)=>setForm({...form,sortOrder:Number(event.target.value)})}/></label>
          <label className="check-field"><input type="checkbox" checked={form.requiresSchedule===true} onChange={(event)=>setForm({...form,requiresSchedule:event.target.checked,scheduleType:event.target.checked?(form.scheduleType||"callback"):""})}/>Require date &amp; time</label>
          {form.requiresSchedule?<label>Schedule type<select value={form.scheduleType||"callback"} onChange={(event)=>setForm({...form,scheduleType:event.target.value})}><option value="callback">Callback</option><option value="interview">Interview</option></select></label>:null}
          <label className="check-field"><input type="checkbox" checked={form.isActive!==false} onChange={(event)=>setForm({...form,isActive:event.target.checked})}/>Active in dropdown</label>
        </div>
        {notice?<p className="connection-notice">{notice}</p>:null}
        {canEdit?<div className="form-actions"><button onClick={()=>setForm(empty)}>Clear</button><button className="primary-action" disabled={saving||!form.code||!form.label} onClick={()=>void save()}>{saving?"Saving…":"Save status"}</button></div>:null}
      </fieldset>
    </section>
    <section className="content-card leads-card"><SimpleTable headers={["Order","Status","Code","Schedule","Workspace","State"]} rows={rows.map((item:any)=>[item.sortOrder,item.label,item.code,item.requiresSchedule?statusLabel(item.scheduleType):"No",statusLabel(item.stream),item.isActive?"Active":"Inactive"])}/></section>
  </section>;
}

function HrLifecycleMaster({data,token,canEdit,reload}:{data:any;token:string;canEdit:boolean;reload:()=>Promise<void>}) {
  const rules=data?.lifecycleRules??[];
  const [settings,setSettings]=useState<any>(data?.lifecycleSettings??{maxInterviewRounds:2,defaultInterviewMinutes:45,requireOfferApproval:true});
  const blank={code:"",label:"",stageGroup:"pipeline",sortOrder:(rules.length+1)*10,isActive:true,isTerminal:false,requiresRemarks:true,requiresSchedule:false,recruiterCanSet:true,interviewerCanSet:false,firstCallAvailable:false,allowedNextCodes:[] as string[],notificationTrigger:""};
  const [selectedCode,setSelectedCode]=useState<string>(rules[0]?.code??"");
  const selected=rules.find((item:any)=>item.code===selectedCode)??null;
  const [form,setForm]=useState<any>(selected??blank);
  const [notice,setNotice]=useState("");
  const [saving,setSaving]=useState(false);
  useEffect(()=>{const current=rules.find((item:any)=>item.code===selectedCode);if(current)setForm({...current,allowedNextCodes:[...(current.allowedNextCodes??[])]});},[selectedCode,data]);
  useEffect(()=>{setSettings(data?.lifecycleSettings??{maxInterviewRounds:2,defaultInterviewMinutes:45,requireOfferApproval:true});},[data?.lifecycleSettings]);
  function edit(item:any){setSelectedCode(item.code);setForm({...item,allowedNextCodes:[...(item.allowedNextCodes??[])]});setNotice("");}
  function add(){setSelectedCode("");setForm({...blank,sortOrder:(rules.length+1)*10});setNotice("");}
  function toggleNext(code:string){setForm((current:any)=>({...current,allowedNextCodes:(current.allowedNextCodes??[]).includes(code)?current.allowedNextCodes.filter((item:string)=>item!==code):[...(current.allowedNextCodes??[]),code]}));}
  async function save(){
    setSaving(true);setNotice("");
    try{
      const response=await fetch("/api/recruitment/masters",{method:"PUT",headers:{...headers(token),"Content-Type":"application/json"},body:JSON.stringify({resource:"lifecycle",...form})});
      const body=await response.json();if(!response.ok)throw new Error(body.error||"Unable to save lifecycle rule.");
      setNotice(`${form.label} saved. New HR actions now follow this transition rule.`);setSelectedCode(body.item?.code||form.code);await reload();
    }catch(error){setNotice(error instanceof Error?error.message:"Unable to save lifecycle rule.");}finally{setSaving(false);}
  }
  async function saveSettings(){
    setSaving(true);setNotice("");
    try{
      const response=await fetch("/api/recruitment/masters",{method:"PUT",headers:{...headers(token),"Content-Type":"application/json"},body:JSON.stringify({resource:"lifecycle_settings",...settings})});
      const body=await response.json();if(!response.ok)throw new Error(body.error||"Unable to save interview settings.");
      setNotice("Interview rounds, duration and offer approval policy saved for web, mobile and API.");await reload();
    }catch(error){setNotice(error instanceof Error?error.message:"Unable to save interview settings.");}finally{setSaving(false);}
  }
  return <section className="connections-view lifecycle-master-view">
    <section className="content-card connection-intro"><div><h2>HR lifecycle and interview rules</h2><p>One source of truth for every candidate stage, valid next action, required evidence, scheduling and interviewer authority.</p></div><dl><dt>Enforced in</dt><dd>Web, mobile and API</dd><dt>Workflow</dt><dd>Recruiter → assigned interviewer → offer → joining</dd></dl></section>
    <section className="content-card lifecycle-settings-card"><div><h3>Interview and offer policy</h3><p>Company-wide rules; no round count or approval behavior is hardcoded in a user profile.</p></div><fieldset disabled={!canEdit||saving}><label>Interview rounds<input type="number" min="1" max="10" value={settings.maxInterviewRounds??2} onChange={(event)=>setSettings({...settings,maxInterviewRounds:Number(event.target.value)})}/></label><label>Default duration (minutes)<input type="number" min="15" max="240" step="15" value={settings.defaultInterviewMinutes??45} onChange={(event)=>setSettings({...settings,defaultInterviewMinutes:Number(event.target.value)})}/></label><label className="check-field"><input type="checkbox" checked={settings.requireOfferApproval!==false} onChange={(event)=>setSettings({...settings,requireOfferApproval:event.target.checked})}/>Offer approval required before issue</label>{canEdit?<button className="primary-action" type="button" onClick={()=>void saveSettings()}>Save policy</button>:null}</fieldset></section>
    <section className="content-card lifecycle-master-layout">
      <aside className="lifecycle-rule-list"><header><div><h3>Lifecycle stages</h3><p>{rules.length} configured stages</p></div>{canEdit?<button type="button" onClick={add}>Add stage</button>:null}</header>{rules.map((item:any)=><button type="button" className={form.code===item.code?"selected":""} key={item.code} onClick={()=>edit(item)}><span><b>{item.label}</b><small>{item.code} · {String(item.stageGroup).replaceAll("_"," ")}</small></span><em>{item.isTerminal?"Terminal":item.requiresSchedule?"Scheduled":"Active"}</em></button>)}</aside>
      <div className="lifecycle-rule-editor"><header><div><span>WORKFLOW MASTER</span><h3>{form.label||"New lifecycle stage"}</h3><p>Changes apply to future actions only. Existing candidate history is preserved.</p></div></header>{!canEdit?<p className="read-only-master-note">View access — lifecycle changes are disabled.</p>:null}<fieldset disabled={!canEdit||saving}><div className="form-grid"><label>Stage code<input value={form.code||""} readOnly={Boolean(selected)} placeholder="Example: manager_review" onChange={(event)=>setForm({...form,code:event.target.value.toLowerCase().replace(/[^a-z0-9_]+/g,"_")})}/></label><label>Display name<input value={form.label||""} onChange={(event)=>setForm({...form,label:event.target.value})}/></label><label>Stage group<input value={form.stageGroup||"pipeline"} onChange={(event)=>setForm({...form,stageGroup:event.target.value})}/></label><label>Sort order<input type="number" value={form.sortOrder??0} onChange={(event)=>setForm({...form,sortOrder:Number(event.target.value)})}/></label><label>Notification trigger<select value={form.notificationTrigger||""} onChange={(event)=>setForm({...form,notificationTrigger:event.target.value})}><option value="">No automatic message</option><option value="new_lead">New application</option><option value="no_response">No response</option><option value="interview">Interview invitation</option><option value="offer">Offer issued</option><option value="joined">Joining confirmation</option></select></label></div><div className="lifecycle-rule-toggles"><label><input type="checkbox" checked={form.isActive!==false} onChange={(event)=>setForm({...form,isActive:event.target.checked})}/>Active</label><label><input type="checkbox" checked={form.isTerminal===true} onChange={(event)=>setForm({...form,isTerminal:event.target.checked})}/>Terminal stage</label><label><input type="checkbox" checked={form.requiresRemarks!==false} onChange={(event)=>setForm({...form,requiresRemarks:event.target.checked})}/>Remark required</label><label><input type="checkbox" checked={form.requiresSchedule===true} onChange={(event)=>setForm({...form,requiresSchedule:event.target.checked})}/>Schedule required</label><label><input type="checkbox" checked={form.recruiterCanSet!==false} onChange={(event)=>setForm({...form,recruiterCanSet:event.target.checked})}/>Recruiter may set</label><label><input type="checkbox" checked={form.interviewerCanSet===true} onChange={(event)=>setForm({...form,interviewerCanSet:event.target.checked})}/>Assigned interviewer may set</label><label><input type="checkbox" checked={form.firstCallAvailable===true} onChange={(event)=>setForm({...form,firstCallAvailable:event.target.checked})}/>Show in first-call outcome</label></div><div className="lifecycle-next-grid"><h4>Allowed next stages</h4><p>Tick every valid next step. Invalid transitions are rejected by the API.</p><div>{rules.filter((item:any)=>item.code!==form.code).map((item:any)=><label key={item.code}><input type="checkbox" checked={(form.allowedNextCodes??[]).includes(item.code)} onChange={()=>toggleNext(item.code)}/><span><b>{item.label}</b><small>{item.code}</small></span></label>)}</div></div>{canEdit?<button className="primary-action" type="button" disabled={saving||!String(form.code||"").trim()||!String(form.label||"").trim()} onClick={()=>void save()}>{saving?"Saving…":"Save lifecycle rule"}</button>:null}</fieldset>{notice?<p className="connection-notice">{notice}</p>:null}</div>
    </section>
  </section>;
}

function NotificationRulesMaster({ data, token, reload, canEdit }: {
  data: any; token: string; reload: () => Promise<void>; canEdit: boolean;
}) {
  const rules = data?.notifications ?? [];
  const streams = [
    { code:"workforce", title:"Workforce notifications", description:"Control blue-collar candidate messages independently." },
    { code:"hr", title:"HR notifications", description:"Control white-collar candidate messages independently. The Interview switch also controls the dedicated candidate and manager WhatsApp invitations." }
  ];
  return <section className="connections-view">
    <section className="content-card notification-intro">
      <div><h2>WhatsApp notification rules</h2><p>All message templates, contact routing and fallbacks are controlled here. Automatic and manual messages use the same rules.</p></div>
      <dl><dt>Workforce</dt><dd>Uses the selected station&apos;s Station Contacts record.</dd><dt>HR</dt><dd>Uses Station Contacts first, then the editable HR defaults as fallback.</dd><dt>Safety</dt><dd>A message is blocked and audited whenever a required Master value is missing.</dd></dl>
    </section>
    {streams.map((stream)=><section className="notification-stream-section" key={stream.code}>
      <header><div><h2>{stream.title}</h2><p>{stream.description}</p></div></header>
      <div className="notification-rule-grid">
        {rules.filter((rule:any)=>rule.stream===stream.code).map((rule:any)=><NotificationRuleCard key={`${rule.stream}-${rule.trigger}`} initial={rule} token={token} reload={reload} canEdit={canEdit}/>)}
      </div>
    </section>)}
  </section>;
}

function NotificationRuleCard({ initial, token, reload, canEdit }: {
  initial: any; token: string; reload: () => Promise<void>; canEdit: boolean;
}) {
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(()=>setForm(initial),[initial]);
  const eventNames:Record<string,string> = {
    new_lead: "Application received",
    no_response: "No response",
    interview: "Interview scheduled"
  };
  const usesDefaults = form.contactSource !== "station";
  async function save() {
    if (!canEdit) return;
    setSaving(true); setNotice("");
    try {
      const response=await fetch("/api/recruitment/masters",{
        method:"PUT",
        headers:{...headers(token),"Content-Type":"application/json"},
        body:JSON.stringify({resource:"notification",...form})
      });
      const payload=await response.json();
      if(!response.ok) throw new Error(payload.error||"Unable to save notification rule.");
      setNotice("Rule saved. New automatic and manual messages now use this Master configuration.");
      await reload();
    } catch(error) {
      setNotice(error instanceof Error?error.message:"Unable to save notification rule.");
    } finally { setSaving(false); }
  }
  return <article className="content-card notification-rule-card">
    {!canEdit?<p className="master-readonly-inline">View only · Edit or All access is required to change this rule.</p>:null}
    <fieldset disabled={!canEdit}>
      <header><div><span>{form.stream === "workforce" ? "Workforce" : "HR"}</span><h2>{eventNames[form.trigger]||form.trigger}</h2></div><label className="toggle"><input type="checkbox" checked={form.enabled!==false} onChange={(event)=>setForm({...form,enabled:event.target.checked})}/><b>{form.enabled!==false?"Enabled":"Disabled"}</b></label></header>
      <div className="form-grid notification-rule-fields">
        <label className="wide">Approved WhatsApp template name<input value={form.templateName||""} onChange={(event)=>setForm({...form,templateName:event.target.value})} placeholder="Enter the approved Meta template name"/></label>
        <label className="wide">Contact source<select value={form.contactSource||"station"} onChange={(event)=>setForm({...form,contactSource:event.target.value})}><option value="station">Station Contacts master only</option><option value="stream_default">Category default only</option><option value="station_then_default">Station first, then category default</option></select><small>{form.contactSource==="station"?"The lead must be mapped to a station with complete contact data.":form.contactSource==="stream_default"?"Uses the values saved in this rule for every lead in the category.":"Uses station data where available and the saved defaults for missing values."}</small></label>
        {usesDefaults?<><label>Default contact name<input value={form.defaultContactName||""} onChange={(event)=>setForm({...form,defaultContactName:event.target.value})}/></label><label>Default contact mobile<input inputMode="tel" value={form.defaultContactMobile||""} onChange={(event)=>setForm({...form,defaultContactMobile:event.target.value})}/></label><label className="wide">Default address<textarea value={form.defaultAddress||""} onChange={(event)=>setForm({...form,defaultAddress:event.target.value})}/></label><label className="wide">Default map link<input value={form.defaultMapLink||""} onChange={(event)=>setForm({...form,defaultMapLink:event.target.value})}/></label></>:null}
        <label className="check-field"><input type="checkbox" checked={form.requireContact!==false} onChange={(event)=>setForm({...form,requireContact:event.target.checked})}/>Require contact mobile</label>
        <label className="check-field"><input type="checkbox" checked={form.requireAddress!==false} onChange={(event)=>setForm({...form,requireAddress:event.target.checked})}/>Require address</label>
      </div>
      {notice?<p className="connection-notice">{notice}</p>:null}
      {canEdit?<footer><button className="primary-action" disabled={saving||!String(form.templateName||"").trim()} onClick={()=>void save()}>{saving?"Saving…":"Save notification rule"}</button></footer>:null}
    </fieldset>
  </article>;
}

function ConnectionCard({ provider, definition, current, token, canEdit, reload }: {
  provider: string;
  definition: typeof connectionDefinitions[string];
  current: any;
  token: string;
  canEdit:boolean;
  reload: () => Promise<void>;
}) {
  const [enabled, setEnabled] = useState(Boolean(current?.isEnabled));
  const [publicConfig, setPublicConfig] = useState<Record<string,string>>(current?.publicConfig ?? {});
  const [secrets, setSecrets] = useState<Record<string,string>>({});
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const configured = new Set<string>(current?.configuredSecretKeys ?? []);
  const configuredPublic = new Set<string>(current?.configuredPublicKeys ?? []);
  useEffect(() => {
    setEnabled(Boolean(current?.isEnabled));
    setPublicConfig(current?.publicConfig ?? {});
  }, [current?.isEnabled, current?.updatedAt]);

  async function request(method: "PUT" | "POST") {
    if(!canEdit){setNotice("View access — connection changes are disabled.");return;}
    setSaving(true); setNotice("");
    try {
      const response = await fetch("/api/recruitment/connections", {
        method,
        headers: { ...headers(token), "Content-Type": "application/json" },
        body: JSON.stringify(method === "PUT"
          ? { provider, isEnabled: enabled, publicConfig, secrets }
          : { provider })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Connection request failed.");
      setSecrets({});
      setPublicConfig({});
      setNotice(method === "PUT"
        ? "Saved securely. Runtime health is monitored automatically."
        : `${payload.message}${current?.isEnabled ? "" : " Test passed while disabled; enable and save when ready."}`);
      await reload();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Connection request failed.");
      await reload();
    } finally { setSaving(false); }
  }

  const status = current?.connectionStatus ?? "not_tested";
  return <article className="content-card connection-card">{!canEdit?<p className="read-only-master-note">View access — settings and connection tests are disabled.</p>:null}<fieldset disabled={!canEdit}>
    <header><div><h2>{definition.title}</h2><p>{definition.description}</p></div><label className="toggle"><input type="checkbox" checked={enabled} onChange={(event)=>setEnabled(event.target.checked)}/><span>{enabled ? "Enabled" : "Disabled"}</span></label></header>
    <div className="connection-status"><b className={`connection-${status}`}>{status.replaceAll("_"," ")}</b><span>{current?.lastTestedAt ? `Tested ${new Date(current.lastTestedAt).toLocaleString("en-IN")}` : "Not tested yet"}</span></div>
    <div className="connection-fields">
      {definition.publicFields.map(([key,label,placeholder])=><label key={key}>{label}<input value={publicConfig[key] ?? ""} placeholder={configuredPublic.has(key) ? "Configured — enter only to replace" : placeholder} onChange={(event)=>setPublicConfig({...publicConfig,[key]:event.target.value})}/><small>{configuredPublic.has(key) ? "Saved value is hidden." : "Not configured."}</small></label>)}
      {definition.secretFields.map(([key,label])=><label key={key}>{label}<input type="password" autoComplete="new-password" value={secrets[key] ?? ""} placeholder={configured.has(key) ? "Configured — enter only to replace" : "Not configured"} onChange={(event)=>setSecrets({...secrets,[key]:event.target.value})}/><small>{configured.has(key) ? "Encrypted credential is stored." : "Required credential is missing."}</small></label>)}
    </div>
    {(definition.advancedPublicFields.length || definition.advancedSecretFields.length) ? <details className="connection-advanced"><summary>Advanced settings</summary><p>Only needed for direct webhook verification or provider-specific customization.</p><div className="connection-fields">
      {definition.advancedPublicFields.map(([key,label,placeholder])=><label key={key}>{label}<input value={publicConfig[key] ?? ""} placeholder={configuredPublic.has(key) ? "Configured — enter only to replace" : placeholder} onChange={(event)=>setPublicConfig({...publicConfig,[key]:event.target.value})}/><small>{configuredPublic.has(key) ? "Saved value is hidden." : "Optional until direct webhook activation."}</small></label>)}
      {definition.advancedSecretFields.map(([key,label])=><label key={key}>{label}<input type="password" autoComplete="new-password" value={secrets[key] ?? ""} placeholder={configured.has(key) ? "Configured — enter only to replace" : "Not configured"} onChange={(event)=>setSecrets({...secrets,[key]:event.target.value})}/><small>{configured.has(key) ? "Encrypted credential is stored." : "Optional until direct webhook activation."}</small></label>)}
    </div></details> : null}
    {current?.lastError && current.lastError !== notice ? <p className="connection-error">{current.lastError}</p> : null}
    {notice ? <p className="connection-notice">{notice}</p> : null}
    {canEdit?<footer><button className="primary-action" disabled={saving} onClick={()=>void request("PUT")}>{saving ? "Working…" : "Save settings"}</button>{provider!=="whatsapp"?<button disabled={saving || !current} onClick={()=>void request("POST")}>Test connection</button>:<span className="runtime-monitor">WhatsApp delivery is monitored automatically.</span>}</footer>:null}</fieldset>
  </article>;
}

function LeadProfile({ data, busy, options, canManage, close, save, notify }: {
  data: LeadDetail;
  busy: boolean;
  options: any;
  canManage: boolean;
  close: () => void;
  save: (fields: Record<string, unknown>) => Promise<void>;
  notify: (trigger: "new_lead" | "no_response" | "interview", to: string) => Promise<{ templateName: string; target: string; providerMessageId: string | null }>;
}) {
  const lead = data.lead;
  const [remarks, setRemarks] = useState(lead.remarks ?? "");
  const [followUp, setFollowUp] = useState(isoToLocalInput(lead.follow_up_at));
  const [callbackAt, setCallbackAt] = useState(isoToLocalInput(lead.callback_at));
  const [finalStatus, setFinalStatus] = useState(lead.final_status ?? "");
  const [finalRemarks, setFinalRemarks] = useState(lead.final_remarks ?? "");
  const [workEmail, setWorkEmail] = useState(lead.work_email ?? "");
  const [assignee, setAssignee] = useState(lead.assigned_profile_id ?? "");
  const [fullName, setFullName] = useState(lead.full_name ?? "");
  const [phone, setPhone] = useState(lead.phone ?? "");
  const [email, setEmail] = useState(lead.email ?? "");
  const [city, setCity] = useState(lead.city ?? "");
  const [locationId, setLocationId] = useState(lead.location_id ?? "");
  const [roleId, setRoleId] = useState(lead.role_id ?? "");
  const [testPhone, setTestPhone] = useState(lead.phone ?? "");
  const [testTrigger, setTestTrigger] = useState<"new_lead" | "no_response" | "interview">("new_lead");
  const [testNotice, setTestNotice] = useState("");
  async function sendTest() {
    if (!confirm(`Send the configured ${testTrigger.replaceAll("_"," ")} notification to ${testPhone}? This sends one real WhatsApp message and records it in the audit trail.`)) return;
    setTestNotice("");
    try {
      const result = await notify(testTrigger, testPhone);
      setTestNotice(`${result.templateName} sent to ${result.target}. Provider ID: ${result.providerMessageId || "accepted"}`);
    } catch (error) {
      setTestNotice(error instanceof Error ? error.message : "WhatsApp test failed.");
    }
  }
  return <div className="modal-backdrop"><section className="modal lead-profile">
    <header className="modal-header"><div><h2>{lead.full_name || "Unnamed candidate"}</h2><p>{displayPhone(lead.phone)} • {lead.email || "No email"}</p></div><button onClick={close}>×</button></header>
    <div className="profile-grid">
      <article><h3>Application</h3><dl>
        <dt>Status</dt><dd>{statusLabel(lead.status || "new")}</dd><dt>Role</dt><dd>{lead.recruitment_roles?.name || "Unmapped"}</dd>
        <dt>Station</dt><dd>{lead.recruitment_locations?.code || "Unmapped"}</dd><dt>Ad</dt><dd>{lead.ad_name || "—"}</dd>
        <dt>Created</dt><dd>{lead.lead_created_at ? new Date(lead.lead_created_at).toLocaleString("en-IN") : "—"}</dd>
        <dt>Attempts</dt><dd>{lead.total_attempts} total • {lead.no_response_attempts} no response • {lead.call_back_attempts} callback</dd>
        <dt>Duplicate sources</dt><dd>{lead.duplicate_count}</dd>
        <dt>Assigned to</dt><dd>{lead.assigned_profile?.full_name || lead.assigned_profile?.email || "Unassigned"}</dd>
      </dl></article>
      <article><h3>Follow-up and outcome</h3><label>Remarks<textarea value={remarks} onChange={(event) => setRemarks(event.target.value)} /></label>
        <label>Follow-up / interview time<input type="datetime-local" value={followUp} onChange={(event) => setFollowUp(event.target.value)} /></label>
        <label>Callback time<input type="datetime-local" value={callbackAt} onChange={(event) => setCallbackAt(event.target.value)} /></label>
        <label>Final status<select value={finalStatus} onChange={(event) => setFinalStatus(event.target.value)}><option value="">— final status —</option>{[...new Set([...(options.finalStatuses ?? []), finalStatus].filter(Boolean))].map((item:any)=><option value={item} key={item}>{item}</option>)}</select></label>
        <label>Final remarks<textarea value={finalRemarks} onChange={(event) => setFinalRemarks(event.target.value)} /></label>
        <label>Work email<input type="email" value={workEmail} onChange={(event)=>setWorkEmail(event.target.value)} placeholder="firstname.lastname@dropxlogistics.com" /></label>
        {canManage?<label>Assigned recruiter<select value={assignee} onChange={(event)=>setAssignee(event.target.value)}><option value="">Unassigned</option>{(options.assignees ?? []).map((item:any)=><option value={item.id} key={item.id}>{item.name}{item.email ? ` — ${item.email}` : ""}</option>)}</select></label>:null}
        <button className="primary-action" disabled={busy} onClick={() => void save({ remarks, follow_up_at: localInputToIso(followUp), callback_at: localInputToIso(callbackAt), final_status: finalStatus || null, final_remarks: finalRemarks || null, work_email: workEmail || null, ...(canManage ? { assigned_profile_id: assignee || null } : {}) })}>{busy ? "Saving…" : "Save follow-up changes"}</button>
      </article>
    </div>
    {canManage?<div className="profile-grid">
      <article><h3>Admin data correction</h3><p className="panel-help">Edit the canonical lead record here instead of changing source history. Every correction is audited and duplicate mobile numbers for the same ad are blocked.</p>
        <label>Candidate name<input value={fullName} onChange={(event)=>setFullName(event.target.value)} /></label>
        <label>Mobile number<input inputMode="tel" value={phone} onChange={(event)=>setPhone(event.target.value)} /></label>
        <label>Email<input type="email" value={email} onChange={(event)=>setEmail(event.target.value)} /></label>
        <label>City<input value={city} onChange={(event)=>setCity(event.target.value)} /></label>
        <div className="field-pair"><label>Station<select value={locationId} onChange={(event)=>setLocationId(event.target.value)}><option value="">Unmapped</option>{(options.locations??[]).map((item:any)=><option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}</select></label><label>Designation<select value={roleId} onChange={(event)=>setRoleId(event.target.value)}><option value="">Unmapped</option>{(options.roles??[]).map((item:any)=><option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}</select></label></div>
        <button className="primary-action" disabled={busy} onClick={()=>void save({full_name:fullName||null,phone,email:email||null,city:city||null,location_id:locationId||null,role_id:roleId||null})}>{busy?"Saving…":"Save corrected lead data"}</button>
      </article>
      <article><h3>Send one WhatsApp test</h3><p className="panel-help">Use a test number without overwriting the candidate&apos;s number. The approved legacy template and provider response are saved against this lead.</p>
        <label>Message<select value={testTrigger} onChange={(event)=>setTestTrigger(event.target.value as "new_lead"|"no_response"|"interview")}><option value="new_lead">Application received</option><option value="no_response">No response</option><option value="interview">Interview scheduled</option></select></label>
        <label>Test mobile number<input inputMode="tel" value={testPhone} onChange={(event)=>setTestPhone(event.target.value)} placeholder="10-digit Indian mobile" /></label>
        <dl className="template-preview"><dt>Candidate</dt><dd>{lead.full_name||"Missing — message will be blocked"}</dd><dt>Designation</dt><dd>{lead.recruitment_roles?.name||"Missing — message will be blocked"}</dd><dt>Resolved contact</dt><dd>{lead.recruitment_locations?.poc_mobile||"Uses Notification Rules master"}</dd><dt>Resolved address</dt><dd>{lead.recruitment_locations?.address||"Uses Notification Rules master"}</dd></dl>
        <button className="primary-action" disabled={busy||!testPhone.trim()} onClick={()=>void sendTest()}>{busy?"Sending…":"Confirm and send one test"}</button>
        {testNotice?<p className="test-notice">{testNotice}</p>:null}
      </article>
    </div>:null}
    <div className="profile-grid">
      <article><h3>Application answers</h3><dl>{visibleQuestionnaireEntries(lead.questionnaire).map(([key,value]) => <><dt key={`${key}-k`}>{key.replaceAll("_"," ")}</dt><dd key={`${key}-v`}>{String(value)}</dd></>)}</dl>{!visibleQuestionnaireEntries(lead.questionnaire).length?<p>No questionnaire responses were submitted.</p>:null}</article>
      <article><h3>Station contact</h3><dl><dt>Address</dt><dd>{lead.recruitment_locations?.address || "—"}</dd><dt>POC</dt><dd>{lead.recruitment_locations?.poc_name || "—"}</dd><dt>Mobile</dt><dd>{lead.recruitment_locations?.poc_mobile || "—"}</dd></dl></article>
    </div>
    <div className="timeline-tabs">
      <article><h3>Audit timeline ({data.history.length})</h3>{data.history.slice(0, 80).map((event) => <div className="timeline-row" key={event.id}><b>{event.event_type.replaceAll("_"," ")}</b><span>{event.field_name ? `${event.field_name}: ${event.old_value || "—"} → ${event.new_value || "—"}` : event.remarks || "Recorded"}</span><small>{new Date(event.created_at).toLocaleString("en-IN")}</small></div>)}</article>
      <article><h3>WhatsApp history ({data.messages.length})</h3>{data.messages.map((message) => <div className="timeline-row" key={message.id}><b>{message.template_name}</b><span>{message.status}{message.last_error ? ` • ${message.last_error}` : ""}</span><small>{new Date(message.created_at).toLocaleString("en-IN")}</small></div>)}</article>
      <article><h3>Source occurrences ({data.sources.length})</h3>{data.sources.map((source) => <div className="timeline-row" key={source.id}><b>{sourceChannel(source.source_system)}</b><span>{source.ad_name || "No ad"}</span><small>{new Date(source.received_at).toLocaleString("en-IN")}</small></div>)}</article>
    </div>
  </section></div>;
}

function ActiveAds({ data, token, stream, roleCatalog, reload, request, canDirectPost, openPublisher }: {
  data: any;
  token: string;
  stream: "workforce" | "hr";
  roleCatalog: Array<{ code: string; name: string; stream: "workforce" | "hr" }>;
  reload: () => Promise<void>;
  request: (type: "new_ad" | "budget_change" | "stop_ad" | "resume_ad", ad?: any) => void;
  canDirectPost: boolean;
  openPublisher: () => void;
}) {
  const baseAds = data?.ads ?? [];
  const permissions = new Set<string>(data?.permissions ?? []);
  const canRequestChange = permissions.has("create");
  const [insightState,setInsightState] = useState<{
    loading:boolean;
    available:boolean|null;
    date:string|null;
    error:string|null;
    values:Record<string,any>;
    recommendations:Record<string,any>;
  }>({loading:true,available:null,date:null,error:null,values:{},recommendations:{}});
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [station, setStation] = useState("");
  const [operationalOwner, setOperationalOwner] = useState("");
  const [role, setRole] = useState("");
  const [sort, setSort] = useState("today");
  const [posterBusy, setPosterBusy] = useState("");
  const [posterPreview, setPosterPreview] = useState<{ url:string; adName:string } | null>(null);
  const [posterError, setPosterError] = useState("");
  const [insightAd,setInsightAd] = useState<any|null>(null);
  const [creativeTarget,setCreativeTarget] = useState<any|null>(null);
  const [reconcileBusy,setReconcileBusy] = useState(false);
  const [reconcileNotice,setReconcileNotice] = useState<{tone:"success"|"warning"|"error";message:string;mismatches?:any[]}|null>(null);
  useEffect(()=>{
    const controller=new AbortController();
    setInsightState((current)=>({...current,loading:true,error:null}));
    fetch(`/api/recruitment/ads/insights${data?.stream?`?stream=${encodeURIComponent(data.stream)}`:""}`,{
      headers:headers(token),cache:"no-store",signal:controller.signal
    }).then(async(response)=>{
      const payload=await response.json();
      if(!response.ok)throw new Error(payload.error||"Unable to refresh Meta ad insights.");
      setInsightState({
        loading:false,
        available:payload.insightsAvailable===true,
        date:payload.insightDate||null,
        error:payload.insightsError||null,
        values:payload.insights??{},
        recommendations:payload.recommendations??{}
      });
    }).catch((error)=>{
      if(error?.name==="AbortError")return;
      setInsightState((current)=>({...current,loading:false,available:false,error:error instanceof Error?error.message:"Unable to refresh Meta ad insights."}));
    });
    return ()=>controller.abort();
  },[data?.stream,token]);
  const ads = useMemo(()=>baseAds.map((item:any)=>({
    ...item,
    ...(item.meta_ad_id ? insightState.values[item.meta_ad_id] : null),
    guard:item.meta_ad_id?insightState.recommendations[item.meta_ad_id]:null
  })),[baseAds,insightState.values,insightState.recommendations]);
  const stationCatalog = useMemo(() => {
    const merged = new Map<string, { code: string; name: string; operationalOwnerName: string | null }>();
    for (const item of data?.stationOptions ?? []) {
      if (!item?.code) continue;
      merged.set(item.code, { code: item.code, name: item.name || item.code, operationalOwnerName: item.operationalOwner?.name ?? item.clusterManager?.name ?? null });
    }
    for (const item of ads) {
      const code = item.recruitment_locations?.code;
      if (!code || merged.has(code)) continue;
      merged.set(code, {
        code,
        name: item.recruitment_locations?.name || code,
        operationalOwnerName: item.recruitment_locations?.operational_owner?.name ?? null
      });
    }
    return [...merged.values()].sort((left, right) => left.code.localeCompare(right.code));
  }, [ads, data?.stationOptions]);
  const operationalOwners = [...new Set(stationCatalog.map((item) => item.operationalOwnerName).filter(Boolean))].sort() as string[];
  const roles = useMemo(() => workspaceRoleCatalog(
    roleCatalog,
    stream,
    ads.map((item:any) => item.recruitment_roles).filter(Boolean)
  ), [ads, roleCatalog, stream]);
  const states = [...new Set(ads.map((item:any)=>String(item.status||"unknown").toUpperCase()))].sort() as string[];
  const selectedAdStates = new Set(status.split(",").filter(Boolean));
  const selectedAdStations = new Set(station.split(",").filter(Boolean));
  const selectedOperationalOwners = new Set(operationalOwner.split(",").filter(Boolean));
  const selectedAdRoles = new Set(role.split(",").filter(Boolean));
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return ads.filter((item:any) => {
      const haystack = [item.ad_name,item.campaign_name,item.adset_name,item.recruitment_locations?.code,item.recruitment_locations?.name,item.recruitment_locations?.operational_owner?.name,item.recruitment_roles?.code,item.recruitment_roles?.name].join(" ").toLowerCase();
      return (!query || haystack.includes(query))
        && (!selectedAdStates.size || selectedAdStates.has(String(item.status||"unknown").toUpperCase()))
        && (!selectedAdStations.size || selectedAdStations.has(item.recruitment_locations?.code))
        && (!selectedOperationalOwners.size || selectedOperationalOwners.has(item.recruitment_locations?.operational_owner?.name))
        && (!selectedAdRoles.size || selectedAdRoles.has(item.recruitment_roles?.code));
    }).sort((a:any,b:any) => {
      if (sort === "budget") return Number(b.daily_budget||0)-Number(a.daily_budget||0);
      if (sort === "leads") return Number(b.lead_count||0)-Number(a.lead_count||0);
      if (sort === "week") return Number(b.recent_spend||0)-Number(a.recent_spend||0);
      if (sort === "lifetime") return Number(b.total_spend||0)-Number(a.total_spend||0);
      if (sort === "newest") return new Date(b.created_on||b.last_synced_at||0).getTime()-new Date(a.created_on||a.last_synced_at||0).getTime();
      if (sort === "name") return String(a.ad_name||"").localeCompare(String(b.ad_name||""));
      if (sort === "station") return String(a.recruitment_locations?.code||"").localeCompare(String(b.recruitment_locations?.code||""));
      return Number(b.today_spend||0)-Number(a.today_spend||0);
    });
  }, [ads, operationalOwner, role, search, sort, station, status]);
  const filtered = visible.reduce((summary:any,item:any)=>{
    summary.active += String(item.status||"").toUpperCase()==="ACTIVE" ? 1 : 0;
    summary.dailyBudget += String(item.status||"").toUpperCase()==="ACTIVE" ? Number(item.daily_budget||0) : 0;
    summary.todaySpend += Number(item.today_spend||0);
    summary.recentSpend += Number(item.recent_spend||0);
    summary.lifetimeSpend += Number(item.total_spend||0);
    summary.leads += Number(item.lead_count||0);
    return summary;
  },{active:0,dailyBudget:0,todaySpend:0,recentSpend:0,lifetimeSpend:0,leads:0});
  const hasFilters = Boolean(search||status||station||operationalOwner||role);
  function resetFilters(){
    setSearch("");setStatus("");setStation("");setOperationalOwner("");setRole("");
  }
  async function viewPoster(item:any) {
    setPosterBusy(item.id); setPosterError("");
    try {
      const response = await fetch(`/api/recruitment/ads/${item.id}/poster`, {
        headers: headers(token),
        cache: "no-store"
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error||"Unable to load poster.");
      setPosterPreview({ url:payload.url, adName:payload.adName||item.ad_name });
    } catch(error) {
      setPosterError(error instanceof Error?error.message:"Unable to load poster.");
    } finally {
      setPosterBusy("");
    }
  }
  async function reconcileMetaAds(repairMetaAdId?:string) {
    setReconcileBusy(true);setReconcileNotice(null);
    try {
      const response = await fetch("/api/recruitment/ads/reconcile", {
        method:"POST",
        headers:headers(token),
        body:JSON.stringify({stream,repairMetaAdId})
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error||"Unable to reconcile Meta ads.");
      const mismatches = payload.mappingMismatches??[];
      const mismatchNames = mismatches.slice(0,4).map((item:any)=>`${item.adName} (${item.adStation} vs ${item.adsetStation||item.campaignStation})`).join(", ");
      setReconcileNotice({
        tone:mismatches.length?"warning":"success",
        message:`Checked ${Number(payload.fetched||0).toLocaleString("en-IN")} Meta ads; refreshed ${Number(payload.synced||0).toLocaleString("en-IN")} and archived ${Number(payload.archivedMissing||0).toLocaleString("en-IN")} unavailable dashboard record${Number(payload.archivedMissing||0)===1?"":"s"}.${payload.repaired?` Renamed ${payload.repaired.oldName} to ${payload.repaired.newName}.`:""}${mismatches.length?` Station mismatch${mismatches.length===1?"":"es"}: ${mismatchNames}${mismatches.length>4?` and ${mismatches.length-4} more`:""}.`:" No station mismatches found."}`,
        mismatches
      });
      await reload();
    } catch(error) {
      setReconcileNotice({tone:"error",message:error instanceof Error?error.message:"Unable to reconcile Meta ads."});
    } finally {
      setReconcileBusy(false);
    }
  }
  return <section className="content-card leads-card active-ads-view">
    <div className="ad-view-head">
      <div><span>LIVE META PERFORMANCE</span><h2>Active Ads</h2><p>Every metric below follows the selected filters. Daily performance is for {insightState.date?new Date(`${insightState.date}T12:00:00`).toLocaleDateString("en-IN"):"today"}.</p></div>
      <div className="ad-head-actions">{canRequestChange&&!canDirectPost?<button onClick={()=>request("new_ad")}>Request New Ad</button>:null}{canDirectPost?<button disabled={reconcileBusy} onClick={()=>void reconcileMetaAds()}>{reconcileBusy?"Reconciling…":"Reconcile Meta"}</button>:null}{canDirectPost?<button className="primary-action" onClick={openPublisher}>Create Meta Ad</button>:null}</div>
    </div>
    {reconcileNotice?<div className={reconcileNotice.tone==="error"?"error-banner":reconcileNotice.tone==="warning"?"ad-insight-warning":"success-banner"}>{reconcileNotice.message}{reconcileNotice.mismatches?.length===1?<button type="button" disabled={reconcileBusy} onClick={()=>void reconcileMetaAds(reconcileNotice.mismatches?.[0]?.metaAdId)}>Fix station mapping</button>:null}<button type="button" onClick={()=>setReconcileNotice(null)}>×</button></div>:null}
    <div className="ad-summary">
      <article className="ad-stat stat-risk"><span>Spend Guard</span><strong>{visible.filter((item:any)=>item.guard?.severity==="critical").length}</strong><small>critical actions</small></article>
      <article className="ad-stat stat-total"><span>Filtered Ads</span><strong>{visible.length.toLocaleString("en-IN")}</strong><small>{filtered.active} running</small></article>
      <article className="ad-stat stat-active"><span>Running Daily Budget</span><strong>₹{filtered.dailyBudget.toLocaleString("en-IN",{maximumFractionDigits:0})}</strong><small>configured per day</small></article>
      <article className="ad-stat stat-spend"><span>Spend Today</span><strong>₹{filtered.todaySpend.toLocaleString("en-IN",{maximumFractionDigits:0})}</strong><small>live Meta insight</small></article>
      <article className="ad-stat stat-week"><span>Last 7 Days</span><strong>₹{filtered.recentSpend.toLocaleString("en-IN",{maximumFractionDigits:0})}</strong><small>including today</small></article>
      <article className="ad-stat stat-total-spend"><span>Lifetime Spend</span><strong>₹{filtered.lifetimeSpend.toLocaleString("en-IN",{maximumFractionDigits:0})}</strong><small>historical total</small></article>
      <article className="ad-stat stat-leads"><span>Mapped Leads</span><strong>{filtered.leads.toLocaleString("en-IN")}</strong><small>unique dashboard leads</small></article>
    </div>
    <div className="toolbar filter-toolbar ad-filter-toolbar"><input placeholder="Search ad, station, owner or role…" value={search} onChange={(event)=>setSearch(event.target.value)}/><MultiFilter label="Status" value={status} options={states.map((item)=>[item,statusLabel(item)])} onChange={setStatus}/><MultiFilter label="Stations" value={station} options={stationCatalog.map((item)=>[item.code,`${item.code} — ${item.name}`])} onChange={setStation}/><MultiFilter label="Operational owners" value={operationalOwner} options={operationalOwners.map((item)=>[item,item])} onChange={setOperationalOwner}/><MultiFilter label="Roles" value={role} options={roles.map((item)=>[item.code,`${item.code} — ${item.name}`])} onChange={setRole}/><FilterSelect label="Sort" value={sort} options={[["today","Today spend"],["week","7-day spend"],["lifetime","Lifetime spend"],["budget","Daily budget"],["leads","Leads"],["newest","Newest"],["name","Ad name"],["station","Station"]]} onChange={setSort}/>{hasFilters?<button className="secondary-action" onClick={resetFilters}>Clear</button>:null}<span>{visible.length} of {ads.length}</span></div>
    {insightState.loading?<div className="ad-insight-loading">Refreshing today and 7-day Meta insight in the background…</div>:insightState.available===false?<div className="ad-insight-warning">Daily Meta insight is temporarily unavailable. Lifetime values and saved budgets remain visible.{insightState.error?` ${insightState.error}`:""}</div>:null}
    {posterError?<div className="error-banner poster-error">{posterError}<button type="button" onClick={()=>setPosterError("")}>×</button></div>:null}
    <section className="spend-guard-panel"><header><div><span>AD SPEND WATCH</span><h3>Actions</h3></div><small>Click a line for analysis</small></header><div className="guard-list">{visible.filter((item:any)=>["critical","warning"].includes(item.guard?.severity)).sort((a:any,b:any)=>Number(b.guard?.score||0)-Number(a.guard?.score||0)).slice(0,10).map((item:any,index:number)=><details key={item.id} className={`guard-card guard-${item.guard.severity}`}><summary><span className="guard-rank">{index+1}</span><span className={`guard-level guard-${item.guard.severity}`}>{item.guard.severity}</span><span className="guard-ad"><b>{item.ad_name}</b><small>{item.recruitment_locations?.code||"Unmapped"} · {item.recruitment_roles?.code||"Unmapped"}</small></span><strong className="guard-action">{item.guard.title}</strong><span className="guard-facts"><b>{item.guard.evidence?.recentLeads||0}</b><small>7d leads</small></span><span className="guard-facts"><b>₹{Number(item.guard.evidence?.recentSpend||0).toLocaleString("en-IN")}</b><small>7d spend</small></span><em>Why?</em></summary><div className="guard-analysis"><p>{item.guard.explanation||item.guard.reason}</p><dl><span><dt>Previous week</dt><dd>{item.guard.evidence?.previousLeads||0} leads</dd></span><span><dt>Click → lead</dt><dd>{item.guard.evidence?.clickToLead||0}%</dd></span><span><dt>CTR</dt><dd>{item.guard.evidence?.ctr||0}%</dd></span><span><dt>CPL</dt><dd>₹{Number(item.guard.evidence?.cpl||0).toLocaleString("en-IN")}</dd></span><span><dt>SLA pending</dt><dd>{item.guard.evidence?.staleUnattempted||0}</dd></span></dl><button type="button" onClick={()=>setInsightAd(item)}>Full performance</button></div></details>)}</div>{!insightState.loading&&!visible.some((item:any)=>["critical","warning"].includes(item.guard?.severity))?<p className="guard-clear">No action needed from the current evidence.</p>:null}</section>
    <div className="table-scroll active-ads-desktop-table"><table><thead><tr><th>Ad</th><th>Station / role</th><th>State</th><th>Daily budget</th><th>Spend today</th><th>7-day spend</th><th>Lifetime</th><th>Leads</th><th>Creative</th><th>Control</th></tr></thead><tbody>
      {visible.map((item:any)=>{
        const state=String(item.status||"unknown").toLowerCase();
        const canReplaceCreative=canDirectPost&&Boolean(item.meta_ad_id)&&["active","paused"].includes(state);
        const ownerStatus=item.recruitment_locations?.operational_owner_status;
        const owner=item.recruitment_locations?.operational_owner;
        const ownerDesignation=item.recruitment_locations?.operational_owner_designation||"Operational owner";
        const ownerLabel=owner?.name||(ownerStatus==="ambiguous"?"Multiple mappings — fix in People":"Not mapped in People");
        return <tr key={item.id} className={`ad-row ad-row-${state}`}><td><button className="ad-insight-link" onClick={()=>setInsightAd(item)}><b>{item.ad_name}</b><small>View insights →</small></button></td><td>{item.recruitment_locations?.code||"Unmapped"} / {item.recruitment_roles?.code||"Unmapped"}<small>{ownerDesignation} · {ownerLabel}</small></td><td><span className={`ad-state ad-state-${state}`}>{statusLabel(item.status||"unknown")}</span></td><td>{item.daily_budget==null?"—":`₹${Number(item.daily_budget).toLocaleString("en-IN")}`}</td><td><b className="ad-spend">₹{Number(item.today_spend||0).toLocaleString("en-IN",{maximumFractionDigits:0})}</b><small>{Number(item.today_impressions||0).toLocaleString("en-IN")} impressions</small></td><td>₹{Number(item.recent_spend||0).toLocaleString("en-IN",{maximumFractionDigits:0})}<small>{Number(item.recent_clicks||0).toLocaleString("en-IN")} clicks</small></td><td>₹{Number(item.total_spend||0).toLocaleString("en-IN",{maximumFractionDigits:0})}</td><td><b>{Number(item.lead_count||0).toLocaleString("en-IN")}</b><small>dashboard unique</small></td><td>{item.poster_url||item.meta_ad_id?<div className="creative-actions"><button type="button" className="poster-action" disabled={posterBusy===item.id} onClick={()=>void viewPoster(item)}>{posterBusy===item.id?"Loading…":"View Creative"}</button>{canReplaceCreative?<button type="button" className="creative-replace-action" onClick={()=>setCreativeTarget(item)}>Replace Creative</button>:null}</div>:"—"}</td><td>{canRequestChange?<div className="inline-actions"><button onClick={()=>request("budget_change",item)}>Change budget</button>{state==="active"?<button onClick={()=>request("stop_ad",item)}>{canDirectPost?"Pause ad":"Request pause"}</button>:null}{state==="paused"?<button className="resume-ad-action" onClick={()=>request("resume_ad",item)}>{canDirectPost?"Resume ad":"Request resume"}</button>:null}</div>:<span className="muted-action">View only</span>}</td></tr>;
      })}
    </tbody></table></div>
    <div className="active-ads-mobile-list">{visible.map((item:any)=>{const state=String(item.status||"unknown").toLowerCase();const canReplaceCreative=canDirectPost&&Boolean(item.meta_ad_id)&&["active","paused"].includes(state);const owner=item.recruitment_locations?.operational_owner;const ownerStatus=item.recruitment_locations?.operational_owner_status;const ownerLabel=owner?.name||(ownerStatus==="ambiguous"?"Multiple mappings — fix in People":"Not mapped in People");return <details key={item.id} className={`mobile-ad-card ad-row-${state}`}><summary><span><b>{item.ad_name}</b><small>{item.recruitment_locations?.code||"Unmapped"} / {item.recruitment_roles?.code||"Unmapped"} · {ownerLabel}</small></span><span className="mobile-ad-glance"><em className={`ad-state ad-state-${state}`}>{statusLabel(item.status||"unknown")}</em><strong>₹{Number(item.today_spend||0).toLocaleString("en-IN",{maximumFractionDigits:0})}</strong></span></summary><div className="mobile-ad-details"><dl><span><dt>Daily budget</dt><dd>{item.daily_budget==null?"—":`₹${Number(item.daily_budget).toLocaleString("en-IN")}`}</dd></span><span><dt>7-day spend</dt><dd>₹{Number(item.recent_spend||0).toLocaleString("en-IN",{maximumFractionDigits:0})}</dd></span><span><dt>Lifetime</dt><dd>₹{Number(item.total_spend||0).toLocaleString("en-IN",{maximumFractionDigits:0})}</dd></span><span><dt>Leads</dt><dd>{Number(item.lead_count||0).toLocaleString("en-IN")}</dd></span></dl><div className="mobile-ad-actions"><button onClick={()=>setInsightAd(item)}>View insights</button>{item.poster_url||item.meta_ad_id?<button type="button" disabled={posterBusy===item.id} onClick={()=>void viewPoster(item)}>{posterBusy===item.id?"Loading…":"View creative"}</button>:null}{canReplaceCreative?<button type="button" className="creative-replace-action" onClick={()=>setCreativeTarget(item)}>Replace creative</button>:null}{canRequestChange?<><button onClick={()=>request("budget_change",item)}>Change budget</button>{state==="active"?<button onClick={()=>request("stop_ad",item)}>Request pause</button>:null}{state==="paused"?<button className="resume-ad-action" onClick={()=>request("resume_ad",item)}>Request resume</button>:null}</>:null}</div></div></details>;})}</div>
    {!visible.length?<div className="empty">No ad records match these filters.</div>:null}
    {insightAd?<div className="modal-backdrop" onMouseDown={(event)=>{if(event.currentTarget===event.target)setInsightAd(null);}}><section className="modal ad-insight-modal" role="dialog" aria-modal="true"><header className="modal-header"><div><span>AD PERFORMANCE</span><h2>{insightAd.ad_name}</h2><p>{insightAd.recruitment_locations?.code||"Unmapped"} / {insightAd.recruitment_roles?.code||"Unmapped"} · {statusLabel(insightAd.status)}</p></div><button onClick={()=>setInsightAd(null)}>×</button></header><div className="ad-insight-kpis"><article><span>Today spend</span><b>₹{Number(insightAd.today_spend||0).toLocaleString("en-IN",{maximumFractionDigits:0})}</b></article><article><span>Today reach</span><b>{Number(insightAd.today_reach||0).toLocaleString("en-IN")}</b></article><article><span>Today impressions</span><b>{Number(insightAd.today_impressions||0).toLocaleString("en-IN")}</b></article><article><span>Today clicks</span><b>{Number(insightAd.today_clicks||0).toLocaleString("en-IN")}</b></article><article><span>7-day Meta leads</span><b>{Number(insightAd.recent_meta_leads||0).toLocaleString("en-IN")}</b></article><article><span>7-day CPL</span><b>{Number(insightAd.recent_meta_leads||0)>0?`₹${(Number(insightAd.recent_spend||0)/Number(insightAd.recent_meta_leads)).toLocaleString("en-IN",{maximumFractionDigits:0})}`:"—"}</b></article></div><section className="ad-daily-trend"><div><h3>Last 7 days spend</h3><p>Day-level Meta insight, not lifetime spend.</p></div><div className="ad-bars">{(insightAd.recent_daily??[]).map((day:any)=>{const max=Math.max(1,...(insightAd.recent_daily??[]).map((item:any)=>Number(item.spend||0)));return <article key={day.date}><b>₹{Number(day.spend||0).toLocaleString("en-IN",{maximumFractionDigits:0})}</b><i><span style={{height:`${Math.max(4,Number(day.spend||0)/max*100)}%`}}/></i><small>{day.date?new Date(`${day.date}T12:00:00`).toLocaleDateString("en-IN",{day:"2-digit",month:"short"}):"—"}</small></article>})}{!insightAd.recent_daily?.length?<p>No recent spend returned by Meta.</p>:null}</div></section><section className="ad-insight-meta"><dl><dt>Campaign</dt><dd>{insightAd.campaign_name||"—"}</dd><dt>Ad set</dt><dd>{insightAd.adset_name||"—"}</dd><dt>Meta Ad ID</dt><dd>{insightAd.meta_ad_id||"—"}</dd><dt>Last synced</dt><dd>{insightAd.last_synced_at?new Date(insightAd.last_synced_at).toLocaleString("en-IN"):"—"}</dd></dl></section><footer><button onClick={()=>setInsightAd(null)}>Close</button>{insightAd.poster_url||insightAd.meta_ad_id?<button className="poster-action" onClick={()=>void viewPoster(insightAd)}>View Creative</button>:null}{canDirectPost&&insightAd.meta_ad_id&&["active","paused"].includes(String(insightAd.status||"").toLowerCase())?<button className="creative-replace-action" onClick={()=>{setInsightAd(null);setCreativeTarget(insightAd);}}>Replace Creative</button>:null}{canRequestChange?<button className="primary-action" onClick={()=>{setInsightAd(null);request("budget_change",insightAd);}}>Request budget change</button>:null}</footer></section></div>:null}
    {posterPreview?<div className="poster-modal" role="dialog" aria-modal="true" aria-label={`${posterPreview.adName} poster`} onClick={()=>setPosterPreview(null)}><article onClick={(event)=>event.stopPropagation()}><header><div><span>AD CREATIVE</span><h2>{posterPreview.adName}</h2></div><button type="button" aria-label="Close poster" onClick={()=>setPosterPreview(null)}>×</button></header><div className="poster-stage"><img src={posterPreview.url} alt={`${posterPreview.adName} recruitment poster`}/></div><footer><a href={posterPreview.url} target="_blank" rel="noreferrer">Open Full Size</a><button type="button" onClick={()=>setPosterPreview(null)}>Close</button></footer></article></div>:null}
    {creativeTarget?<MetaCreativeReplacement token={token} stream={stream} ad={creativeTarget} close={()=>setCreativeTarget(null)} afterReplace={async()=>{await reload();}}/>:null}
  </section>;
}

const adRequestActionLabels: Record<string,string> = {
  approve: "Approve & Apply",
  reject: "Reject",
  publish: "Approve & Apply",
  complete: "Complete",
  cancel: "Cancel Request"
};

function AdRequests({ data, token, reload, openForm }: { data: any; token: string; reload: () => Promise<void>; openForm: () => void }) {
  const requests = data?.requests ?? [];
  const permissions = new Set<string>(data?.permissions ?? []);
  const [actionTarget,setActionTarget] = useState<{request:any;action:string}|null>(null);
  const [remarks,setRemarks] = useState("");
  const [metaAdId,setMetaAdId] = useState("");
  const [publishedUrl,setPublishedUrl] = useState("");
  const [publishMode,setPublishMode] = useState<"api"|"manual">("api");
  const [metaCatalog,setMetaCatalog] = useState<any|null>(null);
  const [metaAudience,setMetaAudience] = useState<any|null>(null);
  const [metaCatalogLoading,setMetaCatalogLoading] = useState(false);
  const [metaDraft,setMetaDraft] = useState<Record<string,string>>({});
  const [saving,setSaving] = useState(false);
  const [notice,setNotice] = useState("");
  const [search,setSearch] = useState("");
  const publishingDesignation=actionTarget?.request?.recruitment_roles??{};
  const matchedMetaForms=useMemo(()=>matchingMetaFormsForDesignation(
    metaCatalog?.forms??[],
    publishingDesignation
  ),[metaCatalog?.forms,publishingDesignation?.code,publishingDesignation?.name]);
  useEffect(()=>{
    if(!["approve","publish"].includes(actionTarget?.action||"")||actionTarget?.request.request_type!=="new_ad"||publishMode!=="api")return;
    const controller=new AbortController();
    let active=true;
    setMetaCatalogLoading(true);
    fetch(`/api/recruitment/meta-ad-builder?locationId=${encodeURIComponent(String(actionTarget.request.location_id||""))}`,{
      headers:headers(token),cache:"no-store",signal:controller.signal
    }).then(async(response)=>{
      const payload=await response.json();
      if(!response.ok)throw new Error(payload.error||"Unable to load Meta forms and campaigns.");
      if(!active)return;
      const designation=actionTarget.request.recruitment_roles??{};
      const matching=matchingMetaFormsForDesignation(payload.catalog?.forms??[],designation);
      const recommended=recommendedMetaFormForDesignation(payload.catalog?.forms??[],designation);
      setMetaCatalog({...payload.catalog,forms:matching});
      setMetaAudience(payload.audience||null);
      setMetaDraft((current)=>{
        const currentMatches=matching.some((item)=>item.id===current.formId);
        return {...current,
          formId:currentMatches?current.formId:(recommended?.id||(matching.length===1?matching[0].id:"")),
          audienceRadiusKm:String(payload.audience?.radiusKm||current.audienceRadiusKm||15)
        };
      });
    }).catch((error)=>{
      if(active&&error?.name!=="AbortError")setNotice(error instanceof Error?error.message:"Unable to load Meta setup.");
    }).finally(()=>{if(active)setMetaCatalogLoading(false);});
    return ()=>{active=false;controller.abort();};
  },[actionTarget?.request?.id,actionTarget?.action,publishMode,token]);
  const legacyRequests = requests.filter((item:any)=>String(item.request_id||"").startsWith("ADR-"));
  const closedStages = new Set(["published","completed","rejected","cancelled"]);
  const openRequests = requests.filter((item:any)=>!closedStages.has(item.status));
  const closedRequests = requests.filter((item:any)=>closedStages.has(item.status));
  const myOpen = openRequests.filter((item:any)=>item.isMine);
  const workActions = new Set(["approve","reject","publish","complete"]);
  const workQueue = openRequests.filter((item:any)=>
    (item.allowedActions??[]).some((action:string)=>workActions.has(action))
  );
  const isWorkflowOperator = ["approve","reject","publish","complete"].some((action)=>permissions.has(action));
  const primaryRequests = isWorkflowOperator ? workQueue : myOpen;
  const myOpenSecondary = myOpen.filter((item:any)=>
    !primaryRequests.some((primary:any)=>primary.id===item.id)
  );
  const primaryTitle = permissions.has("publish") && !permissions.has("review") && !permissions.has("approve")
    ? "Ready for publishing"
    : isWorkflowOperator ? "Needs your action" : "My active requests";
  const primaryDescription = isWorkflowOperator
    ? "Only requests where your configured role can take the next lifecycle action."
    : "Requests you submitted that are still being reviewed, approved or published.";
  const otherActive = openRequests.filter((item:any)=>
    !primaryRequests.some((primary:any)=>primary.id===item.id)
    && !myOpen.some((mine:any)=>mine.id===item.id)
  );
  const normalizedSearch = search.trim().toLowerCase();
  function matchesSearch(item:any) {
    if(!normalizedSearch)return true;
    return [
      item.request_id,item.request_type,item.recruitment_locations?.code,
      item.recruitment_locations?.name,item.recruitment_roles?.code,
      item.recruitment_roles?.name,item.requested_by_display,item.status
    ].join(" ").toLowerCase().includes(normalizedSearch);
  }
  function RequestTable({ items, empty }: { items:any[]; empty:string }) {
    const visibleItems=items.filter(matchesSearch);
    return <><div className="table-scroll request-desktop-table"><table><thead><tr><th>Request</th><th>Purpose</th><th>Station / role</th><th>Requested by</th><th>Commercial</th><th>Current stage</th><th>Last update</th><th>Next action</th></tr></thead><tbody>
      {visibleItems.map((item:any)=>{
        const history=item.lifecycleHistory??[];
        const latest=history.at(-1);
        return <tr key={item.id}><td><b>{item.request_id}</b><small>{item.requested_at?new Date(item.requested_at).toLocaleString("en-IN"):"—"}</small><details className="request-history"><summary>View timeline ({history.length})</summary>{history.map((event:any,index:number)=><div key={`${event.at}-${index}`}><b>{statusLabel(event.to||event.action)}</b><span>{event.actorName||event.actorEmail||"System"}</span><small>{event.at?new Date(event.at).toLocaleString("en-IN"):"—"}{event.remarks?` · ${event.remarks}`:""}</small></div>)}</details></td><td>{statusLabel(item.request_type)}<small>{item.reason||item.notes||"—"}</small></td><td><b>{item.recruitment_locations?.code||"—"} / {item.recruitment_roles?.code||item.recruitment_ads?.ad_name||"—"}</b><small>{item.recruitment_locations?.name||item.recruitment_roles?.name||""}</small></td><td><b>{item.requested_by_display||"Unknown requester"}</b><small>{item.isMine?"My request":"Visible by assigned scope"}</small></td><td>{item.requested_budget?`₹${Number(item.requested_budget).toLocaleString("en-IN")}/day`:"—"}<small>{item.days_required?`${item.days_required} days`:""}{item.payment_offer?` · ${item.payment_offer}`:""}</small></td><td><span className={`request-stage request-stage-${item.status}`}>{statusLabel(item.status)}</span><small>{latest?.remarks||item.admin_remarks||"No latest remark"}</small></td><td>{item.updated_at?new Date(item.updated_at).toLocaleString("en-IN"):"—"}<small>{latest?.actorName||latest?.actorEmail||"System"}</small></td><td>{item.allowedActions?.length?<select aria-label={`Action for ${item.request_id}`} value="" onChange={(event)=>{if(event.target.value)beginAction(item,event.target.value);}}><option value="">Choose action…</option>{item.allowedActions.map((action:string)=><option value={action} key={action}>{adRequestActionLabels[action]||statusLabel(action)}</option>)}</select>:<span className="muted-action">Waiting for next owner</span>}</td></tr>;
      })}
    </tbody></table></div><div className="request-mobile-list">{visibleItems.map((item:any)=>{const history=item.lifecycleHistory??[];const latest=history.at(-1);return <details className="mobile-request-card" key={item.id}><summary><span><b>{item.request_id}</b><small>{item.recruitment_locations?.code||"—"} / {item.recruitment_roles?.code||item.recruitment_ads?.ad_name||"—"} · {statusLabel(item.request_type)}</small></span><span className={`request-stage request-stage-${item.status}`}>{statusLabel(item.status)}</span></summary><div><dl><span><dt>Requested by</dt><dd>{item.requested_by_display||"Unknown"}</dd></span><span><dt>Commercial</dt><dd>{item.requested_budget?`₹${Number(item.requested_budget).toLocaleString("en-IN")}/day`:"—"}</dd></span><span><dt>Reason</dt><dd>{item.reason||item.notes||"—"}</dd></span><span><dt>Updated</dt><dd>{item.updated_at?new Date(item.updated_at).toLocaleString("en-IN"):"—"}</dd></span></dl>{latest?.remarks||item.admin_remarks?<p>{latest?.remarks||item.admin_remarks}</p>:null}<details className="request-history"><summary>Timeline ({history.length})</summary>{history.map((event:any,index:number)=><div key={`${event.at}-${index}`}><b>{statusLabel(event.to||event.action)}</b><span>{event.actorName||event.actorEmail||"System"}</span><small>{event.at?new Date(event.at).toLocaleString("en-IN"):"—"}{event.remarks?` · ${event.remarks}`:""}</small></div>)}</details>{item.allowedActions?.length?<select aria-label={`Action for ${item.request_id}`} value="" onChange={(event)=>{if(event.target.value)beginAction(item,event.target.value);}}><option value="">Choose action…</option>{item.allowedActions.map((action:string)=><option value={action} key={action}>{adRequestActionLabels[action]||statusLabel(action)}</option>)}</select>:<span className="muted-action">Waiting for next owner</span>}</div></details>;})}</div>{!visibleItems.length?<div className="empty">{normalizedSearch?"No requests match this search.":empty}</div>:null}</>;
  }
  function beginAction(request:any,action:string){
    setRemarks("");
    setMetaAdId("");
    setPublishedUrl("");
    setPublishMode("api");
    setMetaCatalog(null);
    setMetaAudience(null);
    const code=`${request.recruitment_locations?.code||"STATION"}_${request.recruitment_roles?.code||"ROLE"}`;
    const dateCode=istDate().replaceAll("-","");
    setMetaDraft({
      campaignMode:"new",
      campaignId:"",
      campaignName:`${code} Recruitment`,
      formId:"",
      dailyBudget:String(request.requested_budget||""),
      daysRequired:String(request.days_required||7),
      adName:`${code}_${dateCode}`,
      adSetName:`${code}_Local`,
      audienceRadiusKm:"15",
      creativeName:`${code}_Creative_${dateCode}`,
      primaryText:`Join DropX Logistics as ${request.recruitment_roles?.name||request.recruitment_roles?.code||"a team member"} at ${request.recruitment_locations?.name||request.recruitment_locations?.code||"your preferred location"}. Apply now.`,
      headline:`${request.recruitment_roles?.name||"Job"} openings at ${request.recruitment_locations?.name||request.recruitment_locations?.code||"DropX"}`,
      description:[request.payment_offer,request.location_details].filter(Boolean).join(" · "),
      posterUrl:request.poster_url||"",
      destinationUrl:"https://recruit.dropxlogistics.com",
      callToAction:"APPLY_NOW"
    });
    setNotice("");
    setActionTarget({request,action});
  }
  async function submitAction() {
    if(!actionTarget)return;
    if(actionTarget.action==="reject"&&!remarks.trim()){setNotice("Enter the rejection reason.");return;}
    if(["approve","publish"].includes(actionTarget.action)&&actionTarget.request.request_type==="new_ad"){
      if(publishMode==="manual"&&!metaAdId.trim()&&!publishedUrl.trim()){
        setNotice("Enter the Meta Ad ID or published ad URL.");return;
      }
      if(publishMode==="api"){
        const radius=Number(metaDraft.audienceRadiusKm||0);
        if(!metaAudience){setNotice("Station audience is not configured. Add latitude and longitude in Master → Station Contacts.");return;}
        if(!Number.isInteger(radius)||radius<15||radius>18){setNotice("Audience radius must be between 15 and 18 km.");return;}
        if(!matchedMetaForms.length){setNotice(`No active Meta form matches ${publishingDesignation?.code||"this designation"}. The form name must contain its designation code.`);return;}
        if(!metaDraft.formId){setNotice(`Choose a ${publishingDesignation?.code||"designation"}-matched Meta instant form.`);return;}
        if(!metaDraft.primaryText?.trim()||!metaDraft.headline?.trim()){setNotice("Enter the primary text and headline.");return;}
        if(!metaDraft.posterUrl?.trim()){setNotice("Add an HTTPS poster link to the approved request.");return;}
        if(!metaDraft.destinationUrl?.trim()){setNotice("Enter the destination link.");return;}
        if(metaDraft.campaignMode==="existing"&&!metaDraft.campaignId){setNotice("Choose an existing employment lead campaign.");return;}
        if(metaDraft.campaignMode!=="existing"&&!metaDraft.campaignName?.trim()){setNotice("Enter the campaign name.");return;}
      }
    }
    setSaving(true);setNotice("");
    try{
      const response = await fetch("/api/recruitment/ad-requests", {
        method: "PATCH",
        headers: { ...headers(token), "Content-Type": "application/json" },
        body: JSON.stringify({
          id:actionTarget.request.id,
          action:actionTarget.action,
          remarks:remarks.trim()||null,
          publishMode,
          metaDraft:publishMode==="api"?metaDraft:null,
          metaAdId:metaAdId.trim()||null,
          publishedUrl:publishedUrl.trim()||null
        })
      });
      const payload=await response.json();
      if(!response.ok)throw new Error(payload.error||"Unable to update the advertising request.");
      setActionTarget(null);
      await reload();
    }catch(error){setNotice(error instanceof Error?error.message:"Unable to update the advertising request.");}
    finally{setSaving(false);}
  }
  async function clearLegacyRequests() {
    setSaving(true);setNotice("");
    try {
      const response=await fetch("/api/recruitment/ad-requests?scope=legacy&confirm=yes",{
        method:"DELETE",
        headers:headers(token)
      });
      const payload=await response.json();
      if(!response.ok)throw new Error(payload.error||"Unable to clear legacy advertising requests.");
      setNotice(`${Number(payload.deleted||0)} old advertising requests cleared. New request tracking was preserved.`);
      await reload();
    } catch(error) {
      setNotice(error instanceof Error?error.message:"Unable to clear legacy advertising requests.");
    } finally { setSaving(false); }
  }
  return <section className="ad-request-view">
    <section className="ad-request-hero">
      <div><span>MY AD WORKSPACE</span><h2>{primaryTitle}</h2><p>{primaryDescription}</p></div>
      <div className="ad-request-kpis"><article><b>{primaryRequests.length}</b><small>Needs me</small></article><article><b>{myOpen.length}</b><small>My active</small></article><article><b>{closedRequests.length}</b><small>Closed history</small></article></div>
      <div className="ad-request-hero-actions">
        {data?.isOwner&&legacyRequests.length?<button className="secondary-action" disabled={saving} onClick={()=>void clearLegacyRequests()}>Clear {legacyRequests.length} old requests</button>:null}
        {permissions.has("create")&&!data?.isOwner&&!(permissions.has("approve")&&permissions.has("publish"))?<button className="primary-action" onClick={openForm}>Request New Ad</button>:null}
      </div>
    </section>
    {notice?<p className="connection-notice">{notice}</p>:null}
    <section className="content-card leads-card ad-request-register">
      <div className="request-section-head"><div><span>{isWorkflowOperator?"ACTION QUEUE":"REQUEST TRACKER"}</span><h3>{primaryTitle}</h3><p>{primaryDescription}</p></div><label>Search requests<input value={search} onChange={(event)=>setSearch(event.target.value)} placeholder="ID, station, role or requester…"/></label></div>
      <RequestTable items={primaryRequests} empty={isWorkflowOperator?"Nothing currently needs your action.":"You have no active ad requests."}/>
    </section>
    {isWorkflowOperator&&myOpenSecondary.length?<section className="content-card leads-card ad-request-register"><div className="request-section-head"><div><span>REQUESTED BY ME</span><h3>My active requests</h3><p>Track the approval and publishing progress of requests you submitted.</p></div><b>{myOpenSecondary.length}</b></div><RequestTable items={myOpenSecondary} empty="You have no active requests."/></section>:null}
    {(permissions.has("view_all")||permissions.has("view_scoped"))&&otherActive.length?<details className="content-card request-archive-section"><summary><span><b>Other active requests in my scope</b><small>Visible for awareness; not currently assigned to you.</small></span><strong>{otherActive.length}</strong></summary><RequestTable items={otherActive} empty="No other active requests."/></details>:null}
    <details className="content-card request-archive-section"><summary><span><b>Closed request history</b><small>Completed, rejected and cancelled requests are kept out of the working queue.</small></span><strong>{closedRequests.length}</strong></summary><RequestTable items={closedRequests} empty="No closed requests."/></details>
    {actionTarget?<div className="modal-backdrop" onMouseDown={(event)=>{if(event.currentTarget===event.target&&!saving)setActionTarget(null);}}><section className={`modal request-action-modal ${actionTarget.action==="publish"&&actionTarget.request.request_type==="new_ad"?"meta-builder-modal":""}`} role="dialog" aria-modal="true"><header className="modal-header"><div><h2>{actionTarget.action==="publish"&&actionTarget.request.request_type==="new_ad"?"Create Meta recruitment ad":adRequestActionLabels[actionTarget.action]||statusLabel(actionTarget.action)}</h2><p>{actionTarget.request.request_id} · {actionTarget.request.recruitment_locations?.code||"—"} / {actionTarget.request.recruitment_roles?.code||"—"}</p></div><button disabled={saving} onClick={()=>setActionTarget(null)}>×</button></header>{actionTarget.action==="publish"&&actionTarget.request.request_type==="new_ad"?<><div className="meta-publish-tabs"><button className={publishMode==="api"?"selected":""} onClick={()=>setPublishMode("api")}>Create in Meta</button><button className={publishMode==="manual"?"selected":""} onClick={()=>setPublishMode("manual")}>Manual fallback</button></div>{publishMode==="api"?<div className="meta-builder-body"><div className="meta-builder-safety"><b>Safe launch</b><span>Employment category · {metaAudience?`${metaAudience.stationCode} local audience · ${metaDraft.audienceRadiusKm||15} km from Station Contacts`:"Station audience loading"} · approved ₹{Number(actionTarget.request.requested_budget||0).toLocaleString("en-IN")}/day · created paused</span></div>{metaCatalogLoading?<p className="meta-catalog-state">Loading Meta account, forms and campaigns…</p>:metaCatalog?<p className="meta-catalog-state"><b>{metaCatalog.accountName}</b> · {metaCatalog.pageName} · {metaCatalog.forms?.length||0} instant forms available</p>:null}<div className="meta-builder-grid">{metaAudience?<section className="wide meta-audience-card"><div><span>AUDIENCE SOURCE</span><b>{metaAudience.stationCode} — {metaAudience.stationName}</b><small>{metaAudience.address||"Station contact coordinates verified"} · {Number(metaAudience.latitude).toFixed(5)}, {Number(metaAudience.longitude).toFixed(5)}</small></div><label>Radius<select value={metaDraft.audienceRadiusKm||"15"} onChange={(event)=>setMetaDraft({...metaDraft,audienceRadiusKm:event.target.value,adSetName:`${actionTarget.request.recruitment_locations?.code||"STATION"}_${actionTarget.request.recruitment_roles?.code||"ROLE"}_Local_${event.target.value}KM`})}>{[15,16,17,18].map((radius)=><option key={radius} value={String(radius)}>{radius} km</option>)}</select></label></section>:null}<label>Campaign setup<select value={metaDraft.campaignMode||"new"} onChange={(event)=>setMetaDraft({...metaDraft,campaignMode:event.target.value})}><option value="new">Create new campaign</option><option value="existing">Use existing campaign</option></select></label>{metaDraft.campaignMode==="existing"?<label>Employment lead campaign<select value={metaDraft.campaignId||""} onChange={(event)=>setMetaDraft({...metaDraft,campaignId:event.target.value,campaignName:metaCatalog?.campaigns?.find((item:any)=>item.id===event.target.value)?.name||""})}><option value="">Choose campaign</option>{(metaCatalog?.campaigns??[]).map((item:any)=><option value={item.id} key={item.id}>{item.name} · {statusLabel(item.effectiveStatus)}</option>)}</select></label>:<label>Campaign name<input value={metaDraft.campaignName||""} onChange={(event)=>setMetaDraft({...metaDraft,campaignName:event.target.value})}/></label>}<label>Instant lead form<select value={metaDraft.formId||""} onChange={(event)=>setMetaDraft({...metaDraft,formId:event.target.value})}><option value="">Choose form</option>{(metaCatalog?.forms??[]).map((item:any)=><option value={item.id} key={item.id}>{item.name} · {statusLabel(item.status)}</option>)}</select></label><label>Call to action<select value={metaDraft.callToAction||"APPLY_NOW"} onChange={(event)=>setMetaDraft({...metaDraft,callToAction:event.target.value})}><option value="APPLY_NOW">Apply Now</option><option value="SIGN_UP">Sign Up</option><option value="LEARN_MORE">Learn More</option></select></label><label className="wide">Primary text<textarea rows={3} value={metaDraft.primaryText||""} onChange={(event)=>setMetaDraft({...metaDraft,primaryText:event.target.value})}/></label><label>Headline<input value={metaDraft.headline||""} onChange={(event)=>setMetaDraft({...metaDraft,headline:event.target.value})}/></label><label>Description<input value={metaDraft.description||""} onChange={(event)=>setMetaDraft({...metaDraft,description:event.target.value})}/></label><label className="wide">Poster HTTPS link<input value={metaDraft.posterUrl||""} onChange={(event)=>setMetaDraft({...metaDraft,posterUrl:event.target.value})}/></label><label className="wide">Destination link<input value={metaDraft.destinationUrl||""} onChange={(event)=>setMetaDraft({...metaDraft,destinationUrl:event.target.value})}/></label><details className="wide meta-builder-advanced"><summary>Names and delivery details</summary><div><label>Ad name<input value={metaDraft.adName||""} onChange={(event)=>setMetaDraft({...metaDraft,adName:event.target.value})}/></label><label>Ad set name<input value={metaDraft.adSetName||""} onChange={(event)=>setMetaDraft({...metaDraft,adSetName:event.target.value})}/></label><label>Creative name<input value={metaDraft.creativeName||""} onChange={(event)=>setMetaDraft({...metaDraft,creativeName:event.target.value})}/></label><label>Duration<input value={`${actionTarget.request.days_required||metaDraft.daysRequired||0} days`} disabled/></label></div></details></div><div className="meta-ad-preview"><span>PREVIEW</span>{metaDraft.posterUrl?<img src={metaDraft.posterUrl} alt="Recruitment ad preview"/>:<div className="meta-preview-empty">Poster preview</div>}<article><small>Sponsored · Apply Now</small><p>{metaDraft.primaryText||"Primary text"}</p><b>{metaDraft.headline||"Ad headline"}</b><em>{metaDraft.description||"Recruitment details"}</em></article></div></div>:<div className="form-grid manual-publish-fields"><label>Meta Ad ID<input value={metaAdId} onChange={(event)=>setMetaAdId(event.target.value)} placeholder="Existing Meta Ad ID"/></label><label>Published ad URL<input value={publishedUrl} onChange={(event)=>setPublishedUrl(event.target.value)} placeholder="Meta Ads Manager or public link"/></label><p className="wide">Use this only for an ad already created outside DropX Recruitment.</p></div>}</>:null}<div className="form-grid action-remarks"><label className="wide">{actionTarget.action==="reject"?"Rejection reason":"Remarks"}<textarea value={remarks} onChange={(event)=>setRemarks(event.target.value)} placeholder={actionTarget.action==="reject"?"Required for requester visibility":"Optional lifecycle note"}/></label></div>{notice?<p className="connection-notice">{notice}</p>:null}<footer><button disabled={saving} onClick={()=>setActionTarget(null)}>Cancel</button><button className="primary-action" disabled={saving||(actionTarget.action==="publish"&&actionTarget.request.request_type==="new_ad"&&(metaCatalogLoading||(publishMode==="api"&&!metaAudience)))} onClick={()=>void submitAction()}>{saving?publishMode==="api"?"Creating in Meta…":"Saving…":actionTarget.action==="publish"&&actionTarget.request.request_type==="new_ad"&&publishMode==="api"?"Create paused ad":adRequestActionLabels[actionTarget.action]}</button></footer></section></div>:null}
  </section>;
}

function AdRequestForm({ token, options, stream, requestType, ad, directMode, close, afterSave }: {
  token: string;
  options: any;
  stream: "workforce" | "hr";
  requestType: "new_ad" | "budget_change" | "stop_ad" | "resume_ad";
  ad?: any;
  directMode: boolean;
  close: () => void;
  afterSave: () => Promise<void>;
}) {
  const [form, setForm] = useState<Record<string, string>>({
    locationId: "", roleId: "", requestedBudget: "", daysRequired: "", posterUrl: "",
    paymentOffer: "", locationDetails: "", notes: "", reason: ""
  });
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const availableRoles=(options.roles??[]).filter((item:any)=>item.stream===stream);
  async function submit() {
    setSaving(true); setNotice("");
    try {
      const response = await fetch("/api/recruitment/ad-requests", { method: "POST", headers: { ...headers(token), "Content-Type": "application/json" }, body: JSON.stringify({
        requestType, adId: ad?.id || null, oldBudget: ad?.daily_budget ?? null, ...form,
        requestedBudget: Number(form.requestedBudget) || null, daysRequired: Number(form.daysRequired) || null
      }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to apply this ad change.");
      await afterSave();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to apply this ad change.");
    } finally { setSaving(false); }
  }
  const title = requestType === "new_ad" ? "Request New Ad" : requestType === "budget_change" ? (directMode ? "Change Daily Budget" : "Request Budget Change") : requestType === "resume_ad" ? (directMode ? "Resume Ad" : "Request Ad Resume") : (directMode ? "Pause Ad" : "Request Ad Pause");
  return <div className="modal-backdrop"><section className="modal request-modal"><header className="modal-header"><div><h2>{title}</h2><p>{ad ? `${ad.ad_name}${directMode ? " · this change will be applied immediately." : ""}` : `This request will follow the configured ${stream === "hr" ? "HR" : "Workforce"} approval workflow.`}</p></div><button onClick={close}>×</button></header>
    <div className="form-grid">
      {requestType==="new_ad"?<><label>Station<select value={form.locationId} onChange={(event) => setForm({...form, locationId:event.target.value})}><option value="">Select station</option>{(options.locations ?? []).map((item:any)=><option value={item.id} key={item.id}>{item.code} — {item.name}</option>)}</select></label>
      <label>Designation<select value={form.roleId} onChange={(event) => setForm({...form, roleId:event.target.value})}><option value="">Select role</option>{availableRoles.map((item:any)=><option value={item.id} key={item.id}>{item.code} — {item.name}</option>)}</select></label>
      <label>Budget per day<input type="number" value={form.requestedBudget} onChange={(event) => setForm({...form,requestedBudget:event.target.value})}/></label>
      <label>Number of days<input type="number" value={form.daysRequired} onChange={(event) => setForm({...form,daysRequired:event.target.value})}/></label>
      <label>Poster link<input value={form.posterUrl} onChange={(event) => setForm({...form,posterUrl:event.target.value})}/></label>
      <label>Payment offering<input value={form.paymentOffer} onChange={(event) => setForm({...form,paymentOffer:event.target.value})}/></label>
      <label className="wide">Location details<textarea value={form.locationDetails} onChange={(event) => setForm({...form,locationDetails:event.target.value})}/></label></>:null}
      {requestType==="budget_change"?<><label>Current daily budget<input value={String(ad?.daily_budget??"—")} disabled/></label><label>Requested daily budget<input type="number" value={form.requestedBudget} onChange={(event)=>setForm({...form,requestedBudget:event.target.value})}/></label></>:null}
      {requestType!=="new_ad"?<label className="wide">Reason<textarea value={form.reason} onChange={(event)=>setForm({...form,reason:event.target.value})}/></label>:null}
      <label className="wide">Notes<textarea value={form.notes} onChange={(event) => setForm({...form,notes:event.target.value})}/></label></div>
    {notice?<div className="error-banner" role="alert">{notice}</div>:null}
    <footer><button onClick={close}>Cancel</button><button className="primary-action" disabled={saving || (requestType==="new_ad" && (!form.locationId || !form.roleId || Number(form.requestedBudget)<100 || Number(form.daysRequired)<1 || !form.posterUrl.trim())) || (requestType==="budget_change" && !Number(form.requestedBudget)) || (["stop_ad","resume_ad"].includes(requestType) && !form.reason.trim())} onClick={() => void submit()}>{saving ? (directMode ? "Applying…" : "Submitting…") : (directMode ? "Apply change" : "Submit request")}</button></footer>
  </section></div>;
}
