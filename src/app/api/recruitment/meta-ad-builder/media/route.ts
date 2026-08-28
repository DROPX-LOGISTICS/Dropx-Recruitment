import { NextResponse } from "next/server";
import { canUseRecruitmentMenu, recruitmentSession } from "@/lib/recruitment-api";
import { uploadMetaAdImage } from "@/lib/meta-ad-builder";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const session = await recruitmentSession(request);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const form = await request.formData();
    const stream = form.get("stream") === "hr" ? "hr" : form.get("stream") === "workforce" ? "workforce" : null;
    if (!stream) return NextResponse.json({ error: "Choose Workforce or HR." }, { status: 400 });
    if (!canUseRecruitmentMenu(session, "Active Ads", "all", stream)) {
      return NextResponse.json({ error: "Meta creative upload access is not assigned to this user." }, { status: 403 });
    }
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Choose a poster to upload." }, { status: 400 });
    const uploaded = await uploadMetaAdImage({
      fileName: file.name,
      contentType: file.type,
      bytes: await file.arrayBuffer()
    });
    return NextResponse.json({ uploaded: true, ...uploaded });
  } catch (error) {
    console.error("Meta creative upload failed", error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Unable to upload the poster to Meta."
    }, { status: 400 });
  }
}
