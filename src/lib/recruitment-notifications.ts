import { createHash } from "node:crypto";
import { getConnectionConfig } from "./connection-config";
import { normalizePhone } from "./recruitment-routing";
import { supabaseAdmin } from "./supabase-admin";

export type LeadNotificationTrigger = "new_lead" | "no_response" | "interview";
export type RecruitmentStream = "workforce" | "hr";
export type NotificationContactSource = "station" | "stream_default" | "station_then_default";

export type NotificationContact = {
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  poc_name?: string | null;
  poc_mobile?: string | null;
};

export type NotificationLead = {
  id: string;
  phone: string | null;
  full_name: string | null;
  stream?: string | null;
  location_id?: string | null;
  recruitment_roles?: { name?: string | null } | null;
  recruitment_locations?: NotificationContact | null;
};

export type NotificationRule = {
  stream: RecruitmentStream;
  trigger: LeadNotificationTrigger;
  enabled: boolean;
  templateName: string;
  contactSource: NotificationContactSource;
  defaultContactName: string;
  defaultContactMobile: string;
  defaultAddress: string;
  defaultMapLink: string;
  requireContact: boolean;
  requireAddress: boolean;
};

const triggers: LeadNotificationTrigger[] = ["new_lead", "no_response", "interview"];
const streams: RecruitmentStream[] = ["workforce", "hr"];
const templateKeys: Record<LeadNotificationTrigger, string> = {
  new_lead: "new_lead_template",
  no_response: "reminder_template",
  interview: "interview_template"
};

function value(input: unknown) {
  return String(input ?? "").trim();
}

function booleanValue(input: unknown, fallback: boolean) {
  return typeof input === "boolean" ? input : fallback;
}

function isStream(input: unknown): input is RecruitmentStream {
  return streams.includes(input as RecruitmentStream);
}

function isTrigger(input: unknown): input is LeadNotificationTrigger {
  return triggers.includes(input as LeadNotificationTrigger);
}

function isContactSource(input: unknown): input is NotificationContactSource {
  return ["station", "stream_default", "station_then_default"].includes(String(input));
}

export function notificationRulesFromConfig(config: Record<string, string>) {
  let stored: unknown = null;
  try {
    stored = JSON.parse(config.notification_rules || "null");
  } catch {
    stored = null;
  }
  const saved = Array.isArray(stored) ? stored as Array<Record<string, unknown>> : [];

  return streams.flatMap((stream) => triggers.map((trigger): NotificationRule => {
    const row = saved.find((item) => item.stream === stream && item.trigger === trigger);
    const contactSource = row?.contactSource;
    return {
      stream,
      trigger,
      enabled: booleanValue(row?.enabled, true),
      templateName: value(row?.templateName) || value(config[templateKeys[trigger]]),
      contactSource: isContactSource(contactSource)
        ? contactSource
        : stream === "workforce" ? "station" : "station_then_default",
      defaultContactName: value(row?.defaultContactName),
      defaultContactMobile: value(row?.defaultContactMobile),
      defaultAddress: value(row?.defaultAddress),
      defaultMapLink: value(row?.defaultMapLink),
      requireContact: booleanValue(row?.requireContact, true),
      requireAddress: booleanValue(row?.requireAddress, trigger !== "no_response")
    };
  }));
}

export async function configuredNotificationRule(
  stream: RecruitmentStream,
  trigger: LeadNotificationTrigger
) {
  const connection = await getConnectionConfig("whatsapp");
  return notificationRulesFromConfig(connection?.publicConfig ?? {}).find(
    (item) => item.stream === stream && item.trigger === trigger
  ) ?? null;
}

export function normalizeNotificationRule(input: Record<string, unknown>): NotificationRule {
  if (!isStream(input.stream) || !isTrigger(input.trigger)) {
    throw new Error("Choose a valid recruitment category and notification event.");
  }
  if (!isContactSource(input.contactSource)) {
    throw new Error("Choose a valid contact source.");
  }
  return {
    stream: input.stream,
    trigger: input.trigger,
    enabled: input.enabled !== false,
    templateName: value(input.templateName).slice(0, 160),
    contactSource: input.contactSource,
    defaultContactName: value(input.defaultContactName).slice(0, 160),
    defaultContactMobile: value(input.defaultContactMobile).slice(0, 30),
    defaultAddress: value(input.defaultAddress).slice(0, 1000),
    defaultMapLink: value(input.defaultMapLink).slice(0, 1000),
    requireContact: input.requireContact !== false,
    requireAddress: input.requireAddress !== false
  };
}

