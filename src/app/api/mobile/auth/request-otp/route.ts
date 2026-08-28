import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { generateOtp, hashOtp, normalizeIndianMobileE164 } from "@/lib/mobile-auth";
import {
  activeProfileByMobile,
  ensureMobileLoginUser,
  ensureRecruitmentAccess
} from "@/lib/recruitment-auth-user";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { whatsappConfig } from "@/lib/whatsapp-provider";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

async function sendWhatsAppOtp(mobileE164: string, otp: string) {
  const config = await whatsappConfig();
  const managed = await import("@/lib/connection-config").then(({ getConnectionConfig }) => getConnectionConfig("whatsapp"));
  const url = `https://graph.facebook.com/${config.graphVersion}/${config.phoneNumberId}/messages`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: mobileE164,
      type: "template",
      template: {
        name: managed?.isEnabled
          ? managed.publicConfig.otp_template || "dropx_recruitment_login_otp"
          : process.env.WHATSAPP_OTP_TEMPLATE?.trim() || "dropx_recruitment_login_otp",
        language: { code: "en" },
        components: [{
          type: "body",
          parameters: [{ type: "text", text: otp }]
        }, {
          type: "button",
          sub_type: "url",
          index: "0",
          parameters: [{ type: "text", text: otp }]
        }]
      }
    })
  });
  const payload = await response.json() as {
    messages?: Array<{ id?: string }>;
    error?: { message?: string };
  };
  if (!response.ok || payload.error) {
    throw new Error(payload.error?.message || `WhatsApp OTP failed with HTTP ${response.status}.`);
  }
  return payload.messages?.[0]?.id ?? null;
}

export async function POST(request: Request) {
  const genericResponse = {
    accepted: true,
    message: "If this mobile number is registered, an OTP will be sent through WhatsApp."
  };
  try {
    if (!supabaseAdmin) throw new Error("Supabase is not configured.");
    const body = await request.json() as { mobile?: string };
    const mobileE164 = normalizeIndianMobileE164(body.mobile);
    if (!mobileE164) {
      return NextResponse.json({ accepted: false, error: "Enter a valid Indian mobile number." }, { status: 400 });
    }
    const companyId = required("RECRUITMENT_COMPANY_ID");
    let user = await supabaseAdmin
      .from("recruitment_mobile_users")
      .select("id,profile_id")
      .eq("company_id", companyId)
      .eq("mobile_e164", mobileE164)
      .eq("is_active", true)
      .maybeSingle();
    if (user.error) throw new Error(user.error.message);
    let profile = await activeProfileByMobile(companyId, mobileE164);
    if (!profile && user.data?.profile_id) {
      const linked = await supabaseAdmin.from("profiles").select("id,full_name,email,mobile,phone,role,role_id,is_master_owner")
        .eq("company_id", companyId).eq("id", user.data.profile_id).eq("is_active", true).maybeSingle();
      if (linked.error) throw new Error(linked.error.message);
      profile = linked.data;
    }
    if (!profile) return NextResponse.json(genericResponse);
    const access = await ensureRecruitmentAccess(companyId, profile);
    if (!access) return NextResponse.json(genericResponse);
    if (!user.data || user.data.profile_id !== profile.id) {
      const repaired = await ensureMobileLoginUser(companyId, profile, mobileE164);
      user = { data: repaired, error: null, count: null, status: 200, statusText: "OK" } as typeof user;
    }
    const activeUser = user.data;
    if (!activeUser) return NextResponse.json(genericResponse);

    const tenMinutesAgo = new Date(Date.now() - 10 * 60_000).toISOString();
    const recent = await supabaseAdmin
      .from("recruitment_mobile_otp_challenges")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("mobile_user_id", activeUser.id)
      .gte("created_at", tenMinutesAgo);
    if (recent.error) throw new Error(recent.error.message);
    if ((recent.count ?? 0) >= 3) {
      return NextResponse.json({ accepted: false, error: "Too many OTP requests. Try again later." }, { status: 429 });
    }

    const challengeId = randomUUID();
    const otp = generateOtp();
    const requestIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "";
    const challenge = await supabaseAdmin
      .from("recruitment_mobile_otp_challenges")
      .insert({
        id: challengeId,
        company_id: companyId,
        mobile_user_id: activeUser.id,
        otp_hash: hashOtp(challengeId, otp),
        expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
        request_ip_hash: requestIp ? createHash("sha256").update(requestIp).digest("hex") : null
      });
    if (challenge.error) throw new Error(challenge.error.message);
    try {
      const providerMessageId = await sendWhatsAppOtp(mobileE164, otp);
      const providerUpdate = await supabaseAdmin
        .from("recruitment_mobile_otp_challenges")
        .update({ provider_message_id: providerMessageId })
        .eq("company_id", companyId)
        .eq("id", challengeId);
      if (providerUpdate.error) throw new Error(providerUpdate.error.message);
    } catch (error) {
      await supabaseAdmin
        .from("recruitment_mobile_otp_challenges")
        .delete()
        .eq("company_id", companyId)
        .eq("id", challengeId);
      throw error;
    }
    return NextResponse.json({ ...genericResponse, challengeId, expiresInSeconds: 300 });
  } catch (error) {
    console.error("Recruitment OTP request failed", error);
    return NextResponse.json({
      accepted: false,
      error: "Mobile login is temporarily unavailable. Please try again shortly."
    }, { status: 503 });
  }
}
