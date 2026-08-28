import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import {
  hashSessionToken,
  newSessionToken,
  normalizeIndianMobileE164,
  verifyOtpHash
} from "@/lib/mobile-auth";
import { resolveMobileSession } from "@/lib/mobile-session";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

export async function POST(request: Request) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase is not configured.");
    const body = await request.json() as {
      challengeId?: string;
      mobile?: string;
      otp?: string;
      deviceId?: string;
      deviceName?: string;
    };
    const mobileE164 = normalizeIndianMobileE164(body.mobile);
    const otp = String(body.otp ?? "").trim();
    if (!body.challengeId || !mobileE164 || !/^\d{6}$/.test(otp)) {
      return NextResponse.json({ authenticated: false, error: "Invalid OTP request." }, { status: 400 });
    }
    const companyId = required("RECRUITMENT_COMPANY_ID");
    const challenge = await supabaseAdmin
      .from("recruitment_mobile_otp_challenges")
      .select("id, mobile_user_id, otp_hash, expires_at, attempt_count, max_attempts, consumed_at")
      .eq("company_id", companyId)
      .eq("id", body.challengeId)
      .maybeSingle();
    if (challenge.error) throw new Error(challenge.error.message);
    if (
      !challenge.data ||
      challenge.data.consumed_at ||
      new Date(challenge.data.expires_at).getTime() <= Date.now() ||
      challenge.data.attempt_count >= challenge.data.max_attempts
    ) {
      return NextResponse.json({ authenticated: false, error: "OTP expired or unavailable." }, { status: 401 });
    }
    const mobileUser = await supabaseAdmin
      .from("recruitment_mobile_users")
      .select("id, profile_id, display_name")
      .eq("company_id", companyId)
      .eq("id", challenge.data.mobile_user_id)
      .eq("mobile_e164", mobileE164)
      .eq("is_active", true)
      .maybeSingle();
    if (mobileUser.error) throw new Error(mobileUser.error.message);
    if (!mobileUser.data) {
      return NextResponse.json({ authenticated: false, error: "User is not active." }, { status: 401 });
    }
    const universalProfile = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("company_id", companyId)
      .eq("id", mobileUser.data.profile_id)
      .eq("is_active", true)
      .maybeSingle();
    if (universalProfile.error) throw new Error(universalProfile.error.message);
    if (!universalProfile.data) {
      return NextResponse.json({
        authenticated: false,
        error: "This user is inactive in the main DropX dashboard."
      }, { status: 403 });
    }
    const valid = verifyOtpHash(challenge.data.id, otp, challenge.data.otp_hash);
    if (!valid) {
      await supabaseAdmin
        .from("recruitment_mobile_otp_challenges")
        .update({ attempt_count: challenge.data.attempt_count + 1 })
        .eq("id", challenge.data.id);
      return NextResponse.json({ authenticated: false, error: "Incorrect OTP." }, { status: 401 });
    }

    const now = new Date().toISOString();
    await supabaseAdmin
      .from("recruitment_mobile_otp_challenges")
      .update({ consumed_at: now })
      .eq("id", challenge.data.id);
    await supabaseAdmin
      .from("recruitment_mobile_users")
      .update({ verified_at: now, updated_at: now })
      .eq("id", mobileUser.data.id);

    const access = await supabaseAdmin
      .from("recruitment_user_access")
      .select("can_access_workforce, can_access_hr, can_access_all_locations, can_manage_masters, can_manage_ads, can_manage_users")
      .eq("company_id", companyId)
      .eq("profile_id", mobileUser.data.profile_id)
      .eq("is_active", true)
      .maybeSingle();
    if (access.error) throw new Error(access.error.message);
    if (!access.data) {
      return NextResponse.json({ authenticated: false, error: "Recruitment access is not configured." }, { status: 403 });
    }

    const sessionToken = newSessionToken();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString();
    const session = await supabaseAdmin
      .from("recruitment_mobile_sessions")
      .insert({
        company_id: companyId,
        profile_id: mobileUser.data.profile_id,
        mobile_user_id: mobileUser.data.id,
        auth_method: "whatsapp_otp",
        token_hash: hashSessionToken(sessionToken),
        device_name: String(body.deviceName ?? "").slice(0, 120) || null,
        device_id_hash: body.deviceId
          ? createHash("sha256").update(String(body.deviceId)).digest("hex")
          : null,
        expires_at: expiresAt
      });
    if (session.error) throw new Error(session.error.message);
    const resolved = await resolveMobileSession(new Request(request.url, {
      headers: { Authorization: `Bearer ${sessionToken}` }
    }), companyId);
    return NextResponse.json({
      authenticated: true,
      token: sessionToken,
      expiresAt,
      user: {
        name: resolved?.displayName ?? mobileUser.data.display_name,
        workforce: resolved?.workforce ?? false,
        hr: resolved?.hr ?? false,
        allLocations: resolved?.allLocations ?? false,
        manageMasters: resolved?.manageMasters ?? false,
        manageAds: resolved?.manageAds ?? false,
        manageUsers: resolved?.manageUsers ?? false,
        locationIds: resolved?.locationIds ?? [],
        roleIds: resolved?.roleIds ?? []
      }
    });
  } catch (error) {
    console.error("Recruitment OTP verification failed", error);
    return NextResponse.json({ authenticated: false, error: "Unable to verify OTP." }, { status: 500 });
  }
}
