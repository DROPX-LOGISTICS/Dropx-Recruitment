import { describe, expect, it } from "vitest";
import { evaluateAdHealth, monitoringState, type HealthInput } from "./ad-health";
import { insightTotals } from "./ad-insight-metrics";
const now=Date.parse("2026-09-09T12:00:00Z");
const totals=(spend=700,impressions=20000,links=300,leads=30,reach=10000)=>insightTotals({spend:String(spend),impressions:String(impressions),reach:String(reach),inline_link_clicks:String(links),actions:[{action_type:"lead",value:String(leads)}]});
const base:HealthInput={status:"ACTIVE",now,available:true,statusFresh:true,metrics:totals(),previous:totals(),completeDays:7,comparableWeeks:true,dailyBudget:100,sharedBudget:false,targetingReview:false,targetCpl:150,spendWithoutLead:750,cplWarningMultiplier:1.5,period:{since:"2026-09-02",until:"2026-09-08"}};
const codes=(overrides:Partial<HealthInput>)=>evaluateAdHealth({...base,...overrides}).issues.map(x=>x.code);
describe("independent ad health recommendations",()=>{
  it("can surface several issues on one ad",()=>expect(codes({targetingReview:true,metrics:totals(900,10000,90,0)})).toEqual(expect.arrayContaining(["spend_no_leads","targeting_review","form_conversion"])));
  it("shows low delivery even when lead cost is good",()=>expect(codes({dailyBudget:200,metrics:totals(254,4880,49,14,3460),sharedBudget:true})).toContain("low_delivery"));
  it("explains shared budget allocation without recommending a budget increase",()=>{
    const issue=evaluateAdHealth({...base,dailyBudget:200,sharedBudget:true,metrics:totals(200)}).issues.find(x=>x.code==="low_delivery")!;
    expect(issue.explanation).toContain("not guaranteed");expect(issue.action).toBe("diagnose");
  });
  it("does not call low reach a bad creative when the ad never delivered",()=>expect(codes({metrics:totals(0,0,0,0,0)})).toEqual(["no_delivery"]));
  it("holds spend interventions during a new run or change",()=>expect(codes({completeDays:1,metrics:totals(900,500,0,0,400)})).toEqual(["new_run_observation"]));
  it("does not infer poor performance when Meta is unavailable",()=>expect(codes({available:false,metrics:totals(900,500,0,0)})).toEqual(["data_unavailable"]));
  it("waits for current status before recommending a pause",()=>expect(codes({statusFresh:false,metrics:totals(900,500,0,0)})).toEqual(["status_stale"]));
  it("leaves paused and completed ads out of intervention",()=>{for(const status of ["PAUSED","COMPLETED","ARCHIVED"])expect(evaluateAdHealth({...base,status,metrics:totals(900,500,0,0)})).toMatchObject({eligible:false,issues:[]});});
  it("identifies weak link response independently of raw delivery",()=>expect(codes({metrics:totals(789,15544,84,13,10250)})).toContain("weak_response"));
  it("compares CPM only with equivalent mature windows",()=>{
    expect(codes({metrics:totals(700,5000)})).toContain("rising_cpm");
    expect(codes({metrics:totals(700,5000),comparableWeeks:false})).not.toContain("rising_cpm");
  });
  it("does not judge conversion from a tiny sample",()=>expect(codes({metrics:totals(200,2500,12,0)})).not.toContain("form_conversion"));
  it("detects a delivery restriction and an approaching end",()=>{
    expect(codes({status:"DISAPPROVED"})).toContain("delivery_blocked");
    expect(codes({endsAt:"2026-09-09T14:00:00Z"})).toContain("ending_soon");
  });
  it("does not mistake missing reach for audience fatigue",()=>expect(codes({metrics:{...totals(),reach:null,frequency:null}})).not.toContain("audience_fatigue"));
  it("allows a healthy ad to keep running",()=>expect(evaluateAdHealth(base)).toMatchObject({issues:[],state:"healthy"}));
});
describe("monitoring lifecycle",()=>{
 const event={recommendation_code:"weak_response",evidence:{reviewAfter:"2026-09-11T12:00:00Z"}};
 const poor=evaluateAdHealth({...base,metrics:totals(700,20000,90,20)});
 it("retains a current watch",()=>expect(monitoringState(event,poor,now)).toBe("monitoring"));
 it("returns an unresolved issue to review when the watch expires",()=>expect(monitoringState(event,poor,now+3*86400000)).toBe("due"));
 it("clears only on a fresh completed-data check",()=>{
   expect(monitoringState(event,evaluateAdHealth(base),now)).toBe("cleared");
   expect(monitoringState(event,evaluateAdHealth({...base,statusFresh:false}),now)).not.toBe("cleared");
   expect(monitoringState(event,evaluateAdHealth({...base,available:false}),now)).not.toBe("cleared");
 });
 it("does not claim recovery because an ad was paused",()=>expect(monitoringState(event,evaluateAdHealth({...base,status:"PAUSED"}),now)).toBe("inactive"));
});
