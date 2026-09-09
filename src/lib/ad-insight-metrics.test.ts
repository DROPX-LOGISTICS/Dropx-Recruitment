import { describe, expect, it } from "vitest";
import { calendarDaily, insightPeriods, insightTotals, metaLeadActions } from "./ad-insight-metrics";
describe("Meta performance measurements",()=>{
  it("counts overlapping Meta lead totals once",()=>expect(metaLeadActions({actions:[{action_type:"lead",value:"45"},{action_type:"onsite_conversion.lead_grouped",value:"45"},{action_type:"onsite_conversion.lead",value:"1"}]})).toBe(45));
  it("honours an explicit zero and falls back only when the primary metric is absent",()=>{
    expect(metaLeadActions({actions:[{action_type:"lead",value:"0"},{action_type:"onsite_conversion.lead_grouped",value:"9"}]})).toBe(0);
    expect(metaLeadActions({actions:[{action_type:"onsite_conversion.lead_grouped",value:"9"}]})).toBe(9);
  });
  it("builds adjacent complete weeks across month boundaries",()=>expect(insightPeriods("2026-09-03")).toEqual({recent:{since:"2026-08-28",until:"2026-09-03"},assessment:{since:"2026-08-27",until:"2026-09-02"},previous:{since:"2026-08-20",until:"2026-08-26"}}));
  it("does not pull old spend forward when Meta omits zero-delivery days",()=>{
    const daily=calendarDaily([{date_start:"2026-08-30",spend:"400"},{date_start:"2026-09-04",spend:"60"}],{since:"2026-09-03",until:"2026-09-09"});
    expect(daily).toHaveLength(7);expect(daily.reduce((sum,row)=>sum+row.spend,0)).toBe(60);expect(daily[6].spend).toBe(0);
  });
  it("uses link clicks rather than reactions and all clicks for response",()=>{
    const metrics=insightTotals({spend:"100",impressions:"1000",reach:"500",clicks:"200",inline_link_clicks:"10",actions:[{action_type:"lead",value:"2"}]});
    expect(metrics).toMatchObject({linkCtr:1,clickToLead:20,frequency:2,cpm:100,cpl:50});
  });
  it("does not pretend missing unique reach is zero",()=>{
    expect(insightTotals({spend:"10",impressions:"100"}).reach).toBeNull();
    expect(insightTotals({spend:"10",impressions:"100"}).frequency).toBeNull();
    expect(insightTotals().reach).toBe(0);
  });
  it("does not report zero cost per lead when there are no leads",()=>expect(insightTotals({spend:"700",impressions:"1000"}).cpl).toBeNull());
});
