import { createHash } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { NextResponse } from "next/server";
import { hashSessionToken, newSessionToken } from "@/lib/mobile-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getConnectionConfig } from "@/lib/connection-config";
import { activeProfileByEmail, ensureRecruitmentAccess } from "@/lib/recruitment-auth-user";

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
      idToken?: string;
      deviceId?: string;
      deviceName?: string;
    };
    if (!body.idToken) {
      return NextResponse.json({ authenticated: false, error: "Google credential is missing." }, { status: 400 });
    }

    const managedGoogle = await getConnectionConfig("google");
    const clientId = managedGoogle?.isEnabled && managedGoogle.publicConfig.client_id
      ? managedGoogle.publicConfig.client_id
      : required("GOOGLE_LOGIN_CLIENT_ID");
    const ticket = await new OAuth2Client(clientId).verifyIdToken({
      idToken: body.idToken,
      audience: clientId
    });
    const identity = ticket.getPayload();
    const email = identity?.email?.trim().toLowerCase();
    if (!email || !identity?.email_verified) {
      return NextResponse.json({ authenticated: false, error: "Verified Google email is required." }, { status: 401 });
    }

    const companyId = required("RECRUITMENT_COMPANY_ID");
    const activeProfile = await activeProfileByEmail(companyId, email);
    if (!activeProfile) {
      return NextResponse.json({
        authenticated: false,
        error: "This user is not active in the main DropX dashboard."
      }, { status: 403 });
    }
    const access = await ensureRecruitmentAccess(companyId, activeProfile);
    if (!access) {
      return NextResponse.json({
        authenticated: false,
        error: "Recruitment access has not been assigned to this universal user."
      }, { status: 403 });
    }

    const sessionToken = newSessionToken();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString();
    const session = await supabaseAdmin
      .from("recruitment_mobile_sessions")
      .insert({
        company_id: companyId,
        profile_id: activeProfile.id,
        mobile_user_id: null,
        auth_method: "google",
        token_hash: hashSessionToken(sessionToken),
        device_name: String(body.deviceName ?? "").slice(0, 120) || null,
        device_id_hash: body.deviceId
          ? createHash("sha256").update(String(body.deviceId)).digest("hex")
          : null,
        expires_at: expiresAt
      });
    if (session.error) throw new Error(session.error.message);
    return NextResponse.json({
      authenticated: true,
      token: sessionToken,
      expiresAt,
      user: { name: activeProfile.full_name }
    });
  } catch (error) {
    console.error("Recruitment Google login failed", error);
    return NextResponse.json({ authenticated: false, error: "Unable to complete Google login." }, { status: 401 });
  }
}
