"use client";
import { recruitmentClientHeaders } from "@/lib/recruitment-client-headers";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  matchingMetaFormsForDesignation,
  recommendedMetaFormForDesignation
} from "@/lib/meta-form-matching";

import { META_MEDIA_ACCEPT, type MetaMediaKind } from "@/lib/meta-media";
import { uploadCreativeFile, type CreativePreview } from "@/lib/meta-media-upload";
import {
  META_AUDIENCE_RADIUS_DEFAULT_KM,
  isValidMetaAudienceRadius,
  metaAudienceAdSetName,
  metaAudienceRadiusLabel
} from "@/lib/meta-audience-radius";
import MetaAudienceRadiusPicker from "./MetaAudienceRadiusPicker";
import MetaLocationPinPicker from "./MetaLocationPinPicker";
import MetaCampaignCategoryPicker from "./MetaCampaignCategoryPicker";
import { matchesMetaCampaignCategory } from "@/lib/meta-campaign-category";
import styles from "./MetaPromotionsPanel.module.css";
import SearchableAdSelect from "./SearchableAdSelect";
import MetaPosterGuidance from "./MetaPosterGuidance";

type Workspace = "workforce" | "hr";
type Props = { token:string; stream:Workspace; options:any; close:()=>void; openPromotions?:(locationId:string)=>void; initialLocationId?:string; afterPublish:()=>Promise<void> };

function authHeaders(token:string){return {...recruitmentClientHeaders(token),"Content-Type":"application/json"};}
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
    <header><div><span>LIVE CREATIVE PREVIEW</span><h3>Check every placement before publishing</h3></div><p>{kind==="video"?"Play the video and check its audio. Placement previews are estimates; Meta may adjust the final layout.":"These previews preserve the full image. Stories/Reels use a 9:16 frame; other ratios have padding. Meta may crop or adapt the final ad, so check its final placement preview."}</p></header>
    <div className="placement-preview-grid">
      <PlacementCard platform="Instagram" placement={`Feed · ${ratioLabel}`} image={image} kind={kind} headline={headline} copy={copy} cta={cta} width={width} height={height}/>
      <PlacementCard platform="Instagram" placement="Story / Reels · 9:16 fit estimate" story image={image} kind={kind} headline={headline} copy={copy} cta={cta} width={width} height={height}/>
      <PlacementCard platform="Facebook" placement={`Feed · ${ratioLabel}`} image={image} kind={kind} headline={headline} copy={copy} cta={cta} width={width} height={height}/>
      <PlacementCard platform="Facebook" placement="Story · 9:16 fit estimate" story image={image} kind={kind} headline={headline} copy={copy} cta={cta} width={width} height={height}/>
    </div>
  </section>;
}

