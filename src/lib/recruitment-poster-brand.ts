import { supabaseAdmin } from "./supabase-admin";
export type PosterBrand = { key: "dropx" | "amazon_now" | "amazon" | "flipkart"; label: string; workplace: string };
export const DROPX_BRAND: PosterBrand = { key: "dropx", label: "DropX Logistics", workplace: "Use only the supplied job details; do not assume a dark store or a delivery station." };
export function resolvePosterBrand(provider: string | null, model: string | null): PosterBrand {
  const p = provider?.trim().toUpperCase(), m = model?.trim().toUpperCase();
  if (p === "AMAZON" && m === "NOW") return { key: "amazon_now", label: "DropX + Amazon Now", workplace: "Amazon Now quick-commerce dark store." };
  if (p === "AMAZON" && (m === "EDSP" || m === "XPT")) return { key: "amazon", label: "DropX + Amazon Last Mile", workplace: "Amazon last-mile parcel delivery station; use delivery and parcel imagery, not a grocery dark store." };
  if (p === "AMAZON" && m === "AMXL") return { key: "amazon", label: "DropX + Amazon AMXL", workplace: "Amazon AMXL large-package logistics; do not depict a grocery dark store." };
  if (p === "FLIPKART") return { key: "flipkart", label: "DropX + Flipkart", workplace: "Flipkart logistics location. Do not assume Flipkart Minutes or quick commerce unless the confirmed job details say so." };
  return { ...DROPX_BRAND };
}
export async function loadPosterBrand(companyId: string, stationId: string | null): Promise<PosterBrand> {
  if (!stationId || !supabaseAdmin) return { ...DROPX_BRAND };
  const station = await supabaseAdmin.from("stations").select("provider_id,location_model_id").eq("company_id", companyId).eq("id", stationId).eq("is_active", true).maybeSingle();
  if (station.error) throw new Error("Station branding could not be checked. Please retry.");
  if (!station.data?.provider_id) return { ...DROPX_BRAND };
  const provider = await supabaseAdmin.from("providers").select("id,code").eq("company_id", companyId).eq("id", station.data.provider_id).eq("is_active", true).maybeSingle();
  if (provider.error) throw new Error("Station branding could not be checked. Please retry.");
  if (!provider.data) return { ...DROPX_BRAND };
  let modelCode: string | null = null;
  if (station.data.location_model_id) {
    const model = await supabaseAdmin.from("location_models").select("code,provider_id").eq("company_id", companyId).eq("id", station.data.location_model_id).eq("is_active", true).maybeSingle();
    if (model.error) throw new Error("Station branding could not be checked. Please retry.");
    if (!model.data || model.data.provider_id !== provider.data.id) return { ...DROPX_BRAND };
    modelCode = model.data.code;
  }
  return resolvePosterBrand(provider.data.code, modelCode);
}
