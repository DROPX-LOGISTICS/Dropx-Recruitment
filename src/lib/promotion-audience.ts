import { createHash } from "node:crypto";
import { validateMetaAdDraft, type MetaAdDraft } from "./meta-ad-builder";
import { audienceEditBlocker, audienceVersion, currentAudiencePin, type AudienceSnapshot } from "./meta-ad-audience-edit";
import { validateAdAudiencePin } from "./meta-audience-pin";
import { isValidMetaAudienceRadius } from "./meta-audience-radius";
import { assertMetaTargeting } from "./meta-targeting";

export type PromotionDemographics = { ageMin: number; ageMax: number; gender: "all" | "male" | "female" };
export type PromotionPurpose = "service_offer" | "customer_offer" | "brand";
export type PromotionDraft = MetaAdDraft & { purpose: PromotionPurpose; demographics: PromotionDemographics };
export type PromotionSnapshot = AudienceSnapshot & { creative?: { id?: string }; campaign?: AudienceSnapshot["campaign"] & { objective?: string }; adset?: NonNullable<AudienceSnapshot["adset"]> & { daily_budget?: string; start_time?: string; end_time?: string } };
const unsupported = /\b(jobs?|hiring|recruit(?:ment|ing)?|vacanc(?:y|ies)|careers?|salary|salaries|wishmaster|delivery associate|apply now|join our team|employment|housing|mortgages?|loans?|insurance|credit cards?|admissions?|scholarships?|medical treatment|elections?)\b/i;

export function promotionDemographics(value: unknown): PromotionDemographics {
  const source = value as Record<string, unknown> | null;
  const ageMin = Number(source?.ageMin), ageMax = Number(source?.ageMax);
  if (!source || source.ageMin == null || source.ageMax == null || !Number.isInteger(ageMin) || !Number.isInteger(ageMax) || ageMin < 18 || ageMax > 65 || ageMin > ageMax || !["all", "male", "female"].includes(String(source.gender))) {
    throw new Error("Choose a valid adult age range from 18 to 65+ and a gender audience.");
  }
  return { ageMin, ageMax, gender: source.gender as PromotionDemographics["gender"] };
}
export function demographicsTargeting(value: PromotionDemographics) {
  const demographic = promotionDemographics(value);
  return { age_min: demographic.ageMin, age_max: demographic.ageMax, genders: demographic.gender === "all" ? [1, 2] : demographic.gender === "male" ? [1] : [2] };
}
export function assertPromotionContent(input: { purpose: unknown; adName: string; headline: string; primaryText: string; description?: string | null; destinationUrl: string }) {
  if (!["service_offer", "customer_offer", "brand"].includes(String(input.purpose))) throw new Error("Choose a service promotion, customer offer or brand campaign.");
  const url = new URL(input.destinationUrl);
  const text = [input.adName, input.headline, input.primaryText, input.description, url.hostname, decodeURIComponent(url.pathname)].join(" ").normalize("NFKC").replace(/[_\-/]+/g, " ");
  if (unsupported.test(text) || /^(recruit|people|one|workforce)\./i.test(url.hostname)) throw new Error("This content or destination belongs to a hiring or other restricted campaign. Use the appropriate campaign flow; customer promotions cannot be used to change its audience rules.");
}
export function validatePromotionDraft(input: unknown, audience: MetaAdDraft["audience"]): PromotionDraft {
  const source = input as Record<string, unknown> | null;
  if (!source || source.campaignCategory !== "STANDARD_INDIA" || source.campaignMode === "existing" || source.formId || source.roleId) throw new Error("Customer promotions use a new Standard India website campaign, without a recruitment form or designation.");
  // Explicit construction prevents supplied campaign IDs, form IDs or targeting from crossing flows.
  const draft = validateMetaAdDraft({ campaignMode: "new", campaignCategory: "STANDARD_INDIA", campaignName: String(source.campaignName || source.adName || ""),
    formId: "website-promotion", dailyBudget: Number(source.dailyBudget), daysRequired: Number(source.daysRequired),
    adName: String(source.adName || ""), adSetName: `${String(source.adName || "")}_Audience`, creativeName: `${String(source.adName || "")}_Creative`,
    primaryText: String(source.primaryText || ""), headline: String(source.headline || ""), description: String(source.description || ""), imageHash: String(source.imageHash || ""),
    posterUrl: String(source.posterUrl || ""), destinationUrl: String(source.destinationUrl || ""), callToAction: "LEARN_MORE", audience });
  if (!draft.imageHash) throw new Error("Upload the promotion image before reviewing.");
  const result = { ...draft, purpose: source.purpose as PromotionPurpose, demographics: promotionDemographics(source.demographics) };
  assertPromotionContent(result);
  return result;
}
export function promotionReviewVersion(draft: PromotionDraft) {
  return createHash("sha256").update(JSON.stringify(draft)).digest("hex");
}
export function promotionTargeting(point: { latitude: number; longitude: number }, radiusKm: number, demographic: PromotionDemographics) {
  const pin = validateAdAudiencePin(point);
  if (!isValidMetaAudienceRadius(radiusKm)) throw new Error("Choose a whole-number radius from 3 to 80 km.");
  return { ...demographicsTargeting(demographic), targeting_automation: { advantage_audience: 0 },
    geo_locations: { custom_locations: [{ latitude: pin.latitude, longitude: pin.longitude, radius: radiusKm, distance_unit: "kilometer" }], location_types: ["home", "recent"] } };
}
export function assertPromotionTargeting(targeting: any, point: { latitude: number; longitude: number }, radiusKm: number, demographic: PromotionDemographics) {
  assertMetaTargeting(targeting, { ...point, radiusKm, stationCode: "promotion" });
  const expected = demographicsTargeting(demographic), genders = [...(targeting?.genders?.length ? targeting.genders : [1, 2])].sort();
  if (Number(targeting?.age_min ?? 18) !== expected.age_min || Number(targeting?.age_max ?? 65) !== expected.age_max || JSON.stringify(genders) !== JSON.stringify(expected.genders) || Number(targeting?.targeting_automation?.advantage_audience || 0) !== 0) throw new Error("Meta has not confirmed the selected age and gender audience. The promotion has not been activated.");
}
export function assertPromotionSnapshot(snapshot: PromotionSnapshot, record: { meta_ad_id: string; progress: { creativeId?: string; adSetId?: string; campaignId?: string }; draft: PromotionDraft }) {
  assertPromotionContent(record.draft);
  if (snapshot.id !== record.meta_ad_id || snapshot.creative?.id !== record.progress.creativeId || snapshot.adset?.id !== record.progress.adSetId || snapshot.campaign?.id !== record.progress.campaignId) throw new Error("This promotion changed in Meta. Review its creative and campaign before editing its audience.");
  if (snapshot.campaign?.objective !== "OUTCOME_TRAFFIC" || !Array.isArray(snapshot.campaign?.special_ad_categories) || snapshot.campaign.special_ad_categories.some(category => category !== "NONE")) throw new Error("Age and gender editing is only available for this promotion’s Standard India website campaign.");
  const blocker = audienceEditBlocker(snapshot); if (blocker) throw new Error(blocker);
}
export function promotionEditVersion(snapshot: PromotionSnapshot) {
  return createHash("sha256").update(JSON.stringify([audienceVersion(snapshot, null), snapshot.creative?.id, snapshot.campaign?.objective, snapshot.adset?.daily_budget, snapshot.adset?.start_time, snapshot.adset?.end_time])).digest("hex");
}
export { currentAudiencePin };
