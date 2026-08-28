import { describe, expect, it } from "vitest";
import { defaultHrLifecycleRules } from "./hr-recruitment-lifecycle";
import { buildHrUserPerformance, candidateJourney, hrLifecycleFilterOptions, hrQueueStatusQuery } from "./hr-ats-product";

describe("HR ATS product rules", () => {
  it("uses the HR lifecycle master for candidate filters", () => {
    const options = hrLifecycleFilterOptions(defaultHrLifecycleRules);
    expect(options[0]).toEqual(["new", "New profile"]);
    expect(options.some(([code]) => code === "assigned")).toBe(false);
    expect(options.some(([code]) => code === "offer_pending")).toBe(true);
  });

  it("keeps queue membership aligned to the HR lifecycle", () => {
    expect(hrQueueStatusQuery("Screening")).toBe("new,contacting,screening,documents_pending");
    expect(hrQueueStatusQuery("Interviews")).toBe("");
    expect(hrQueueStatusQuery("Offers")).toBe("selected,offer_pending,offered");
  });

  it("shows blockers and the next candidate action", () => {
    expect(candidateJourney("screening", defaultHrLifecycleRules, { hasResume: false })).toMatchObject({
      activeStage: 1,
      nextAction: "Collect resume",
      blockers: ["Resume missing"]
    });
    expect(candidateJourney("interview_scheduled", defaultHrLifecycleRules, {
      hasResume: true,
      interviewCount: 1,
      latestInterviewStatus: "scheduled",
      latestInterviewHasCalendar: false,
      latestInterviewHasMeet: false
    }).blockers).toEqual(["Calendar invite not confirmed", "Meeting link not available"]);
  });

  it("attributes HR work to the user who performed each action", () => {
    const rows = buildHrUserPerformance([
      { lead_id: "a", event_type: "hr_initial_call_outcome", actor_profile_id: "p1", actor_email: "hr@dropx.test", created_at: "2026-08-10T01:00:00Z" },
      { lead_id: "a", event_type: "hr_screening_profile", actor_profile_id: "p1", actor_email: "hr@dropx.test", created_at: "2026-08-10T02:00:00Z" },
      { lead_id: "b", event_type: "hr_interview_forwarded", actor_profile_id: "p1", actor_email: "hr@dropx.test", created_at: "2026-08-10T03:00:00Z" }
    ]);
    expect(rows[0]).toMatchObject({ totalUpdates: 3, uniqueCandidates: 2, firstCalls: 1, screenings: 1, interviews: 1 });
  });

  it("keeps system automation out of recruiter performance", () => {
    const rows = buildHrUserPerformance([
      { lead_id: "lead-1", event_type: "source_ingest", actor_email: "system:meta_poll", created_at: "2026-08-10T03:00:00Z" },
      { lead_id: "lead-1", event_type: "hr_initial_call_outcome", actor_profile_id: "profile-1", actor_email: "hr@dropxlogistics.com", created_at: "2026-08-10T04:00:00Z" }
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ profileId: "profile-1", email: "hr@dropxlogistics.com", firstCalls: 1 });
  });
});
