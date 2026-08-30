export type MetaBudgetEntity = {
  id?: string | null;
  daily_budget?: string | number | null;
  lifetime_budget?: string | number | null;
};

export type MetaDailyBudgetTarget = {
  id: string;
  source: "campaign" | "adset";
};

function hasBudget(value: unknown) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

export function resolveMetaDailyBudgetTarget(input: {
  campaign?: MetaBudgetEntity | null;
  adset?: MetaBudgetEntity | null;
  fallback?: {
    source?: unknown;
    campaignId?: unknown;
    adsetId?: unknown;
  };
}): { target: MetaDailyBudgetTarget | null; reason: "daily" | "lifetime" | "missing" } {
  if (input.campaign?.id && hasBudget(input.campaign.daily_budget)) {
    return { target: { id: String(input.campaign.id), source: "campaign" }, reason: "daily" };
  }
  if (input.adset?.id && hasBudget(input.adset.daily_budget)) {
    return { target: { id: String(input.adset.id), source: "adset" }, reason: "daily" };
  }
  if (hasBudget(input.campaign?.lifetime_budget) || hasBudget(input.adset?.lifetime_budget)) {
    return { target: null, reason: "lifetime" };
  }

  const fallbackSource = String(input.fallback?.source || "adset") === "campaign"
    ? "campaign"
    : "adset";
  const fallbackId = fallbackSource === "campaign"
    ? String(input.fallback?.campaignId || "")
    : String(input.fallback?.adsetId || "");
  return fallbackId
    ? { target: { id: fallbackId, source: fallbackSource }, reason: "daily" }
    : { target: null, reason: "missing" };
}
