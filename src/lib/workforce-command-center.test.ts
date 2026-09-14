import { describe, expect, it } from "vitest";
import { buildWorkforceActionRows, noStatusSeverity, workforceAdStatusOptions } from "./workforce-command-center";

describe("workforce command center", () => {
  const adRows = [
    { adId:"1", adName:"KOZD DA A", adStatus:"active", station:"KOZD", stationName:"Kozhikode", designation:"DA", designationName:"Delivery Associate", totalLeads:18, pending:14, noStatus:12, noResponse:1, callBack:1, interviews:2, stale24h:5 },
    { adId:"2", adName:"KOZD DA B", adStatus:"active", station:"KOZD", stationName:"Kozhikode", designation:"DA", designationName:"Delivery Associate", totalLeads:7, pending:5, noStatus:4, noResponse:1, callBack:0, interviews:1, stale24h:2 },
    { adId:"3", adName:"CNNR DA", adStatus:"active", station:"CNNR", stationName:"Kannur", designation:"DA", designationName:"Delivery Associate", totalLeads:10, pending:8, noStatus:8, noResponse:0, callBack:0, interviews:2, stale24h:1 },
    { adId:"4", adName:"KOZD Picker", adStatus:"paused", station:"KOZD", stationName:"Kozhikode", designation:"PICKER", designationName:"Picker", totalLeads:50, pending:45, noStatus:40 }
  ];

  it("shows only selected ad statuses, aggregates station and designation, and sorts untreated leads first", () => {
    const rows = buildWorkforceActionRows(adRows, [{ stationCode:"KOZD", capacityGap:9, trainingHeadcount:2, netHiringNeed:7 }], ["active"]);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ station:"KOZD", designation:"DA", adCount:2, adIds:["1","2"], totalLeads:25, pending:19, noStatus:16 });
    expect(rows[0].capacity).toMatchObject({ capacityGap:9, trainingHeadcount:2, netHiringNeed:7 });
    expect(rows[1]).toMatchObject({ station:"CNNR", noStatus:8, capacity:null });
  });

  it("offers ad states in a stable action-first order", () => {
    expect(workforceAdStatusOptions(adRows)).toEqual(["active", "paused"]);
  });

  it("marks the largest material untreated backlog as critical", () => {
    expect(noStatusSeverity(16, 16)).toBe("critical");
    expect(noStatusSeverity(8, 16)).toBe("normal");
    expect(noStatusSeverity(0, 16)).toBe("clear");
  });
});
