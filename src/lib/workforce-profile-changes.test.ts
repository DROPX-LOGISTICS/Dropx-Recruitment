import { describe, expect, it } from "vitest";
import {
  canApproveWorkforceProfileChanges,
  canCloseWorkforceInvitation,
  canRequestWorkforceProfileChange,
  isClosableWorkforceInvitation,
  workforceOnboardingStage
} from "./workforce-profile-changes";

describe("workforce onboarding profile changes", () => {
  it("shows the onboarding stage before the inactive database flag", () => {
    expect(workforceOnboardingStage({ is_active: false, onboarding_status: "pending" })).toEqual({
      code: "pending",
      label: "Invitation pending"
    });
    expect(workforceOnboardingStage({ is_active: false, onboarding_status: "under_review" }).label).toBe("Under review");
  });

  it("grants approval to the canonical Business Head or Owner", () => {
    expect(canApproveWorkforceProfileChanges({ designationCode: "BH" })).toBe(true);
    expect(canApproveWorkforceProfileChanges({ designationCode: "BUSINESS_HEAD" })).toBe(true);
    // Existing sessions using the retired label remain valid during cutover.
    expect(canApproveWorkforceProfileChanges({ designationCode: "ZONAL_HEAD" })).toBe(true);
    expect(canApproveWorkforceProfileChanges({ isOwner: true, designationCode: "TELE_CALLER" })).toBe(true);
    expect(canApproveWorkforceProfileChanges({ designationCode: "TELE_CALLER" })).toBe(false);
  });

  it("only lets the initiating profile request a limited correction", () => {
    expect(canRequestWorkforceProfileChange("telecaller-1", "telecaller-1")).toBe(true);
    expect(canRequestWorkforceProfileChange("telecaller-1", "telecaller-2")).toBe(false);
  });

  it("only treats an inactive, unsubmitted pending invitation as closable", () => {
    expect(isClosableWorkforceInvitation({ is_active: false, onboarding_status: "pending", onboarding_submitted_at: null })).toBe(true);
    expect(isClosableWorkforceInvitation({ is_active: false, onboarding_status: "submitted", onboarding_submitted_at: "2026-08-14T10:00:00Z" })).toBe(false);
    expect(isClosableWorkforceInvitation({ is_active: true, onboarding_status: "pending" })).toBe(false);
    expect(isClosableWorkforceInvitation({ is_active: false, onboarding_status: "cancelled" })).toBe(false);
  });

  it("lets the initiator close their own invitation but never a read-only preview", () => {
    const invitation = { is_active: false, onboarding_status: "pending", onboarding_submitted_at: null, created_by: "telecaller-1", location_id: "station-1" };
    expect(canCloseWorkforceInvitation("telecaller-1", invitation)).toBe(true);
    expect(canCloseWorkforceInvitation("telecaller-1", invitation, { readOnly: true })).toBe(false);
    expect(canCloseWorkforceInvitation("telecaller-2", invitation)).toBe(false);
  });

  it("applies reporting hierarchy and location scope to management closure", () => {
    const invitation = { is_active: false, onboarding_status: "pending", onboarding_submitted_at: null, created_by: "telecaller-1", location_id: "station-1" };
    expect(canCloseWorkforceInvitation("manager-1", invitation, {
      teamProfileIds: ["manager-1", "telecaller-1"],
      locationIds: ["station-1"]
    })).toBe(true);
    expect(canCloseWorkforceInvitation("manager-1", invitation, {
      teamProfileIds: ["manager-1", "telecaller-1"],
      locationIds: ["station-2"]
    })).toBe(false);
    expect(canCloseWorkforceInvitation("owner-1", invitation, {
      fullScope: true,
      allLocations: true
    })).toBe(true);
  });

  it("renders cancelled invitations as closed rather than inactive", () => {
    expect(workforceOnboardingStage({ is_active: false, onboarding_status: "cancelled" })).toEqual({
      code: "cancelled",
      label: "Invitation closed"
    });
  });
});
