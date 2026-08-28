import { describe, expect, it } from "vitest";
import { chooseWorkforceStationCode, normalizeIndianPostCode } from "./workforce-pincode-routing";

describe("workforce PIN-code routing", () => {
  it("normalizes a six-digit Indian PIN code", () => {
    expect(normalizeIndianPostCode("673 614")).toBe("673614");
    expect(normalizeIndianPostCode("67361")).toBeNull();
  });

  it("routes supplied Flipkart PIN mappings before ad station", () => {
    expect(chooseWorkforceStationCode({
      postCode: "673525", stream: "workforce", advertisedStationCode: "QLDA"
    })).toMatchObject({ stationCode: "PMB", source: "manual_override" });
    expect(chooseWorkforceStationCode({
      postCode: "673527", stream: "workforce", advertisedStationCode: "PMB"
    })).toMatchObject({ stationCode: "CHM", source: "manual_override" });
    expect(chooseWorkforceStationCode({
      postCode: "754001", stream: "workforce", advertisedStationCode: "PMB"
    })).toMatchObject({ stationCode: "PHN", source: "manual_override" });
  });

  it("uses service-network ownership and delivery evidence for split PINs", () => {
    expect(chooseWorkforceStationCode({
      postCode: "673614",
      stream: "workforce",
      advertisedStationCode: "PMB",
      networkStationCodes: ["QLDA", "PMB"],
      deliveredStationCodes: ["QLDA", "QLDA", "PMB"]
    })).toMatchObject({ stationCode: "QLDA", source: "service_network" });
  });

  it("uses delivered shipment history when no network master owns the PIN", () => {
    expect(chooseWorkforceStationCode({
      postCode: "673614",
      stream: "workforce",
      advertisedStationCode: "PMB",
      deliveredStationCodes: ["QLDA", "QLDA", "PMB"]
    })).toMatchObject({ stationCode: "QLDA", source: "delivered_shipments" });
  });

  it("keeps the advertised station when no station serves the PIN", () => {
    expect(chooseWorkforceStationCode({
      postCode: "999999", stream: "workforce", advertisedStationCode: "PMB"
    })).toMatchObject({ stationCode: "PMB", source: "advertised_station" });
  });

  it("never PIN-routes HR candidates", () => {
    expect(chooseWorkforceStationCode({
      postCode: "673525", stream: "hr", advertisedStationCode: "QLDA"
    })).toMatchObject({ stationCode: "QLDA", source: "advertised_station" });
  });
});
