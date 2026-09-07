export type RecruitmentLocationContact = {
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  poc_name?: string | null;
  poc_mobile?: string | null;
};

function text(value: string | null | undefined) {
  return value?.trim() || null;
}

export function mergeRecruitmentLocationContact(
  preferred: RecruitmentLocationContact | null | undefined,
  fallback: RecruitmentLocationContact | null | undefined
): RecruitmentLocationContact {
  return {
    address: text(preferred?.address) ?? text(fallback?.address),
    latitude: preferred?.latitude ?? fallback?.latitude ?? null,
    longitude: preferred?.longitude ?? fallback?.longitude ?? null,
    poc_name: text(preferred?.poc_name) ?? text(fallback?.poc_name),
    poc_mobile: text(preferred?.poc_mobile) ?? text(fallback?.poc_mobile)
  };
}
