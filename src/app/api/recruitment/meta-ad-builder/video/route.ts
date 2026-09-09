import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { canUseRecruitmentMenu, recruitmentSession, requiredEnv } from "@/lib/recruitment-api";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getMetaVideo, uploadMetaAdVideoFromUrl } from "@/lib/meta-ad-builder";
import { META_VIDEO_MAX_BYTES, validateCreativeFile } from "@/lib/meta-media";
import { readVideoTicket, signVideoTicket, type VideoUploadTicket } from "@/lib/meta-video-ticket";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;
const BUCKET = "recruitment-ad-video-uploads";

export async function POST(request: Request) {
  try {
    const session = await recruitmentSession(request);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await request.json();
    const stream = body.stream === "hr" ? "hr" : body.stream === "workforce" ? "workforce" : null;
    if (!stream || !canUseRecruitmentMenu(session, "Active Ads", "all", stream)) {
      return NextResponse.json({ error: "Video creative upload access is not assigned to this user." }, { status: 403 });
    }
    if (!supabaseAdmin) throw new Error("Storage is not configured.");
    const scope = { actor: session.profileId, company: requiredEnv("RECRUITMENT_COMPANY_ID"), stream };
    const secret = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    if (body.action === "start") {
      const fileName = String(body.fileName || "video.mp4").slice(0,240);
      const size = Number(body.size);
      const file = validateCreativeFile({ name: fileName, type: String(body.contentType || ""), size });
      if (file.kind !== "video") throw new Error("Choose an MP4 or MOV video.");
      const existing = await supabaseAdmin.storage.getBucket(BUCKET);
      if (existing.error) {
        if (!/not found/i.test(existing.error.message)) throw existing.error;
        const created = await supabaseAdmin.storage.createBucket(BUCKET, {
          public: false, fileSizeLimit: META_VIDEO_MAX_BYTES, allowedMimeTypes: ["video/mp4", "video/quicktime"]
        });
        if (created.error && !/already exists|duplicate/i.test(created.error.message)) throw created.error;
      } else if (existing.data.public) throw new Error("The video upload bucket must be private.");
      const path = `${scope.company}/${scope.actor}/${randomUUID()}.${file.contentType === "video/mp4" ? "mp4" : "mov"}`;
      const signed = await supabaseAdmin.storage.from(BUCKET).createSignedUploadUrl(path);
      if (signed.error) throw signed.error;
      const ticket: VideoUploadTicket = { ...scope, path, fileName, contentType: file.contentType, size, expires: Date.now()+2*60*60*1000 };
      return NextResponse.json({ uploadUrl: signed.data.signedUrl, ticket: signVideoTicket(ticket, secret) });
    }
    const ticket = readVideoTicket(String(body.ticket || ""), secret, scope);
    if (body.action === "complete") {
      if (ticket.videoId) throw new Error("This video has already been sent to Meta.");
      const slash = ticket.path.lastIndexOf("/");
      const name = ticket.path.slice(slash+1);
      const objects = await supabaseAdmin.storage.from(BUCKET).list(ticket.path.slice(0,slash), { search: name, limit: 5 });
      if (objects.error) throw objects.error;
      const file = objects.data.find(item => item.name === name);
      if (!file || Number(file.metadata?.size) !== ticket.size || file.metadata?.mimetype !== ticket.contentType) {
        throw new Error("The uploaded video is incomplete or does not match the selected file. Upload it again.");
      }
      const signed = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(ticket.path, 2*60*60);
      if (signed.error) throw signed.error;
      // Only the server-created private object URL is accepted; clients cannot submit arbitrary fetch URLs.
      const videoId = await uploadMetaAdVideoFromUrl(signed.data.signedUrl, ticket.fileName);
      return NextResponse.json({ videoId, ticket: signVideoTicket({ ...ticket, videoId }, secret), processing: true });
    }
    if (body.action === "status" && ticket.videoId) {
      const video = await getMetaVideo(ticket.videoId);
      if (video.status === "error") throw new Error("Meta could not process this video. Try an H.264 MP4 with AAC audio.");
      if (video.status === "ready") {
        // Meta now owns its copy. A cleanup failure must not turn a successful upload into a retry.
        await supabaseAdmin.storage.from(BUCKET).remove([ticket.path]).catch(() => undefined);
      }
      return NextResponse.json({ videoId: ticket.videoId, ready: video.status === "ready", ...video });
    }
    throw new Error("Invalid video upload action.");
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to upload this video." }, { status: 400 });
  }
}
