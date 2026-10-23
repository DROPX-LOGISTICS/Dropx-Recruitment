import "server-only";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requiredEnv } from "@/lib/recruitment-api";
import { loadRecruitSessionForProfile, resolveMobileSessionFromToken } from "@/lib/mobile-session";
import { RECRUITMENT_SESSION_COOKIE } from "@/lib/recruitment-session-cookie";

export { RECRUITMENT_SESSION_COOKIE };

export function recruitmentSessionCookieOptions(maxAge = 30 * 24 * 60 * 60) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge
  };
}

export function attachRecruitmentSessionCookie(response: NextResponse, token: string) {
  response.cookies.set(RECRUITMENT_SESSION_COOKIE, token, recruitmentSessionCookieOptions());
  return response;
}

export async function getRecruitmentWebSession() {
  const token = cookies().get(RECRUITMENT_SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    return await resolveMobileSessionFromToken(token, requiredEnv("RECRUITMENT_COMPANY_ID"));
  } catch {
    return null;
  }
}

export async function loadRecruitAuthForMcpUser(userId: string) {
  const companyId = process.env.RECRUITMENT_COMPANY_ID?.trim();
  if (!companyId || !userId) return null;
  return loadRecruitSessionForProfile(companyId, userId);
}
