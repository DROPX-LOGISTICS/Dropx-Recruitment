import { metaDeliveryStatus, type MetaDeliverySnapshot } from "./meta-ad-delivery";
import { assertMetaTargeting } from "./meta-targeting";
import { adRunEndTime } from "./ad-schedule";

export type RestartAdSnapshot = MetaDeliverySnapshot & {
  id: string;
  adset?: NonNullable<MetaDeliverySnapshot["adset"]> & {
    id?: string;
    daily_budget?: string;
    lifetime_budget?: string;
    targeting?: unknown;
    ads?: { data?: { id: string }[]; paging?: { next?: string } };
  };
  campaign?: NonNullable<MetaDeliverySnapshot["campaign"]> & {
    id?: string;
    daily_budget?: string;
    lifetime_budget?: string;
    is_adset_budget_sharing_enabled?: boolean;
  };
};

export const RESTART_AD_FIELDS = "id,status,configured_status,effective_status,adset{id,status,effective_status,start_time,end_time,daily_budget,lifetime_budget,targeting,ads.limit(2){id}},campaign{id,status,effective_status,daily_budget,lifetime_budget,is_adset_budget_sharing_enabled}";

export function validateRestartTerms(days: unknown, budget: unknown) {
  if (!Number.isInteger(Number(days)) || Number(days) < 1 || Number(days) > 90) {
    throw new Error("Choose a whole number of days between 1 and 90.");
  }
  if (!Number.isFinite(Number(budget)) || Number(budget) < 100 || !Number.isSafeInteger(Math.round(Number(budget) * 100))) {
    throw new Error("Daily budget must be at least ₹100.");
  }
  return { days: Number(days), budgetMinor: Math.round(Number(budget) * 100) };
}

