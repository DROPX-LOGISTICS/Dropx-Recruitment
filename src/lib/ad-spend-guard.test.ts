import {describe,expect,it} from "vitest";
import {defaultGuardPolicy,evaluateAdGuard} from "./ad-spend-guard";
const base={status:"active",recentSpend:100,recentLeads:2,dashboardLeads:2,unattempted:0,staleUnattempted:0,ageDays:3,clicks:10,syncFresh:true};
describe("ad spend guard",()=>{
 it("stops spend without leads",()=>expect(evaluateAdGuard({...base,recentSpend:900,recentLeads:0},defaultGuardPolicy).code).toBe("spend_no_leads"));
 it("prioritises a material unattended backlog",()=>expect(evaluateAdGuard({...base,dashboardLeads:20,staleUnattempted:12},defaultGuardPolicy).action).toBe("assign_leads"));
 it("does not alarm on three ageing leads",()=>expect(evaluateAdGuard({...base,dashboardLeads:4,staleUnattempted:3},defaultGuardPolicy).severity).toBe("opportunity"));
 it("recommends a new poster when a mature ad has weak lead volume",()=>expect(evaluateAdGuard({...base,ageDays:8,recentSpend:400,recentLeads:2,clicks:70,impressions:3000},defaultGuardPolicy).code).toBe("low_lead_volume"));
 it("detects creative fatigue from week over week decline",()=>expect(evaluateAdGuard({...base,ageDays:12,recentSpend:600,recentLeads:3,previousSpend:620,previousLeads:9,clicks:80,impressions:4000},defaultGuardPolicy).code).toBe("creative_fatigue"));
 it("separates click conversion problems from weak reach",()=>expect(evaluateAdGuard({...base,ageDays:5,recentSpend:200,recentLeads:1,clicks:100,impressions:5000},defaultGuardPolicy).code).toBe("clicks_not_converting"));
 it("flags stale tracking only while spending",()=>expect(evaluateAdGuard({...base,syncFresh:false},defaultGuardPolicy).code).toBe("tracking_stale"));
 it("does not intervene when evidence is healthy",()=>expect(evaluateAdGuard(base,defaultGuardPolicy).severity).toBe("healthy"));
});
