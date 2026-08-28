import { NextResponse } from "next/server";
import { canAccessLead, canUseRecruitmentMenu, recruitmentSession, requiredEnv } from "@/lib/recruitment-api";
import { enqueueLeadNotification } from "@/lib/recruitment-notifications";
import { canonicalApplicationKey, normalizePhone } from "@/lib/recruitment-routing";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { RecruitmentMenuId } from "@/lib/recruitment-menu-roles";
import { legacyLeadDetailMenus } from "@/lib/lead-detail-menu";
import { normalizeCandidateLocation } from "@/lib/hr-recruitment-overview";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const leadMenus = new Set<RecruitmentMenuId>([
  "All Leads", "Archived Leads", "No Response / Call Back", "Interviews",
  "Unmapped", "Screening", "Documents", "Offers", "Hired"
]);

async function scopedLead(request: Request, id: string, includeContact = false) {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  const session = await recruitmentSession(request);
  if (!session) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
  const result = await supabaseAdmin
    .from("recruitment_leads")
    .select("*, recruitment_locations(id,code,name,address,latitude,longitude,poc_name,poc_mobile), recruitment_roles(id,code,name,stream), recruitment_ads(id,ad_name,campaign_name,adset_name), assigned_profile:profiles!recruitment_leads_assigned_profile_id_fkey(id,full_name,email)")
    .eq("company_id", companyId)
    .eq("id", id)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  const lead = result.data;
  if (!lead) return { error: NextResponse.json({ error: "Lead not found." }, { status: 404 }) };
  if (!canAccessLead(session, lead)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  if (includeContact && lead.location_id) {
    const contact = await supabaseAdmin.from("recruitment_location_contacts")
      .select("address,latitude,longitude,poc_name,poc_mobile")
      .eq("company_id", companyId)
      .eq("location_id", lead.location_id)
      .maybeSingle();
    if (contact.error) throw new Error(contact.error.message);
    if (contact.data) lead.recruitment_locations = {
      ...(lead.recruitment_locations ?? {}),
      ...contact.data
    };
  }
  return { session, companyId, lead };
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase is not configured.");
    const startedAt = Date.now();
    const resolved = await scopedLead(request, params.id);
    if (resolved.error) return resolved.error;
    const requestedMenu = new URL(request.url).searchParams.get("menu") as RecruitmentMenuId | null;
    const workspace = resolved.lead!.stream as "workforce"|"hr";
    const menu = requestedMenu
      ? leadMenus.has(requestedMenu) && canUseRecruitmentMenu(resolved.session, requestedMenu, "view", workspace)
        ? requestedMenu
        : null
      : legacyLeadDetailMenus(resolved.lead!).find((candidate) =>
          canUseRecruitmentMenu(resolved.session, candidate, "view", workspace)) ?? null;
    if (!menu) {
      return NextResponse.json({ error: "View access to this Recruitment queue is required." }, { status: 403 });
    }
    const leadLoadedAt = Date.now();
    const [history, contact, interviews] = await Promise.all([
      supabaseAdmin.from("recruitment_lead_history")
        .select("id,event_type,field_name,old_value,new_value,remarks,actor_profile_id,actor_email,metadata,created_at")
        .eq("company_id", resolved.companyId!)
        .eq("lead_id", params.id)
        .order("created_at", { ascending: false })
        .limit(500),
      resolved.lead!.location_id
        ? supabaseAdmin.from("recruitment_location_contacts")
            .select("address,latitude,longitude,poc_name,poc_mobile")
            .eq("company_id", resolved.companyId!)
            .eq("location_id", resolved.lead!.location_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      workspace === "hr"
        ? supabaseAdmin.from("recruitment_hr_interviews")
            .select("id,round_no,interviewer_profile_id,assigned_by_profile_id,status,scheduled_at,duration_minutes,channels,recruiter_note,meet_link,calendar_event_id,invitation_delivery,decision,feedback,completed_at,created_at,updated_at")
            .eq("company_id", resolved.companyId!)
            .eq("lead_id", params.id)
            .order("round_no", { ascending: true })
        : Promise.resolve({ data: [], error: null })
    ]);
    const interviewTableMissing = interviews.error
      && /relation .* does not exist|schema cache/i.test(interviews.error.message);
    if (history.error || contact.error || (interviews.error && !interviewTableMissing)) {
      throw new Error(history.error?.message || contact.error?.message || interviews.error?.message);
    }
    const lead = contact.data ? {
      ...resolved.lead,
      recruitment_locations: {
        ...(resolved.lead!.recruitment_locations ?? {}),
        ...contact.data
      }
    } : resolved.lead;
    const finishedAt = Date.now();
    return NextResponse.json(
      { lead, history: history.data ?? [], interviews: interviews.data ?? [], messages: [], sources: [] },
      {
        headers: {
          "Cache-Control": "private, no-store, max-age=0",
          "Server-Timing": `lead;dur=${leadLoadedAt - startedAt},related;dur=${finishedAt - leadLoadedAt},total;dur=${finishedAt - startedAt}`
        }
      }
    );
  } catch (error) {
    console.error("Recruitment lead detail failed", error);
    return NextResponse.json({ error: "Unable to load lead details." }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase is not configured.");
    const resolved = await scopedLead(request, params.id, true);
    if (resolved.error) return resolved.error;
    const body = await request.json() as Record<string, unknown>;
    const menu = String(body.menu ?? "All Leads") as RecruitmentMenuId;
    if (!leadMenus.has(menu) || !canUseRecruitmentMenu(resolved.session, menu, "edit", resolved.lead!.stream as "workforce"|"hr")) {
      return NextResponse.json({ error: "This role has View access only." }, { status: 403 });
    }
    delete body.menu;
    const allowed = ["remarks", "follow_up_at", "callback_at", "final_status", "final_remarks", "work_email"] as const;
    const update: Record<string, unknown> = { updated_at: new Date().toISOString(), last_updated_by: resolved.session!.profileId };
    const changes: Array<{ field: string; oldValue: string | null; newValue: string | null }> = [];
    for (const field of allowed) {
      if (!(field in body)) continue;
      const value = body[field] == null || body[field] === "" ? null : String(body[field]).slice(0, 3000);
      update[field] = value;
      changes.push({ field, oldValue: resolved.lead![field] == null ? null : String(resolved.lead![field]), newValue: value });
    }
    if (["full_name", "phone", "email", "city", "post_code", "location_id", "role_id"].some((field) => field in body)) {
      if (!canUseRecruitmentMenu(resolved.session, "All Leads", "all", resolved.lead!.stream as "workforce"|"hr")) {
        return NextResponse.json({ error: "All access is required to correct source identity or routing fields." }, { status: 403 });
      }
      for (const field of ["full_name", "email", "city"] as const) {
        if (!(field in body)) continue;
        const value = body[field] == null || body[field] === "" ? null : String(body[field]).trim().slice(0, 500);
        update[field] = value;
        changes.push({
          field,
          oldValue: resolved.lead![field] == null ? null : String(resolved.lead![field]),
          newValue: value
        });
      }
      if ("post_code" in body) {
        const { postCode } = normalizeCandidateLocation(resolved.lead!.city, body.post_code);
        update.post_code = postCode;
        changes.push({
          field: "post_code",
          oldValue: resolved.lead!.post_code == null ? null : String(resolved.lead!.post_code),
          newValue: postCode
        });
      }
      if ("phone" in body) {
        const rawPhone = String(body.phone ?? "").trim();
        const normalizedPhone = normalizePhone(rawPhone);
        if (!normalizedPhone) {
          return NextResponse.json({ error: "Enter a valid 10-digit Indian mobile number." }, { status: 400 });
        }
        const canonicalKey = canonicalApplicationKey(
          resolved.lead!.ad_name,
          normalizedPhone,
          resolved.lead!.meta_lead_id
        );
        if (!canonicalKey) {
          return NextResponse.json({ error: "Unable to create a stable identity for this number." }, { status: 400 });
        }
        const duplicate = await supabaseAdmin.from("recruitment_leads").select("id")
          .eq("company_id", resolved.companyId!)
          .eq("canonical_key", canonicalKey)
          .neq("id", params.id)
          .maybeSingle();
        if (duplicate.error) throw new Error(duplicate.error.message);
        if (duplicate.data) {
          return NextResponse.json({
            error: "Another lead already uses this mobile number for the same ad. Merge or review that lead instead of creating a duplicate."
          }, { status: 409 });
        }
        update.phone = normalizedPhone;
        update.normalized_phone = normalizedPhone;
        update.canonical_key = canonicalKey;
        changes.push({
          field: "phone",
          oldValue: resolved.lead!.phone == null ? null : String(resolved.lead!.phone),
          newValue: normalizedPhone
        });
      }
      if ("location_id" in body) {
        const locationId = body.location_id == null || body.location_id === "" ? null : String(body.location_id);
        if (locationId) {
          const location = await supabaseAdmin.from("recruitment_locations").select("id")
            .eq("company_id", resolved.companyId!).eq("id", locationId).eq("is_active", true).maybeSingle();
          if (location.error) throw new Error(location.error.message);
          if (!location.data) return NextResponse.json({ error: "Select an active station." }, { status: 400 });
        }
        update.location_id = locationId;
        changes.push({
          field: "location_id",
          oldValue: resolved.lead!.location_id == null ? null : String(resolved.lead!.location_id),
          newValue: locationId
        });
      }
      if ("role_id" in body) {
        const roleId = body.role_id == null || body.role_id === "" ? null : String(body.role_id);
        let roleStream: string | null = null;
        if (roleId) {
          const role = await supabaseAdmin.from("recruitment_roles").select("id,stream")
            .eq("company_id", resolved.companyId!).eq("id", roleId).eq("is_active", true).maybeSingle();
          if (role.error) throw new Error(role.error.message);
          if (!role.data) return NextResponse.json({ error: "Select an active designation." }, { status: 400 });
          roleStream = role.data.stream;
        }
        update.role_id = roleId;
        update.stream = roleStream;
        changes.push({
          field: "role_id",
          oldValue: resolved.lead!.role_id == null ? null : String(resolved.lead!.role_id),
          newValue: roleId
        });
      }
    }
    if ("assigned_profile_id" in body) {
      if (!canUseRecruitmentMenu(resolved.session, "All Leads", "all", resolved.lead!.stream as "workforce"|"hr")) {
        return NextResponse.json({ error: "All access is required to reassign a lead." }, { status: 403 });
      }
      const assignedProfileId = body.assigned_profile_id == null || body.assigned_profile_id === ""
        ? null
        : String(body.assigned_profile_id);
      if (assignedProfileId) {
        const target = await supabaseAdmin.from("recruitment_user_access").select("profile_id")
          .eq("company_id", resolved.companyId!)
          .eq("profile_id", assignedProfileId)
          .eq("is_active", true)
          .maybeSingle();
        if (target.error) throw new Error(target.error.message);
        if (!target.data) {
          return NextResponse.json({ error: "The selected assignee is not an active recruitment user." }, { status: 400 });
        }
      }
      update.assigned_profile_id = assignedProfileId;
      changes.push({
        field: "assigned_profile_id",
        oldValue: resolved.lead!.assigned_profile_id == null ? null : String(resolved.lead!.assigned_profile_id),
        newValue: assignedProfileId
      });
    }
    if (!changes.length) return NextResponse.json({ error: "No supported fields supplied." }, { status: 400 });
    const saved = await supabaseAdmin.from("recruitment_leads").update(update)
      .eq("company_id", resolved.companyId!).eq("id", params.id).select("*").single();
    if (saved.error) throw new Error(saved.error.message);
    const history = await supabaseAdmin.from("recruitment_lead_history").insert(changes.map((change) => ({
      company_id: resolved.companyId, lead_id: params.id, event_type: "field_update",
      field_name: change.field, old_value: change.oldValue, new_value: change.newValue,
      actor_profile_id: resolved.session!.profileId, actor_email: resolved.session!.email,
      metadata: { source: "web_or_mobile" }
    })));
    if (history.error) throw new Error(history.error.message);
    const interviewChange = changes.find((change) => change.field === "follow_up_at" && change.newValue);
    if (interviewChange && ["interview_scheduled", "interview_rescheduled"].includes(String(resolved.lead!.status ?? ""))) {
      await enqueueLeadNotification({
        companyId: resolved.companyId!,
        lead: {
          id: resolved.lead!.id,
          phone: resolved.lead!.phone,
          full_name: resolved.lead!.full_name,
          stream: resolved.lead!.stream,
          location_id: resolved.lead!.location_id,
          recruitment_roles: resolved.lead!.recruitment_roles,
          recruitment_locations: resolved.lead!.recruitment_locations
        },
        trigger: "interview",
        anchor: String(interviewChange.newValue)
      });
    }
    return NextResponse.json({ lead: saved.data });
  } catch (error) {
    console.error("Recruitment lead update failed", error);
    return NextResponse.json({ error: "Unable to update lead." }, { status: 500 });
  }
}
