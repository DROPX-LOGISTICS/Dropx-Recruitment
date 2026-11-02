import { adRunEndTime, sameMetaInstant, toMetaGraphDateTime } from "./ad-schedule";
import type { RestartAdSnapshot } from "./meta-ad-restart";

export function validateExtensionTerms(days: unknown, expectedEndTime: unknown, expectedBudget: unknown, now = Date.now()) {
  const end = Date.parse(String(expectedEndTime || ""));
  const endTime = adRunEndTime(Number(days), end);
  if (!Number.isInteger(Number(days)) || Number(days) < 1 || Number(days) > 90) {
    throw new Error("Choose a whole number of extra days between 1 and 90.");
  }
  if (!endTime) throw new Error("This ad has no scheduled end date. It already runs until paused.");
  if (end <= now) throw new Error("This ad has ended. Refresh Active Ads and choose Run again.");
  if (!Number.isFinite(Number(expectedBudget)) || Number(expectedBudget) <= 0) {
    throw new Error("Refresh Active Ads to load the current daily budget before extending this ad.");
  }
  return { endTime: toMetaGraphDateTime(endTime)!, budgetMinor: Math.round(Number(expectedBudget) * 100) };
}

/** Change only end_time. Absolute, expected-date-based updates cannot compound on retry. */
export async function extendMetaAd(input: {
  adId: string;
  days: unknown;
  expectedEndTime: string;
  expectedBudget: unknown;
  read: () => Promise<RestartAdSnapshot>;
  post: (id: string, values: Record<string, string>) => Promise<unknown>;
  now?: number;
  sleep?: (ms: number) => Promise<void>;
}) {
  const terms = validateExtensionTerms(input.days, input.expectedEndTime, input.expectedBudget, input.now);
  const before = await input.read();
  const adset = before.adset;
  const campaign = before.campaign;
  if (before.id !== input.adId || !adset?.id || !campaign?.id) {
    throw new Error("Meta did not return this ad's campaign and ad set.");
  }
  if (!sameMetaInstant(adset.end_time, input.expectedEndTime, 1000)) {
    throw new Error("This ad's schedule has changed. Refresh Active Ads before extending it.");
  }
  if (!["ACTIVE", "PAUSED"].includes(String(before.status))
    || !["ACTIVE", "PAUSED"].includes(String(adset.status))
    || !["ACTIVE", "PAUSED"].includes(String(campaign.status))) {
    throw new Error("This ad cannot be extended in its current Meta state. Refresh Active Ads.");
  }
  if (adset.ads?.data?.length !== 1 || adset.ads.data[0].id !== input.adId || adset.ads.paging?.next) {
    throw new Error("This ad shares its schedule with other ads. Review the shared ad set in Meta Ads Manager before extending it.");
  }
  if (!(Number(adset.daily_budget) > 0) || Number(adset.lifetime_budget) > 0
    || Number(campaign.daily_budget) > 0 || Number(campaign.lifetime_budget) > 0
    || campaign.is_adset_budget_sharing_enabled !== false) {
    throw new Error("This ad uses a shared or lifetime budget. Review its schedule in Meta Ads Manager.");
  }
  if (Number(adset.daily_budget) !== terms.budgetMinor) {
    throw new Error("The daily budget has changed. Refresh Active Ads to review the cost before extending it.");
  }

  // Do not change status, budget, audience, creative or start_time.
  await input.post(adset.id, { end_time: terms.endTime });
  const wait = input.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  for (let attempt = 0; attempt < 3; attempt++) {
    const after = await input.read();
    if (after.id === input.adId && after.adset?.id === adset.id && after.campaign?.id === campaign.id
      && sameMetaInstant(after.adset.end_time, terms.endTime, 1000)) {
      return { before, after, endTime: terms.endTime, dailyBudget: Number(after.adset.daily_budget) / 100 };
    }
    if (attempt < 2) await wait(1000);
  }
  throw new Error("Meta has not confirmed the new end date. Refresh Active Ads before retrying; the extension may already be saved.");
}
