import { workforceTeamProfileIds, type RecruitmentFunction, type WorkforceUserFunction } from "./recruitment-workforce-config";

export function fieldDutyViewerScope(input: {
  profileId: string;
  functionName: RecruitmentFunction;
  fullScope: boolean;
  configuredUsers: Record<string, WorkforceUserFunction>;
}) {
  // A field recruiter always sees only their own route and duty history, even
  // if a broader role/menu permission was accidentally attached to the same
  // account. Team/all visibility belongs to management views only.
  if (input.functionName === "field_recruiter") {
    return { visibility: "own" as const, profileIds: [input.profileId] };
  }
  if (input.fullScope) return { visibility: "all" as const, profileIds: [] as string[] };
  if (input.functionName === "manager") {
    return {
      visibility: "team" as const,
      profileIds: workforceTeamProfileIds(input.profileId, input.configuredUsers)
    };
  }
  return { visibility: "own" as const, profileIds: [input.profileId] };
}
