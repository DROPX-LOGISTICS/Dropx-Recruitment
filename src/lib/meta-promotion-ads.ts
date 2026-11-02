import { metaPromotionGateway, metaDailyBudgetMinorUnits, type MetaPublishProgress } from "./meta-ad-builder";
import { AUDIENCE_EDIT_FIELDS } from "./meta-ad-audience-edit";
import { assertPromotionContent, assertPromotionSnapshot, assertPromotionTargeting, promotionEditVersion, promotionTargeting, type PromotionDraft, type PromotionDemographics, type PromotionSnapshot } from "./promotion-audience";

const snapshotFields = `${AUDIENCE_EDIT_FIELDS},creative{id}`.replace("campaign{id,name,status", "campaign{id,objective,name,status");
export async function getPromotionSnapshot(adId: string) {
  return await (await metaPromotionGateway()).read(adId, snapshotFields) as PromotionSnapshot;
}
export function promotionCampaignValues(draft: PromotionDraft) {
  return { name: `[DropX Promotion] ${draft.campaignName || draft.adName}`, objective: "OUTCOME_TRAFFIC", buying_type: "AUCTION", special_ad_categories: "[]", is_adset_budget_sharing_enabled: "false", status: "PAUSED" };
}
export function promotionAdSetValues(draft: PromotionDraft, campaignId: string, now = new Date()) {
  const start = new Date(now.getTime() + 10 * 60_000);
  return { name: draft.adSetName, campaign_id: campaignId, daily_budget: metaDailyBudgetMinorUnits(draft.dailyBudget), billing_event: "IMPRESSIONS", optimization_goal: "LINK_CLICKS", bid_strategy: "LOWEST_COST_WITHOUT_CAP", destination_type: "WEBSITE",
    targeting: JSON.stringify(promotionTargeting(draft.audience, draft.audience.radiusKm, draft.demographics)), start_time: start.toISOString(), end_time: new Date(start.getTime() + draft.daysRequired * 86400000).toISOString(), status: "PAUSED" };
}
export async function validatePromotionCampaign(draft: PromotionDraft) {
  assertPromotionContent(draft);
  const graph = await metaPromotionGateway();
  await graph.post(`act_${graph.accountId}/campaigns`, { ...promotionCampaignValues(draft), execution_options: '["validate_only"]' });
}
export async function publishPromotion(draft: PromotionDraft, onProgress: (progress: MetaPublishProgress) => Promise<void>) {
  assertPromotionContent(draft);
  const graph = await metaPromotionGateway(), account = `act_${graph.accountId}`;
  const progress: MetaPublishProgress = {};
  const create = async (collection: string, values: Record<string, string>, key: keyof MetaPublishProgress) => {
    const value = await graph.post(`${account}/${collection}`, values);
    if (!/^\d+$/.test(String(value.id || ""))) throw new Error(`Meta did not return the ${collection} reference.`);
    progress[key] = String(value.id); await onProgress({ ...progress });
  };
  // All objects stay paused until their saved audience has been verified.
  await create("campaigns", promotionCampaignValues(draft), "campaignId");
  const adset = promotionAdSetValues(draft, progress.campaignId!);
  await graph.post(`${account}/adsets`, { ...adset, execution_options: '["validate_only"]' });
  await create("adsets", adset, "adSetId");
  const saved = await graph.read(progress.adSetId!, "id,campaign_id,targeting,daily_budget,start_time,end_time");
  assertPromotionTargeting(saved.targeting, draft.audience, draft.audience.radiusKm, draft.demographics);
  if (String(saved.campaign_id) !== progress.campaignId || Number(saved.daily_budget) !== Number(adset.daily_budget) || Math.abs(Date.parse(String(saved.end_time)) - Date.parse(String(saved.start_time)) - draft.daysRequired * 86400000) > 60_000 || !Number.isFinite(Date.parse(String(saved.end_time)))) throw new Error("Meta saved different budget or schedule details. Review the paused promotion in Meta.");
  await create("adcreatives", { name: draft.creativeName, object_story_spec: JSON.stringify({ page_id: graph.pageId, link_data: { link: draft.destinationUrl, image_hash: draft.imageHash, message: draft.primaryText, name: draft.headline, description: draft.description || undefined, call_to_action: { type: "LEARN_MORE", value: { link: draft.destinationUrl } } } }) }, "creativeId");
  await create("ads", { name: draft.adName, adset_id: progress.adSetId!, creative: JSON.stringify({ creative_id: progress.creativeId }), status: "PAUSED" }, "adId");
  const snapshot = await graph.read(progress.adId!, snapshotFields) as PromotionSnapshot;
  assertPromotionSnapshot(snapshot, { meta_ad_id: progress.adId!, progress, draft });
  return { progress, snapshot };
}
export async function updatePromotionAudience(input: { record: { meta_ad_id: string; progress: MetaPublishProgress; draft: PromotionDraft }; expectedVersion: string; point: { latitude: number; longitude: number }; radiusKm: number; demographics: PromotionDemographics; validateOnly: boolean }) {
  const graph = await metaPromotionGateway();
  const read = async () => {
    const snapshot = await graph.read(input.record.meta_ad_id, snapshotFields) as PromotionSnapshot;
    assertPromotionSnapshot(snapshot, input.record);
    return snapshot;
  };
  const check = async () => { const snapshot = await read(); if (promotionEditVersion(snapshot) !== input.expectedVersion) throw new Error("The promotion changed in Meta. Reload and review its audience again."); return snapshot; };
  const before = await check(), targeting = { ...before.adset?.targeting, ...promotionTargeting(input.point, input.radiusKm, input.demographics) };
  if (!input.validateOnly) await graph.post(before.adset!.id, { targeting: JSON.stringify(targeting), execution_options: '["validate_only"]' }, async () => { await check(); });
  await graph.post(before.adset!.id, { targeting: JSON.stringify(targeting), ...(input.validateOnly ? { execution_options: '["validate_only"]' } : {}) }, async () => { await check(); });
  if (input.validateOnly) return before;
  const after = await read();
  assertPromotionTargeting(after.adset?.targeting, input.point, input.radiusKm, input.demographics);
  return after;
}
export async function setPromotionDelivery(record: { meta_ad_id: string; progress: MetaPublishProgress; draft: PromotionDraft }, status: "ACTIVE" | "PAUSED", expectedVersion: string) {
  const graph = await metaPromotionGateway();
  const current = await graph.read(record.meta_ad_id, snapshotFields) as PromotionSnapshot;
  assertPromotionSnapshot(current, record);
  if (promotionEditVersion(current) !== expectedVersion) throw new Error("The promotion changed. Refresh before changing delivery.");
  if (status === "ACTIVE") {
    const campaign = await graph.read(record.progress.campaignId!, "id,adsets.limit(2){id}") as { adsets?: { data?: { id: string }[]; paging?: { next?: string } } };
    if (campaign.adsets?.data?.length !== 1 || campaign.adsets.data[0].id !== record.progress.adSetId || campaign.adsets?.paging?.next) throw new Error("This campaign now contains other ad sets. Manage its delivery in Meta to avoid affecting other ads.");
    const adset = await graph.read(record.progress.adSetId!, "end_time,targeting,daily_budget");
    assertPromotionTargeting(adset.targeting, record.draft.audience, record.draft.audience.radiusKm, record.draft.demographics);
    if (!(Date.parse(String(adset.end_time)) > Date.now()) || Number(adset.daily_budget) !== Number(metaDailyBudgetMinorUnits(record.draft.dailyBudget))) throw new Error("Check the promotion budget and end date in Meta before resuming.");
    // The dedicated campaign/ad set were created only for this promotion.
    await graph.post(record.progress.adSetId!, { status });
    await graph.post(record.progress.campaignId!, { status });
  }
  await graph.post(record.meta_ad_id, { status });
  const after = await graph.read(record.meta_ad_id, snapshotFields) as PromotionSnapshot;
  assertPromotionSnapshot(after, record);
  if (after.status !== status) throw new Error("Meta has not confirmed this delivery change. Refresh before retrying.");
  return after;
}
