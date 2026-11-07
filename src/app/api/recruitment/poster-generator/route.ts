import { NextResponse } from "next/server";
import { canAccessLead, canUseRecruitmentMenu, recruitmentSession, requiredEnv } from "@/lib/recruitment-api";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getFreshMetaAdMedia } from "@/lib/meta-ingestion";
import { downloadPosterReference, generateRecruitmentPoster, posterCredential } from "@/lib/recruitment-poster-ai";
import { loadPosterBrand, DROPX_BRAND } from "@/lib/recruitment-poster-brand";
import { validatePosterInput } from "@/lib/recruitment-poster";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;
const headers = { "Cache-Control": "private, no-store, max-age=0" };
const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;

async function authorize(request: Request, stream: unknown) {
  const session = await recruitmentSession(request);
  if (!session) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401, headers }) };
  if ((stream !== "hr" && stream !== "workforce") || !canUseRecruitmentMenu(session, "Active Ads", "all", stream)) return { error: NextResponse.json({ error: "Ad creative access is not assigned for this workspace." }, { status: 403, headers }) };
  if (!supabaseAdmin) throw new Error("Recruit data is temporarily unavailable.");
  return { session, stream, company: requiredEnv("RECRUITMENT_COMPANY_ID") };
}

export async function GET(request: Request) {
  try {
    const access = await authorize(request, new URL(request.url).searchParams.get("stream"));
    if (access.error) return access.error;
    let brand = { ...DROPX_BRAND };
    const locationId = new URL(request.url).searchParams.get("locationId");
    if (locationId) {
      if (!uuid.test(locationId) || !canAccessLead(access.session!, { stream: access.stream, location_id: locationId, role_id: new URL(request.url).searchParams.get("roleId") })) return NextResponse.json({ error: "Location is outside your scope." }, { status: 403, headers });
      const location = await supabaseAdmin!.from("recruitment_locations").select("station_id").eq("company_id", access.company!).eq("id", locationId).eq("is_active", true).maybeSingle();
      if (location.error || !location.data) throw new Error("Location unavailable.");
      brand = await loadPosterBrand(access.company!, location.data.station_id);
    }
    const { data, error } = await supabaseAdmin!.from("recruitment_ads")
      .select("id,ad_name,meta_ad_id,poster_url,location_id,role_id,recruitment_roles!inner(name,stream)")
      .eq("company_id", access.company!).eq("recruitment_roles.stream", access.stream!)
      .order("last_synced_at", { ascending: false }).limit(200);
    if (error) throw new Error("Previous ad designs could not be loaded. Try again shortly.");
    const references = (data || []).filter(ad => {
      const role = Array.isArray(ad.recruitment_roles) ? ad.recruitment_roles[0] : ad.recruitment_roles;
      return (ad.meta_ad_id || ad.poster_url) && canAccessLead(access.session!, { stream: role?.stream, location_id: ad.location_id, role_id: ad.role_id });
    }).map(ad => ({ id: ad.id, name: ad.ad_name, roleId: ad.role_id }));
    return NextResponse.json({ enabled: Boolean(posterCredential()), brand, references }, { headers });
  } catch {
    return NextResponse.json({ error: "Poster generation setup could not be loaded. Please try again." }, { status: 500, headers });
  }
}

export async function POST(request: Request) {
  try {
    const raw = await request.text();
    if (raw.length > 12_000) return NextResponse.json({ error: "Poster details are too long." }, { status: 413, headers });
    let body: Record<string, unknown>;
    try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "Invalid poster details." }, { status: 400, headers }); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid poster details." }, { status: 400, headers });
    const access = await authorize(request, body.stream);
    if (access.error) return access.error;
    const locationId = String(body.locationId || ""), roleId = String(body.roleId || "");
    if (!uuid.test(locationId) || !uuid.test(roleId)) throw new Error("Choose a station and designation before generating a poster.");
    const input = validatePosterInput(body);
    if (!canAccessLead(access.session!, { stream: access.stream, location_id: locationId, role_id: roleId })) return NextResponse.json({ error: "This location or designation is outside your assigned scope." }, { status: 403, headers });
    const [location, role] = await Promise.all([
      supabaseAdmin!.from("recruitment_locations").select("id,name,station_id").eq("company_id", access.company!).eq("id", locationId).eq("is_active", true).maybeSingle(),
      supabaseAdmin!.from("recruitment_roles").select("id,name,stream").eq("company_id", access.company!).eq("id", roleId).eq("is_active", true).maybeSingle()
    ]);
    if (location.error || role.error) throw new Error("The location and designation could not be checked. Please retry.");
    if (!location.data || !role.data || role.data.stream !== access.stream) return NextResponse.json({ error: "Choose an active location and designation in this workspace." }, { status: 400, headers });
    const brand = await loadPosterBrand(access.company!, location.data.station_id);
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(105_000)]);
    let reference: string | null = null;
    if (input.referenceAdId) {
      const old = await supabaseAdmin!.from("recruitment_ads").select("id,meta_ad_id,poster_url,location_id,role_id,recruitment_roles(stream)").eq("company_id", access.company!).eq("id", input.referenceAdId).maybeSingle();
      const oldRole = Array.isArray(old.data?.recruitment_roles) ? old.data?.recruitment_roles[0] : old.data?.recruitment_roles;
      if (old.error || !old.data || oldRole?.stream !== access.stream || !canAccessLead(access.session!, { stream: oldRole?.stream, location_id: old.data.location_id, role_id: old.data.role_id })) return NextResponse.json({ error: "The reference ad is not available in your scope." }, { status: 403, headers });
      const media = old.data.meta_ad_id ? await getFreshMetaAdMedia(old.data.meta_ad_id) : null;
      if (media?.mediaType === "video") throw new Error("Choose a previous image poster as the design reference, not a video ad.");
      reference = await downloadPosterReference(media?.url || old.data.poster_url || "", signal);
    }
    const result = await generateRecruitmentPoster(input, { role: role.data.name, location: location.data.name, brand }, reference, signal);
    return new Response(new Uint8Array(result.image), { headers: { ...headers, "Content-Type": "image/jpeg", "Content-Disposition": 'inline; filename="dropx-recruitment-poster.jpg"', "X-Poster-Width": String(result.width), "X-Poster-Height": String(result.height) } });
  } catch (error) {
    const message = error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)
      ? "Poster generation took too long or was cancelled. Try again, or upload a poster."
      : error instanceof Error ? error.message : "The poster could not be generated. Please try again.";
    return NextResponse.json({ error: message }, { status: 400, headers });
  }
}
