import { describe, expect, it } from "vitest";
import { buildLeadFacets } from "./lead-facets";

const rows = [
  { locationCode: "JUGD", cluster: "Odisha", roleCode: "TL" },
  { locationCode: "SBPD", cluster: "Odisha", roleCode: "TL" },
  { locationCode: "KOZA", cluster: "Kerala", roleCode: "RC" },
  { locationCode: "ERSE", cluster: "Kerala", roleCode: "RC" }
];

describe("buildLeadFacets", () => {
  it("limits stations and clusters to the selected designation", () => {
    const facets = buildLeadFacets(rows, {
      stationCodes: [],
      clusters: [],
      roleCodes: ["TL"]
    });

    expect(facets.locations).toEqual([
      { value: "JUGD", count: 1 },
      { value: "SBPD", count: 1 }
    ]);
    expect(facets.clusters).toEqual([{ value: "Odisha", count: 2 }]);
  });

  it("limits designations to the selected station while keeping station choices cross-filtered", () => {
    const facets = buildLeadFacets(rows, {
      stationCodes: ["KOZA"],
      clusters: [],
      roleCodes: []
    });

    expect(facets.roles).toEqual([{ value: "RC", count: 1 }]);
    expect(facets.locations).toHaveLength(4);
  });
});

import { buildDependentLeadFacets, dependentFilterOptions, facetSelections, type LeadFacetGroup } from "./lead-facets";
const groups: LeadFacetGroup[] = [
  {locationCode:"PMB",roleCode:"DA",status:"interview_scheduled",finalStatus:null,age:60,count:35},
  {locationCode:"MEP",roleCode:"ODCD",status:"interview_scheduled",finalStatus:null,age:12,count:5},
  {locationCode:"CHM",roleCode:"PTDA",status:"new",finalStatus:null,age:1,count:120},
  {locationCode:"PMB",roleCode:"ODCD",status:"joined",finalStatus:"selected",age:2,count:2},
  {locationCode:"TFB7",roleCode:"SM",status:"interview_scheduled",finalStatus:"rejected",age:4,count:4},
  {locationCode:null,roleCode:null,status:"new",finalStatus:null,age:1,count:3}
];
const owners = new Map([["PMB","Kerala"],["MEP","Kerala"],["CHM","Kerala"],["TFB7","Gurgaon"]]);
const facetsFor = (query:string) => buildDependentLeadFacets(groups, facetSelections(new URLSearchParams(query)), owners);

describe("dependent lead filters", () => {
  it("excludes part-time roles without matching interviews and uses weighted totals across all pages", () => {
    const facets = facetsFor("status=interview_scheduled&station=PMB,MEP,CHM&role=DA,ODCD");
    expect(facets.roles).toEqual([{value:"DA",count:35},{value:"ODCD",count:5}]);
    expect(facets.locations).toEqual([{value:"MEP",count:5},{value:"PMB",count:35}]);
    expect(facets.clusters).toEqual([{value:"Kerala",count:40}]);
    expect(facets.statuses).toEqual([{value:"interview_scheduled",count:40},{value:"joined",count:2}]);
  });
  it("updates in both directions and leaves alternative values in its own multi-select", () => {
    expect(facetsFor("role=SM").locations).toEqual([{value:"TFB7",count:4}]);
    expect(facetsFor("station=TFB7").roles).toEqual([{value:"SM",count:4}]);
    expect(facetsFor("station=PMB&role=DA").roles).toEqual([{value:"DA",count:35},{value:"ODCD",count:2}]);
  });
  it("cross-filters owners, statuses and final outcomes", () => {
    expect(facetsFor("cluster=Gurgaon").roles).toEqual([{value:"SM",count:4}]);
    expect(facetsFor("finalStatus=selected").locations).toEqual([{value:"PMB",count:2}]);
    expect(facetsFor("role=SM").finalStatuses).toEqual([{value:"rejected",count:4}]);
  });
  it("matches blank/new aliases and handles unmapped leads without inventing locations", () => {
    const facets = facetsFor("status=__BLANK__");
    expect(facets.locations).toEqual([{value:"CHM",count:120}]);
    expect(facets.updatedAges).toEqual([{value:"never",count:123}]);
    expect(facetsFor("status=new").roles).toEqual(facets.roles);
  });
  it("matches existing updated-age overlap semantics and counts only compatible age choices", () => {
    expect(facetsFor("updatedAge=gt24h").roles).toEqual([{value:"DA",count:35}]);
    expect(facetsFor("updatedAge=never").roles).toEqual([{value:"PTDA",count:120}]);
    expect(facetsFor("updatedAge=gt60,gt24h&cluster=Kerala").roles).toEqual([{value:"DA",count:35},{value:"ODCD",count:5}]);
    expect(facetsFor("updatedAge=lt30,gt24h").roles).toEqual([{value:"ODCD",count:2}]);
  });
  it("retains conflicting selections for clearing, hides unselected zero-count master options", () => {
    const options = dependentFilterOptions([["DA","Delivery associate"],["PTDA","Part time"]], facetsFor("station=TFB7").roles, "DA,OLD");
    expect(options).toEqual([["DA","Delivery associate (0)"],["OLD","OLD (0)"]]);
    expect(dependentFilterOptions([["DA","Delivery associate"]], undefined, "")).toEqual([]);
    expect(dependentFilterOptions([["__BLANK__","No status"]], [{value:"new",count:123}], "", value=>value==="__BLANK__"?"new":value)).toEqual([["__BLANK__","No status (123)"]]);
  });
  it("returns empty choices for an empty queue", () => {
    expect(buildDependentLeadFacets([], facetSelections(new URLSearchParams()), owners)).toEqual({locations:[],clusters:[],roles:[],statuses:[],finalStatuses:[],updatedAges:[]});
  });
});


it("includes historical stations with leads even when absent from the active master", () => {
  expect(dependentFilterOptions([["PMB","PMB — Perambra"]], [{value:"PMB",count:2},{value:"ERSE",count:90}], "", undefined, true))
    .toEqual([["PMB","PMB — Perambra (2)"],["ERSE","ERSE (90)"]]);
  // Status/outcome menus remain restricted to their supported choices.
  expect(dependentFilterOptions([["joined","Joined"]], [{value:"old_status",count:90}], "")).toEqual([]);
});
