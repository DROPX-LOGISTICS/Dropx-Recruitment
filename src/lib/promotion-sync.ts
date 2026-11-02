/** The prefix also covers the interval between Meta creation and its DB checkpoint. */
export function isCustomerPromotion(ad: { id?: string; campaign?: { id?: string; name?: string } }, records: Array<{ meta_ad_id?: string | null; progress?: any }>) {
  return String(ad.campaign?.name || "").startsWith("[DropX Promotion] ") || records.some(record =>
    (!!record.meta_ad_id && record.meta_ad_id === ad.id) || (!!record.progress?.campaignId && record.progress.campaignId === ad.campaign?.id));
}
