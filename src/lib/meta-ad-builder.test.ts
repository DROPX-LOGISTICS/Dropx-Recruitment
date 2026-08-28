import { describe, expect, it } from "vitest";
import {
  buildAdSetBudgetCampaignValues,
  buildEmploymentAdSetValues,
  buildEmploymentCampaignValues,
  buildReplacementObjectStorySpec,
  hasMetaPageAdvertiseTask,
  metaDailyBudgetMinorUnits,
  validateMetaAdDraft
} from "./meta-ad-builder";

const validDraft = {
  campaignMode: "new" as const,
  campaignName: "ERSE DA Recruitment",
  formId: "123",
  dailyBudget: 500,
  daysRequired: 7,
  adName: "ERSE_DA_20260801",
  adSetName: "ERSE_DA_Broad",
  creativeName: "ERSE_DA_Creative",
  primaryText: "Join DropX Logistics",
  headline: "Delivery Associate openings",
  posterUrl: "https://example.com/poster.jpg",
  destinationUrl: "https://recruit.dropxlogistics.com",
  callToAction: "APPLY_NOW" as const,
  audience: {
    locationId: "location-1",
    stationCode: "ERSE",
    stationName: "Perumbavoor",
    address: "Perumbavoor, Kerala",
    latitude: 10.10695,
    longitude: 76.47366,
    radiusKm: 15,
    source: "station_contacts" as const
  }
};

