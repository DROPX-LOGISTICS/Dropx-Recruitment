import { describe, expect, it } from "vitest";
import {
  defaultHiringManagerFor,
  resolvePeopleClusterManager,
  resolvePeopleOperationalOwner,
  type MainDashboardHiringManager,
  type MainDashboardStation
} from "./main-dashboard-masters";

const station: MainDashboardStation = {
  id: "station-1",
  code: "SBPD",
  name: "Sambalpur",
  state: null,
  region: null,
  cluster: null,
  address: null,
  managerEmail: "station@dropx.test",
  managerId: "station-manager",
  managerName: "Station Manager",
  clusterManager: null,
  clusterManagerStatus: "unmapped",
  operationalOwner: null,
  operationalOwnerStatus: "unmapped",
  operationalOwnerDesignation: null,
  isActive: true
};

const managers: MainDashboardHiringManager[] = [
  {
    id: "station-manager",
    name: "Station Manager",
    email: "station@dropx.test",
    phone: "9999999999",
    employeeId: "S1",
    roleCode: "STM",
    roleName: "Station Manager",
    reportsToUserId: "cluster-manager",
    locationScopeIds: ["station-1"]
  },
  {
    id: "cluster-manager",
    name: "Cluster Manager",
    email: "cluster@dropx.test",
    phone: "8888888888",
    employeeId: "C1",
    roleCode: "CLM",
    roleName: "Cluster Manager",
    reportsToUserId: null,
    locationScopeIds: ["station-1"]
  }
];

describe("defaultHiringManagerFor", () => {
  it("defaults SSA interviews to the station manager", () => {
    expect(defaultHiringManagerFor(station, "SSA", managers)?.id).toBe("station-manager");
  });

  it("defaults other HR roles to the station manager's reporting manager", () => {
    expect(defaultHiringManagerFor(station, "TL", managers)?.id).toBe("cluster-manager");
  });
});

describe("resolvePeopleClusterManager", () => {
  const activeManager = {
    profileId: "profile-1",
    peopleCode: "D100",
    name: "Current Cluster Manager",
    email: "manager@dropx.test",
    locationScopeIds: ["station-1"],
    peopleActive: true,
    profileActive: true
  };

  it("uses the active People Cluster Manager designation mapping for the station", () => {
    expect(resolvePeopleClusterManager("station-1", [activeManager])).toEqual({
      status: "mapped",
      manager: expect.objectContaining({ name: "Current Cluster Manager" })
    });
  });

  it("does not use inactive or out-of-scope people", () => {
    expect(resolvePeopleClusterManager("station-1", [
      { ...activeManager, profileId: "inactive", peopleActive: false },
      { ...activeManager, profileId: "other-station", locationScopeIds: ["station-2"] }
    ])).toEqual({ status: "unmapped", manager: null });
  });

  it("does not silently choose when multiple active Cluster Managers own a station", () => {
    expect(resolvePeopleClusterManager("station-1", [
      activeManager,
      { ...activeManager, profileId: "profile-2", peopleCode: "D101", name: "Another Cluster Manager" }
    ])).toEqual({ status: "ambiguous", manager: null });
  });
});

describe("resolvePeopleOperationalOwner", () => {
  const clusterManager = {
    profileId: "cm-profile",
    peopleCode: "D100",
    name: "Current Cluster Manager",
    email: "cm@dropx.test",
    locationScopeIds: ["station-1"],
    peopleActive: true,
    profileActive: true,
    designationCode: "CLM",
    designationName: "Cluster Manager",
    ownerType: "cluster_manager" as const
  };
  const areaOpsManager = {
    ...clusterManager,
    profileId: "aom-profile",
    peopleCode: "D200",
    name: "Current Area Ops Manager",
    email: "aom@dropx.test",
    designationCode: "AOM",
    designationName: "Area Operations Manager",
    ownerType: "area_ops_manager" as const
  };

  it("uses the Cluster Manager when both People mappings exist", () => {
    expect(resolvePeopleOperationalOwner("station-1", [areaOpsManager, clusterManager])).toEqual({
      status: "mapped",
      owner: expect.objectContaining({ name: "Current Cluster Manager", ownerType: "cluster_manager" }),
      designationName: "Cluster Manager"
    });
  });

  it("falls back to the Area Ops Manager when no Cluster Manager is mapped", () => {
    expect(resolvePeopleOperationalOwner("station-1", [areaOpsManager])).toEqual({
      status: "mapped",
      owner: expect.objectContaining({ name: "Current Area Ops Manager", ownerType: "area_ops_manager" }),
      designationName: "Area Operations Manager"
    });
  });

  it("does not hide an ambiguous Cluster Manager mapping behind the AOM fallback", () => {
    expect(resolvePeopleOperationalOwner("station-1", [
      clusterManager,
      { ...clusterManager, profileId: "other-cm", peopleCode: "D101" },
      areaOpsManager
    ])).toEqual({ status: "ambiguous", owner: null, designationName: "Cluster Manager" });
  });

  it("ignores inactive owners and out-of-scope profiles", () => {
    expect(resolvePeopleOperationalOwner("station-1", [
      { ...clusterManager, peopleActive: false },
      { ...areaOpsManager, locationScopeIds: ["station-2"] }
    ])).toEqual({ status: "unmapped", owner: null, designationName: null });
  });
});
