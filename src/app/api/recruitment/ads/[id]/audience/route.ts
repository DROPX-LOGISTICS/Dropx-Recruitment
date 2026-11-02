import { NextResponse } from "next/server";
import { scopedRecruitmentAd } from "@/lib/scoped-recruitment-ad";
import { resolveRecruitmentAdAudience } from "@/lib/recruitment-ad-audience";
import { editMetaAdAudience, getMetaAudienceSnapshot } from "@/lib/meta-ad-builder";
import { audienceEditBlocker, audienceVersion, currentAudiencePin, plannedAudience } from "@/lib/meta-ad-audience-edit";
import { metaDeliveryStatus } from "@/lib/meta-ad-delivery";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;
const table = "recruitment_ad_audience_changes";
const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { "Cache-Control": "private, no-store" } });

async function context(companyId: string, ad: { location_id: string; meta_ad_id: string }) {
  let station = null, stationError = "";
  try { station = await resolveRecruitmentAdAudience({ companyId, locationId: ad.location_id }); }
  catch (error) { stationError = error instanceof Error ? error.message : "Unable to load the station pin."; }
  const snapshot = await getMetaAudienceSnapshot(ad.meta_ad_id);
  const point = station ? { latitude: station.latitude, longitude: station.longitude } : null;
  return { snapshot, station, stationError, point, version: audienceVersion(snapshot, point) };
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const scoped = await scopedRecruitmentAd(request, params.id, true);
    if ("error" in scoped) return scoped.error;
    if (scoped.session.readOnly || scoped.session.isPreview) return json({ error: "Exit preview to edit an audience." }, 403);
    if (!scoped.ad.meta_ad_id) return json({ error: "This ad is not linked to Meta." }, 400);
    const result = await context(scoped.companyId, scoped.ad);
    const history = await supabaseAdmin!.from(table).select("id,status,before_targeting,after_targeting,created_at,completed_at").eq("company_id", scoped.companyId).eq("ad_id", scoped.ad.id).order("created_at", { ascending: false }).limit(3);
    if (history.error) throw history.error;
    return json({ station: result.station, stationError: result.stationError, version: result.version,
      currentPin: currentAudiencePin(result.snapshot.adset?.targeting),
      blocker: audienceEditBlocker(result.snapshot), status: metaDeliveryStatus(result.snapshot),
      categories: result.snapshot.campaign?.special_ad_categories ?? [],
      metaAdId: scoped.ad.meta_ad_id, history: history.data ?? [] });
  } catch (error) { return json({ error: error instanceof Error ? error.message : "Unable to load the audience." }, 502); }
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  let auditId = "", companyId = "";
  let attempted = false;
  try {
    const scoped = await scopedRecruitmentAd(request, params.id, true);
    if ("error" in scoped) return scoped.error;
    if (scoped.session.readOnly || scoped.session.isPreview) return json({ error: "Exit preview to edit an audience." }, 403);
    if (!scoped.ad.meta_ad_id) return json({ error: "This ad is not linked to Meta." }, 400);
    const body = await request.json().catch(() => null);
    const allowed = ["action", "center", "radiusKm", "expectedVersion", "clientRequestId", "customPin"];
    if (!body || Object.keys(body).some(key => !allowed.includes(key)) || !["preview", "apply"].includes(body.action) || !/^[a-f0-9]{64}$/.test(body.expectedVersion ?? "") || !/^[a-f0-9-]{36}$/i.test(body.clientRequestId ?? "")) return json({ error: "Invalid audience request. Reopen Edit audience. Only location and radius changes are supported." }, 400);
    companyId = scoped.companyId;
    if (body.action === "apply") {
      const prior = await supabaseAdmin!.from(table).select("ad_id,status").eq("company_id", companyId).eq("client_request_id", body.clientRequestId).maybeSingle();
      if (prior.error) throw prior.error;
      if (prior.data) return prior.data.ad_id === scoped.ad.id && prior.data.status === "completed" ? json({ saved: true, replay: true }) : json({ error: "This change was already submitted. Reopen Edit audience to see the current result." }, 409);
    }
    const current = await context(companyId, scoped.ad);
    if (current.version !== body.expectedVersion) return json({ error: "The audience or station pin changed. Reopen Edit audience and review it again." }, 409);
    let plan;
    try { plan = plannedAudience(current.snapshot, current.point, body); }
    catch (error) { return json({ error: error instanceof Error ? error.message : "Invalid audience." }, 400); }
    if (body.action === "apply") {
      const expired = await supabaseAdmin!.from(table).update({ status: "failed", error_message: "Update timed out. Check Meta before retrying.", completed_at: new Date().toISOString() }).eq("company_id", companyId).eq("meta_adset_id", current.snapshot.adset!.id).eq("status", "processing").lt("created_at", new Date(Date.now() - 5 * 60_000).toISOString());
      if (expired.error) throw expired.error;
      const audit = await supabaseAdmin!.from(table).insert({ company_id: companyId, ad_id: scoped.ad.id, meta_adset_id: current.snapshot.adset!.id, client_request_id: body.clientRequestId,
        status: "processing", expected_version: current.version, before_targeting: current.snapshot.adset!.targeting,
        proposed_targeting: plan.targeting, actor_profile_id: scoped.session.profileId, actor_email: scoped.session.email
      }).select("id").single();
      if (audit.error?.code === "23505") return json({ error: "An audience update is already being processed. Refresh before retrying." }, 409);
      if (audit.error) throw audit.error;
      auditId = audit.data.id;
    }
    attempted = body.action === "apply";
    const result = await editMetaAdAudience({ adId: scoped.ad.meta_ad_id, expectedVersion: current.version, station: current.point, center: body.center, radiusKm: body.radiusKm, customPin: body.customPin, validateOnly: body.action === "preview" });
    if (body.action === "preview") return json({ reviewed: true, point: plan.point, radiusKm: plan.radiusKm });
    const latest = await supabaseAdmin!.from("recruitment_ads").select("raw_payload").eq("company_id", companyId).eq("id", scoped.ad.id).single();
    if (latest.error) throw latest.error;
    const after = result.after;
    const saved = await supabaseAdmin!.from("recruitment_ads").update({ status: metaDeliveryStatus(after), last_synced_at: new Date().toISOString(), raw_payload: { ...latest.data.raw_payload, ...after,
      adset: { ...latest.data.raw_payload?.adset, ...after.adset }, campaign: { ...latest.data.raw_payload?.campaign, ...after.campaign },
      last_audience_change: { at: new Date().toISOString(), radiusKm: plan.radiusKm, center: body.center, actor_email: scoped.session.email }
    } }).eq("company_id", companyId).eq("id", scoped.ad.id);
    if (saved.error) throw saved.error;
    const completed = await supabaseAdmin!.from(table).update({ status: "completed", after_targeting: after.adset?.targeting, completed_at: new Date().toISOString() }).eq("company_id", companyId).eq("id", auditId);
    if (completed.error) throw completed.error;
    return json({ saved: true, status: metaDeliveryStatus(after), radiusKm: plan.radiusKm });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unable to update the audience.";
    if (auditId) await supabaseAdmin!.from(table).update({ status: "failed", error_message: detail.slice(0, 2000), completed_at: new Date().toISOString() }).eq("company_id", companyId).eq("id", auditId);
    return json({ error: attempted ? `${detail} Refresh the audience before retrying; Meta may already have saved it.` : detail }, 502);
  }
}
