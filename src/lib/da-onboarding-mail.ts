import { randomUUID } from "node:crypto";
import nodemailer from "nodemailer";
import { emailValid, ist, type MailPerson } from "./ad-manager-mail-model";
import {
  DA_INAPP_SOURCE_ALIASES,
  carryForwardDaOperations,
  daDependencyLabel,
  daSubStatusOptions,
  isDaInAppBatch,
  latestDaInAppBatch,
  parseDaInAppRecord,
  type DaBatch,
  type DaImportRow
} from "./da-inapp-onboarding";
import {
  daDigestSlot,
  renderDaDigestMail,
  type DaDigestGroup,
  type DaDigestRecord,
  type DaDigestStation,
  type DaDigestSlot
} from "./da-onboarding-mail-model";
import { loadMainDashboardStations } from "./main-dashboard-masters";
import { supabaseAdmin } from "./supabase-admin";

function db() {
  if (!supabaseAdmin) throw new Error("Database unavailable.");
  return supabaseAdmin;
}

function checked<T extends { error: any; data: any }>(result: T): NonNullable<T["data"]> {
  if (result.error) throw new Error(result.error.message);
  return result.data as NonNullable<T["data"]>;
}

async function latestDaRows(companyId: string) {
  const [typed, filename] = await Promise.all([
    db().from("report_import_batches")
      .select("id,source_type,file_name,status,message,report_from,report_to,row_count,imported_row_count,skipped_row_count,created_at")
      .eq("company_id", companyId)
      .in("source_type", [...DA_INAPP_SOURCE_ALIASES])
      .order("created_at", { ascending: false })
      .limit(40),
    db().from("report_import_batches")
      .select("id,source_type,file_name,status,message,report_from,report_to,row_count,imported_row_count,skipped_row_count,created_at")
      .eq("company_id", companyId)
      .ilike("file_name", "%in%app%onboarding%")
      .order("created_at", { ascending: false })
      .limit(40)
  ]);
  const batches = [...new Map(
    [...checked(typed), ...checked(filename)]
      .filter((batch) => isDaInAppBatch(batch as DaBatch))
      .map((batch) => [batch.id, batch as DaBatch])
  ).values()];
  if (!batches.length) return { batch: null as DaBatch | null, rows: [] as DaImportRow[] };
  const rows = checked(await db().from("report_import_rows")
    .select("id,batch_id,source_type,station_code,work_date,raw_data,normalized_data,created_at")
    .eq("company_id", companyId)
    .in("batch_id", batches.map((batch) => batch.id))
    .order("created_at", { ascending: false })
    .limit(20000)) as DaImportRow[];
  const latest = latestDaInAppBatch(batches, rows);
  return { batch: latest.batch, rows: latest.batch ? carryForwardDaOperations(latest.rows, latest.historyRows) : [] };
}

export async function loadDaDigestContext(companyId: string) {
  const [peopleResult, stations, latest] = await Promise.all([
    db().rpc("recruitment_ad_mail_people", { p_company: companyId }),
    loadMainDashboardStations(companyId),
    latestDaRows(companyId)
  ]);
  const people = checked(peopleResult) as MailPerson[];
  const stationByCode = new Map(stations.map((station) => [station.code, station]));
  const digestStations: DaDigestStation[] = stations.map((station) => ({
    id: station.id,
    code: station.code,
    name: station.name,
    cluster: station.operationalOwner?.name || station.managerName || "Owner not mapped"
  }));
  const records: DaDigestRecord[] = latest.batch ? latest.rows.flatMap((row) => {
    const parsed = parseDaInAppRecord(row, latest.batch!);
    const station = stationByCode.get(parsed.station);
    if (!station) return [];
    return [{
      id: parsed.id,
      daName: parsed.daName,
      transporterId: parsed.transporterId,
      stationId: station.id,
      station: station.code,
      stationName: station.name,
      cluster: station.operationalOwner?.name || station.managerName || "Owner not mapped",
      actionLabel: daDependencyLabel(parsed.dependency),
      actionStatus: parsed.subStatus,
      actionStatusLabel: daSubStatusOptions(parsed.dependency).find((option) => option.value === parsed.subStatus)?.label || parsed.subStatus,
      sourceAction: parsed.sourceAction,
      finalOutcome: parsed.finalOutcome,
      clearanceStatus: parsed.clearanceStatus,
      videoStatus: parsed.videoStatus,
      uanStatus: parsed.uanStatus,
      updatedAt: parsed.updatedAt,
      updatedBy: parsed.updatedBy,
      agingDays: parsed.agingDays
    }];
  }) : [];
  const groups: DaDigestGroup[] = people.filter((person) => emailValid(person.email)).flatMap((recipient) => {
    const scopedStations = digestStations.filter((station) => recipient.station_ids.includes(station.id));
    if (!scopedStations.length) return [];
    const stationIds = new Set(scopedStations.map((station) => station.id));
    return [{ recipient, stations: scopedStations, records: records.filter((record) => stationIds.has(record.stationId)) }];
  }).sort((left, right) => left.recipient.email.localeCompare(right.recipient.email));
  return { people, stations: digestStations, records, groups, source: latest.batch };
}

