import { describe, expect, it } from "vitest";
import {
  earnedInfluencerAmount,
  influencerCandidateStage,
  influencerMilestoneProgress
} from "./influencer-program";

const milestones = [
  { activeDays: 10, amount: 300 },
  { activeDays: 20, amount: 700 },
  { activeDays: 30, amount: 1000 }
];

describe("recruitment influencer milestones", () => {
  it("uses the cumulative 10/20/30 active-day pilot ladder", () => {
    expect(earnedInfluencerAmount(9, milestones)).toBe(0);
    expect(earnedInfluencerAmount(10, milestones)).toBe(300);
    expect(earnedInfluencerAmount(20, milestones)).toBe(1000);
    expect(earnedInfluencerAmount(30, milestones)).toBe(2000);
  });

  it("shows the next milestone without paying for a raw registration", () => {
    expect(influencerMilestoneProgress(0, milestones)).toMatchObject({
      earnedAmount: 0, nextMilestoneDays: 10, daysRemaining: 10, completed: false
    });
    expect(influencerMilestoneProgress(30, milestones)).toMatchObject({
      earnedAmount: 2000, nextMilestoneDays: null, daysRemaining: 0, completed: true
    });
  });

  it("keeps candidate registration and activation states explicit", () => {
    expect(influencerCandidateStage("pending", false)).toBe("Registration pending");
    expect(influencerCandidateStage("submitted", false)).toBe("HO review");
    expect(influencerCandidateStage("active", true)).toBe("Active");
  });
});
