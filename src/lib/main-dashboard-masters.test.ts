import { describe, expect, it } from "vitest";
import {
  defaultHiringManagerFor,
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