export class NotificationConfigurationError extends Error {
  constructor(public readonly issues: string[]) {
    super(issues.join(" "));
    this.name = "NotificationConfigurationError";
  }
}

export class NotificationRuleDisabledError extends Error {
  constructor(public readonly rule: NotificationRule) {
    super(`The ${rule.stream} ${rule.trigger} notification is disabled in Master.`);
    this.name = "NotificationRuleDisabledError";
  }
}

function idempotency(companyId: string, leadId: string, trigger: string, anchor: string) {
  return `recruitment:${createHash("sha256").update([companyId, leadId, trigger, anchor].join("|")).digest("hex")}`;
}

function effectiveContact(rule: NotificationRule, station: NotificationContact | null | undefined) {
  const fallback: NotificationContact = {
    address: rule.defaultAddress || null,
    poc_name: rule.defaultContactName || null,
    poc_mobile: rule.defaultContactMobile || null
  };
  if (rule.contactSource === "station") return station ?? {};
  if (rule.contactSource === "stream_default") return fallback;
  return {
    address: value(station?.address) || fallback.address,
    latitude: station?.latitude,
    longitude: station?.longitude,
    poc_name: value(station?.poc_name) || fallback.poc_name,
    poc_mobile: value(station?.poc_mobile) || fallback.poc_mobile
  };
}

function mapLink(rule: NotificationRule, contact: NotificationContact) {
  if (contact.latitude != null && contact.longitude != null) {
    return `https://maps.google.com/?q=${contact.latitude},${contact.longitude}`;
  }
  if (rule.defaultMapLink) return rule.defaultMapLink;
  const address = value(contact.address);
  return address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : "";
}

export function mergeNotificationContacts(
  ...sources: Array<NotificationContact | null | undefined>
): NotificationContact {
  const present = sources.filter(Boolean) as NotificationContact[];
  const text = (key: "address" | "poc_name" | "poc_mobile") =>
    present.map((source) => value(source[key])).find(Boolean) || null;
  const number = (key: "latitude" | "longitude") =>
    present.map((source) => source[key]).find((item) => item != null) ?? null;
  return {
    address: text("address"),
    latitude: number("latitude"),
    longitude: number("longitude"),
    poc_name: text("poc_name"),
    poc_mobile: text("poc_mobile")
  };
}

export function buildNotificationTemplate(
  trigger: LeadNotificationTrigger,
  lead: NotificationLead,
  rule: NotificationRule
) {
  if (!rule.enabled) throw new NotificationRuleDisabledError(rule);
  const contact = effectiveContact(rule, lead.recruitment_locations);
  const candidate = value(lead.full_name);
  const role = value(lead.recruitment_roles?.name);
  const phone = value(lead.phone);
  const contactMobile = value(contact.poc_mobile);
  const address = value(contact.address);
  const link = mapLink(rule, contact);
  const issues: string[] = [];
  if (!rule.templateName) issues.push("Template name is missing in Notification Rules.");
  if (!candidate) issues.push("Candidate name is missing.");
  if (!role && trigger !== "interview") issues.push("Designation is missing.");
  if (!phone) issues.push("Candidate mobile number is missing.");
  if (rule.requireContact && !contactMobile) issues.push("Contact mobile is missing in the selected Master source.");
  if (rule.requireAddress && !address) issues.push("Address is missing in the selected Master source.");
  if (trigger === "interview" && !link) issues.push("Interview map or address is missing in Master.");
  if (issues.length) throw new NotificationConfigurationError(issues);

  const parameters = trigger === "new_lead"
    ? [candidate, role, contactMobile, address]
    : trigger === "no_response"
      ? [candidate, role, phone, contactMobile]
      : [candidate, address, link, contactMobile];
  return { name: rule.templateName, parameters, rule, contact };
}

async function stationContact(companyId: string, lead: NotificationLead) {
  if (!lead.location_id || !supabaseAdmin) return lead.recruitment_locations ?? null;
  const [contact, location] = await Promise.all([
    supabaseAdmin.from("recruitment_location_contacts")
      .select("address,latitude,longitude,poc_name,poc_mobile")
      .eq("company_id", companyId)
      .eq("location_id", lead.location_id)
      .maybeSingle(),
    supabaseAdmin.from("recruitment_locations")
      .select("address,latitude,longitude,poc_name,poc_mobile")
      .eq("company_id", companyId)
      .eq("id", lead.location_id)
      .maybeSingle()
  ]);
  if (contact.error || location.error) throw new Error(contact.error?.message || location.error?.message);
  return mergeNotificationContacts(lead.recruitment_locations, contact.data, location.data);
}

