import { normalizeIndianMobileE164 } from "./mobile-auth";
import { isRecruitmentInfluencerRole } from "./recruitment-workforce-config";
import { supabaseAdmin } from "./supabase-admin";

export type RecruitmentAuthProfile = {
  id: string;
  full_name: string | null;
  email: string | null;
  mobile: string | null;
  phone: string | null;
  role: string | null;
  role_id: string | null;
  is_master_owner: boolean | null;
};

const profileFields = "id,full_name,email,mobile,phone,role,role_id,is_master_owner";

export async function activeProfileByEmail(companyId: string, email: string) {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  const result = await supabaseAdmin.from("profiles")
    .select(profileFields)
    .eq("company_id", companyId)
    .ilike("email", email)
    .eq("is_active", true)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return result.data as RecruitmentAuthProfile | null;
}

export async function activeProfileByMobile(companyId: string, mobileE164: string) {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  // Main-dashboard numbers predate a single storage format. Normalize both
  // mobile columns in application code so spaces, +91 and local numbers match.
  const result = await supabaseAdmin.from("profiles")
    .select(profileFields)
    .eq("company_id", companyId)
    .eq("is_active", true);
  if (result.error) throw new Error(result.error.message);
  return ((result.data ?? []) as RecruitmentAuthProfile[]).find((profile) =>
    normalizeIndianMobileE164(profile.mobile || profile.phone) === mobileE164
  ) ?? null;
}

export async function ensureRecruitmentAccess(companyId: string, profile: RecruitmentAuthProfile) {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  const current = await supabaseAdmin.from("recruitment_user_access")
    .select("id")
    .eq("company_id", companyId)
    .eq("profile_id", profile.id)
    .eq("is_active", true)
    .maybeSingle();
  if (current.error) throw new Error(current.error.message);
  if (current.data) return current.data;
  const universalRole = profile.role_id
    ? await supabaseAdmin.from("user_roles").select("code,name")
        .eq("company_id", companyId).eq("id", profile.role_id).eq("is_active", true).maybeSingle()
    : { data: null, error: null };
  if (universalRole.error) throw new Error(universalRole.error.message);
  const roleCode = universalRole.data?.code ?? profile.role;
  const influencer = isRecruitmentInfluencerRole(roleCode, universalRole.data?.name);
  // Owners and RINF users are authoritative in the universal user master. A
  // newly onboarded influencer can therefore use OTP immediately after the
  // Main Dashboard profile/role is activated; no duplicate mobile user setup
  // is required in Recruitment.
  const owner = profile.is_master_owner === true || String(roleCode || "").trim().toUpperCase() === "OWNER";
  if (!owner && !influencer) return null;
  const repaired = await supabaseAdmin.from("recruitment_user_access").upsert({
    company_id: companyId,
    profile_id: profile.id,
    can_access_workforce: true,
    can_access_hr: owner,
    can_access_all_locations: true,
    can_manage_masters: owner,
    can_manage_ads: owner,
    can_manage_users: owner,
    is_active: true,
    updated_at: new Date().toISOString()
  }, { onConflict: "company_id,profile_id" }).select("id").single();
  if (repaired.error) throw new Error(repaired.error.message);
  return repaired.data;
}

export async function ensureMobileLoginUser(
  companyId: string,
  profile: RecruitmentAuthProfile,
  mobileE164: string
) {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  const byMobile = await supabaseAdmin.from("recruitment_mobile_users")
    .select("id,profile_id")
    .eq("company_id", companyId)
    .eq("mobile_e164", mobileE164)
    .maybeSingle();
  if (byMobile.error) throw new Error(byMobile.error.message);
  const values = {
    profile_id: profile.id,
    mobile_e164: mobileE164,
    display_name: profile.full_name || profile.email || mobileE164,
    is_active: true,
    updated_at: new Date().toISOString()
  };
  if (byMobile.data) {
    const updated = await supabaseAdmin.from("recruitment_mobile_users")
      .update(values).eq("company_id", companyId).eq("id", byMobile.data.id)
      .select("id,profile_id").single();
    if (updated.error) throw new Error(updated.error.message);
    return updated.data;
  }
  const byProfile = await supabaseAdmin.from("recruitment_mobile_users")
    .select("id")
    .eq("company_id", companyId)
    .eq("profile_id", profile.id)
    .maybeSingle();
  if (byProfile.error) throw new Error(byProfile.error.message);
  const saved = byProfile.data
    ? await supabaseAdmin.from("recruitment_mobile_users").update(values)
        .eq("company_id", companyId).eq("id", byProfile.data.id).select("id,profile_id").single()
    : await supabaseAdmin.from("recruitment_mobile_users").insert({
        company_id: companyId,
        ...values
      }).select("id,profile_id").single();
  if (saved.error) throw new Error(saved.error.message);
  return saved.data;
}
