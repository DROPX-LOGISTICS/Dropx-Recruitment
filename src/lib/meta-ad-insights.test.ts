import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const fixture=vi.hoisted(()=>({token:"test-token"}));
vi.mock("./connection-config",()=>({getConnectionConfig:async()=>({isEnabled:true,secrets:{access_token:fixture.token},publicConfig:{ad_account_id:"act_1",graph_version:"v25.0"}})}));
import { fetchRecentMetaInsights } from "./meta-ad-insights";
beforeEach(()=>{fixture.token+= "x";});
afterEach(()=>vi.unstubAllGlobals());
describe("complete Meta performance reads",()=>{
 it("asks Meta for unique reach in three separate period totals",async()=>{
  const calls:URL[]=[];vi.stubGlobal("fetch",vi.fn(async(url:URL)=>{calls.push(new URL(url));return Response.json({data:[]});}));
  const result=await fetchRecentMetaInsights();expect(result.available).toBe(true);expect(calls).toHaveLength(4);
  expect(calls.filter(url=>url.searchParams.has("time_increment"))).toHaveLength(1);
  expect(calls.filter(url=>!url.searchParams.has("time_increment")).map(url=>JSON.parse(url.searchParams.get("time_range")!))).toEqual([result.periods.recent,result.periods.assessment,result.periods.previous]);
 });
 it("discards partial evidence when one of the reads fails",async()=>{
  let calls=0;vi.stubGlobal("fetch",vi.fn(async()=>++calls===3 ? Response.json({error:{message:"Rate limited"}},{status:429}) : Response.json({data:[{ad_id:"ad",spend:"100"}]})));
  expect(await fetchRecentMetaInsights()).toMatchObject({available:false,rows:[],assessment:[],error:"Rate limited"});
 });
 it("deduplicates concurrent reads for the same account credential",async()=>{
  const fetch=vi.fn(async()=>Response.json({data:[]}));vi.stubGlobal("fetch",fetch);
  await Promise.all([fetchRecentMetaInsights(),fetchRecentMetaInsights()]);expect(fetch).toHaveBeenCalledTimes(4);
 });
 it("rejects incomplete pagination instead of silently using a subset",async()=>{
  vi.stubGlobal("fetch",vi.fn(async()=>Response.json({data:[],paging:{next:"https://graph.facebook.com/v25.0/act_1/insights?after=more"}})));
  expect(await fetchRecentMetaInsights()).toMatchObject({available:false,error:expect.stringContaining("page limit")});
 });
});
