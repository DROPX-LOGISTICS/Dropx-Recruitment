import { NextResponse } from "next/server";
import { getConnectionConfig } from "@/lib/connection-config";
import {
  IndeedIngestionError,
  ingestExternalRecruitmentApplication,
  normalizeIndeedApplication,
  verifyIndeedSignature
} from "@/lib/recruitment-source-ingestion";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const config = await getConnectionConfig("indeed");
    if (!config?.isEnabled) {
      return NextResponse.json({ error: "Indeed intake is disabled." }, { status: 503 });
    }
    const secret = config.secrets.webhook_secret?.trim();
    if (!secret) {
      return NextResponse.json({ error: "Indeed Apply shared secret is not configured." }, { status: 503 });
    }
    const suppliedLength = Number(request.headers.get("content-length") ?? 0);
    if (suppliedLength > 15 * 1024 * 1024) {
      return NextResponse.json({ error: "Application payload is too large." }, { status: 413 });
    }
    const rawBody = await request.text();
    if (!verifyIndeedSignature(rawBody, request.headers.get("x-indeed-signature"), secret)) {
      return NextResponse.json({ error: "Missing or invalid X-Indeed-Signature value." }, { status: 401 });
    }
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody) as unknown;
    } catch {
      return NextResponse.json({ error: "Application payload is not valid JSON." }, { status: 400 });
    }
    const application = normalizeIndeedApplication(payload);
    const notifyCandidate = config.publicConfig.notify_new_candidates === "true";
    const result = await ingestExternalRecruitmentApplication(application, {
      sourceSystem: "indeed_apply",
      notifyCandidate
    });
    if (result.duplicate) {
      return NextResponse.json({
        error: "Duplicate application already exists.",
        duplicate: true
      }, { status: 409 });
    }
    return NextResponse.json({
      accepted: true,
      applyId: application.externalEventId
    }, { status: 200 });
  } catch (error) {
    console.error("Indeed recruitment webhook failed", error);
    if (error instanceof IndeedIngestionError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.statusCode });
    }
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Indeed webhook failed."
    }, { status: 422 });
  }
}
