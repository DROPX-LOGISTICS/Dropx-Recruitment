import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("./connection-config", () => ({ getConnectionConfig: async () => ({ isEnabled:true,
  publicConfig:{ad_account_id:"11111",page_id:"22222",graph_version:"v25.0"}, secrets:{access_token:"test-token"} }) }));
import { buildReplacementObjectStorySpec, replaceMetaAdCreative, publishMetaRecruitmentAd, sameMetaPublishDraft, type MetaAdDraft } from "./meta-ad-builder";
import { validateCreativeFile } from "./meta-media";
import { readVideoTicket, signVideoTicket } from "./meta-video-ticket";

const hash="a1b2c3d4e5f678901234567890abcdef";
const story={page_id:"22222",instagram_user_id:"123456",link_data:{link:"https://recruit.dropxlogistics.com",message:"₹21,000 guaranteed",name:"Kozhikode delivery",description:"Apply today",call_to_action:{type:"APPLY_NOW",value:{lead_gen_form_id:"77777",link:"https://recruit.dropxlogistics.com"}}}};
afterEach(()=>vi.unstubAllGlobals());

describe("video creative support",()=>{
  it("accepts the real 30-second MP4 size and rejects unsupported or oversized files",()=>{
    expect(validateCreativeFile({name:"dropx-kozhikode-hiring-30s.mp4",type:"video/mp4",size:29959331}).kind).toBe("video");
    expect(validateCreativeFile({name:"phone.mov",type:"",size:1000}).contentType).toBe("video/quicktime");
    expect(()=>validateCreativeFile({name:"large.mp4",type:"video/mp4",size:51*1024*1024})).toThrow("50 MB");
    expect(()=>validateCreativeFile({name:"payload.mp4",type:"text/html",size:1000})).toThrow("Choose");
  });
  it("converts image to video and back without losing lead form, text, link or Instagram identity",()=>{
    const video=buildReplacementObjectStorySpec(story,hash,"99999");
    expect(video).not.toHaveProperty("link_data");
    expect(video).toMatchObject({page_id:"22222",instagram_user_id:"123456",video_data:{video_id:"99999",image_hash:hash,message:story.link_data.message,title:story.link_data.name,link_description:story.link_data.description,call_to_action:story.link_data.call_to_action}});
    const image=buildReplacementObjectStorySpec(video,hash);
    expect(image).not.toHaveProperty("video_data");
    expect(image.link_data).toMatchObject(story.link_data);
  });
  it("holds a completed ad paused while attaching its video, without changing budget or schedule",async()=>{
    const end=new Date(Date.now()-86400000).toISOString();
    const ad:any={id:"33333",name:"KOZA_DA",status:"ACTIVE",configured_status:"ACTIVE",effective_status:"ACTIVE",adset:{id:"55555",status:"ACTIVE",end_time:end,daily_budget:"10000"},campaign:{id:"66666",status:"ACTIVE"},creative:{id:"44444",object_story_spec:story}};
    const before=structuredClone(ad.adset),writes:any[]=[];
    let createdStory:any;
    vi.stubGlobal("fetch",vi.fn(async(url:URL,init:RequestInit)=>{
      if(url.pathname.endsWith("/99999"))return Response.json({status:{video_status:"ready"},source:"https://video.example.test/test.mp4"});
      if(url.pathname.endsWith("/me/accounts"))return Response.json({data:[]});
      if(init.method==="POST"){
        const values=Object.fromEntries(new URLSearchParams(init.body as URLSearchParams));writes.push({path:url.pathname,values});
        if(url.pathname.endsWith("/adcreatives")){createdStory=JSON.parse(values.object_story_spec);return Response.json({id:"88888"});}
        if(values.status)Object.assign(ad,{status:values.status,configured_status:values.status});
        if(values.creative)ad.creative={id:"88888",object_story_spec:createdStory};
        return Response.json({success:true});
      }
      return Response.json(ad);
    }));
    const result=await replaceMetaAdCreative({metaAdId:"33333",expectedCreativeId:"44444",imageHash:hash,videoId:"99999",expectedEndTime:end});
    expect(result.after).toMatchObject({adId:"33333",videoId:"99999",configuredStatus:"PAUSED",deliveryStatus:"COMPLETED"});
    expect(ad.adset).toEqual(before);
    expect(writes.some(x=>x.values.status==="ACTIVE")).toBe(false);
    expect(createdStory.video_data.call_to_action.value.lead_gen_form_id).toBe("77777");
  });
  it("does not create Meta objects or activate anything while the video is processing",async()=>{
    const fetcher=vi.fn(async(_url:URL,_init?:RequestInit)=>Response.json({status:{video_status:"processing"}}));vi.stubGlobal("fetch",fetcher);
    const draft:MetaAdDraft={campaignMode:"new",campaignName:"Recruit",formId:"77777",dailyBudget:100,daysRequired:7,adName:"KOZA_DA_20260909",adSetName:"KOZA_DA_Local",creativeName:"Video",primaryText:"Apply",headline:"Delivery",imageHash:hash,videoId:"99999",destinationUrl:"https://recruit.dropxlogistics.com",callToAction:"APPLY_NOW",audience:{locationId:"koza",stationCode:"KOZA",stationName:"Kozhikode",address:null,latitude:11.26,longitude:75.8,radiusKm:15,source:"location_master"}};
    await expect(publishMetaRecruitmentAd({draft})).rejects.toThrow("still processing");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]?.method || "GET").toBe("GET");
    expect(sameMetaPublishDraft(draft,{...draft,videoId:"99998"})).toBe(false);
  });
});

describe("private video upload references",()=>{
  const scope={actor:"actor-1",company:"dropx",stream:"workforce"};
  const value={...scope,path:"dropx/actor-1/file.mp4",fileName:"video.mp4",contentType:"video/mp4",size:29959331,expires:Date.now()+60000};
  it("allows the issuing user only, and rejects tampering and expired references",()=>{
    const token=signVideoTicket(value,"server-secret");
    expect(readVideoTicket(token,"server-secret",scope).path).toBe(value.path);
    expect(()=>readVideoTicket(token,"server-secret",{...scope,actor:"actor-2"})).toThrow("another user");
    expect(()=>readVideoTicket(token,"server-secret",{...scope,stream:"hr"})).toThrow("another user");
    expect(()=>readVideoTicket(token+"x","server-secret",scope)).toThrow("Invalid");
    expect(()=>readVideoTicket(signVideoTicket({...value,expires:0},"server-secret"),"server-secret",scope)).toThrow("expired");
  });
});
