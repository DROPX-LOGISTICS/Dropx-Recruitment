import { scopedPromotion, promotionJson as json, promotionTable, promotionEvents } from "@/lib/promotion-api";
import { assertPromotionSnapshot, currentAudiencePin, promotionDemographics, promotionEditVersion, promotionTargeting } from "@/lib/promotion-audience";
import { getPromotionSnapshot, setPromotionDelivery, updatePromotionAudience } from "@/lib/meta-promotion-ads";
import { metaDeliveryStatus } from "@/lib/meta-ad-delivery";
import { validateAdAudiencePin } from "@/lib/meta-audience-pin";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const access = await scopedPromotion(request, params.id); if ("error" in access) return access.error;
    if (!access.ad.meta_ad_id) return json({ error: "This promotion has not finished publishing. Check its status in the list." }, 409);
    const snapshot = await getPromotionSnapshot(access.ad.meta_ad_id); assertPromotionSnapshot(snapshot, access.ad);
    const target = snapshot.adset?.targeting;
    return json({ ad: { ...access.ad, snapshot }, version: promotionEditVersion(snapshot), status: metaDeliveryStatus(snapshot),
      point: currentAudiencePin(target), demographics: { ageMin: target?.age_min ?? 18, ageMax: target?.age_max ?? 65, gender: target?.genders?.length === 1 ? target.genders[0] === 1 ? "male" : "female" : "all" } });
  } catch (error) { return json({ error: error instanceof Error ? error.message : "Unable to load the promotion audience." }, 400); }
}
export async function POST(request: Request, { params }: { params: { id: string } }) {
  let access: Awaited<ReturnType<typeof scopedPromotion>> | null = null, eventId = "", attempted = false;
  try {
    access = await scopedPromotion(request, params.id); if ("error" in access) return access.error;
    const body = await request.json();
    if (!["review_audience", "apply_audience", "ACTIVE", "PAUSED"].includes(body.action) || !/^[a-f0-9]{64}$/.test(body.version || "") || !/^[a-f0-9-]{36}$/i.test(body.clientRequestId || "")) return json({ error: "Invalid promotion change. Reload the editor." }, 400);
    if (!access.ad.meta_ad_id) return json({ error: "This promotion has not finished publishing." }, 409);
    const prior = await access.db.from(promotionEvents).select("ad_id,status").eq("company_id", access.companyId).eq("client_request_id", body.clientRequestId).maybeSingle();
    if (prior.error) throw prior.error;
    if (prior.data) return json({ error: "This change was already submitted. Refresh to check the saved result before retrying." }, 409);
    const snapshot = await getPromotionSnapshot(access.ad.meta_ad_id); assertPromotionSnapshot(snapshot, access.ad);
    if (promotionEditVersion(snapshot) !== body.version) return json({ error: "The promotion changed in Meta. Reload and review again." }, 409);
    const audienceAction = ["review_audience", "apply_audience"].includes(body.action);
    const demographics = audienceAction ? promotionDemographics(body.demographics) : access.ad.draft.demographics;
    const point = audienceAction ? validateAdAudiencePin(body.point) : access.ad.draft.audience;
    const radiusKm = audienceAction ? Number(body.radiusKm) : access.ad.draft.audience.radiusKm;
    promotionTargeting(point, radiusKm, demographics);
    const input = { record: access.ad, expectedVersion: body.version, point, radiusKm, demographics, validateOnly: body.action === "review_audience" };
    if (body.action === "review_audience") { await updatePromotionAudience(input); return json({ reviewed: true }); }
    if (body.action === "ACTIVE" && body.confirmLaunch !== true) return json({ error: "Confirm the daily budget and end date before starting this promotion." }, 400);
    // A unique partial index serializes audience and delivery changes for each promotion.
    const event = await access.db.from(promotionEvents).insert({ company_id: access.companyId, ad_id: access.ad.id, client_request_id: body.clientRequestId,
      action: audienceAction ? "audience" : body.action, status: "processing", before_snapshot: snapshot, requested_change: audienceAction ? { point, radiusKm, demographics } : { status: body.action }, actor_email: access.session.email }).select("id").single();
    if (event.error?.code === "23505") return json({ error: "Another change is being processed. Refresh before retrying." }, 409);
    if (event.error) throw event.error; eventId = event.data.id; attempted = true;
    const after = audienceAction ? await updatePromotionAudience({ ...input, validateOnly: false }) : await setPromotionDelivery(access.ad, body.action, body.version);
    const draft = audienceAction ? { ...access.ad.draft, demographics, audience: { ...access.ad.draft.audience, ...point, radiusKm, source: "ad_override" } } : access.ad.draft;
    const saved = await access.db.from(promotionTable).update({ draft, snapshot: after, status: metaDeliveryStatus(after), updated_at: new Date().toISOString() }).eq("company_id", access.companyId).eq("id", access.ad.id);
    if (saved.error) throw saved.error;
    const audit = await access.db.from(promotionEvents).update({ status: "completed", after_snapshot: after, completed_at: new Date().toISOString() }).eq("company_id", access.companyId).eq("id", eventId);
    if (audit.error) throw audit.error;
    return json({ saved: true, status: metaDeliveryStatus(after) });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unable to update the promotion.";
    if (access && !("error" in access) && eventId) await access.db.from(promotionEvents).update({ status: "failed", error_message: detail.slice(0, 1500), completed_at: new Date().toISOString() }).eq("company_id", access.companyId).eq("id", eventId);
    return json({ error: attempted ? `${detail} Meta may have saved the change; refresh before retrying.` : detail }, 400);
  }
}
