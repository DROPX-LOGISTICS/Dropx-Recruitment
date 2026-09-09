import { supabaseAdmin } from "@/lib/supabase-admin";
import { requiredEnv } from "@/lib/recruitment-api";
import { allowedOrigin, issueIntakeToken, preflight, publicResponse, publicRoleNames } from "@/lib/public-recruit";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;
export async function GET(request: Request) {
  if (!allowedOrigin(request)) return publicResponse(request, { error: "Origin not allowed." }, 403);
  try {
    if (!supabaseAdmin) throw new Error("Unavailable");
    const company = requiredEnv("RECRUITMENT_COMPANY_ID");
    const result = await supabaseAdmin.rpc("website_recruit_catalog", { p_company: company });
    if (result.error) throw result.error;
    return publicResponse(request, { ...result.data, roles: (result.data.roles || []).map((r: {id: string; code: string}) => ({ ...r, name: publicRoleNames[r.code] })), token: issueIntakeToken() });
  } catch (error) {
    console.error("Public recruitment catalog unavailable", error);
    return publicResponse(request, { error: "We couldn’t load opportunities right now. Please try again shortly." }, 503);
  }
}
