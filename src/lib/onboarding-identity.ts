export type OnboardingIdentityMatch = {
  source_type: string;
  source_id: string;
  display_name: string | null;
  designation_code: string | null;
  designation_name: string | null;
  profile_status: string | null;
};

export type OnboardingIdentityEvaluation = {
  exactMatches: OnboardingIdentityMatch[];
  otherMatches: OnboardingIdentityMatch[];
};

type RpcClient = {
  rpc: (name: string, params: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

function items(value: unknown): OnboardingIdentityMatch[] {
  return Array.isArray(value) ? value.filter((item): item is OnboardingIdentityMatch => Boolean(item && typeof item === "object")) : [];
}

export function parseOnboardingIdentity(value: unknown): OnboardingIdentityEvaluation {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return { exactMatches: items(record.exact_matches), otherMatches: items(record.other_matches) };
}

function label(match: OnboardingIdentityMatch | undefined) {
  return `${match?.display_name || "an existing person"} (${match?.designation_name || match?.designation_code || "existing designation"})`;
}

export function assertRecruitWorkforceIdentity(evaluation: OnboardingIdentityEvaluation) {
  if (!evaluation.exactMatches.length) return;
  throw new Error(`This mobile number is already registered to ${label(evaluation.exactMatches[0])}. Continue the existing profile; the same designation cannot be onboarded again.`);
}

export async function evaluateRecruitWorkforceIdentity({ client, companyId, mobile, designationId, designationName }: {
  client: RpcClient;
  companyId: string;
  mobile: string;
  designationId?: string | null;
  designationName: string;
}) {
  const result = await client.rpc("evaluate_onboarding_identity", {
    p_company_id: companyId,
    p_mobile: mobile,
    p_designation_id: designationId ?? null,
    p_designation_name: designationName,
    p_exclude_source: null,
    p_exclude_id: null
  });
  if (result.error) throw new Error(result.error.message);
  return parseOnboardingIdentity(result.data);
}

export function recruitmentIdentityExceptionMetadata(evaluation: OnboardingIdentityEvaluation) {
  if (!evaluation.otherMatches.length) return {};
  return {
    identity_exception_required: true,
    identity_exception_reason: "existing_person_different_designation",
    existing_profiles: evaluation.otherMatches.map((match) => ({
      source_type: match.source_type,
      source_id: match.source_id,
      display_name: match.display_name,
      designation_code: match.designation_code,
      designation_name: match.designation_name,
      profile_status: match.profile_status
    }))
  };
}
