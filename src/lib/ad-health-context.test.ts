import { describe, expect, it } from "vitest";
import { adPolicy, buildHealthContext } from "./ad-health-context";
const now=Date.parse("2026-09-09T12:00:00Z");
const input={ad:{id:"ad",status:"ACTIVE",last_synced_at:new Date(now).toISOString(),created_on:"2026-08-01T00:00:00Z",raw_payload:{},daily_budget:100},allAds:[],daily:[],assessment:{spend:"900",impressions:"9000"},previous:{spend:"200",impressions:"5000"},period:{since:"2026-09-02",until:"2026-09-08"},previousPeriod:{since:"2026-08-26",until:"2026-09-01"},available:true,now,changes:[],requests:[]};
describe("run-aware performance evidence",()=>{
 it("excludes the partial day and old performance after a creative replacement",()=>{
   const result=buildHealthContext({...input,changes:[{status:"completed",completed_at:"2026-09-06T12:00:00Z"}],daily:[{date_start:"2026-09-04",spend:"800",impressions:"8000"},{date_start:"2026-09-07",spend:"100",impressions:"1000"}]});
   expect(result).toMatchObject({period:{since:"2026-09-07",until:"2026-09-08"},completeDays:2,metrics:{spend:100,impressions:1000,reach:null},state:"observing"});
   expect(result.issues.some(issue=>issue.action==="pause")).toBe(false);
 });
 it("does not reset the measurement when a change fails or is only requested",()=>{
   const result=buildHealthContext({...input,changes:[{status:"failed",created_at:"2026-09-08T12:00:00Z"}],requests:[{status:"requested",request_type:"budget_change",updated_at:"2026-09-08T12:00:00Z"}]});
   expect(result.completeDays).toBe(7);expect(result.metrics.spend).toBe(900);
 });
 it("uses restart time instead of the original creation time",()=>{
   const result=buildHealthContext({...input,ad:{...input.ad,current_run_started_at:"2026-09-09T10:00:00Z"}});
   expect(result.completeDays).toBe(0);expect(result.metrics.spend).toBe(0);expect(result.state).toBe("observing");
 });
 it("merges location and role policies in specificity order without crossing streams",()=>{
   const policy=adPolicy({location_id:"station",role_id:"role",recruitment_roles:{stream:"workforce"}},[{stream:"hr",target_cpl:1},{target_cpl:150},{location_id:"station",target_cpl:100},{location_id:"station",role_id:"role",target_cpl:80}]);
   expect(policy.target_cpl).toBe(80);
 });
});
