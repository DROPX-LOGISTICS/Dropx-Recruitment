"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  matchingMetaFormsForDesignation,
  recommendedMetaFormForDesignation
} from "@/lib/meta-form-matching";

import { META_MEDIA_ACCEPT, type MetaMediaKind } from "@/lib/meta-media";
import { uploadCreativeFile, type CreativePreview } from "@/lib/meta-media-upload";

type Workspace = "workforce" | "hr";
type Props = { token:string; stream:Workspace; options:any; close:()=>void; afterPublish:()=>Promise<void> };

function authHeaders(token:string){return {Authorization:`Bearer ${token}`,"Content-Type":"application/json"};}
function requestKey(){return typeof crypto!=="undefined"&&"randomUUID" in crypto?crypto.randomUUID().replaceAll("-",""):`${Date.now()}_${Math.random().toString(36).slice(2)}`;}
function ctaLabel(value:string){return value.replaceAll("_"," ").toLowerCase().replace(/^./,(letter)=>letter.toUpperCase());}

function PlacementCard({platform,placement,story,image,headline,copy,cta,width,height,kind="image"}:{platform:string;placement:string;story?:boolean;image:string;headline:string;copy:string;cta:string;width:number;height:number;kind?:MetaMediaKind}){
  return <article className={`placement-card ${story?"placement-story":"placement-feed"}`}>
    <header><span className={`platform-mark platform-${platform.toLowerCase()}`}>{platform.slice(0,1)}</span><div><b>DropX Logistics</b><small>{placement}</small></div><i>•••</i></header>
    {!story?<p className="placement-copy">{copy||"Your primary text appears here."}</p>:null}
    <div className="placement-media" style={!story?{aspectRatio:`${width} / ${height}`}:{}}>{kind==="video"?<video className="placement-art" src={image} controls playsInline preload="metadata" aria-label={`${platform} ${placement} video preview`}/>:<>{story?<img className="placement-backdrop" src={image} alt="" aria-hidden="true"/>:null}<img className="placement-art" src={image} alt={`${platform} ${placement} preview`}/></>}</div>
    {!story?<footer><div><small>RECRUIT.DROPXLOGISTICS.COM</small><b>{headline||"Your headline"}</b></div><em>{ctaLabel(cta)}</em></footer>:<em className="story-cta">{ctaLabel(cta)} ↑</em>}
  </article>;
}

export function PlacementGallery({image,headline,copy,cta,width,height,kind="image"}:{image:string;headline:string;copy:string;cta:string;width:number;height:number;kind?:MetaMediaKind}){
  const ratioLabel=width===height?"1:1 original":`${width}:${height} original`;
  return <section className="placement-preview-section">
    <header><div><span>LIVE CREATIVE PREVIEW</span><h3>Check every placement before publishing</h3></div><p>{kind==="video"?"Play the video and check its audio. Placement previews are estimates; Meta may adjust the final layout.":"Feed preserves the uploaded image. Story/Reels estimates the 9:16 background fill."}</p></header>
    <div className="placement-preview-grid">
      <PlacementCard platform="Instagram" placement={`Feed · ${ratioLabel}`} image={image} kind={kind} headline={headline} copy={copy} cta={cta} width={width} height={height}/>
      <PlacementCard platform="Instagram" placement="Story / Reels · 9:16 auto-fill" story image={image} kind={kind} headline={headline} copy={copy} cta={cta} width={width} height={height}/>
      <PlacementCard platform="Facebook" placement={`Feed · ${ratioLabel}`} image={image} kind={kind} headline={headline} copy={copy} cta={cta} width={width} height={height}/>
      <PlacementCard platform="Facebook" placement="Story · 9:16 auto-fill" story image={image} kind={kind} headline={headline} copy={copy} cta={cta} width={width} height={height}/>
    </div>
  </section>;
}

