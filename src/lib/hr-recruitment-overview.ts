export const currentRequisitionStatuses = ["open", "pending_approval", "on_hold", "draft"] as const;

export function normalizeCandidateLocation(cityValue: unknown, postCodeValue: unknown) {
  const city = String(cityValue ?? "").trim().slice(0, 180) || null;
  const postCode = String(postCodeValue ?? "").replace(/\s+/g, "").trim() || null;
  if (postCode && !/^\d{6}$/.test(postCode)) {
    throw new Error("Enter a valid 6-digit PIN code.");
  }
  return { city, postCode };
}

export function remainingRequisitionOpenings(openingsValue: unknown, filledValue: unknown) {
  const openings = Math.max(0, Math.floor(Number(openingsValue) || 0));
  const filled = Math.max(0, Math.floor(Number(filledValue) || 0));
  return Math.max(0, openings - filled);
}

export function isCurrentRequisitionStatus(value: unknown) {
  return currentRequisitionStatuses.includes(String(value ?? "") as typeof currentRequisitionStatuses[number]);
}