describe("Meta recruitment ad builder", () => {
  it("uses minor currency units for daily budget", () => {
    expect(metaDailyBudgetMinorUnits(500)).toBe("50000");
  });

  it("always creates an employment lead campaign paused", () => {
    expect(buildEmploymentCampaignValues("Test")).toMatchObject({
      objective: "OUTCOME_LEADS",
      is_adset_budget_sharing_enabled: "false",
      special_ad_categories: '["EMPLOYMENT"]',
      special_ad_category_country: '["IN"]',
      status: "PAUSED"
    });
  });

  it("targets the station-contact coordinates and creates the ad set paused", () => {
    const values = buildEmploymentAdSetValues({
      name: "Test",
      campaignId: "123",
      dailyBudget: 500,
      pageId: "456",
      daysRequired: 7,
      audience: validDraft.audience,
      now: new Date("2026-08-01T00:00:00.000Z")
    });
    expect(values.status).toBe("PAUSED");
    expect(values.optimization_goal).toBe("LEAD_GENERATION");
    expect(values).not.toHaveProperty("is_adset_budget_sharing_enabled");
    expect(JSON.parse(values.targeting)).toEqual({
      geo_locations: {
        custom_locations: [{
          latitude: 10.10695,
          longitude: 76.47366,
          radius: 15,
          distance_unit: "kilometer"
        }],
        location_types: ["home", "recent"]
      }
    });
  });

  it("serializes the campaign budget-sharing choice exactly once as false", () => {
    const campaign = buildEmploymentCampaignValues("Test");
    const encoded = new URLSearchParams(campaign).toString();
    expect(encoded).toContain("is_adset_budget_sharing_enabled=false");
    expect(encoded.match(/is_adset_budget_sharing_enabled/g)).toHaveLength(1);
  });

  it("reuses the exact Meta 100/4834011 repair payload for resumed campaigns", () => {
    const encoded = new URLSearchParams(buildAdSetBudgetCampaignValues());
    expect(encoded.getAll("is_adset_budget_sharing_enabled")).toEqual(["false"]);
  });

  it("accepts the maximum editable station radius", () => {
    const result = validateMetaAdDraft({
      ...validDraft,
      audience: { ...validDraft.audience, radiusKm: 18 }
    });
    expect(result.audience.radiusKm).toBe(18);
  });

  it("rejects audiences below 15 km or above 18 km", () => {
    expect(() => validateMetaAdDraft({
      ...validDraft,
      audience: { ...validDraft.audience, radiusKm: 14 }
    })).toThrow("between 15 and 18 km");
    expect(() => validateMetaAdDraft({
      ...validDraft,
      audience: { ...validDraft.audience, radiusKm: 19 }
    })).toThrow("between 15 and 18 km");
  });

  it("rejects missing or invalid station-contact coordinates", () => {
    expect(() => validateMetaAdDraft({
      ...validDraft,
      audience: { ...validDraft.audience, latitude: Number.NaN }
    })).toThrow("Station Contacts");
    expect(() => validateMetaAdDraft({
      ...validDraft,
      audience: { ...validDraft.audience, longitude: 181 }
    })).toThrow("Station Contacts");
    expect(() => validateMetaAdDraft({
      ...validDraft,
      audience: { ...validDraft.audience, latitude: null }
    } as any)).toThrow("Station Contacts");
    expect(() => validateMetaAdDraft({
      ...validDraft,
      audience: { ...validDraft.audience, longitude: "" }
    } as any)).toThrow("Station Contacts");
  });

  it("rejects unsafe or incomplete drafts", () => {
    expect(() => validateMetaAdDraft({ ...validDraft, dailyBudget: 50 })).toThrow("at least ₹100");
    expect(() => validateMetaAdDraft({ ...validDraft, posterUrl: "http://example.com/a.jpg" })).toThrow("HTTPS");
  });

  it("accepts a poster uploaded into the Meta image library", () => {
    const result = validateMetaAdDraft({ ...validDraft, posterUrl: null, imageHash: "a1b2c3d4e5f678901234567890abcdef" });
    expect(result.imageHash).toBe("a1b2c3d4e5f678901234567890abcdef");
    expect(result.posterUrl).toBeNull();
  });

  it("replaces only the poster while preserving the lead form, copy and destination", () => {
    const original = {
      page_id: "123456",
      instagram_user_id: "456789",
      link_data: {
        link: "https://recruit.dropxlogistics.com",
        picture: "https://example.com/old.jpg",
        image_crops: { "100x100": [[0, 0], [100, 100]] },
        attachment_style: "link",
        page_welcome_message: "Legacy read-only welcome message",
        message: "Join DropX Logistics",
        name: "Delivery Associate openings",
        description: "Apply today",
        call_to_action: {
          type: "APPLY_NOW",
          value: { link: "https://recruit.dropxlogistics.com", lead_gen_form_id: "998877" }
        }
      }
    };
    const result = buildReplacementObjectStorySpec(original, "a1b2c3d4e5f678901234567890abcdef");
    expect(result).toMatchObject({
      page_id: "123456",
      instagram_user_id: "456789",
      link_data: {
        image_hash: "a1b2c3d4e5f678901234567890abcdef",
        link: "https://recruit.dropxlogistics.com",
        message: "Join DropX Logistics",
        name: "Delivery Associate openings",
        call_to_action: {
          value: {
            lead_gen_form_id: "998877",
            link: "https://recruit.dropxlogistics.com"
          }
        }
      }
    });
    expect(result.link_data).not.toHaveProperty("picture");
    expect(result.link_data).not.toHaveProperty("image_crops");
    expect(result.link_data).not.toHaveProperty("attachment_style");
    expect(result.link_data).not.toHaveProperty("page_welcome_message");
    expect(original.link_data.picture).toBe("https://example.com/old.jpg");
  });

  it("does not replay unknown fields returned by Meta", () => {
    const result = buildReplacementObjectStorySpec({
      page_id: "123456",
      output_only_story_field: "do-not-replay",
      link_data: {
        link: "https://recruit.dropxlogistics.com",
        message: "Join DropX",
        name: "Open role",
        output_only_link_field: "do-not-replay",
        call_to_action: {
          type: "APPLY_NOW",
          value: {
            lead_gen_form_id: "998877",
            output_only_cta_field: "do-not-replay"
          }
        }
      }
    }, "a1b2c3d4e5f678901234567890abcdef");
    const resultLinkData = result.link_data as Record<string, any>;
    expect(result).not.toHaveProperty("output_only_story_field");
    expect(resultLinkData).not.toHaveProperty("output_only_link_field");
    expect(resultLinkData.call_to_action.value).not.toHaveProperty("output_only_cta_field");
  });

  it("requires Advertise or Full control Page tasks", () => {
    expect(hasMetaPageAdvertiseTask(["MANAGE_LEADS"])).toBe(false);
    expect(hasMetaPageAdvertiseTask(["MANAGE_LEADS", "ADVERTISE"])).toBe(true);
    expect(hasMetaPageAdvertiseTask(["MANAGE"])).toBe(true);
    expect(hasMetaPageAdvertiseTask(null)).toBe(false);
  });

  it("blocks carousel and invalid replacement creatives", () => {
    expect(() => buildReplacementObjectStorySpec({
      link_data: { child_attachments: [{ link: "https://example.com" }] }
    }, "a1b2c3d4e5f678901234567890abcdef")).toThrow("Carousel");
    expect(() => buildReplacementObjectStorySpec({ link_data: { link: "https://example.com" } }, "bad"))
      .toThrow("reference is invalid");
    expect(() => buildReplacementObjectStorySpec({ video_data: {} }, "a1b2c3d4e5f678901234567890abcdef"))
      .toThrow("cannot be replaced");
  });
});