type DaMailPayload = {
  recipientId: string;
  stationIds: string[];
  date: string;
  slot: DaDigestSlot | "sample";
  sourceBatchId: string | null;
};

async function enqueue(companyId: string, group: DaDigestGroup, slot: DaDigestSlot | "sample", date: string, sourceBatchId: string | null) {
  const id = randomUUID();
  const month = date.slice(0, 7);
  const sample = slot === "sample";
  const payload: DaMailPayload = {
    recipientId: group.recipient.id,
    stationIds: group.stations.map((station) => station.id),
    date,
    slot,
    sourceBatchId
  };
  checked(await db().from("recruitment_da_onboarding_mail_deliveries").upsert({
    id,
    company_id: companyId,
    dedupe_key: `${sample ? "sample" : slot}:${date}:${group.recipient.id}`,
    recipient_id: group.recipient.id,
    recipient_role: group.recipient.role,
    slot,
    payload,
    thread_key: `${sample ? "sample:" : ""}${month}:${group.recipient.id}`,
    message_id: `<recruit-da-${id}@dropxlogistics.com>`
  }, { onConflict: "company_id,dedupe_key", ignoreDuplicates: true }));
}

async function deliver(companyId: string, job: any, context: Awaited<ReturnType<typeof loadDaDigestContext>>) {
  const payload = job.payload as DaMailPayload;
  const group = context.groups.find((candidate) => candidate.recipient.id === job.recipient_id);
  if (!group) {
    checked(await db().from("recruitment_da_onboarding_mail_deliveries")
      .update({ status: "cancelled", error: "Recipient or station scope changed." })
      .eq("company_id", companyId).eq("id", job.id));
    return false;
  }
  try {
    const smtp = checked(await db().from("email_notification_settings")
      .select("is_enabled,smtp_host,smtp_port,smtp_user,smtp_pass,smtp_from,from_name")
      .eq("company_id", companyId).eq("id", true).single());
    if (!smtp.is_enabled || !smtp.smtp_host || !smtp.smtp_from) throw new Error("Company email service is disabled or incomplete.");
    const mail = renderDaDigestMail({ group, date: payload.date, slot: payload.slot, sample: payload.slot === "sample" });
    const previous = checked(await db().from("recruitment_da_onboarding_mail_deliveries")
      .select("message_id")
      .eq("company_id", companyId).eq("thread_key", job.thread_key).eq("status", "sent")
      .order("sent_at").limit(1).maybeSingle());
    const claimed = checked(await db().from("recruitment_da_onboarding_mail_deliveries")
      .update({ status: "sending", attempts: Number(job.attempts) + 1, error: null })
      .eq("company_id", companyId).eq("id", job.id).eq("status", "queued").select("id"));
    if (!claimed.length) return false;
    const transport = nodemailer.createTransport({
      host: smtp.smtp_host,
      port: smtp.smtp_port || 587,
      secure: Number(smtp.smtp_port) === 465,
      requireTLS: Number(smtp.smtp_port) !== 465,
      auth: { user: smtp.smtp_user, pass: smtp.smtp_pass },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 20000
    });
    try {
      const result = await transport.sendMail({
        from: { name: smtp.from_name || "DropX Recruit", address: smtp.smtp_from },
        to: group.recipient.email,
        cc: [],
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        messageId: job.message_id,
        ...(previous ? { inReplyTo: previous.message_id, references: [previous.message_id] } : {})
      });
      const accepted = new Set((result.accepted || []).map((value) => (typeof value === "string" ? value : value.address).toLowerCase()));
      const rejected = result.rejected?.length || !accepted.has(group.recipient.email.toLowerCase());
      checked(await db().from("recruitment_da_onboarding_mail_deliveries")
        .update({ status: rejected ? "needs_review" : "sent", sent_at: new Date().toISOString(), error: rejected ? "SMTP rejected the recipient. Check provider delivery logs before retry." : null })
        .eq("company_id", companyId).eq("id", job.id));
      return !rejected;
    } catch (error) {
      checked(await db().from("recruitment_da_onboarding_mail_deliveries")
        .update({ status: "needs_review", error: "SMTP attempt not confirmed. Review provider delivery before retrying." })
        .eq("company_id", companyId).eq("id", job.id));
      console.error("recruit-da-mail SMTP failed", job.id, (error as { code?: string }).code || "unknown");
      return false;
    } finally {
      transport.close();
    }
  } catch (error) {
    checked(await db().from("recruitment_da_onboarding_mail_deliveries")
      .update({ status: "failed", error: "Email preparation failed. Check SMTP configuration and server logs." })
      .eq("company_id", companyId).eq("id", job.id).eq("status", "queued"));
    console.error("recruit-da-mail preparation failed", job.id, error instanceof Error ? error.message : "unknown");
    return false;
  }
}

