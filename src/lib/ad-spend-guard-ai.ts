import type {GuardResult} from "./ad-spend-guard";
export async function enhanceGuardRecommendations(items:Array<{id:string;ad:string;station:string;role:string;result:GuardResult}>){
 const credential=process.env.AI_GATEWAY_API_KEY?.trim()||process.env.VERCEL_OIDC_TOKEN?.trim();
 if(!credential||!items.length)return null;
 const schema={type:"object",additionalProperties:false,properties:{items:{type:"array",items:{type:"object",additionalProperties:false,properties:{id:{type:"string"},explanation:{type:"string"},nextCheck:{type:"string"}},required:["id","explanation","nextCheck"]}}},required:["items"]};
 try{
  const response=await fetch("https://ai-gateway.vercel.sh/v1/chat/completions",{method:"POST",headers:{Authorization:`Bearer ${credential}`,"Content-Type":"application/json"},body:JSON.stringify({model:process.env.RECRUITMENT_AD_GUARD_MODEL?.trim()||"openai/gpt-5-mini",temperature:.1,stream:false,messages:[{role:"system",content:"You are DropX recruitment advertising analyst. Explain only the supplied aggregate evidence. Never invent metrics, infer personal information, or recommend discrimination. Keep each explanation under 220 characters. A human must approve ad changes."},{role:"user",content:JSON.stringify(items.map(x=>({id:x.id,ad:x.ad,station:x.station,role:x.role,severity:x.result.severity,code:x.result.code,action:x.result.action,evidence:x.result.evidence}))) }],response_format:{type:"json_schema",json_schema:{name:"dropx_ad_guard",strict:true,schema}}})});
  if(!response.ok)return null;const payload=await response.json() as any;const parsed=JSON.parse(payload?.choices?.[0]?.message?.content||"{}");
  return new Map((parsed.items||[]).map((x:any)=>[String(x.id),{explanation:String(x.explanation||"").slice(0,240),nextCheck:String(x.nextCheck||"").slice(0,120)}]));
 }catch{return null;}
}