export default function MetaAdPublisher({token,stream,options,close,openPromotions,initialLocationId="",afterPublish}:Props){
  const dialog=useRef<HTMLDialogElement>(null);
  const body=useRef<HTMLDivElement>(null);
  useEffect(()=>{dialog.current?.showModal();},[]);
  const [catalog,setCatalog]=useState<any>(null);
  const [audience,setAudience]=useState<any>(null);
  const [audienceLoading,setAudienceLoading]=useState(false);
  const [audienceError,setAudienceError]=useState("");
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [uploading,setUploading]=useState(false);
  const [notice,setNotice]=useState("");
  const [review,setReview]=useState<any>(null);
  const [clientRequestId]=useState(requestKey);
  const [posterPreview,setPosterPreview]=useState("");
  const [posterMeta,setPosterMeta]=useState<CreativePreview|null>(null);
  const uploadController=useRef<AbortController|null>(null);
  const [uploadStatus,setUploadStatus]=useState("");
  useEffect(()=>()=>uploadController.current?.abort(),[]);
  const locations=options?.locations??[];
  const roles=useMemo(()=>(options?.roles??[]).filter((item:any)=>item.stream===stream),[options,stream]);
  const [form,setForm]=useState<Record<string,any>>({
    locationId:initialLocationId,roleId:"",campaignCategory:"EMPLOYMENT",campaignMode:"new",campaignId:"",campaignName:"",formId:"",dailyBudget:"300",daysRequired:"7",
    adName:"",adSetName:"",creativeName:"",primaryText:"",headline:"",description:"",imageHash:"",posterUrl:"",videoId:"",
    destinationUrl:"https://recruit.dropxlogistics.com",callToAction:"APPLY_NOW",audienceRadiusKm:String(META_AUDIENCE_RADIUS_DEFAULT_KM),customPin:null,launchMode:"paused",confirmLive:false
  });
  useEffect(()=>{body.current?.scrollTo({top:0});},[review]);

  useEffect(()=>{const controller=new AbortController();fetch(`/api/recruitment/meta-ad-builder?stream=${stream}`,{headers:{Authorization:`Bearer ${token}`},cache:"no-store",signal:controller.signal}).then(async(response)=>{const payload=await response.json();if(!response.ok)throw new Error(payload.error||"Unable to load Meta setup.");setCatalog(payload.catalog);}).catch((error)=>{if(error?.name!=="AbortError")setNotice(error instanceof Error?error.message:"Unable to load Meta setup.");}).finally(()=>setLoading(false));return()=>controller.abort();},[stream,token]);
  useEffect(()=>()=>{if(posterPreview.startsWith("blob:"))URL.revokeObjectURL(posterPreview);},[posterPreview]);

  const selectedLocation=locations.find((item:any)=>item.id===form.locationId);
  const selectedRole=roles.find((item:any)=>item.id===form.roleId);
  const matchedForms=useMemo(()=>matchingMetaFormsForDesignation(catalog?.forms??[],selectedRole??{}),[catalog?.forms,selectedRole?.code,selectedRole?.name,selectedRole?.aliases]);
  function update(key:string,value:any){setReview(null);setNotice("");if(key==="locationId"){setAudience(null);setAudienceError("");}setForm((current)=>({...current,[key]:value,...(key==="locationId"?{customPin:null}:{})}));}
  useEffect(()=>{
    if(!form.locationId){setAudience(null);setAudienceLoading(false);return;}
    const controller=new AbortController();
    let active=true;
    setAudienceLoading(true);setAudience(null);setAudienceError("");
    fetch(`/api/recruitment/meta-ad-builder?stream=${stream}&audienceOnly=true&locationId=${encodeURIComponent(form.locationId)}`,{
      headers:{Authorization:`Bearer ${token}`},cache:"no-store",signal:controller.signal
    }).then(async(response)=>{
      const payload=await response.json();
      if(!response.ok)throw new Error(payload.error||"Unable to verify the station audience.");
      if(!active)return;
      setAudience(payload.audience);
      // Loading the default pin must not overwrite the radius already chosen.
    }).catch((error)=>{
      if(active&&error?.name!=="AbortError"){setAudience(null);setAudienceError(error instanceof Error?error.message:"Unable to verify the station audience.");}
    }).finally(()=>{if(active)setAudienceLoading(false);});
    return()=>{active=false;controller.abort();};
  },[form.locationId,stream,token]);
  useEffect(()=>{if(!selectedLocation||!selectedRole)return;const date=new Date().toISOString().slice(0,10).replaceAll("-","");const code=`${String(selectedLocation.code).toUpperCase()}_${String(selectedRole.code).toUpperCase()}`;setForm((current)=>({...current,campaignName:`${stream==="hr"?"HR":"Workforce"} Recruitment · ${selectedRole.name}`,adName:`${code}_${date}`,adSetName:metaAudienceAdSetName(code,current.audienceRadiusKm),creativeName:`${code}_Creative_${date}`,primaryText:`Join DropX Logistics as ${selectedRole.name} at ${selectedLocation.name}. Apply now.`,headline:`${selectedRole.name} openings at ${selectedLocation.name}`}));},[selectedLocation,selectedRole,stream]);
  useEffect(()=>{if(!selectedRole){setForm((current)=>({...current,formId:""}));return;}const matching=matchingMetaFormsForDesignation(catalog?.forms??[],selectedRole);const recommended=recommendedMetaFormForDesignation(catalog?.forms??[],selectedRole);setForm((current)=>({...current,formId:matching.some((item)=>item.id===current.formId)?current.formId:(recommended?.id||(matching.length===1?matching[0].id:""))}));},[catalog?.forms,selectedRole]);
  useEffect(()=>{if(!selectedLocation||!selectedRole)return;const code=`${String(selectedLocation.code).toUpperCase()}_${String(selectedRole.code).toUpperCase()}`;setForm((current)=>({...current,adSetName:metaAudienceAdSetName(code,current.audienceRadiusKm)}));},[form.audienceRadiusKm,selectedLocation,selectedRole]);

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

  const payload={stream,locationId:form.locationId,roleId:form.roleId,clientRequestId,launchMode:form.launchMode,confirmLive:form.confirmLive,draft:{campaignCategory:form.campaignCategory,campaignMode:form.campaignMode,campaignId:form.campaignId||null,campaignName:form.campaignName||null,formId:form.formId,dailyBudget:Number(form.dailyBudget),daysRequired:Number(form.daysRequired),adName:form.adName,adSetName:form.adSetName,creativeName:form.creativeName,primaryText:form.primaryText,headline:form.headline,description:form.description||null,imageHash:form.imageHash,videoId:form.videoId||null,posterUrl:form.posterUrl||null,destinationUrl:form.destinationUrl,callToAction:form.callToAction,audienceRadiusKm:Number(form.audienceRadiusKm),customPin:form.customPin}};
  async function submit(validateOnly:boolean){setBusy(true);setNotice("");try{if(uploading)throw new Error("Wait for the creative upload to finish.");if(audienceLoading)throw new Error("Wait for the station audience to finish loading.");if(!audience&&!form.customPin)throw new Error("Choose an ad pin using location search or coordinates before reviewing.");if(!isValidMetaAudienceRadius(form.audienceRadiusKm))throw new Error("Choose an audience radius from 3 to 80 km.");if(!matchedForms.length)throw new Error(`No active Meta form matches ${selectedRole?.code||"this designation"}.`);if(!form.formId)throw new Error(`Choose a ${selectedRole?.code||"designation"}-matched Meta form.`);if(!form.imageHash)throw new Error("Upload an image or video before reviewing the ad.");const response=await fetch("/api/recruitment/meta-ad-builder",{method:"POST",headers:authHeaders(token),body:JSON.stringify({...payload,validateOnly,reviewedAudience:review?.audience})});const result=await response.json();if(!response.ok)throw new Error(result.error||"Unable to publish the Meta ad.");if(validateOnly)setReview(result.review);else{setNotice(`Meta ad ${result.status==="ACTIVE"?"is live":result.status==="SCHEDULED"?"is scheduled":result.status==="PAUSED"?"was created paused":`was created · Meta status: ${String(result.status||"unknown").toLowerCase().replaceAll("_"," ")}`}. Ad ID: ${result.metaAdId||"saved"}`);await afterPublish();}}catch(error){setNotice(error instanceof Error?error.message:"Unable to publish the Meta ad.");}finally{setBusy(false);}}

  return <dialog ref={dialog} className={`${styles.dialog} ${styles.createDialog}`} aria-labelledby="recruitment-ad-title" onCancel={event=>{event.preventDefault();if(!busy&&!uploading)close();}}>
    <header className={styles.header}><div><small>{stream==="hr"?"HR":"WORKFORCE"} · RECRUITMENT</small><h2 id="recruitment-ad-title">New lead ad</h2></div><button type="button" aria-label="Close recruitment ad" disabled={busy||uploading} onClick={close}>×</button></header>
    <div ref={body} className={styles.body}>
    {notice?<p className={styles.notice} role="status">{notice}</p>:null}
    {loading?<p role="status">Loading Meta forms and campaigns…</p>:null}
    {!loading&&!review?<fieldset className={styles.fields} disabled={busy||uploading}>
      <div className={`${styles.two} ${styles.mobileStack}`}>
        <label>Ad type<select value="recruitment" onChange={()=>openPromotions?.(form.locationId)}><option value="recruitment">Recruitment · instant form &amp; leads</option>{openPromotions?<option value="promotion">Service / customer promotion</option>:null}</select></label>
        <SearchableAdSelect label="Location" value={form.locationId} onChange={value=>update("locationId",value)} placeholder="Choose station / store" options={locations.map((item:any)=>({value:item.id,label:`${item.code} — ${item.name}`}))}/>
        <SearchableAdSelect label="Designation" value={form.roleId} onChange={value=>update("roleId",value)} placeholder={`Select ${stream==="hr"?"HR position":"workforce role"}`} options={roles.map((item:any)=>({value:item.id,label:`${item.code} — ${item.name}`}))}/>
        <div><SearchableAdSelect label="Instant form" disabled={!selectedRole} value={form.formId} onChange={value=>update("formId",value)} placeholder={selectedRole?`Select a form for ${selectedRole.code}`:"Select designation first"} options={matchedForms.map((item:any)=>({value:item.id,label:item.name}))}/>{selectedRole&&!matchedForms.length?<small role="status">No active Meta form matches {selectedRole.code}.</small>:null}</div>
      </div>
      <p className={styles.leadDestination}>Applications → <strong>{stream==="hr"?"HR · Candidates":"Workforce · All Leads"}</strong>{selectedLocation&&selectedRole?` · ${selectedLocation.code} / ${selectedRole.code}`:" · Choose a location and designation"}</p>
      <div className={styles.composer}>
        <section className={styles.creative} aria-label="Recruitment ad details">
          <h3>Ad details</h3>
          <div className={styles.two}><label>Daily budget (₹)<input type="number" min="100" value={form.dailyBudget} onChange={e=>update("dailyBudget",e.target.value)}/></label><label>Run for (days)<input type="number" min="1" max="90" value={form.daysRequired} onChange={e=>update("daysRequired",e.target.value)}/></label></div>
          <label>Headline<input value={form.headline} onChange={e=>update("headline",e.target.value)}/></label>
          <label>Ad text<textarea rows={3} value={form.primaryText} onChange={e=>update("primaryText",e.target.value)}/></label>
          <label>Image or video<input type="file" accept={META_MEDIA_ACCEPT} onChange={event=>{const file=event.target.files?.[0];if(file)void uploadPoster(file);event.currentTarget.value="";}}/><small>Images up to 12 MB · MP4/MOV up to 50 MB · 1 sec–3 min</small></label>
          <MetaPosterGuidance media={posterMeta}/>
          {uploading?<p role="status">{uploadStatus}</p>:null}
          {posterPreview?posterMeta?.kind==="video"?<video className={styles.preview} src={posterPreview} controls playsInline preload="metadata" aria-label="Recruitment video preview"/>:<img className={styles.preview} src={posterPreview} alt="Recruitment image preview"/>:null}
          <details className={styles.advanced}><summary>Campaign &amp; more options</summary><div className={styles.stack}>
            <label>Campaign<select value={form.campaignMode} onChange={e=>update("campaignMode",e.target.value)}><option value="new">Create new Leads campaign</option><option value="existing">Use existing Leads campaign</option></select></label>
            {form.campaignMode==="existing"?<SearchableAdSelect label="Existing campaign" value={form.campaignId} onChange={value=>update("campaignId",value)} placeholder="Select campaign" options={(catalog?.campaigns??[]).filter((item:any)=>matchesMetaCampaignCategory(item.specialAdCategories,form.campaignCategory)).map((item:any)=>({value:item.id,label:`${item.name} · ${item.effectiveStatus}`}))}/>:<label>Campaign name<input value={form.campaignName} onChange={e=>update("campaignName",e.target.value)}/></label>}
            <label>Call to action<select value={form.callToAction} onChange={e=>update("callToAction",e.target.value)}><option value="APPLY_NOW">Apply now</option><option value="SIGN_UP">Sign up</option><option value="LEARN_MORE">Learn more</option></select></label>
            <label>Destination link<input type="url" value={form.destinationUrl} onChange={e=>update("destinationUrl",e.target.value)}/></label>
            <label>Description<input value={form.description} onChange={e=>update("description",e.target.value)} placeholder="Salary, shift or benefit (optional)"/></label>
            <label>Ad name<input value={form.adName} readOnly placeholder="Select location and designation"/></label>
            <label>Ad set name<input value={form.adSetName} onChange={e=>update("adSetName",e.target.value)}/></label>
            <label>Creative name<input value={form.creativeName} onChange={e=>update("creativeName",e.target.value)}/></label>
          </div></details>
        </section>
        <section className={styles.audience} aria-label="Audience and location">
          <h3>Audience &amp; location</h3>
          <MetaCampaignCategoryPicker value={form.campaignCategory} accountCountry={catalog?.accountCountry} onChange={value=>{update("campaignCategory",value);update("campaignId","");}}/>
          {form.customPin?<small>Custom ad pin · {Number(form.customPin.latitude).toFixed(5)}, {Number(form.customPin.longitude).toFixed(5)}</small>:audienceLoading?<small role="status">Checking station coordinates… You can choose the radius now.</small>:audience?<small>{audience.stationCode} · {audience.source==="location_master"?"Location Master":"Saved ad pin"} · {Number(audience.latitude).toFixed(5)}, {Number(audience.longitude).toFixed(5)}</small>:<small role="status">{form.locationId?(audienceError||"Choose an ad pin below using location search or coordinates."):"Choose a station to load its pin."}</small>}
          <MetaAudienceRadiusPicker value={String(form.audienceRadiusKm)} disabled={!form.locationId} onChange={value=>update("audienceRadiusKm",value)}/>
          <MetaLocationPinPicker key={`pin-${form.locationId}`} token={token} station={audience} value={form.customPin} radiusKm={Number(form.audienceRadiusKm)} disabled={busy||!form.locationId} scope={{stream,locationId:form.locationId,roleId:form.roleId}} onChange={pin=>update("customPin",pin)}/>
        </section>
      </div>
      <div className={styles.two}>
        <label>Launch state<select value={form.launchMode} onChange={e=>{update("launchMode",e.target.value);update("confirmLive",false);}}><option value="paused">Create paused</option><option value="live">Launch live</option></select></label>
        <small className={styles.routingHint}>{form.launchMode==="live"?"Delivery starts after Meta accepts the ad.":"Review in Active Ads, then resume when ready."}</small>
      </div>
      {form.launchMode==="live"?<label className={styles.check}><input type="checkbox" checked={form.confirmLive} onChange={e=>update("confirmLive",e.target.checked)}/>I confirm the budget and want this ad to start immediately.</label>:null}
    </fieldset>:null}
    {review?<section className="publisher-review"><div><span>FINAL REVIEW</span><h3>{review.station}</h3><p>{review.designation}</p></div><dl><span><dt>Workspace</dt><dd>{review.workspace==="hr"?"HR":"Workforce"}</dd></span><span><dt>Ad name</dt><dd>{form.adName}</dd></span><span><dt>Campaign</dt><dd>{review.campaign}<br/>{review.campaignCategory}</dd></span><span><dt>Form</dt><dd>{review.form}</dd></span><span><dt>Audience</dt><dd>{review.audience?.stationCode} · 0–{review.audience?.radiusKm} km<br/>{metaAudienceRadiusLabel(review.audience?.radiusKm)}<br/>{review.audience?.address}<br/><a href={`https://www.google.com/maps?q=${review.audience?.latitude},${review.audience?.longitude}`} target="_blank" rel="noreferrer">{review.audience?.latitude}, {review.audience?.longitude} · View pin ↗</a></dd></span><span><dt>Budget</dt><dd>₹{Number(review.dailyBudget).toLocaleString("en-IN")}/day × {review.durationDays} days</dd></span><span><dt>Launch</dt><dd>{review.launchMode==="live"?"Start live":"Create paused"}</dd></span></dl><p>{review.metaAudienceValidated?"Meta accepted this campaign and audience in a validation-only check. Ad review still applies.":"Meta will validate the campaign and exact audience before the ad can start spending."}</p>{posterPreview?<PlacementGallery image={posterPreview} kind={posterMeta?.kind} headline={form.headline} copy={form.primaryText} cta={form.callToAction} width={posterMeta?.width||1} height={posterMeta?.height||1}/>:null}</section>:null}
    </div>
    <footer className={styles.footer}><button disabled={busy||uploading} onClick={review?()=>setReview(null):close}>{review?"Back to edit":"Cancel"}</button>{!loading&&!review?<button className={styles.primary} disabled={busy||uploading||audienceLoading||(!audience&&!form.customPin)||!form.locationId||!form.roleId||!form.formId||!form.imageHash||(form.launchMode==="live"&&!form.confirmLive)||!isValidMetaAudienceRadius(form.audienceRadiusKm)} onClick={()=>void submit(true)}>{uploading?"Uploading…":audienceLoading?"Checking station…":busy?"Checking…":"Review ad"}</button>:null}{review&&!notice.startsWith("Meta ad")?<button className={styles.primary} disabled={busy} onClick={()=>void submit(false)}>{busy?"Creating in Meta…":form.launchMode==="live"?"Confirm & launch live":"Confirm & create paused"}</button>:null}{notice.startsWith("Meta ad")?<button className={styles.primary} onClick={close}>Done</button>:null}</footer>
  </dialog>;
}
