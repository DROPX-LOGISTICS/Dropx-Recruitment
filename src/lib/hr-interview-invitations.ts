import { createHash, randomUUID } from "node:crypto";
import { getConnectionConfig } from "./connection-config";
import { normalizePhone } from "./recruitment-routing";
import { supabaseAdmin } from "./supabase-admin";

export type GoogleCalendarCredential = {
  clientSecret: string;
  refreshToken: string;
};

export function decodeGoogleCalendarCredential(value: string | null | undefined): GoogleCalendarCredential {
  const raw = String(value ?? "").trim();
  if (!raw) return { clientSecret: "", refreshToken: "" };
  try {
    const parsed = JSON.parse(raw) as Partial<GoogleCalendarCredential>;
    return {
      clientSecret: String(parsed.clientSecret ?? "").trim(),
      refreshToken: String(parsed.refreshToken ?? "").trim()
    };
  } catch {
    return { clientSecret: raw, refreshToken: "" };
  }
}

export function encodeGoogleCalendarCredential(value: GoogleCalendarCredential) {
  return JSON.stringify({
    clientSecret: value.clientSecret.trim(),
    refreshToken: value.refreshToken.trim()
  });
}

async function googleAccessToken(clientId: string, credential: GoogleCalendarCredential) {
  if (!clientId || !credential.clientSecret || !credential.refreshToken) {
    throw new Error("Google Calendar OAuth client secret and refresh token are not configured.");
  }
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: credential.clientSecret,
      refresh_token: credential.refreshToken,
      grant_type: "refresh_token"
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000)
  });
  const payload = await response.json() as { access_token?: string; error_description?: string };
  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description || "Google Calendar authorization failed.");
  }
  return payload.access_token;
}

export async function testGoogleCalendarConnection() {
  const config = await getConnectionConfig("google");
  if (!config) throw new Error("Google connection is not configured.");
  const credential = decodeGoogleCalendarCredential(config.secrets.client_secret);
  if (!credential.refreshToken) {
    return { ready: false, message: "Google login is valid; add the Calendar refresh token to enable Meet invitations." };
  }
  const token = await googleAccessToken(config.publicConfig.client_id, credential);
  const calendarId = config.publicConfig.calendar_id || "primary";
  const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error(`Google Calendar access returned HTTP ${response.status}.`);
  return { ready: true, message: "Google Login, Calendar, email invitations and Meet links are ready." };
}

