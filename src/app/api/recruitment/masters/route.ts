import { NextResponse } from "next/server";
import { getConnectionConfig, invalidateConnectionConfig } from "@/lib/connection-config";
import {
  normalizeNotificationRule,
  notificationRulesFromConfig
} from "@/lib/recruitment-notifications";
import { canUseRecruitmentMenu, recruitmentSession, requiredEnv } from "@/lib/recruitment-api";
import { remapUnmappedApplications } from "@/lib/recruitment-remap";
import { loadMainDashboardStations } from "@/lib/main-dashboard-masters";
import { authoritativeRoleStream } from "@/lib/recruitment-routing";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { loadWorkforceConfig, saveWorkforceConfig } from "@/lib/recruitment-workforce-config";
import { loadHrLifecycleRules, loadHrWorkflowSettings } from "@/lib/hr-recruitment-lifecycle";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase is not configured.");
    const session = await recruitmentSession(request);
    const url = new URL(request.url);
    const resource = url.searchParams.get("resource");
    const workspace = url.searchParams.get("stream") === "hr" ? "hr" : "workforce";
    const masterMenus = ["Station Directory", "Station Contacts", "Roles", "Lead Status Master", "HR Lifecycle", "Notification Rules"] as const;
    if (!masterMenus.includes(resource as typeof masterMenus[number]) || !canUseRecruitmentMenu(session, resource as typeof masterMenus[number], "view", workspace)) {
      return NextResponse.json({ error: "View access to this master is required." }, { status: 403 });
    }
    const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
    const [locations, roles, contacts, whatsapp, mainStations, workforceConfig, lifecycleRules, lifecycleSettings] = await Promise.all([
      supabaseAdmin.from("recruitment_locations").select("id,code,name,state,region,address,latitude,longitude,poc_name,poc_mobile,is_active").eq("company_id", companyId).order("code"),
      supabaseAdmin.from("recruitment_roles").select("id,code,name,stream,aliases,required_fields,is_active").eq("company_id", companyId).order("code")
      ,supabaseAdmin.from("recruitment_location_contacts").select("id,location_id,address,latitude,longitude,poc_name,poc_mobile").eq("company_id", companyId),
      getConnectionConfig("whatsapp"),
      loadMainDashboardStations(companyId),
      loadWorkforceConfig(companyId),
      workspace === "hr" ? loadHrLifecycleRules(supabaseAdmin as any, companyId, { includeInactive: true }) : Promise.resolve([]),
      workspace === "hr" ? loadHrWorkflowSettings(supabaseAdmin as any, companyId) : Promise.resolve(null)
    ]);
    if (locations.error) throw locations.error;
    if (roles.error) throw roles.error;
    if (contacts.error) throw contacts.error;
    const contactByLocation = new Map((contacts.data ?? []).map((contact) => [contact.location_id, contact]));
    const payload = {
      locations: (locations.data ?? []).map((location) => ({
        ...location,
        ...(mainStations.find((station) => station.code === location.code)
          ? {
              name: mainStations.find((station) => station.code === location.code)!.name,
              state: mainStations.find((station) => station.code === location.code)!.state,
              region: mainStations.find((station) => station.code === location.code)!.region,
              cluster: mainStations.find((station) => station.code === location.code)!.operationalOwner?.name ?? null,
              operationalOwner: mainStations.find((station) => station.code === location.code)!.operationalOwner,
              operationalOwnerStatus: mainStations.find((station) => station.code === location.code)!.operationalOwnerStatus,
              operationalOwnerDesignation: mainStations.find((station) => station.code === location.code)!.operationalOwnerDesignation,
              manager: {
                id: mainStations.find((station) => station.code === location.code)!.managerId,
                name: mainStations.find((station) => station.code === location.code)!.managerName,
                email: mainStations.find((station) => station.code === location.code)!.managerEmail
              },
              source: "main_dashboard"
            }
          : {
              source: "recruitment_fallback",
              manager: null,
              cluster: null,
              operationalOwner: null,
              operationalOwnerStatus: "unmapped",
              operationalOwnerDesignation: null
            }),
        contact: contactByLocation.get(location.id) ?? null
      })),
      roles: (roles.data ?? []).map((role) => ({
        ...role,
        stream: authoritativeRoleStream(role.code, role.stream) ?? role.stream
      })),
      notifications: notificationRulesFromConfig(whatsapp?.publicConfig ?? {}),
      leadStatuses: workforceConfig.leadStatusMaster,
      lifecycleRules,
      lifecycleSettings
    };
    if (resource === "Station Directory") return NextResponse.json({ locations: payload.locations });
    if (resource === "Station Contacts") return NextResponse.json({ locations: payload.locations });
    if (resource === "Roles") return NextResponse.json({ roles: payload.roles.filter((role) => role.stream === workspace) });
    if (resource === "Lead Status Master") return NextResponse.json({ leadStatuses: payload.leadStatuses });
    if (resource === "HR Lifecycle") return NextResponse.json({ lifecycleRules: payload.lifecycleRules, lifecycleSettings: payload.lifecycleSettings });
    return NextResponse.json({ notifications: payload.notifications });
  } catch (error) {
    console.error("Recruitment masters failed", error);
    return NextResponse.json({ error: "Unable to load masters." }, { status: 500 });
  }
}

