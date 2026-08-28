"use client";

import { useEffect, useMemo, useState } from "react";

function authHeaders(token: string) {
  const previewProfileId = typeof window === "undefined" ? "" : localStorage.getItem("dropx_recruitment_preview_profile") ?? "";
  return { Authorization: `Bearer ${token}`, ...(previewProfileId ? { "X-DropX-Preview-Profile": previewProfileId } : {}) };
}
function relation<T>(value: T | T[] | null | undefined) { return Array.isArray(value) ? value[0] ?? null : value ?? null; }
function label(value: unknown) { return String(value ?? "").replaceAll("_", " ").replace(/\b\w/g, (part) => part.toUpperCase()); }

export function JobRequisitionsWorkspace({ data, token, options, canAdd, canEdit, canApprove, reload }: {
  data:any; token:string; options:any; canAdd:boolean; canEdit:boolean; canApprove:boolean; reload:()=>Promise<void>;
}) {
  const requisitions=data?.requisitions??[];
  const people=data?.people??[];
  const [open,setOpen]=useState(false);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState("");
  const hrRoles=(options.roles??[]).filter((item:any)=>item.stream==="hr");
  async function submit(event:React.FormEvent<HTMLFormElement>) {
    event.preventDefault();setBusy(true);setNotice("");
    try {
      const response=await fetch("/api/recruitment/requisitions",{method:"POST",headers:authHeaders(token),body:new FormData(event.currentTarget)});
      const body=await response.json();if(!response.ok)throw new Error(body.error||"Unable to create requisition.");
      setNotice(body.message||"Requisition saved.");setOpen(false);await reload();
    } catch(error){setNotice(error instanceof Error?error.message:"Unable to create requisition.");}
    finally{setBusy(false);}
  }
  async function setStatus(id:string,status:string) {
    setBusy(true);setNotice("");
    try {
      const response=await fetch("/api/recruitment/requisitions",{method:"PATCH",headers:{...authHeaders(token),"Content-Type":"application/json"},body:JSON.stringify({id,status})});
      const body=await response.json();if(!response.ok)throw new Error(body.error||"Unable to update requisition.");
      setNotice(`Requisition moved to ${label(status)}.`);await reload();
    }catch(error){setNotice(error instanceof Error?error.message:"Unable to update requisition.");}
    finally{setBusy(false);}
  }
  const openCount=requisitions.filter((item:any)=>item.status==="open").length;
  const openings=requisitions.filter((item:any)=>["open","pending_approval"].includes(item.status)).reduce((sum:number,item:any)=>sum+Number(item.openings||0)-Number(item.filled_positions||0),0);
  return <section className="ats-stack">
    <div className="ats-hero"><div><span>REQUISITION CONTROL</span><h2>Jobs, JDs and hiring ownership</h2><p>The TA tracker is organised by requisition, location and owner—without creating one sheet per role.</p></div>{canAdd?<button className="primary-action" onClick={()=>setOpen(!open)}>{open?"Close form":"+ New requisition"}</button>:null}</div>
    {notice?<div className="ats-notice" role="status">{notice}</div>:null}
    <div className="ats-metrics"><article><b>{requisitions.length}</b><span>Total requisitions</span></article><article><b>{openCount}</b><span>Open for applications</span></article><article><b>{openings}</b><span>Remaining positions</span></article><article><b>{requisitions.reduce((sum:number,item:any)=>sum+Number(item.applications?.total||0),0)}</b><span>Linked applications</span></article></div>
    {open?<form className="content-card ats-form" onSubmit={submit}>
      <header><div><h2>Create job requisition</h2><p>Paste a JD or upload PDF/DOCX/TXT. The readable text becomes the versioned comparison source.</p></div></header>
      <div className="ats-form-grid">
        <label>Job title *<input name="title" maxLength={180} required/></label>
        <label>Position *<select name="roleId" required><option value="">Select</option>{hrRoles.map((item:any)=><option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}</select></label>
        <label>Business location *<select name="locationId" required><option value="">Select</option>{(options.locations??[]).map((item:any)=><option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}</select></label>
        <label>Worker type *<select name="workerType" defaultValue="employee"><option value="employee">Employee</option><option value="contractor">Independent contractor</option></select></label>
        <label>Openings *<input name="openings" type="number" min="1" max="10000" defaultValue="1" required/></label>
        <label>Priority<select name="priority" defaultValue="normal"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="critical">Critical</option></select></label>
        <label>Hiring manager<select name="hiringManagerId"><option value="">Select</option>{people.map((item:any)=><option key={item.id} value={item.id}>{item.full_name||item.email}</option>)}</select></label>
        <label>TA owner<select name="recruiterId"><option value="">Current user</option>{people.map((item:any)=><option key={item.id} value={item.id}>{item.full_name||item.email}</option>)}</select></label>
        <label>Target joining date<input name="targetJoiningDate" type="date"/></label>
        <label>Experience from (years)<input name="experienceMin" type="number" min="0" max="60" step="0.5"/></label>
        <label>Experience to (years)<input name="experienceMax" type="number" min="0" max="60" step="0.5"/></label>
        <label>Education / certification<input name="education" maxLength={1000}/></label>
        <label>Salary from (INR)<input name="salaryMin" type="number" min="0" step="1"/></label>
        <label>Salary to (INR)<input name="salaryMax" type="number" min="0" step="1"/></label>
        <label className="wide">Must-have skills<input name="mustHaveSkills" placeholder="Comma separated, e.g. team handling, last-mile operations"/></label>
        <label className="wide">Preferred skills<input name="preferredSkills" placeholder="Comma separated"/></label>
        <label className="wide">Planned sources<input name="sourceChannels" placeholder="Meta, Indeed, Naukri, LinkedIn, referral, manual CV"/></label>
        <label className="wide">Upload JD<input name="jdFile" type="file" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"/></label>
        <label className="wide">Or paste job description<textarea name="jdText" rows={10} placeholder="Responsibilities, must-haves, experience, location, work pattern and success measures…"/></label>
        <label>Save as<select name="status" defaultValue="draft"><option value="draft">Draft</option><option value="open">Submit to open</option></select></label>
      </div>
      <div className="ats-form-actions"><button type="submit" className="primary-action" disabled={busy}>{busy?"Saving…":"Save requisition"}</button></div>
    </form>:null}
    <section className="content-card ats-table-card"><header><div><h2>Requisition register</h2><p>HR executives with Edit access can update scoped role status. Opening a new requisition remains approval controlled; an approved role can be paused and reopened by HR.</p></div></header><div className="table-scroll"><table><thead><tr><th>Requisition</th><th>Role / location</th><th>Category</th><th>Hiring</th><th>Applications</th><th>Status</th><th>Control</th></tr></thead><tbody>{requisitions.map((item:any)=>{const role=relation(item.recruitment_roles);const location=relation(item.recruitment_locations);return <tr key={item.id}><td><b>{item.requisition_code}</b><span>{item.title}</span><small>JD v{item.version}{item.jd_file_name?` · ${item.jd_file_name}`:" · pasted JD"}</small></td><td><b>{role?.name||"Unmapped"}</b><small>{location?.code||"—"} · {location?.name||"No location"}</small></td><td>{label(item.worker_type)}<small>{label(item.priority)} priority</small></td><td><b>{Math.max(0,Number(item.openings)-Number(item.filled_positions))} remaining</b><small>{item.hiring_manager?.full_name||item.recruiter?.full_name||"Owner not set"}</small></td><td><b>{item.applications?.total||0}</b><small>{item.applications?.active||0} active · {item.applications?.hired||0} hired</small></td><td><em className={`ats-status ats-${item.status}`}>{label(item.status)}</em></td><td>{canEdit?<div className="ats-row-actions">{item.status==="draft"?<button disabled={busy} onClick={()=>void setStatus(item.id,"pending_approval")}>Submit</button>:null}{item.status==="pending_approval"&&canApprove?<button disabled={busy} onClick={()=>void setStatus(item.id,"open")}>Approve & open</button>:null}{item.status==="open"?<button disabled={busy} onClick={()=>void setStatus(item.id,"on_hold")}>Put on hold</button>:null}{item.status==="on_hold"?<button disabled={busy} onClick={()=>void setStatus(item.id,"open")}>Reopen</button>:null}{!["closed","cancelled"].includes(item.status)?<button disabled={busy} onClick={()=>void setStatus(item.id,"closed")}>Close</button>:null}</div>:"—"}</td></tr>})}{!requisitions.length?<tr><td colSpan={7}>No job requisitions yet.</td></tr>:null}</tbody></table></div></section>
  </section>;
}

function ApplicationTable({ applications, selectedId, select, handoff, busy }: { applications:any[]; selectedId?:string; select?:(item:any)=>void; handoff?:(item:any)=>void; busy?:boolean }) {
  return <div className="table-scroll"><table><thead><tr><th>Candidate</th><th>Requisition</th><th>Source</th><th>Resume</th><th>Fit review</th><th>People handoff</th></tr></thead><tbody>{applications.map((item:any)=>{const lead=relation(item.recruitment_leads);const req=relation(item.recruitment_job_requisitions);return <tr key={item.id} className={selectedId===item.id?"selected-row":""} onClick={()=>select?.(item)}><td><b>{lead?.full_name||"Unnamed"}</b><small>{lead?.email||lead?.phone||"No contact"}</small></td><td><b>{req?.requisition_code||"—"}</b><small>{req?.title||"No requisition"}</small></td><td>{label(item.source)}<small>{new Date(item.applied_at).toLocaleDateString("en-IN")}</small></td><td>{item.resume_file_name||"Missing"}</td><td>{item.latestScreening?<><b>{item.latestScreening.fit_score ?? "—"}/100</b><small>{label(item.latestScreening.recommendation)}</small></>:"Not analysed"}</td><td>{item.transferred_at?<><b>Sent to People</b><small>{label(item.people_worker_type)}</small></>:handoff?<button className="ats-handoff-action" disabled={busy||lead?.status!=="joined"} onClick={(event)=>{event.stopPropagation();handoff(item);}}>{lead?.status==="joined"?"Send to People":"Awaiting Joined"}</button>:"Pending joining"}</td></tr>})}{!applications.length?<tr><td colSpan={6}>No applications in this view.</td></tr>:null}</tbody></table></div>;
}

export function ResumeIntakeWorkspace({ data, token, canAdd, canEdit, reload, openCandidate }: { data:any;token:string;canAdd:boolean;canEdit:boolean;reload:()=>Promise<void>;openCandidate?:(id:string)=>void }) {
  const applications=data?.applications??[];const requisitions=data?.requisitions??[];
  const [busy,setBusy]=useState(false);const[notice,setNotice]=useState("");
  const [database,setDatabase]=useState<any>({candidates:[],total:0,page:1,limit:50,statuses:[],sources:[]});
  const [databaseBusy,setDatabaseBusy]=useState(false);
  const [databaseError,setDatabaseError]=useState("");
  const [candidateSearch,setCandidateSearch]=useState("");
  const [candidateStatus,setCandidateStatus]=useState("");
  const [candidateSource,setCandidateSource]=useState("");
  const [resumeOnly,setResumeOnly]=useState(false);
  const [candidatePage,setCandidatePage]=useState(1);
  useEffect(()=>{
    const controller=new AbortController();
    const timer=window.setTimeout(async()=>{
      setDatabaseBusy(true);setDatabaseError("");
      try{
        const params=new URLSearchParams({page:String(candidatePage),limit:"50"});
        if(candidateSearch.trim())params.set("search",candidateSearch.trim());
        if(candidateStatus)params.set("status",candidateStatus);
        if(candidateSource)params.set("source",candidateSource);
        const response=await fetch(`/api/recruitment/candidates?${params}`,{headers:authHeaders(token),cache:"no-store",signal:controller.signal});
        const body=await response.json();if(!response.ok)throw new Error(body.error||"Unable to load candidate database.");setDatabase(body);
      }catch(error){if(!(error instanceof DOMException&&error.name==="AbortError"))setDatabaseError(error instanceof Error?error.message:"Unable to load candidate database.");}
      finally{if(!controller.signal.aborted)setDatabaseBusy(false);}
    },250);
    return()=>{window.clearTimeout(timer);controller.abort();};
  },[candidatePage,candidateSearch,candidateSource,candidateStatus,token]);
  async function submit(event:React.FormEvent<HTMLFormElement>){event.preventDefault();setBusy(true);setNotice("");try{const response=await fetch("/api/recruitment/applications",{method:"POST",headers:authHeaders(token),body:new FormData(event.currentTarget)});const body=await response.json();if(!response.ok)throw new Error(body.error||"Unable to add candidate.");setNotice(body.message||"Candidate added.");event.currentTarget.reset();await reload();}catch(error){setNotice(error instanceof Error?error.message:"Unable to add candidate.");}finally{setBusy(false);}}
  async function handoff(item:any){setBusy(true);setNotice("");try{const response=await fetch("/api/recruitment/applications",{method:"PATCH",headers:{...authHeaders(token),"Content-Type":"application/json"},body:JSON.stringify({applicationId:item.id,action:"send_to_people"})});const body=await response.json();if(!response.ok)throw new Error(body.error||"Unable to send candidate to People.");setNotice(body.message||"Candidate sent to People.");await reload();}catch(error){setNotice(error instanceof Error?error.message:"Unable to send candidate to People.");}finally{setBusy(false);}}
  const visibleCandidates=(database.candidates??[]).filter((candidate:any)=>!resumeOnly||candidate.hasResume);
  const sourceCatalog=["linkedin","referral","naukri","email","walk_in","cv_pool","meta","indeed","sheets_migration","meta_sheet_backfill","other"];
  const sources:string[]=[...new Set<string>([...sourceCatalog,...(database.sources??[]).map((item:any)=>String(item.value||"")),...(database.candidates??[]).map((candidate:any)=>String(candidate.application?.source||candidate.source||""))].filter(Boolean))];
  return <section className="ats-stack"><div className="ats-hero"><div><span>UNIFIED TALENT DATABASE</span><h2>Every candidate, resume and decision in one place</h2><p>Manual LinkedIn profiles, referrals, Meta, Indeed and CV uploads follow the same screening, interview, offer and joining lifecycle.</p></div></div>{notice?<div className="ats-notice">{notice}</div>:null}
    <section className="content-card candidate-database"><header><div><h2>Candidate database</h2><p>{Number(database.total||0).toLocaleString("en-IN")} scoped HR candidates · source, resume, feedback, delivery health and next action</p></div><b>{databaseBusy?"Refreshing…":`${visibleCandidates.length} shown`}</b></header><div className="candidate-database-filters"><input aria-label="Search candidate database" placeholder="Search name, mobile, email, city, PIN or source…" value={candidateSearch} onChange={(event)=>{setCandidatePage(1);setCandidateSearch(event.target.value);}}/><select aria-label="Candidate status" value={candidateStatus} onChange={(event)=>{setCandidatePage(1);setCandidateStatus(event.target.value);}}><option value="">All lifecycle stages</option>{(database.statuses??[]).map((status:any)=><option value={status.value} key={status.value}>{status.label||label(status.value)}</option>)}</select><select aria-label="Candidate source" value={candidateSource} onChange={(event)=>{setCandidatePage(1);setCandidateSource(event.target.value);}}><option value="">All sources</option>{sources.map((source)=><option value={source} key={source}>{label(source)}</option>)}</select><label title="This narrows the loaded page; use search/source/status first for the complete database"><input type="checkbox" checked={resumeOnly} onChange={(event)=>setResumeOnly(event.target.checked)}/> Resume-ready on this page</label></div>{databaseError?<div className="ats-notice">{databaseError}</div>:null}<div className="table-scroll"><table><thead><tr><th>Candidate</th><th>Source / role</th><th>Lifecycle</th><th>Resume & feedback</th><th>Interview delivery</th><th>Owner / action</th></tr></thead><tbody>{visibleCandidates.map((candidate:any)=>{const interview=candidate.interviews?.latest;return <tr key={candidate.id}><td><b>{candidate.full_name||"Unnamed"}</b><small>{candidate.phone||candidate.email||"No contact"}</small><small>{candidate.city||"City not captured"}{candidate.post_code?` · ${candidate.post_code}`:" · PIN not captured"} · {candidate.recruitment_locations?.code||"No station"}</small></td><td><b>{label(candidate.application?.source||candidate.source||"unknown")}</b><small>{candidate.recruitment_roles?.name||"Unmapped role"}</small><small>{candidate.application?.recruitment_job_requisitions?.requisition_code||candidate.ad_name||"No requisition"}</small></td><td><em className={`ats-status ats-${candidate.status}`}>{label(candidate.status)}</em><small>Next: {candidate.journey?.nextAction}</small>{(candidate.journey?.blockers??[]).map((blocker:string)=><small className="ats-warning" key={blocker}>! {blocker}</small>)}</td><td><b>{candidate.hasResume?(candidate.resumeFileName||"Resume available"):"Resume missing"}</b><small>{candidate.latestFeedback?.remarks||candidate.latestScreening?.remarks||"No feedback recorded"}</small><small>{candidate.latestFeedback?.actorEmail||candidate.latestScreening?.actorEmail||"—"}</small></td><td>{interview?<><b>Round {interview.round_no} · {label(interview.status)}</b><small>{interview.calendar_event_id?"✓ Calendar":"! No calendar"} · {interview.meet_link?"✓ Meet":"! No Meet"}</small><small>{interview.scheduled_at?new Date(interview.scheduled_at).toLocaleString("en-IN"):"Schedule missing"}</small></>:"No interview scheduled"}</td><td><b>{candidate.assigned_profile?.full_name||candidate.last_updated_profile?.full_name||"Unassigned"}</b><small>{candidate.updated_at?new Date(candidate.updated_at).toLocaleString("en-IN"):"—"}</small>{openCandidate?<button className="ats-open-profile" onClick={()=>openCandidate(candidate.id)}>Open full profile</button>:null}</td></tr>})}{!databaseBusy&&!visibleCandidates.length?<tr><td colSpan={6}>No candidates match this database view.</td></tr>:null}</tbody></table></div><footer className="candidate-database-pager"><button disabled={candidatePage<=1||databaseBusy} onClick={()=>setCandidatePage((value)=>Math.max(1,value-1))}>Previous</button><span>Page {candidatePage} of {Math.max(1,Math.ceil(Number(database.total||0)/50))}</span><button disabled={candidatePage*50>=Number(database.total||0)||databaseBusy} onClick={()=>setCandidatePage((value)=>value+1)}>Next</button></footer></section>
    {canAdd?<form className="content-card ats-form" onSubmit={submit}><header><div><h2>Add candidate profile</h2><p>Use for referral, LinkedIn, Naukri, email or an existing CV pool. The selected source remains visible throughout the lifecycle.</p></div></header><div className="ats-form-grid"><label className="wide">Job requisition *<select name="requisitionId" required><option value="">Select</option>{requisitions.map((item:any)=><option key={item.id} value={item.id}>{item.requisition_code} — {item.title}</option>)}</select></label><label>Candidate source *<select name="source" required defaultValue="linkedin"><option value="linkedin">LinkedIn</option><option value="referral">Employee referral</option><option value="naukri">Naukri</option><option value="email">Email application</option><option value="walk_in">Walk-in</option><option value="cv_pool">Existing CV pool</option><option value="other">Other manual source</option></select></label><label>Candidate name *<input name="fullName" required/></label><label>Mobile<input name="phone" inputMode="numeric"/></label><label>Email<input name="email" type="email"/></label><label>City<input name="city"/></label><label className="wide">Resume *<input name="resume" type="file" required accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"/></label><label className="wide ats-confirm"><input type="checkbox" required/> I confirm this candidate profile is authorised for recruitment processing.</label></div><div className="ats-form-actions"><button className="primary-action" disabled={busy}>{busy?"Uploading…":"Create application"}</button></div></form>:null}
    <section className="content-card ats-table-card"><header><div><h2>Application register</h2><p>{applications.length} candidate applications from manual and connected sources. Joined candidates can be handed to People for final location, designation, manager and shift mapping.</p></div></header><ApplicationTable applications={applications} handoff={canEdit?handoff:undefined} busy={busy}/></section>
  </section>;
}

export function AiFitReviewWorkspace({ data, token, canAdd, canEdit, reload }: { data:any;token:string;canAdd:boolean;canEdit:boolean;reload:()=>Promise<void> }) {
  const applications=data?.applications??[];
  const [selected,setSelected]=useState<any>(applications[0]??null);
  const [results,setResults]=useState<any[]>([]);
  const [busy,setBusy]=useState(false);const[notice,setNotice]=useState("");const[note,setNote]=useState("");
  useEffect(()=>{if(!selected&&applications.length)setSelected(applications[0]);},[applications,selected]);
  useEffect(()=>{if(!selected)return;fetch(`/api/recruitment/applications/${selected.id}/screening`,{headers:authHeaders(token),cache:"no-store"}).then(async(response)=>{const body=await response.json();if(!response.ok)throw new Error(body.error);setResults(body.results??[]);}).catch((error)=>setNotice(error instanceof Error?error.message:"Unable to load reviews."));},[selected,token]);
  const latest=results[0]??selected?.latestScreening??null;
  async function analyse(){if(!selected)return;setBusy(true);setNotice("");try{const response=await fetch(`/api/recruitment/applications/${selected.id}/screening`,{method:"POST",headers:authHeaders(token)});const body=await response.json();if(!response.ok)throw new Error(body.error||"Unable to analyse fit.");setNotice("Evidence fit review completed. A human decision is still required.");setResults([body.result,...results]);await reload();}catch(error){setNotice(error instanceof Error?error.message:"Unable to analyse fit.");}finally{setBusy(false);}}
  async function decide(decision:string){if(!selected||!latest)return;setBusy(true);setNotice("");try{const response=await fetch(`/api/recruitment/applications/${selected.id}/screening`,{method:"PATCH",headers:{...authHeaders(token),"Content-Type":"application/json"},body:JSON.stringify({resultId:latest.id,decision,note})});const body=await response.json();if(!response.ok)throw new Error(body.error||"Unable to save review.");setNotice("Human review decision saved.");setNote("");const refreshed=await fetch(`/api/recruitment/applications/${selected.id}/screening`,{headers:authHeaders(token),cache:"no-store"});setResults((await refreshed.json()).results??[]);await reload();}catch(error){setNotice(error instanceof Error?error.message:"Unable to save review.");}finally{setBusy(false);}}
  const lead=relation(selected?.recruitment_leads);const req=relation(selected?.recruitment_job_requisitions);
  return <section className="ats-stack"><div className="ats-hero"><div><span>HUMAN-CONTROLLED AI REVIEW</span><h2>Resume evidence against the approved JD</h2><p>Contact details and protected-trait lines are removed before analysis. GPT never selects or rejects; recruiters verify evidence and decide.</p></div></div>{notice?<div className="ats-notice">{notice}</div>:null}
    <div className="ats-review-layout"><section className="content-card ats-table-card"><header><div><h2>Applications</h2><p>Select a resume linked to a requisition.</p></div></header><ApplicationTable applications={applications} selectedId={selected?.id} select={setSelected}/></section>
      <aside className="content-card ats-review-panel">{selected?<><header><div><h2>{lead?.full_name||"Candidate"}</h2><p>{req?.requisition_code} · {req?.title}</p></div>{canAdd?<button className="primary-action" disabled={busy||!selected.resume_file_name} onClick={()=>void analyse()}>{busy?"Analysing…":latest?"Run fresh analysis":"Analyse fit"}</button>:null}</header><div className="ats-safety-note"><b>Decision support only</b><span>Score means documented evidence coverage. It must not be used as an automatic rejection threshold.</span></div>{latest?<div className="ats-result"><div className="ats-score"><b>{latest.fit_score ?? "—"}</b><span>/100 evidence fit</span><em>{label(latest.recommendation)}</em></div><p>{latest.summary||"No summary available."}</p>{Array.isArray(latest.must_have_matches)&&latest.must_have_matches.length?<section><h3>Must-have evidence</h3>{latest.must_have_matches.map((item:any,index:number)=><div className={`ats-match match-${item.status}`} key={`${item.requirement}-${index}`}><b>{item.requirement}</b><em>{label(item.status)}</em><span>{item.evidence}</span></div>)}</section>:null}<div className="ats-result-columns"><section><h3>Strengths</h3><ul>{(latest.strengths??[]).map((item:string)=><li key={item}>{item}</li>)}</ul></section><section><h3>Evidence gaps</h3><ul>{(latest.gaps??[]).map((item:string)=><li key={item}>{item}</li>)}</ul></section></div><section><h3>Suggested interview questions</h3><ol>{(latest.interview_questions??[]).map((item:string)=><li key={item}>{item}</li>)}</ol></section>{canEdit?<div className="ats-human-review"><label>Human review note<textarea value={note} onChange={(event)=>setNote(event.target.value)} rows={3} placeholder="Verify evidence and record a job-related reason…"/></label><div><button disabled={busy} onClick={()=>void decide("advance")}>Advance</button><button disabled={busy} onClick={()=>void decide("hold")}>Hold</button><button className="danger-action" disabled={busy||note.trim().length<5} onClick={()=>void decide("decline")}>Decline</button></div>{latest.reviewer_decision?<small>Latest human decision: {label(latest.reviewer_decision)}</small>:null}</div>:null}</div>:<div className="ats-empty"><b>No fit review yet</b><p>Run analysis after verifying the resume belongs to this candidate and the JD is complete.</p></div>}</>:<div className="ats-empty"><b>Select an application</b></div>}</aside>
    </div>
  </section>;
}