export async function createGoogleInterviewEvent(options: {
  candidateName: string;
  candidateEmail: string;
  candidatePhone: string | null;
  managerName: string;
  managerEmail: string;
  roleName: string;
  stationCode: string | null;
  round: number;
  scheduledAt: string;
  note: string;
}) {
  const config = await getConnectionConfig("google");
  if (!config?.isEnabled) throw new Error("Google Calendar invitations are disabled in Source Integrations.");
  const credential = decodeGoogleCalendarCredential(config.secrets.client_secret);
  const token = await googleAccessToken(config.publicConfig.client_id, credential);
  const start = new Date(options.scheduledAt);
  if (!Number.isFinite(start.getTime())) throw new Error("Interview date is invalid.");
  const duration = Math.max(15, Math.min(240, Number(config.publicConfig.interview_duration_minutes) || 45));
  const end = new Date(start.getTime() + duration * 60_000);
  const timeZone = config.publicConfig.calendar_time_zone || "Asia/Kolkata";
  const calendarId = config.publicConfig.calendar_id || "primary";
  const requestId = randomUUID();
  const subjectTemplate = config.publicConfig.interview_email_subject || "Interview Invitation - {role}";
  const subject = subjectTemplate
    .replaceAll("{role}", options.roleName)
    .replaceAll("{candidate}", options.candidateName)
    .replaceAll("{round}", String(options.round));
  const emailIntro = config.publicConfig.interview_email_intro || "Greetings from DropX Logistics";
  const displayTime = new Intl.DateTimeFormat("en-IN", {
    dateStyle: "full", timeStyle: "short", timeZone
  }).format(start);
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?conferenceDataVersion=1&sendUpdates=all`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        summary: subject,
        description: [
          `Dear ${options.candidateName},`,
          "",
          emailIntro,
          "",
          `Your Round ${options.round} interview for ${options.roleName} has been scheduled with ${options.managerName} on ${displayTime}.`,
          "The Google Meet link is included in this calendar invitation.",
          "",
          `Candidate: ${options.candidateName}`,
          `Mobile: ${options.candidatePhone || "Not available"}`,
          `Designation: ${options.roleName}`,
          `Station: ${options.stationCode || "Not mapped"}`,
          `Round: ${options.round}`,
          `Hiring manager: ${options.managerName}`,
          options.note ? `Recruiter note: ${options.note}` : "",
          "",
          "Regards,",
          "People & Culture",
          "DropX Logistics"
        ].filter(Boolean).join("\n"),
        start: { dateTime: start.toISOString(), timeZone },
        end: { dateTime: end.toISOString(), timeZone },
        attendees: [
          { email: options.candidateEmail, displayName: options.candidateName },
          { email: options.managerEmail, displayName: options.managerName }
        ],
        conferenceData: {
          createRequest: {
            requestId,
            conferenceSolutionKey: { type: "hangoutsMeet" }
          }
        },
        guestsCanModify: false
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000)
    }
  );
  const payload = await response.json() as {
    id?: string;
    htmlLink?: string;
    hangoutLink?: string;
    conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string }> };
    error?: { message?: string };
  };
  if (!response.ok) throw new Error(payload.error?.message || `Calendar event creation returned HTTP ${response.status}.`);
  const meetLink = payload.hangoutLink
    || payload.conferenceData?.entryPoints?.find((item) => item.entryPointType === "video")?.uri
    || null;
  return { eventId: payload.id ?? null, calendarLink: payload.htmlLink ?? null, meetLink };
}

export async function enqueueManagerInterviewWhatsapp(options: {
  companyId: string;
  leadId: string;
  candidateName: string;
  candidatePhone: string | null;
  roleName: string;
  managerName: string;
  managerPhone: string | null;
  round: number;
  scheduledAt: string;
  note: string;
  meetLink?: string | null;
}) {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  const config = await getConnectionConfig("whatsapp");
  if (!config?.isEnabled) return { queued: false, reason: "WhatsApp is disabled in Source Integrations." };
  const templateName = config.publicConfig.hr_manager_interview_template?.trim();
  const phone = normalizePhone(options.managerPhone);
  if (!templateName) return { queued: false, reason: "HR manager interview template is missing in Source Integrations." };
  if (!phone) return { queued: false, reason: "The selected manager has no valid mobile number in User Master." };
  const anchor = `${options.round}:${options.scheduledAt}:${options.managerPhone}`;
  const idempotencyKey = `recruitment:${createHash("sha256").update([
    options.companyId, options.leadId, "hr_manager_interview", anchor
  ].join("|")).digest("hex")}`;
  const displayTime = new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata"
  }).format(new Date(options.scheduledAt));
  const result = await supabaseAdmin.from("recruitment_whatsapp_outbox").upsert({
    company_id: options.companyId,
    lead_id: options.leadId,
    idempotency_key: idempotencyKey,
    phone,
    template_name: templateName,
    template_parameters: [
      options.managerName,
      options.candidateName,
      options.roleName,
      options.candidatePhone || "Not available",
      displayTime,
      `Round ${options.round}`,
      options.note || "No additional note",
      options.meetLink || "Not applicable"
    ],
    notification_trigger: "interview",
    recruitment_stream: "hr",
    notification_context: {
      recipient: "manager",
      round: options.round,
      scheduled_at: options.scheduledAt
    },
    status: "queued",
    next_attempt_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }, { onConflict: "company_id,idempotency_key", ignoreDuplicates: true });
  if (result.error) throw new Error(result.error.message);
  return { queued: true, templateName };
}

export async function enqueueCandidateInterviewWhatsapp(options: {
  companyId: string;
  leadId: string;
  candidateName: string;
  candidatePhone: string | null;
  roleName: string;
  managerName: string;
  managerPhone: string | null;
  round: number;
  scheduledAt: string;
  note: string;
  meetLink?: string | null;
}) {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  const config = await getConnectionConfig("whatsapp");
  if (!config?.isEnabled) return { queued: false, reason: "WhatsApp is disabled in Source Integrations." };
  const templateName = config.publicConfig.hr_candidate_interview_template?.trim();
  const phone = normalizePhone(options.candidatePhone);
  if (!templateName) return { queued: false, reason: "HR candidate interview template is missing in Source Integrations." };
  if (!phone) return { queued: false, reason: "Candidate mobile number is invalid." };
  const displayTime = new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata"
  }).format(new Date(options.scheduledAt));
  const anchor = `${options.round}:${options.scheduledAt}:${options.managerPhone}`;
  const idempotencyKey = `recruitment:${createHash("sha256").update([
    options.companyId, options.leadId, "hr_candidate_interview", anchor
  ].join("|")).digest("hex")}`;
  const result = await supabaseAdmin.from("recruitment_whatsapp_outbox").upsert({
    company_id: options.companyId,
    lead_id: options.leadId,
    idempotency_key: idempotencyKey,
    phone,
    template_name: templateName,
    template_parameters: [
      options.candidateName,
      options.roleName,
      options.managerName,
      options.managerPhone || "The hiring team will contact you",
      displayTime,
      `Round ${options.round}`,
      options.meetLink || "The interviewer will call you",
      options.note || "No additional instruction"
    ],
    notification_trigger: "interview",
    recruitment_stream: "hr",
    notification_context: {
      recipient: "candidate",
      round: options.round,
      scheduled_at: options.scheduledAt
    },
    status: "queued",
    next_attempt_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }, { onConflict: "company_id,idempotency_key", ignoreDuplicates: true });
  if (result.error) throw new Error(result.error.message);
  return { queued: true, templateName };
}
