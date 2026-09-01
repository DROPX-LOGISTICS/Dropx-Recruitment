export type WorkforceOnboardingRecord = {
  is_active?: boolean | null;
  onboarding_status?: string | null;
  onboarding_submitted_at?: string | null;
  created_by?: string | null;
  location_id?: string | null;
};

export type WorkforceProfileChangeActor = {
  isOwner?: boolean;
  designationCode?: string | null;
};

const stageLabels: Record<string, string> = {
  pending: "Invitation pending",
  submitted: "Profile submitted",
  under_review: "Under review",
  returned: "Changes requested",
  approved: "Activation pending",
  rejected: "Not approved",
  cancelled: "Invitation closed"
};

export function workforceOnboardingStage(record: WorkforceOnboardingRecord) {
  const onboardingStatus = String(record.onboarding_status ?? "").trim().toLowerCase();
  if (record.is_active === true) return { code: "active", label: "Active" };
  if (stageLabels[onboardingStatus]) {
    return { code: onboardingStatus, label: stageLabels[onboardingStatus] };
  }
  return { code: "inactive", label: "Inactive / deactivated" };
}

export function workforceOnboardingStatusLabel(value: unknown) {
  const status = String(value ?? "").trim().toLowerCase();
  if (status === "active") return "Active";
  if (status === "inactive") return "Inactive / deactivated";
  return stageLabels[status] ?? status.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function canApproveWorkforceProfileChanges(actor: WorkforceProfileChangeActor) {
  const designation = String(actor.designationCode ?? "").trim().toUpperCase();
  return actor.isOwner === true || [
    "BH",
    "BUSINESS_HEAD",
    // Compatibility aliases remain accepted for already-issued sessions.
    "ZONAL_HEAD",
    "ZONE_HEAD",
    "ZH"
  ].includes(designation);
}

export function canRequestWorkforceProfileChange(profileId: string, createdBy: unknown) {
  return Boolean(profileId) && String(createdBy ?? "").trim() === profileId;
}

export function isClosableWorkforceInvitation(record: WorkforceOnboardingRecord) {
  return record.is_active !== true
    && String(record.onboarding_status ?? "").trim().toLowerCase() === "pending"
    && !record.onboarding_submitted_at;
}

type WorkforceInvitationClosureScope = {
  fullScope?: boolean;
  teamProfileIds?: readonly string[];
  allLocations?: boolean;
  locationIds?: readonly string[];
  readOnly?: boolean;
};

/**
 * Pending invitations are never hard-deleted. The creator may close their own
 * unsubmitted invitation. Management access follows the configured reporting
 * hierarchy/menu scope and the viewer's assigned location scope.
 */
export function canCloseWorkforceInvitation(
  profileId: string,
  record: WorkforceOnboardingRecord,
  scope: WorkforceInvitationClosureScope = {}
) {
  if (!profileId || scope.readOnly || !isClosableWorkforceInvitation(record)) return false;
  const creatorId = String(record.created_by ?? "").trim();
  if (creatorId === profileId) return true;
  const locationAllowed = scope.allLocations === true
    || Boolean(record.location_id && scope.locationIds?.includes(record.location_id));
  if (!locationAllowed) return false;
  if (scope.fullScope) return true;
  return Boolean(creatorId && scope.teamProfileIds?.includes(creatorId));
}