export default function MetaAdPublisher({token,stream,options,close,afterPublish}:Props){
  const [catalog,setCatalog]=useState<any>(null);
  const [audience,setAudience]=useState<any>(null);
  const [audienceLoading,setAudienceLoading]=useState(false);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [uploading,setUploading]=useState(false);
  const [notice,setNotice]=useState("");
  const [review,setReview]=useState<any>(null);
  const [clientRequestId]=useState(requestKey);
  const [posterPreview,setPosterPreview]=useState("");
  const [posterMeta,setPosterMeta]=useState<CreativePreview|null>(null);
  const fileInput=useRef<HTMLInputElement>(null);
  const uploadController=useRef<AbortController|null>(null);
  const [uploadStatus,setUploadStatus]=useState("");
  useEffect(()=>()=>uploadController.current?.abort(),[]);
  const locations=options?.locations??[];
  const roles=useMemo(()=>(options?.roles??[]).filter((item:any)=>item.stream===stream),[options,stream]);
  const [form,setForm]=useState<Record<string,any>>({
    locationId:"",roleId:"",campaignMode:"new",campaignId:"",campaignName:"",formId:"",dailyBudget:"300",daysRequired:"7",
    adName:"",adSetName:"",creativeName:"",primaryText:"",headline:"",description:"",imageHash:"",posterUrl:"",videoId:"",
    destinationUrl:"https://recruit.dropxlogistics.com",callToAction:"APPLY_NOW",audienceRadiusKm:"15",launchMode:"paused",confirmLive:false
  });

  useEffect(()=>{const controller=new AbortController();fetch(`/api/recruitment/meta-ad-builder?stream=${stream}`,{headers:{Authorization:`Bearer ${token}`},cache:"no-store",signal:controller.signal}).then(async(response)=>{const payload=await response.json();if(!response.ok)throw new Error(payload.error||"Unable to load Meta setup.");setCatalog(payload.catalog);}).catch((error)=>{if(error?.name!=="AbortError")setNotice(error instanceof Error?error.message:"Unable to load Meta setup.");}).finally(()=>setLoading(false));return()=>controller.abort();},[stream,token]);
  useEffect(()=>()=>{if(posterPreview.startsWith("blob:"))URL.revokeObjectURL(posterPreview);},[posterPreview]);

  const selectedLocation=locations.find((item:any)=>item.id===form.locationId);
  const selectedRole=roles.find((item:any)=>item.id===form.roleId);
  const matchedForms=useMemo(()=>matchingMetaFormsForDesignation(catalog?.forms??[],selectedRole??{}),[catalog?.forms,selectedRole?.code,selectedRole?.name,selectedRole?.aliases]);
  function update(key:string,value:any){setReview(null);setNotice("");if(key==="locationId")setAudience(null);setForm((current)=>({...current,[key]:value}));}
  useEffect(()=>{
    if(!form.locationId){setAudience(null);setAudienceLoading(false);return;}
    const controller=new AbortController();
    let active=true;
    setAudienceLoading(true);setAudience(null);
    fetch(`/api/recruitment/meta-ad-builder?stream=${stream}&audienceOnly=true&locationId=${encodeURIComponent(form.locationId)}`,{
      headers:{Authorization:`Bearer ${token}`},cache:"no-store",signal:controller.signal
    }).then(async(response)=>{
      const payload=await response.json();
      if(!response.ok)throw new Error(payload.error||"Unable to verify the station audience.");
      if(!active)return;
      setAudience(payload.audience);
      setForm((current)=>({...current,audienceRadiusKm:String(payload.audience?.radiusKm||15)}));
    }).catch((error)=>{
      if(active&&error?.name!=="AbortError"){setAudience(null);setNotice(error instanceof Error?error.message:"Unable to verify the station audience.");}
    }).finally(()=>{if(active)setAudienceLoading(false);});
    return()=>{active=false;controller.abort();};
  },[form.locationId,stream,token]);
  useEffect(()=>{if(!selectedLocation||!selectedRole)return;const date=new Date().toISOString().slice(0,10).replaceAll("-","");const code=`${String(selectedLocation.code).toUpperCase()}_${String(selectedRole.code).toUpperCase()}`;setForm((current)=>({...current,campaignName:`${stream==="hr"?"HR":"Workforce"} Recruitment · ${selectedRole.name}`,adName:`${code}_${date}`,adSetName:`${code}_Local_${current.audienceRadiusKm||15}KM`,creativeName:`${code}_Creative_${date}`,primaryText:`Join DropX Logistics as ${selectedRole.name} at ${selectedLocation.name}. Apply now.`,headline:`${selectedRole.name} openings at ${selectedLocation.name}`}));},[selectedLocation,selectedRole,stream]);
  useEffect(()=>{if(!selectedRole){setForm((current)=>({...current,formId:""}));return;}const matching=matchingMetaFormsForDesignation(catalog?.forms??[],selectedRole);const recommended=recommendedMetaFormForDesignation(catalog?.forms??[],selectedRole);setForm((current)=>({...current,formId:matching.some((item)=>item.id===current.formId)?current.formId:(recommended?.id||(matching.length===1?matching[0].id:""))}));},[catalog?.forms,selectedRole]);
  useEffect(()=>{if(!selectedLocation||!selectedRole)return;const code=`${String(selectedLocation.code).toUpperCase()}_${String(selectedRole.code).toUpperCase()}`;setForm((current)=>({...current,adSetName:`${code}_Local_${current.audienceRadiusKm||15}KM`}));},[form.audienceRadiusKm,selectedLocation,selectedRole]);

  async function uploadPoster(file:File){
    setReview(null);setNotice("");setUploading(true);setPosterPreview("");setPosterMeta(null);
    setForm(current=>({...current,imageHash:"",posterUrl:"",videoId:""}));
    uploadController.current?.abort();
    const controller=new AbortController();uploadController.current=controller;
    try{
      const result=await uploadCreativeFile({file,stream,headers:{Authorization:`Bearer ${token}`},signal:controller.signal,
        onPreview:preview=>{setPosterPreview(preview.url);setPosterMeta(preview);},onStatus:setUploadStatus});
      setForm(current=>({...current,imageHash:result.imageHash,posterUrl:result.previewUrl||"",videoId:result.videoId||""}));
      setNotice("Creative uploaded. Review the preview before publishing.");
    }catch(error){
      setForm(current=>({...current,imageHash:"",posterUrl:"",videoId:""}));setPosterPreview("");setPosterMeta(null);
      if(!controller.signal.aborted)setNotice(error instanceof Error?error.message:"Unable to upload the creative.");
    }finally{setUploading(false);}
  }

  const payload={stream,locationId:form.locationId,roleId:form.roleId,clientRequestId,launchMode:form.launchMode,confirmLive:form.confirmLive,draft:{campaignMode:form.campaignMode,campaignId:form.campaignId||null,campaignName:form.campaignName||null,formId:form.formId,dailyBudget:Number(form.dailyBudget),daysRequired:Number(form.daysRequired),adName:form.adName,adSetName:form.adSetName,creativeName:form.creativeName,primaryText:form.primaryText,headline:form.headline,description:form.description||null,imageHash:form.imageHash,videoId:form.videoId||null,posterUrl:form.posterUrl||null,destinationUrl:form.destinationUrl,callToAction:form.callToAction,audienceRadiusKm:Number(form.audienceRadiusKm)}};
  async function submit(validateOnly:boolean){setBusy(true);setNotice("");try{if(uploading)throw new Error("Wait for the creative upload to finish.");if(audienceLoading)throw new Error("Wait for the station audience to finish loading.");if(!audience)throw new Error("This station has no valid latitude/longitude in the Location Master.");const radius=Number(form.audienceRadiusKm);if(!Number.isInteger(radius)||radius<15||radius>18)throw new Error("Choose a station audience radius from 15 to 18 km.");if(!matchedForms.length)throw new Error(`No active Meta form matches ${selectedRole?.code||"this designation"}.`);if(!form.formId)throw new Error(`Choose a ${selectedRole?.code||"designation"}-matched Meta form.`);if(!form.imageHash)throw new Error("Upload an image or video before reviewing the ad.");const response=await fetch("/api/recruitment/meta-ad-builder",{method:"POST",headers:authHeaders(token),body:JSON.stringify({...payload,validateOnly,reviewedAudience:review?.audience})});const result=await response.json();if(!response.ok)throw new Error(result.error||"Unable to publish the Meta ad.");if(validateOnly)setReview(result.review);else{setNotice(`Meta ad ${result.status==="ACTIVE"?"is live":result.status==="SCHEDULED"?"is scheduled":result.status==="PAUSED"?"was created paused":`was created · Meta status: ${String(result.status||"unknown").toLowerCase().replaceAll("_"," ")}`}. Ad ID: ${result.metaAdId||"saved"}`);await afterPublish();}}catch(error){setNotice(error instanceof Error?error.message:"Unable to publish the Meta ad.");}finally{setBusy(false);}}

  return <div className="modal-backdrop meta-publisher-backdrop" onMouseDown={(event)=>{if(event.currentTarget===event.target&&!busy&&!uploading)close();}}><section className="modal meta-direct-publisher" role="dialog" aria-modal="true" aria-label={`Create ${stream} Meta ad`}>
    <header className="modal-header"><div><span>{stream==="hr"?"HR HIRING":"WORKFORCE HIRING"}</span><h2>Post a Meta lead ad</h2><p>Upload, preview and publish without leaving DropX Recruitment.</p></div><button disabled={busy||uploading} onClick={close}>×</button></header>
    {loading?<div className="publisher-loading"><span className="loader"/><b>Loading your Meta account, forms and campaigns…</b></div>:null}
    {!loading&&!review?<>
      <div className="publisher-grid">
        <label>Station<select value={form.locationId} onChange={(e)=>update("locationId",e.target.value)}><option value="">Select station</option>{locations.map((item:any)=><option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}</select></label>
        <label>Designation<select value={form.roleId} onChange={(e)=>update("roleId",e.target.value)}><option value="">Select {stream==="hr"?"HR position":"workforce role"}</option>{roles.map((item:any)=><option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}</select></label>
        <section className="meta-audience-card publisher-audience">
          <div>
            <span>VERIFIED LOCAL AUDIENCE · LOCATION MASTER</span>
            {audienceLoading?<b>Checking station coordinates…</b>:audience?<><b>{audience.stationCode} — {audience.stationName}</b><small>{audience.address||"Station address"}</small><small>{Number(audience.latitude).toFixed(5)}, {Number(audience.longitude).toFixed(5)} · coordinates are locked</small><a href={`https://www.google.com/maps?q=${audience.latitude},${audience.longitude}`} target="_blank" rel="noreferrer">Check station pin on map ↗</a></>:<><b>{form.locationId?"Audience unavailable":"Select a station"}</b><small>{form.locationId?"Add valid latitude and longitude in the Location Master before publishing.":"The station master will supply the audience coordinates."}</small></>}
          </div>
          <label>Radius<select value={form.audienceRadiusKm} disabled={!audience||audienceLoading} onChange={(e)=>update("audienceRadiusKm",e.target.value)}>{[15,16,17,18].map((radius)=><option key={radius} value={radius}>{radius} km</option>)}</select></label>
        </section>
        <label>Daily budget (₹)<input type="number" min="100" value={form.dailyBudget} onChange={(e)=>update("dailyBudget",e.target.value)}/></label>
        <label>Run for<input type="number" min="1" max="90" value={form.daysRequired} onChange={(e)=>update("daysRequired",e.target.value)}/><small>days · delivery stops automatically at the end</small></label>
        <label>Campaign<select value={form.campaignMode} onChange={(e)=>update("campaignMode",e.target.value)}><option value="new">Create new Employment campaign</option><option value="existing">Use existing Employment campaign</option></select></label>
        {form.campaignMode==="existing"?<label>Existing campaign<select value={form.campaignId} onChange={(e)=>update("campaignId",e.target.value)}><option value="">Select campaign</option>{(catalog?.campaigns??[]).map((item:any)=><option key={item.id} value={item.id}>{item.name} · {item.effectiveStatus}</option>)}</select></label>:<label>Campaign name<input value={form.campaignName} onChange={(e)=>update("campaignName",e.target.value)}/></label>}
        <label>Instant form<select value={form.formId} onChange={(e)=>update("formId",e.target.value)}><option value="">Select a form matching {selectedRole?.code||"designation"}</option>{matchedForms.map((item:any)=><option key={item.id} value={item.id}>{item.name}</option>)}</select><small>{selectedRole&&!matchedForms.length?`No active Meta form matches ${selectedRole.code}.`:"Only forms matching the selected designation are shown."}</small></label>
        <label>Call to action<select value={form.callToAction} onChange={(e)=>update("callToAction",e.target.value)}><option value="APPLY_NOW">Apply now</option><option value="SIGN_UP">Sign up</option><option value="LEARN_MORE">Learn more</option></select></label>
        <label className="publisher-ad-name">Ad name (Meta)<input value={form.adName} readOnly placeholder="Select station and designation"/><small>Convention: STATION_DESIGNATION_YYYYMMDD</small></label>
      </div>
      <div className="publisher-copy-grid">
        <div className="publisher-upload-wrap"><span>IMAGE OR VIDEO</span>
          <input ref={fileInput} type="file" accept={META_MEDIA_ACCEPT} onChange={event=>{const file=event.target.files?.[0];if(file)void uploadPoster(file);event.currentTarget.value="";}} hidden/>
          {posterMeta?.kind==="video"&&posterPreview?<div className="creative-video-upload"><video src={posterPreview} controls playsInline preload="metadata" aria-label="Uploaded recruitment video"/><button type="button" disabled={uploading} onClick={()=>fileInput.current?.click()}>Choose another file</button></div>:<button type="button" className={`publisher-upload ${posterPreview?"has-poster":""}`} disabled={uploading} onClick={()=>fileInput.current?.click()}>{posterPreview?<img src={posterPreview} alt="Uploaded recruitment image"/>:<i>＋</i>}<strong>{uploading?uploadStatus:posterPreview?"Replace creative":"Upload image or video"}</strong></button>}
          <small>Images up to 12 MB · MP4/MOV up to 50 MB · 1 second–3 minutes</small>
          {posterMeta?<small>{posterMeta.name} · {posterMeta.width}×{posterMeta.height}{posterMeta.duration?` · ${posterMeta.duration.toFixed(1)} seconds`:""}</small>:null}
          {uploading?<p role="status">{uploadStatus}</p>:null}
        </div>
        <div className="publisher-copy-fields"><label>Destination link<input type="url" value={form.destinationUrl} onChange={(e)=>update("destinationUrl",e.target.value)}/></label><label>Headline<input value={form.headline} onChange={(e)=>update("headline",e.target.value)}/></label><label>Primary text<textarea value={form.primaryText} onChange={(e)=>update("primaryText",e.target.value)}/></label><label>Description<input value={form.description} onChange={(e)=>update("description",e.target.value)} placeholder="Salary, shift or benefit (optional)"/></label></div>
      </div>
      {posterPreview?<PlacementGallery image={posterPreview} kind={posterMeta?.kind} headline={form.headline} copy={form.primaryText} cta={form.callToAction} width={posterMeta?.width||1} height={posterMeta?.height||1}/>:null}
      <details className="publisher-advanced"><summary>Advanced Meta names</summary><div><label>Ad set name<input value={form.adSetName} onChange={(e)=>update("adSetName",e.target.value)}/></label><label>Creative name<input value={form.creativeName} onChange={(e)=>update("creativeName",e.target.value)}/></label></div></details>
      <fieldset className="launch-choice"><legend>Launch state</legend><label><input type="radio" checked={form.launchMode==="paused"} onChange={()=>update("launchMode","paused")}/> Create paused <small>Review in Active Ads, then resume from DropX.</small></label><label><input type="radio" checked={form.launchMode==="live"} onChange={()=>update("launchMode","live")}/> Launch live <small>Starts spending after Meta accepts it.</small></label>{form.launchMode==="live"?<label className="live-confirm"><input type="checkbox" checked={form.confirmLive} onChange={(e)=>update("confirmLive",e.target.checked)}/> I confirm the budget and want this ad to start immediately.</label>:null}</fieldset>
    </>:null}
    {review?<section className="publisher-review"><div><span>FINAL REVIEW</span><h3>{review.station}</h3><p>{review.designation}</p></div><dl><span><dt>Workspace</dt><dd>{review.workspace==="hr"?"HR":"Workforce"}</dd></span><span><dt>Ad name</dt><dd>{form.adName}</dd></span><span><dt>Campaign</dt><dd>{review.campaign}</dd></span><span><dt>Form</dt><dd>{review.form}</dd></span><span><dt>Audience</dt><dd>{review.audience?.stationCode} · {review.audience?.radiusKm} km<br/>{review.audience?.address}<br/><a href={`https://www.google.com/maps?q=${review.audience?.latitude},${review.audience?.longitude}`} target="_blank" rel="noreferrer">{review.audience?.latitude}, {review.audience?.longitude} · View pin ↗</a></dd></span><span><dt>Budget</dt><dd>₹{Number(review.dailyBudget).toLocaleString("en-IN")}/day × {review.durationDays} days</dd></span><span><dt>Launch</dt><dd>{review.launchMode==="live"?"Start live":"Create paused"}</dd></span></dl>{posterPreview?<PlacementGallery image={posterPreview} kind={posterMeta?.kind} headline={form.headline} copy={form.primaryText} cta={form.callToAction} width={posterMeta?.width||1} height={posterMeta?.height||1}/>:null}</section>:null}
    {notice?<div className={notice.startsWith("Meta ad")||notice.startsWith("Creative uploaded")?"success-banner":"error-banner"}>{notice}</div>:null}
    <footer className="publisher-actions"><button disabled={busy||uploading} onClick={review?()=>setReview(null):close}>{review?"Back to edit":"Cancel"}</button>{!loading&&!review?<button className="primary-action" disabled={busy||uploading||audienceLoading||!audience||!form.imageHash} onClick={()=>void submit(true)}>{uploading?"Uploading…":audienceLoading?"Checking station…":busy?"Checking…":"Review ad"}</button>:null}{review&&!notice.startsWith("Meta ad")?<button className="primary-action" disabled={busy} onClick={()=>void submit(false)}>{busy?"Creating in Meta…":form.launchMode==="live"?"Confirm & launch live":"Confirm & create paused"}</button>:null}{notice.startsWith("Meta ad")?<button className="primary-action" onClick={close}>Done</button>:null}</footer>
  </section></div>;
}
