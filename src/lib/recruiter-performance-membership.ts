import type { RecruitmentFunction } from "./recruitment-workforce-config";

export type PerformanceMember = {
  profileId: string;
  accessId: string;
  name: string;
  email: string | null;
  function: RecruitmentFunction;
  reportingManagerProfileId: string | null;
  locationIds: string[];
  active: boolean;
  workforceEnabled: boolean;
};

export type PerformanceView = "telecaller" | "influencer" | "combined";

export type PerformanceAttributionEvent = {
  actor_profile_id?: string | null;
  actor_email?: string | null;
  metadata?: Record<string, unknown> | null;
};

function cleanProfileId(value: unknown) {
  return String(value ?? "").trim();
}

/**
 * Performance history predates the current actor_profile_id column. Older
 * mobile/calling actions stored the responsible user in metadata instead.
 * Return every explicit attribution once so manager totals use the same
 * action history that an individual scorecard can see.
 */
export function performanceActorIds(
  event: PerformanceAttributionEvent,
  profileIdByEmail: ReadonlyMap<string, string | readonly string[]>
) {
  const metadata = event.metadata ?? {};
  const ids = [
    event.actor_profile_id,
    metadata.telecaller_profile_id,
    metadata.recruiter_profile_id,
    metadata.field_recruiter_profile_id,
    metadata.influencer_profile_id,
    metadata.actor_profile_id
  ].map(cleanProfileId).filter(Boolean);
  const email = String(
    event.actor_email
      ?? metadata.telecaller_email
      ?? metadata.recruiter_email
      ?? ""
  ).trim().toLowerCase();
  const emailProfileIds = email ? profileIdByEmail.get(email) : null;
  if (Array.isArray(emailProfileIds)) ids.push(...emailProfileIds);
  else if (emailProfileIds) ids.push(emailProfileIds as string);
  return [...new Set(ids)];
}

export function effectivePerformanceFunction(input: {
  configuredFunction: RecruitmentFunction;
  canViewTelecallerPerformance: boolean;
}) {
  if (input.configuredFunction !== "viewer") return input.configuredFunction;
  return input.canViewTelecallerPerformance ? "telecaller" : "viewer";
}

function teamProfileIds(viewerProfileId: string, members: PerformanceMember[]) {
  const visible = new Set([viewerProfileId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const member of members) {
      if (!member.reportingManagerProfileId
        || !visible.has(member.reportingManagerProfileId)
        || visible.has(member.profileId)) continue;
      visible.add(member.profileId);
      changed = true;
    }
  }
  return visible;
}

export function selectPerformanceMembers(input: {
  members: PerformanceMember[];
  viewerProfileId: string;
  viewerLocationIds: string[];
  allLocations: boolean;
  personalOnly: boolean;
  view: PerformanceView;
}) {
  const team = teamProfileIds(input.viewerProfileId, input.members);
  const viewerLocations = new Set(input.viewerLocationIds);
  const allowedFunctions = input.view === "combined"
    ? new Set<RecruitmentFunction>(["telecaller", "field_recruiter", "influencer"])
    : input.view === "influencer"
      ? new Set<RecruitmentFunction>(["influencer"])
      : new Set<RecruitmentFunction>(["telecaller"]);

  return input.members.filter((member) => {
    if (!member.active || !member.workforceEnabled || !allowedFunctions.has(member.function)) return false;
    if (input.personalOnly) return member.profileId === input.viewerProfileId;
    if (input.allLocations || member.profileId === input.viewerProfileId || team.has(member.profileId)) return true;
    return member.locationIds.some((locationId) => viewerLocations.has(locationId));
  });
}