/** Extend only an isolated, expired ad set. Keep the ad paused until read-back succeeds. */
export async function restartCompletedMetaAd(input: {
  adId: string;
  days: unknown;
  budget: unknown;
  expectedEndTime: string;
  audience: { stationCode: string; latitude: number; longitude: number };
  read: () => Promise<RestartAdSnapshot>;
  post: (id: string, values: Record<string, string>) => Promise<unknown>;
  now?: number;
}) {
  const terms = validateRestartTerms(input.days, input.budget);
  const now = input.now ?? Date.now();
  const before = await input.read();
  const adset = before.adset;
  const campaign = before.campaign;
  if (before.id !== input.adId || !adset?.id || !campaign?.id) throw new Error("Meta did not return this ad's campaign and ad set.");
  if (metaDeliveryStatus(before, now) !== "COMPLETED"
    || !Number.isFinite(Date.parse(input.expectedEndTime))
    || Date.parse(String(adset.end_time)) !== Date.parse(input.expectedEndTime)) {
    throw new Error("This ad's schedule has changed. Refresh Active Ads before running it again.");
  }
  if (String(campaign.effective_status || campaign.status) !== "ACTIVE") {
    throw new Error("The parent campaign is not active. Review it in Meta before running this ad again.");
  }
  if (!["ACTIVE", "PAUSED"].includes(String(before.status))
    || !["ACTIVE", "PAUSED"].includes(String(adset.status))) {
    throw new Error("This ad or ad set cannot be restarted in its current Meta state.");
  }
  const siblings = adset.ads?.data;
  if (!siblings || siblings.length !== 1 || siblings[0].id !== input.adId || adset.ads?.paging?.next) {
    throw new Error("This ad set is shared with other ads. Create a separate ad in Recruit to avoid changing their schedules.");
  }
  if (!(Number(adset.daily_budget) > 0) || Number(adset.lifetime_budget) > 0
    || Number(campaign.daily_budget) > 0 || Number(campaign.lifetime_budget) > 0
    || campaign.is_adset_budget_sharing_enabled !== false) {
    throw new Error("This ad uses a shared or lifetime budget. Create a separate ad in Recruit with its own daily budget.");
  }
  const pin = (adset.targeting as { geo_locations?: { custom_locations?: { radius?: number; distance_unit?: string }[] } })?.geo_locations?.custom_locations?.[0];
  const radiusKm = Number(pin?.radius) * (pin?.distance_unit === "mile" ? 1.609344 : 1);
  if (!Number.isFinite(radiusKm) || radiusKm <= 0 || !["mile", "kilometer"].includes(String(pin?.distance_unit))) throw new Error("Review this ad's audience radius in Meta before restarting.");
  const audience = { ...input.audience, radiusKm };
  assertMetaTargeting(adset.targeting, audience);
  const endTime = adRunEndTime(terms.days, now)!;
  const values = { end_time: endTime, daily_budget: String(terms.budgetMinor), status: "ACTIVE" };
  await input.post(adset.id, { ...values, execution_options: JSON.stringify(["validate_only"]) });

  const verify = (snapshot: RestartAdSnapshot) => {
    if (!snapshot.adset || !snapshot.campaign
      || snapshot.id !== input.adId || snapshot.adset.id !== adset.id || snapshot.campaign.id !== campaign.id
      || Date.parse(String(snapshot.adset.end_time)) !== Date.parse(endTime)
      || Number(snapshot.adset.daily_budget) !== terms.budgetMinor
      || String(snapshot.adset.status) !== "ACTIVE"
      || String(snapshot.campaign.effective_status || snapshot.campaign.status) !== "ACTIVE") {
      throw new Error("Meta did not confirm the requested schedule, budget and active parents.");
    }
    if (snapshot.adset.ads?.data?.length !== 1 || snapshot.adset.ads.data[0].id !== input.adId || snapshot.adset.ads?.paging?.next
      || Number(snapshot.adset.lifetime_budget) > 0 || Number(snapshot.campaign.daily_budget) > 0
      || Number(snapshot.campaign.lifetime_budget) > 0 || snapshot.campaign.is_adset_budget_sharing_enabled !== false) {
      throw new Error("The ad's budget or schedule is now shared. Review it in Meta before retrying.");
    }
    assertMetaTargeting(snapshot.adset.targeting, audience);
  };
  try {
    await input.post(input.adId, { status: "PAUSED" });
    // A concurrent change or retry must not extend an already restarted schedule.
    const paused = await input.read();
    if (!paused.adset || !paused.campaign || String(paused.status) !== "PAUSED" || paused.adset.id !== adset.id
      || Date.parse(String(paused.adset.end_time)) !== Date.parse(input.expectedEndTime)
      || paused.adset.ads?.data?.length !== 1 || paused.adset.ads.data[0].id !== input.adId || paused.adset.ads.paging?.next
      || paused.campaign?.id !== campaign.id || String(paused.campaign.status) !== "ACTIVE"
      || Number(paused.campaign.daily_budget) > 0 || Number(paused.campaign.lifetime_budget) > 0
      || paused.campaign.is_adset_budget_sharing_enabled !== false || Number(paused.adset.lifetime_budget) > 0) {
      throw new Error("The ad changed while preparing the restart. Refresh Active Ads.");
    }
    assertMetaTargeting(paused.adset.targeting, audience);
    await input.post(adset.id, values);
    verify(await input.read());
    await input.post(input.adId, { status: "ACTIVE" });
    const after = await input.read();
    verify(after);
    if (String(after.status) !== "ACTIVE") throw new Error("Meta has not confirmed that the ad is switched on.");
    return { before, after, endTime, dailyBudget: terms.budgetMinor / 100 };
  } catch (error) {
    try {
      await input.post(input.adId, { status: "PAUSED" });
    } catch {
      throw new Error("The restart could not be verified, and Meta did not confirm the safety pause. Check this ad in Meta Ads Manager before retrying.");
    }
    throw new Error(`${error instanceof Error ? error.message : "The restart could not be verified."} The ad is paused; refresh Active Ads to review its current schedule.`);
  }
}