function text(value: unknown, limit = 250) {
  return String(value ?? "").trim().slice(0, limit);
}

function optional(value: unknown, limit = 500) {
  const valueText = text(value, limit);
  return valueText || null;
}

function stringList(value: unknown) {
  const raw = Array.isArray(value) ? value : String(value ?? "").split(",");
  return [...new Set(raw.map((item) => text(item, 100)).filter(Boolean))];
}

function coordinate(value: unknown) {
  if (value === "" || value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function auditMasterChange(input: {
  companyId: string;
  action: string;
  changedFields: string[];
  message: string;
  actorProfileId: string;
  actorEmail: string | null;
}) {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  const audited = await supabaseAdmin.from("recruitment_connection_audit").insert({
    company_id: input.companyId,
    provider: "masters",
    action: input.action,
    changed_fields: input.changedFields,
    outcome: "success",
    message: input.message,
    actor_profile_id: input.actorProfileId,
    actor_email: input.actorEmail
  });
  if (audited.error) throw audited.error;
}

export async function PUT(request: Request) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase is not configured.");
    const session = await recruitmentSession(request);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await request.json() as Record<string, unknown>;
    const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
    const resource = text(body.resource, 30);
    const menuForResource = resource === "location" ? "Station Directory"
      : resource === "contact" ? "Station Contacts"
      : resource === "role" ? "Roles"
      : resource === "status" ? "Lead Status Master"
      : ["lifecycle", "lifecycle_settings"].includes(resource) ? "HR Lifecycle"
      : resource === "notification" ? "Notification Rules"
      : null;
    const resourceWorkspace = resource === "role" ? (body.stream === "hr" ? "hr" : "workforce") : undefined;
    if (!menuForResource || !canUseRecruitmentMenu(session, menuForResource, "edit", resourceWorkspace)) {
      return NextResponse.json({ error: "Edit access to this master is required." }, { status: 403 });
    }
    const now = new Date().toISOString();

    if (resource === "location") {
      const code = text(body.code, 20).toUpperCase().replace(/[^A-Z0-9]/g, "");
      const name = text(body.name, 160);
      if (!code || !name) return NextResponse.json({ error: "Location code and name are required." }, { status: 400 });
      const saved = await supabaseAdmin.from("recruitment_locations").upsert({
        company_id: companyId,
        code,
        name,
        state: optional(body.state, 100),
        region: optional(body.region, 100),
        is_active: body.isActive !== false,
        updated_at: now
      }, { onConflict: "company_id,code" }).select("id,code,name").single();
      if (saved.error) throw saved.error;
      const remapped = await remapUnmappedApplications({
        companyId,
        actorProfileId: session.profileId,
        actorEmail: session.email
      });
      await auditMasterChange({ companyId, action: "location_saved", changedFields: ["name", "state", "region", "active"], message: `Station ${code} · ${name} saved. Operational ownership remains controlled in People.`, actorProfileId: session.profileId, actorEmail: session.email });
      return NextResponse.json({ saved: true, resource, item: saved.data, remapped });
    }

    if (resource === "contact") {
      const locationId = text(body.locationId, 80);
      if (!locationId) return NextResponse.json({ error: "Choose a station." }, { status: 400 });
      const location = await supabaseAdmin.from("recruitment_locations").select("id")
        .eq("company_id", companyId).eq("id", locationId).maybeSingle();
      if (location.error) throw location.error;
      if (!location.data) return NextResponse.json({ error: "Station was not found." }, { status: 404 });
      const values = {
        address: optional(body.address, 1000),
        latitude: coordinate(body.latitude),
        longitude: coordinate(body.longitude),
        poc_name: optional(body.pocName, 160),
        poc_mobile: optional(body.pocMobile, 30),
        updated_at: now
      };
      const saved = await supabaseAdmin.from("recruitment_location_contacts").upsert({
        company_id: companyId,
        location_id: locationId,
        ...values
      }, { onConflict: "company_id,location_id" }).select("id").single();
      if (saved.error) throw saved.error;
      const mirrored = await supabaseAdmin.from("recruitment_locations").update(values)
        .eq("company_id", companyId).eq("id", locationId);
      if (mirrored.error) throw mirrored.error;
      await auditMasterChange({ companyId, action: "station_contact_saved", changedFields: ["address", "coordinates", "poc_name", "poc_mobile"], message: `Station contact details saved for ${locationId}.`, actorProfileId: session.profileId, actorEmail: session.email });
      return NextResponse.json({ saved: true, resource, item: saved.data });
    }

    if (resource === "role") {
      const code = text(body.code, 20).toUpperCase().replace(/[^A-Z0-9]/g, "");
      const name = text(body.name, 160);
      const stream = text(body.stream, 20);
      if (!code || !name || !["workforce", "hr"].includes(stream)) {
        return NextResponse.json({ error: "Role code, name and stream are required." }, { status: 400 });
      }
      const saved = await supabaseAdmin.from("recruitment_roles").upsert({
        company_id: companyId,
        code,
        name,
        stream,
        aliases: stringList(body.aliases),
        required_fields: stringList(body.requiredFields),
        is_active: body.isActive !== false,
        updated_at: now
      }, { onConflict: "company_id,code" }).select("id,code,name,stream").single();
      if (saved.error) throw saved.error;
      const updatedLeadStreams = await supabaseAdmin.from("recruitment_leads").update({
        stream,
        updated_at: now
      }).eq("company_id", companyId).eq("role_id", saved.data.id).neq("stream", stream);
      if (updatedLeadStreams.error) throw updatedLeadStreams.error;
      const remapped = await remapUnmappedApplications({
        companyId,
        actorProfileId: session.profileId,
        actorEmail: session.email
      });
      await auditMasterChange({ companyId, action: "designation_saved", changedFields: ["name", "workspace", "aliases", "required_fields", "active"], message: `${stream} designation ${code} · ${name} saved.`, actorProfileId: session.profileId, actorEmail: session.email });
      return NextResponse.json({ saved: true, resource, item: saved.data, remapped });
    }

    if (resource === "notification") {
      const rule = normalizeNotificationRule(body);
      invalidateConnectionConfig("whatsapp");
      const current = await getConnectionConfig("whatsapp");
      const rules = notificationRulesFromConfig(current?.publicConfig ?? {});
      const nextRules = rules.map((item) =>
        item.stream === rule.stream && item.trigger === rule.trigger ? rule : item
      );
      const publicConfig = {
        ...(current?.publicConfig ?? {}),
        notification_rules: JSON.stringify(nextRules)
      };
      const saved = await supabaseAdmin.from("recruitment_connection_settings").upsert({
        company_id: companyId,
        provider: "whatsapp",
        is_enabled: current?.isEnabled ?? false,
        public_config: publicConfig,
        updated_by: session.profileId,
        updated_by_email: session.email,
        updated_at: now
      }, { onConflict: "company_id,provider" }).select("id").single();
      if (saved.error) throw saved.error;
      const audited = await supabaseAdmin.from("recruitment_connection_audit").insert({
        company_id: companyId,
        provider: "whatsapp",
        action: "notification_rule_saved",
        changed_fields: [`${rule.stream}.${rule.trigger}`],
        outcome: "success",
        message: `${rule.stream} ${rule.trigger} notification rule updated in Master.`,
        actor_profile_id: session.profileId,
        actor_email: session.email
      });
      if (audited.error) throw audited.error;
      invalidateConnectionConfig("whatsapp");
      return NextResponse.json({ saved: true, resource, item: rule });
    }

    if (resource === "status") {
      const code = text(body.code, 60).toLowerCase().replace(/[^a-z0-9_]+/g, "_");
      const label = text(body.label, 100);
      const stream = text(body.stream, 20);
      const scheduleType = text(body.scheduleType, 20);
      if (!code || !label || !["workforce","hr","both"].includes(stream)) {
        return NextResponse.json({ error: "Status code, label and workspace are required." }, { status: 400 });
      }
      const current = await loadWorkforceConfig(companyId);
      const next = current.leadStatusMaster.filter((item) => item.code !== code);
      next.push({
        code,
        label,
        stream: stream as "workforce"|"hr"|"both",
        isActive: body.isActive !== false,
        requiresSchedule: body.requiresSchedule === true,
        scheduleType: ["callback","interview"].includes(scheduleType) ? scheduleType as "callback"|"interview" : null,
        sortOrder: Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : (next.length + 1) * 10
      });
      next.sort((a,b) => a.sortOrder - b.sortOrder);
      await saveWorkforceConfig(companyId, { lead_status_master: next }, session.profileId, session.email);
      await auditMasterChange({ companyId, action: "candidate_status_saved", changedFields: ["label", "workspace", "schedule", "sort_order", "active"], message: `Candidate status ${code} · ${label} saved.`, actorProfileId: session.profileId, actorEmail: session.email });
      return NextResponse.json({ saved: true, resource, item: next.find((item) => item.code === code) });
    }

    if (resource === "lifecycle") {
      const code = text(body.code, 60).toLowerCase().replace(/[^a-z0-9_]+/g, "_");
      const label = text(body.label, 100);
      const stageGroup = text(body.stageGroup, 50).toLowerCase().replace(/[^a-z0-9_]+/g, "_") || "pipeline";
      const allowedNextCodes = stringList(body.allowedNextCodes)
        .map((item) => item.toLowerCase().replace(/[^a-z0-9_]+/g, "_"));
      const notificationTrigger = optional(body.notificationTrigger, 60);
      if (!code || !label) {
        return NextResponse.json({ error: "Lifecycle code and label are required." }, { status: 400 });
      }
      const existing = await loadHrLifecycleRules(supabaseAdmin as any, companyId, { includeInactive: true });
      const knownCodes = new Set([...existing.map((item) => item.code), code]);
      const invalidNext = allowedNextCodes.find((item) => !knownCodes.has(item));
      if (invalidNext) {
        return NextResponse.json({ error: `${invalidNext} is not an existing HR lifecycle status.` }, { status: 400 });
      }
      const saved = await supabaseAdmin.from("recruitment_hr_lifecycle_rules").upsert({
        company_id: companyId,
        code,
        label,
        stage_group: stageGroup,
        sort_order: Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : (existing.length + 1) * 10,
        is_active: body.isActive !== false,
        is_terminal: body.isTerminal === true,
        requires_remarks: body.requiresRemarks !== false,
        requires_schedule: body.requiresSchedule === true,
        recruiter_can_set: body.recruiterCanSet !== false,
        interviewer_can_set: body.interviewerCanSet === true,
        first_call_available: body.firstCallAvailable === true,
        allowed_next_codes: allowedNextCodes,
        notification_trigger: notificationTrigger,
        updated_by: session.profileId,
        updated_at: now
      }, { onConflict: "company_id,code" }).select("id,code,label").single();
      if (saved.error) throw saved.error;
      await auditMasterChange({ companyId, action: "hr_lifecycle_saved", changedFields: ["label", "stage_group", "transitions", "requirements", "active"], message: `HR lifecycle ${code} · ${label} saved.`, actorProfileId: session.profileId, actorEmail: session.email });
      return NextResponse.json({ saved: true, resource, item: saved.data });
    }

    if (resource === "lifecycle_settings") {
      const maxInterviewRounds = Math.max(1, Math.min(10, Number(body.maxInterviewRounds) || 2));
      const defaultInterviewMinutes = Math.max(15, Math.min(240, Number(body.defaultInterviewMinutes) || 45));
      const saved = await supabaseAdmin.from("recruitment_hr_workflow_settings").upsert({
        company_id: companyId,
        max_interview_rounds: maxInterviewRounds,
        default_interview_minutes: defaultInterviewMinutes,
        require_offer_approval: body.requireOfferApproval !== false,
        updated_by: session.profileId,
        updated_at: now
      }, { onConflict: "company_id" }).select("id").single();
      if (saved.error) throw saved.error;
      await auditMasterChange({ companyId, action: "hr_workflow_settings_saved", changedFields: ["max_interview_rounds", "default_interview_minutes", "require_offer_approval"], message: "HR interview and offer workflow settings saved.", actorProfileId: session.profileId, actorEmail: session.email });
      return NextResponse.json({
        saved: true,
        resource,
        item: { maxInterviewRounds, defaultInterviewMinutes, requireOfferApproval: body.requireOfferApproval !== false }
      });
    }

    return NextResponse.json({ error: "Unsupported master resource." }, { status: 400 });
  } catch (error) {
    console.error("Recruitment master save failed", error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Unable to save master."
    }, { status: 400 });
  }
}
