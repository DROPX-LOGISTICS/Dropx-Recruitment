import { NextResponse } from "next/server";
import { canAccessLead, canUseRecruitmentMenu, recruitmentSession, requiredEnv } from "./recruitment-api";
import { supabaseAdmin } from "./supabase-admin";
export const promotionTable = "recruitment_promotion_ads";
export const promotionEvents = "recruitment_promotion_events";
export const promotionJson = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { "Cache-Control": "private, no-store" } });
type PromotionAccess = { session: NonNullable<Awaited<ReturnType<typeof recruitmentSession>>>; companyId: string; stream: "workforce" | "hr"; db: NonNullable<typeof supabaseAdmin> };
export async function promotionAccess(request: Request, stream: unknown, locationId?: string): Promise<PromotionAccess | { error: NextResponse }> {
  const session = await recruitmentSession(request);
  if (!session) return { error: promotionJson({ error: "Unauthorized" }, 401) } as const;
  if (!supabaseAdmin) throw new Error("Database unavailable.");
  if (!["workforce", "hr"].includes(String(stream)) || session.readOnly || session.isPreview || (!session.isOwner && !(stream === "hr" ? session.hr : session.workforce)) || !canUseRecruitmentMenu(session, "Active Ads", "all", stream as "workforce" | "hr") || (!session.isOwner && session.roleIds.length > 0)
    || (locationId && ((!session.isOwner && !session.allLocations && !session.locationIds.includes(locationId)) || !canAccessLead(session, { stream: String(stream), location_id: locationId, role_id: null })))) return { error: promotionJson({ error: "Customer promotions require full ad access and the selected station in your scope. Exit preview before editing." }, 403) } as const;
  return { session, companyId: requiredEnv("RECRUITMENT_COMPANY_ID"), stream: stream as "workforce" | "hr", db: supabaseAdmin } as const;
}
export async function scopedPromotion(request: Request, id: string): Promise<(PromotionAccess & { ad: any }) | { error: NextResponse }> {
  const stream = new URL(request.url).searchParams.get("stream");
  const access = await promotionAccess(request, stream); if ("error" in access) return access;
  const result = await access.db.from(promotionTable).select("*").eq("company_id", access.companyId).eq("stream", access.stream).eq("id", id).maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) return { error: promotionJson({ error: "Promotion not found." }, 404) } as const;
  if ((!access.session.isOwner && !access.session.allLocations && !access.session.locationIds.includes(result.data.location_id)) || !canAccessLead(access.session, { stream: access.stream, location_id: result.data.location_id, role_id: null })) return { error: promotionJson({ error: "This promotion is outside your station scope." }, 403) } as const;
  return { ...access, ad: result.data } as const;
}
