import { describe, expect, it } from "vitest";
import {
  buildNotificationTemplate,
  mergeNotificationContacts,
  NotificationConfigurationError,
  NotificationRuleDisabledError,
  NotificationRule,
  notificationRulesFromConfig
} from "./recruitment-notifications";

const workforceRule: NotificationRule = {
  stream: "workforce",
  trigger: "new_lead",
  enabled: true,
  templateName: "configured_application_template",
  contactSource: "station",
  defaultContactName: "",
  defaultContactMobile: "",
  defaultAddress: "",
  defaultMapLink: "",
  requireContact: true,
  requireAddress: true
};

const lead = {
  id: "lead-1",
  phone: "9876543210",
  full_name: "Candidate One",
  stream: "workforce",
  recruitment_roles: { name: "Delivery Associate" },
  recruitment_locations: {
    address: "DropX Station, Kozhikode",
    latitude: 11.4454926,
    longitude: 75.7275699,
    poc_name: "Station Recruiter",
    poc_mobile: "9567044045"
  }
};

describe("recruitment WhatsApp notification rules", () => {
  it("fills incomplete Station Contacts from the Station Directory without overwriting configured values", () => {
    expect(mergeNotificationContacts(
      { poc_mobile: "9000000001", address: null },
      { poc_mobile: "9000000002", address: "Directory address", latitude: 11.2, longitude: 75.7 }
    )).toEqual({
      address: "Directory address",
      latitude: 11.2,
      longitude: 75.7,
      poc_name: null,
      poc_mobile: "9000000001"
    });
  });

  it("builds workforce application messages from Station Contacts master data", () => {
    expect(buildNotificationTemplate("new_lead", lead, workforceRule)).toMatchObject({
      name: "configured_application_template",
      parameters: [
        "Candidate One",
        "Delivery Associate",
        "9567044045",
        "DropX Station, Kozhikode"
      ]
    });
  });

  it("uses editable HR defaults when the station contact is unavailable", () => {
    const rule: NotificationRule = {
      ...workforceRule,
      stream: "hr",
      trigger: "interview",
      templateName: "configured_hr_interview",
      contactSource: "station_then_default",
      defaultContactName: "HR Team",
      defaultContactMobile: "9000000000",
      defaultAddress: "DropX Head Office",
      defaultMapLink: "https://maps.example/hr"
    };
    expect(buildNotificationTemplate("interview", {
      ...lead,
      stream: "hr",
      recruitment_roles: { name: "Team Leader" },
      recruitment_locations: null
    }, rule).parameters).toEqual([
      "Candidate One",
      "DropX Head Office",
      "https://maps.example/hr",
      "9000000000"
    ]);
  });

  it("blocks incomplete messages instead of inserting Not available", () => {
    expect(() => buildNotificationTemplate("new_lead", {
      ...lead,
      recruitment_locations: null
    }, workforceRule)).toThrow(NotificationConfigurationError);
  });

  it("distinguishes a Master-disabled rule from invalid message data", () => {
    expect(() => buildNotificationTemplate("new_lead", lead, {
      ...workforceRule,
      enabled: false
    })).toThrow(NotificationRuleDisabledError);
  });

  it("loads template identifiers from the saved connection master", () => {
    const rules = notificationRulesFromConfig({
      new_lead_template: "saved_application",
      reminder_template: "saved_reminder",
      interview_template: "saved_interview"
    });
    expect(rules.find((item) => item.stream === "workforce" && item.trigger === "new_lead")?.templateName)
      .toBe("saved_application");
    expect(rules.find((item) => item.stream === "hr" && item.trigger === "interview")?.contactSource)
      .toBe("station_then_default");
  });

  it("falls back to the legacy default interview template when connection config is incomplete", () => {
    const rules = notificationRulesFromConfig({});
    expect(rules.find((item) => item.stream === "workforce" && item.trigger === "interview")?.templateName)
      .toBe("job_location_share");
    expect(rules.find((item) => item.stream === "workforce" && item.trigger === "new_lead")?.templateName)
      .toBe("job_application_number");
  });
});
