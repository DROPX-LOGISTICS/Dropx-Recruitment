import { NextResponse } from "next/server";
import { canAccessLead, canUseRecruitmentMenu, recruitmentSession, requiredEnv } from "./recruitment-api";
import { supabaseAdmin } from "./supabase-admin";
export async function scopedRecruitmentAd(request: Request, id: string, edit = false) {
  const session = await recruitmentSession(request);
  if (!session) return { error: NextResponse.json({error:"Unauthorized"},{status:401}) } as const;
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
  const result = await supabaseAdmin.from("recruitment_ads").select("id,ad_name,meta_ad_id,location_id,role_id,status,raw_payload,recruitment_roles(stream)").eq("company_id",companyId).eq("id",id).maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) return {error:NextResponse.json({error:"Ad not found."},{status:404})} as const;
  const ad = result.data, role = Array.isArray(ad.recruitment_roles) ? ad.recruitment_roles[0] : ad.recruitment_roles;
  const stream = role?.stream === "hr" ? "hr" : "workforce";
  if (!canUseRecruitmentMenu(session,"Active Ads",edit ? "all" : "view",stream) || !canAccessLead(session,{stream,location_id:ad.location_id,role_id:ad.role_id})) return {error:NextResponse.json({error:"This action is outside your assigned ad access."},{status:403})} as const;
  return {ad,session,companyId} as const;
}
