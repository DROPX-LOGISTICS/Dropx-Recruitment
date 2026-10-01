import { NextResponse } from "next/server";
import { runDaOnboardingMail } from "@/lib/da-onboarding-mail";
import { requiredEnv } from "@/lib/recruitment-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    return NextResponse.json(await runDaOnboardingMail(
      requiredEnv("RECRUITMENT_COMPANY_ID"),
      new URL(request.url).searchParams.get("preview") === "1"
    ));
  } catch (error) {
    console.error("recruit-da-onboarding-mail cron", error);
    return NextResponse.json({ error: "DA onboarding mail failed; inspect server logs." }, { status: 500 });
  }
}