export async function leadNotificationTemplate(
  companyId: string,
  trigger: LeadNotificationTrigger,
  lead: NotificationLead
) {
  const stream = isStream(lead.stream) ? lead.stream : null;
  if (!stream) throw new NotificationConfigurationError(["Recruitment category is missing from the lead."]);
  const rule = await configuredNotificationRule(stream, trigger);
  if (!rule) throw new NotificationConfigurationError(["Notification rule is missing in Master."]);
  const contact = await stationContact(companyId, lead);
  return buildNotificationTemplate(trigger, { ...lead, recruitment_locations: contact }, rule);
}

async function auditBlocked(options: {
  companyId: string;
  lead: NotificationLead;
  trigger: LeadNotificationTrigger;
  issues: string[];
}) {
  if (!supabaseAdmin) return;
  const result = await supabaseAdmin.from("recruitment_lead_history").insert({
    company_id: options.companyId,
    lead_id: options.lead.id,
    event_type: "whatsapp_notification_blocked",
    remarks: options.issues.join(" "),
    metadata: { trigger: options.trigger, issues: options.issues, source: "notification_master" }
  });
  if (result.error) throw new Error(result.error.message);
}

async function auditNotification(options: {
  companyId: string;
  leadId: string;
  eventType: string;
  trigger: LeadNotificationTrigger;
  remarks: string;
  metadata?: Record<string, unknown>;
}) {
  if (!supabaseAdmin) return;
  const result = await supabaseAdmin.from("recruitment_lead_history").insert({
    company_id: options.companyId,
    lead_id: options.leadId,
    event_type: options.eventType,
    remarks: options.remarks,
    actor_email: "system:notification_orchestrator",
    metadata: {
      trigger: options.trigger,
      source: "notification_master",
      ...(options.metadata ?? {})
    }
  });
  if (result.error) throw new Error(result.error.message);
}

export async function enqueueLeadNotification(options: {
  companyId: string;
  lead: NotificationLead;
  trigger: LeadNotificationTrigger;
  anchor: string;
}) {
  if (!supabaseAdmin) return { queued: false, reason: "Supabase is not configured." };
  const phone = normalizePhone(options.lead.phone);
  if (!phone) {
    await auditBlocked({ ...options, issues: ["Candidate mobile number is missing."] });
    return { queued: false, reason: "Candidate mobile number is missing." };
  }
  let template: Awaited<ReturnType<typeof leadNotificationTemplate>>;
  try {
    template = await leadNotificationTemplate(options.companyId, options.trigger, options.lead);
  } catch (error) {
    if (error instanceof NotificationRuleDisabledError) {
      await auditNotification({
        companyId: options.companyId,
        leadId: options.lead.id,
        eventType: "whatsapp_notification_skipped",
        trigger: options.trigger,
        remarks: error.message,
        metadata: { stream: error.rule.stream, reason: "disabled_in_master" }
      });
      return { queued: false, skipped: true, reason: error.message };
    }
    if (!(error instanceof NotificationConfigurationError)) throw error;
    await auditBlocked({ ...options, issues: error.issues });
    return { queued: false, reason: error.message };
  }
  const result = await supabaseAdmin.from("recruitment_whatsapp_outbox").upsert({
    company_id: options.companyId,
    lead_id: options.lead.id,
    idempotency_key: idempotency(options.companyId, options.lead.id, options.trigger, options.anchor),
    phone,
    template_name: template.name,
    template_parameters: template.parameters,
    notification_trigger: options.trigger,
    recruitment_stream: template.rule.stream,
    notification_context: {
      anchor: options.anchor,
      contact_source: template.rule.contactSource
    },
    status: "queued",
    next_attempt_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }, { onConflict: "company_id,idempotency_key", ignoreDuplicates: true }).select("id,status");
  if (result.error) throw new Error(result.error.message);
  const inserted = Boolean(result.data?.length);
  if (inserted) {
    await auditNotification({
      companyId: options.companyId,
      leadId: options.lead.id,
      eventType: "whatsapp_notification_queued",
      trigger: options.trigger,
      remarks: `${template.name} queued for provider delivery.`,
      metadata: {
        outbox_id: result.data?.[0]?.id,
        template_name: template.name,
        stream: template.rule.stream
      }
    });
  }
  return { queued: true, deduplicated: !inserted, templateName: template.name };
}
