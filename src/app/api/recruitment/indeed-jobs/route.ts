import { NextResponse } from "next/server";
import { canUseRecruitmentMenu, recruitmentSession, requiredEnv } from "@/lib/recruitment-api";
import { validateIndeedMappingInput } from "@/lib/recruitment-source-ingestion";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function mappingSession(request: Request, required: "view" | "edit") {
  const session = await recruitmentSession(request);
  if (!session?.hr || !canUseRecruitmentMenu(session, "Connections", required, "hr")) return null;
  return session;
}

export async function GET(request: Request) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase is not configured.");
    const session = await mappingSession(request, "view");
    if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
    const [mappings, locations, roles] = await Promise.all([
      supabaseAdmin.from("recruitment_indeed_job_mappings")
        .select("id,indeed_job_id,indeed_published_id,public_title,internal_code,location_id,role_id,is_active,last_application_at,updated_at")
        .eq("company_id", companyId)
        .order("public_title"),
      supabaseAdmin.from("recruitment_locations")
        .select("id,code,name,region,state")
        .eq("company_id", companyId).eq("is_active", true).order("code"),
      supabaseAdmin.from("recruitment_roles")
        .select("id,code,name,stream")
        .eq("company_id", companyId).eq("is_active", true).eq("stream", "hr").order("code")
    ]);
    const failed = [mappings, locations, roles].find((result) => result.error);
    if (failed?.error) throw new Error(failed.error.message);
    const locationById = new Map((locations.data ?? []).map((item) => [item.id, item]));
    const roleById = new Map((roles.data ?? []).map((item) => [item.id, item]));
    return NextResponse.json({
      mappings: (mappings.data ?? []).map((item) => ({
        id: item.id,
        indeedJobId: item.indeed_job_id,
        indeedPublishedId: item.indeed_published_id,
        publicTitle: item.public_title,
        internalCode: item.internal_code,
        locationId: item.location_id,
        roleId: item.role_id,
        isActive: item.is_active,
        lastApplicationAt: item.last_application_at,
        updatedAt: item.updated_at,
        location: locationById.get(item.location_id) ?? null,
        role: roleById.get(item.role_id) ?? null
      })),
      locations: locations.data ?? [],
      roles: roles.data ?? []
    });
  } catch (error) {
    console.error("Indeed job mapping list failed", error);
    return NextResponse.json({ error: "Unable to load Indeed job mappings." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase is not configured.");
    const session = await mappingSession(request, "edit");
    if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
    const body = await request.json() as Record<string, unknown>;
    const indeedJobId = String(body.indeedJobId ?? "").trim();
    const indeedPublishedId = String(body.indeedPublishedId ?? "").trim() || null;
    const publicTitle = String(body.publicTitle ?? "").trim();
    const internalCode = String(body.internalCode ?? "").trim().toUpperCase();
    const locationId = String(body.locationId ?? "").trim();
    const roleId = String(body.roleId ?? "").trim();
    if (!indeedJobId || indeedJobId.length > 512 || !locationId || !roleId) {
      return NextResponse.json({ error: "Indeed job ID, business location and HR designation are required." }, { status: 400 });
    }
    const [location, role] = await Promise.all([
      supabaseAdmin.from("recruitment_locations").select("id,code,is_active")
        .eq("company_id", companyId).eq("id", locationId).maybeSingle(),
      supabaseAdmin.from("recruitment_roles").select("id,code,stream,is_active")
        .eq("company_id", companyId).eq("id", roleId).maybeSingle()
    ]);
    if (location.error || role.error) throw new Error(location.error?.message || role.error?.message);
    if (!location.data?.is_active || !role.data?.is_active) {
      return NextResponse.json({ error: "Choose active routing masters." }, { status: 400 });
    }
    const validated = validateIndeedMappingInput({
      internalCode,
      publicTitle,
      roleCode: role.data.code,
      roleStream: role.data.stream
    });
    const saved = await supabaseAdmin.from("recruitment_indeed_job_mappings").upsert({
      company_id: companyId,
      indeed_job_id: indeedJobId,
      indeed_published_id: indeedPublishedId,
      public_title: validated.publicTitle,
      internal_code: validated.internalCode,
      location_id: locationId,
      role_id: roleId,
      is_active: body.isActive !== false,
      updated_by: session.profileId,
      updated_at: new Date().toISOString()
    }, { onConflict: "company_id,indeed_job_id" }).select("id").single();
    if (saved.error) throw new Error(saved.error.message);
    const audit = await supabaseAdmin.from("recruitment_connection_audit").insert({
      company_id: companyId,
      provider: "indeed",
      action: "job_mapping_saved",
      changed_fields: ["public_title","internal_code","location_id","role_id","is_active"],
      actor_profile_id: session.profileId,
      actor_email: session.email
    });
    if (audit.error) throw new Error(audit.error.message);
    return NextResponse.json({ saved: true, id: saved.data.id });
  } catch (error) {
    console.error("Indeed job mapping save failed", error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Unable to save Indeed job mapping."
    }, { status: 400 });
  }
}
