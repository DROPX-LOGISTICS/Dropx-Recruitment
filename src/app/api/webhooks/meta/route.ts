import { NextResponse } from "next/server";
import { getMetaConfig, ingestMetaLeadgenValue, LeadgenValue } from "@/lib/meta-ingestion";
import { verifyMetaSignature } from "@/lib/meta-signature";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type MetaPayload = {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{ field?: string; value?: LeadgenValue }>;
  }>;
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const config = await getMetaConfig();
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode === "subscribe" && challenge && token && token === config.verifyToken) {
    return new Response(challenge, { status: 200 });
  }
  return new Response("Webhook verification failed.", { status: 403 });
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const config = await getMetaConfig();
  if (!config.appSecret) {
    return NextResponse.json({ received: false, error: "Meta app secret is not configured." }, { status: 503 });
  }
  if (!verifyMetaSignature(rawBody, request.headers.get("x-hub-signature-256"), config.appSecret)) {
    return NextResponse.json({ received: false, error: "Invalid Meta signature." }, { status: 401 });
  }

  try {
    const payload = JSON.parse(rawBody) as MetaPayload;
    const changes = (payload.entry ?? []).flatMap((entry) => entry.changes ?? [])
      .filter((change) => change.field === "leadgen" && change.value?.leadgen_id);
    let saved = 0;
    let duplicates = 0;
    let replays = 0;
    const errors: string[] = [];
    for (const change of changes) {
      try {
        const result = await ingestMetaLeadgenValue(change.value!);
        if (result.saved && !result.replay) saved++;
        if (result.duplicate && !result.replay) duplicates++;
        if (result.replay) replays++;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "Unknown lead ingestion error.");
      }
    }
    return NextResponse.json({ received: true, events: changes.length, saved, duplicates, replays, errors });
  } catch (error) {
    return NextResponse.json({
      received: false,
      error: error instanceof Error ? error.message : "Invalid webhook payload."
    }, { status: 400 });
  }
}
