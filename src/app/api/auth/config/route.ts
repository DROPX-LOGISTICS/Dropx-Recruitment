import { NextResponse } from "next/server";
import { getConnectionConfig } from "@/lib/connection-config";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const google = await getConnectionConfig("google");
    return NextResponse.json({
      googleClientId: google?.isEnabled && google.publicConfig.client_id
        ? google.publicConfig.client_id
        : process.env.NEXT_PUBLIC_GOOGLE_LOGIN_CLIENT_ID?.trim() || ""
    });
  } catch {
    return NextResponse.json({
      googleClientId: process.env.NEXT_PUBLIC_GOOGLE_LOGIN_CLIENT_ID?.trim() || ""
    });
  }
}
