import type { InfluencerMilestone } from "./recruitment-workforce-config";

export function earnedInfluencerAmount(activeDays: number, milestones: InfluencerMilestone[]) {
  const days = Math.max(0, Number(activeDays) || 0);
  return milestones
    .filter((milestone) => days >= milestone.activeDays)
    .reduce((total, milestone) => total + milestone.amount, 0);
}

export function nextInfluencerMilestone(activeDays: number, milestones: InfluencerMilestone[]) {
  const days = Math.max(0, Number(activeDays) || 0);
  return milestones.find((milestone) => days < milestone.activeDays) ?? null;
}

export function influencerMilestoneProgress(activeDays: number, milestones: InfluencerMilestone[]) {
  const earnedAmount = earnedInfluencerAmount(activeDays, milestones);
  const next = nextInfluencerMilestone(activeDays, milestones);
  return {
    earnedAmount,
    nextMilestoneDays: next?.activeDays ?? null,
    nextMilestoneAmount: next?.amount ?? null,
    daysRemaining: next ? Math.max(0, next.activeDays - Math.max(0, Number(activeDays) || 0)) : 0,
    completed: next === null
  };
}

export function influencerCandidateStage(status: unknown, isActive: unknown) {
  const normalized = String(status ?? "pending").trim().toLowerCase();
  if (isActive === true && normalized === "active") return "Active";
  if (normalized === "inactive") return "Inactive";
  if (normalized === "returned") return "Correction required";
  if (["under_review", "review", "submitted"].includes(normalized)) return "HO review";
  if (["rejected", "cancelled"].includes(normalized)) return "Not approved";
  return "Registration pending";
}