export async function runDaOnboardingMail(companyId: string, preview = false, now = new Date()) {
  const [settingsResult, context] = await Promise.all([
    db().from("recruitment_da_onboarding_mail_settings").select("*").eq("company_id", companyId).maybeSingle(),
    loadDaDigestContext(companyId)
  ]);
  const settings = checked(settingsResult);
  const schedule = [`${String(settings?.afternoon_time || "15:00").slice(0, 5)} Asia/Kolkata`, `${String(settings?.evening_time || "19:00").slice(0, 5)} Asia/Kolkata`];
  if (preview) return {
    enabled: settings?.enabled === true,
    schedule,
    recipientGroups: context.groups.length,
    mappedStations: context.stations.length,
    cases: context.records.length,
    sourceFile: context.source?.file_name || null,
    unmappedCases: context.source ? Math.max(0, Number(context.source.row_count ?? context.source.imported_row_count ?? 0) - context.records.length) : 0
  };
  if (!settings?.enabled) return { enabled: false };
  const locked = checked(await db().rpc("recruitment_da_onboarding_mail_lock", { p_company: companyId }));
  if (!locked) return { enabled: true, busy: true };
  const slot = daDigestSlot(now, String(settings.afternoon_time || "15:00").slice(0, 5), String(settings.evening_time || "19:00").slice(0, 5));
  let sent = 0;
  try {
    if (!slot) return { enabled: true, sent: 0, queued: 0, groups: context.groups.length };
    const date = ist(now).slice(0, 10);
    for (const group of context.groups) await enqueue(companyId, group, slot, date, context.source?.id || null);
    const pending = checked(await db().from("recruitment_da_onboarding_mail_deliveries")
      .select("*").eq("company_id", companyId).eq("slot", slot).eq("status", "queued")
      .eq("payload->>date", date).order("created_at").limit(500));
    for (let index = 0; index < pending.length; index += 6) {
      const delivered = await Promise.all(pending.slice(index, index + 6).map((job: any) => deliver(companyId, job, context)));
      sent += delivered.filter(Boolean).length;
    }
    checked(await db().from("recruitment_da_onboarding_mail_deliveries")
      .update({ status: "needs_review", error: "Interrupted SMTP attempt; check delivery before retry." })
      .eq("company_id", companyId).eq("status", "sending").lt("created_at", new Date(Date.now() - 15 * 60_000).toISOString()));
    return { enabled: true, sent, queued: pending.length, groups: context.groups.length, slot };
  } finally {
    checked(await db().from("recruitment_da_onboarding_mail_settings")
      .update({ lease_until: null, updated_at: new Date().toISOString() }).eq("company_id", companyId));
  }
}

export async function sendDaOnboardingSamples(companyId: string, emails: string[], now = new Date()) {
  const context = await loadDaDigestContext(companyId);
  const requested = new Set(emails.map((email) => email.trim().toLowerCase()).filter(emailValid));
  const groups = context.groups.filter((group) => requested.has(group.recipient.email.toLowerCase()));
  const date = ist(now).slice(0, 10);
  for (const group of groups) await enqueue(companyId, group, "sample", date, context.source?.id || null);
  const recipientIds = groups.map((group) => group.recipient.id);
  const jobs = recipientIds.length ? checked(await db().from("recruitment_da_onboarding_mail_deliveries")
    .select("*").eq("company_id", companyId).eq("slot", "sample").eq("status", "queued")
    .in("recipient_id", recipientIds).eq("payload->>date", date).order("created_at")) : [];
  let sent = 0;
  for (const job of jobs) if (await deliver(companyId, job, context)) sent += 1;
  return {
    sent,
    recipients: groups.map((group) => ({ email: group.recipient.email, role: group.recipient.role, stations: group.stations.map((station) => station.code) })),
    missing: [...requested].filter((email) => !groups.some((group) => group.recipient.email.toLowerCase() === email))
  };
}
