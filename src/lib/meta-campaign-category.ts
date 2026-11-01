export type MetaCampaignCategory = "EMPLOYMENT" | "STANDARD_INDIA";

export function normalizeMetaCampaignCategory(value: unknown): MetaCampaignCategory {
  // Older saved drafts retain their original category on retry.
  if (value == null || value === "" || value === "EMPLOYMENT") return "EMPLOYMENT";
  if (value === "STANDARD_INDIA") return value;
  throw new Error("Choose a supported recruitment campaign category.");
}

export function metaCampaignCategoryLabel(value: unknown) {
  return normalizeMetaCampaignCategory(value) === "STANDARD_INDIA"
    ? "Standard · India" : "Employment special category";
}

export function matchesMetaCampaignCategory(categories: string[], category: unknown) {
  return normalizeMetaCampaignCategory(category) === "STANDARD_INDIA"
    ? categories.length === 0 || (categories.length === 1 && categories[0] === "NONE")
    : categories.length === 1 && categories[0] === "EMPLOYMENT";
}

export function assertMetaCampaignCompatibility(input: {
  category: unknown; accountCountry: string; radiusKm: number;
  campaign?: { objective: string; specialAdCategories: string[] } | null;
}) {
  const category = normalizeMetaCampaignCategory(input.category);
  if (category === "STANDARD_INDIA" && input.accountCountry.toUpperCase() !== "IN") {
    throw new Error("Standard India campaigns require an ad account with a verified Indian business country. Use Employment or check the account settings in Meta.");
  }
  if (category === "EMPLOYMENT" && input.radiusKm < 15) {
    throw new Error("This radius is below the Employment campaign range. For an eligible Indian account, select Standard · India. Meta validates the exact radius before publishing.");
  }
  if (input.campaign && (input.campaign.objective !== "OUTCOME_LEADS"
    || !matchesMetaCampaignCategory(input.campaign.specialAdCategories, category))) {
    throw new Error("The selected campaign does not match this category and the Leads objective. Choose a matching campaign or create a new one.");
  }
}
