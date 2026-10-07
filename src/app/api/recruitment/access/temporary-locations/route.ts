import { NextResponse } from "next/server";
import { canManageTemporaryLocations, canUseRecruitmentMenu, recruitmentSession, requiredEnv } from "@/lib/recruitment-api";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { validAccessId, validateTemporaryLocationInput } from "@/lib/recruitment-temporary-locations";

export const dynamic = "force-dynamic";
const fields = "id,user_access_id,location_id,starts_at,expires_at,reason,granted_by,created_at,revoked_at,revoked_by,recruitment_locations(code,name),grantor:profiles!recruitment_temporary_location_grants_granted_by_fkey(full_name),revoker:profiles!recruitment_temporary_location_grants_revoked_by_fkey(full_name)";

export async function GET(request: Request) {
  try {
    const session = await recruitmentSession(request);
    if (!session || !canUseRecruitmentMenu(session, "Access Control", "view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
    const profileId = new URL(request.url).searchParams.get("profileId");
    if (!validAccessId(profileId)) return NextResponse.json({ error: "Select a valid user." }, { status: 400 });
    const access = await supabaseAdmin!.from("recruitment_user_access").select("id")
      .eq("company_id", companyId).eq("profile_id", profileId).maybeSingle();
    if (access.error) throw access.error;
    if (!access.data) return NextResponse.json({ grants: [] });
    // History is paged independently from the user list, newest grants first.
    const url = new URL(request.url);
    const page = Math.max(0, Math.floor(Number(url.searchParams.get("page")) || 0));
    const result = await supabaseAdmin!.from("recruitment_temporary_location_grants")
      .select(fields, { count: "exact" }).eq("company_id", companyId).eq("user_access_id", access.data.id)
      .order("created_at", { ascending: false }).order("id").range(page * 100, page * 100 + 99);
    if (result.error) throw result.error;
    return NextResponse.json({ grants: result.data ?? [], total: result.count, canManage: canManageTemporaryLocations(session) });
  } catch (error) {
    console.error("Temporary Recruit access read failed", error);
    return NextResponse.json({ error: "Unable to load temporary access. Please retry." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await recruitmentSession(request);
    if (!canManageTemporaryLocations(session) || !session) return NextResponse.json({ error: "Company-wide Users & Access edit permission is required." }, { status: 403 });
    const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
    const body = await request.json() as Record<string, unknown>;
    const input = validateTemporaryLocationInput(body);
    const [profile, access, membership, locations] = await Promise.all([
      supabaseAdmin!.from("profiles").select("id").eq("company_id", companyId).eq("id", input.profileId).eq("is_active", true).maybeSingle(),
      supabaseAdmin!.from("recruitment_user_access").select("id").eq("company_id", companyId).eq("profile_id", input.profileId).eq("is_active", true).maybeSingle(),
      supabaseAdmin!.from("company_product_memberships").select("id").eq("company_id", companyId).eq("user_id", input.profileId).eq("product_code", "recruit").eq("is_active", true).maybeSingle(),
      supabaseAdmin!.from("recruitment_locations").select("id").eq("company_id", companyId).eq("is_active", true).not("station_id", "is", null).in("id", input.locationIds)
    ]);
    if ([profile, access, membership, locations].some((result) => result.error)) throw new Error("Unable to validate access. Please retry.");
    if (!profile.data || !access.data || !membership.data) return NextResponse.json({ error: "Activate this user's Recruit access first." }, { status: 400 });
    if (locations.data?.length !== input.locationIds.length) return NextResponse.json({ error: "One or more locations are inactive or outside this company." }, { status: 400 });
    const startsAt = new Date().toISOString();
    // Multi-select is one atomic insert. A client request ID makes network retries idempotent.
    const saved = await supabaseAdmin!.from("recruitment_temporary_location_grants").upsert(input.locationIds.map((locationId) => ({
      company_id: companyId, user_access_id: access.data!.id, location_id: locationId,
      request_id: input.requestId, starts_at: startsAt, expires_at: input.expiresAt,
      reason: input.reason, granted_by: session.profileId
    })), { onConflict: "company_id,request_id,location_id", ignoreDuplicates: true });
    if (saved.error) throw saved.error;
    return NextResponse.json({ saved: true });
  } catch (error) {
    console.error("Temporary Recruit access grant failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to grant access. Please retry." }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await recruitmentSession(request);
    if (!canManageTemporaryLocations(session) || !session) return NextResponse.json({ error: "Company-wide Users & Access edit permission is required." }, { status: 403 });
    const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
    const body = await request.json() as Record<string, unknown>;
    if (!validAccessId(body.grantId) || !validAccessId(body.profileId)) return NextResponse.json({ error: "Select a valid grant." }, { status: 400 });
    const access = await supabaseAdmin!.from("recruitment_user_access").select("id")
      .eq("company_id", companyId).eq("profile_id", body.profileId).maybeSingle();
    if (access.error) throw access.error;
    if (!access.data) return NextResponse.json({ error: "User access was not found." }, { status: 404 });
    const grant = await supabaseAdmin!.from("recruitment_temporary_location_grants").select("id")
      .eq("company_id", companyId).eq("user_access_id", access.data.id).eq("id", body.grantId).maybeSingle();
    if (grant.error) throw grant.error;
    if (!grant.data) return NextResponse.json({ error: "Grant was not found." }, { status: 404 });
    const saved = await supabaseAdmin!.from("recruitment_temporary_location_grants")
      .update({ revoked_at: new Date().toISOString(), revoked_by: session.profileId })
      .eq("company_id", companyId).eq("user_access_id", access.data.id).eq("id", body.grantId).is("revoked_at", null);
    if (saved.error) throw saved.error;
    return NextResponse.json({ saved: true });
  } catch (error) {
    console.error("Temporary Recruit access revoke failed", error);
    return NextResponse.json({ error: "Unable to disable access. Please retry." }, { status: 500 });
  }
}
