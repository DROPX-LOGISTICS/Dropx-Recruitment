import { promotionAccess, promotionJson as json, promotionTable } from "@/lib/promotion-api";
import { resolveRecruitmentAdAudience } from "@/lib/recruitment-ad-audience";
import { promotionReviewVersion, validatePromotionDraft } from "@/lib/promotion-audience";
import { publishPromotion, validatePromotionCampaign } from "@/lib/meta-promotion-ads";
import { metaDeliveryStatus } from "@/lib/meta-ad-delivery";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams, locationId = params.get("locationId") || "";
    const access = await promotionAccess(request, params.get("stream"), locationId); if ("error" in access) return access.error;
    if (locationId) return json({ audience: await resolveRecruitmentAdAudience({ companyId: access.companyId, locationId }) });
    let query = access.db.from(promotionTable).select("id,ad_name,purpose,status,meta_ad_id,draft,error_message,created_at,location_id").eq("company_id", access.companyId).eq("stream", access.stream);
    if (!access.session.isOwner && !access.session.allLocations) query = query.in("location_id", access.session.locationIds);
    const result = await query.order("created_at", { ascending: false }).limit(500);
    if (result.error) throw result.error;
    return json({ ads: result.data || [] });
  } catch (error) { return json({ error: error instanceof Error ? error.message : "Unable to load promotions." }, 400); }
}
export async function POST(request: Request) {
  let savedId = "";
  let access: Awaited<ReturnType<typeof promotionAccess>> | null = null;
  try {
    const body = await request.json();
    access = await promotionAccess(request, body.stream, String(body.locationId || "")); if ("error" in access) return access.error;
    if (!["review", "create"].includes(body.action) || !body.locationId || body.confirmPurpose !== true) return json({ error: "Confirm that the ad, image and destination promote a service or customer offer." }, 400);
    const audience = await resolveRecruitmentAdAudience({ companyId: access.companyId, locationId: body.locationId, radiusKm: body.draft?.audienceRadiusKm, customPin: body.draft?.customPin });
    const draft = validatePromotionDraft(body.draft, audience);
    const reviewVersion = promotionReviewVersion(draft);
    if (body.action === "review") { await validatePromotionCampaign(draft); return json({ review: draft, reviewVersion }); }
    if (body.reviewVersion !== reviewVersion) return json({ error: "Review the current promotion, audience and budget before creating it." }, 409);
    if (!/^[a-f0-9-]{36}$/i.test(body.clientRequestId || "")) return json({ error: "Reopen the promotion form before submitting." }, 400);
    const inserted = await access.db.from(promotionTable).insert({ company_id: access.companyId, stream: access.stream, location_id: body.locationId,
      client_request_id: body.clientRequestId, purpose: draft.purpose, ad_name: draft.adName, draft, status: "publishing", actor_email: access.session.email }).select("id").single();
    if (inserted.error?.code === "23505") return json({ error: "This promotion was already submitted. Refresh the list to see its result; do not submit a duplicate." }, 409);
    if (inserted.error) throw inserted.error; savedId = inserted.data.id;
    const db = access.db, companyId = access.companyId;
    const result = await publishPromotion(draft, async progress => {
      const saved = await db.from(promotionTable).update({ progress, meta_ad_id: progress.adId || null, updated_at: new Date().toISOString() }).eq("company_id", companyId).eq("id", savedId);
      if (saved.error) throw saved.error;
    });
    const saved = await db.from(promotionTable).update({ progress: result.progress, meta_ad_id: result.progress.adId, snapshot: result.snapshot, status: metaDeliveryStatus(result.snapshot), updated_at: new Date().toISOString() }).eq("company_id", companyId).eq("id", savedId);
    if (saved.error) throw saved.error;
    return json({ created: true, id: savedId, status: "PAUSED", metaAdId: result.progress.adId });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unable to create the promotion.";
    if (savedId && access && !("error" in access)) await access.db.from(promotionTable).update({ status: "failed", error_message: detail.slice(0, 1500), updated_at: new Date().toISOString() }).eq("company_id", access.companyId).eq("id", savedId);
    return json({ error: savedId ? `${detail} Created Meta objects remain paused. Check the saved promotion before trying again.` : detail }, 400);
  }
}
