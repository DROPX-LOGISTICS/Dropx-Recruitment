import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { requiredEnv } from "./recruitment-api";
import { uploadRecruitmentDocument } from "./recruitment-documents";
import { enqueueStoredLeadWelcome } from "./recruitment-lead-welcome";
import { normalizeMetaFieldName, normalizePhone } from "./recruitment-routing";
import { supabaseAdmin } from "./supabase-admin";

export type RecruitmentSource = "indeed" | "manual";

export type IndeedResumeFile = {
  fileName: string;
  contentType: string;
  data: string;
};

export type NormalizedRecruitmentApplication = {
  source: RecruitmentSource;
  externalEventId: string;
  jobId: string;
  jobName: string;
  jobMeta: string | null;
  fullName: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  postCode: string | null;
  appliedAt: string | null;
  questionnaire: Record<string, string>;
  resume: IndeedResumeFile | null;
  rawPayload: unknown;
};

export class IndeedIngestionError extends Error {
  constructor(message: string, readonly statusCode: number, readonly code: string) {
    super(message);
    this.name = "IndeedIngestionError";
  }
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    const clean = String(value ?? "").trim();
    if (clean) return clean;
  }
  return null;
}

function normalizedAnswers(value: unknown) {
  const source = object(value);
  return Object.fromEntries(Object.entries(source).flatMap(([key, item]) => {
    const normalizedKey = normalizeMetaFieldName(key);
    const normalizedValue = Array.isArray(item)
      ? item.map((part) => String(part ?? "").trim()).filter(Boolean).join(", ")
      : String(item ?? "").trim();
    return normalizedKey && normalizedValue ? [[normalizedKey, normalizedValue]] : [];
  }));
}

function questionAnswers(root: Record<string, unknown>) {
  const containers = [
    object(root.screenerQuestionsAndAnswers),
    object(root.questionsAndAnswers)
  ];
  const result: Record<string, string> = {};
  for (const container of containers) {
    const rows = Array.isArray(container.questionsAndAnswers)
      ? container.questionsAndAnswers
      : Array.isArray(container.questions)
        ? container.questions
        : [];
    for (const row of rows) {
      const entry = object(row);
      const question = object(entry.question);
      const key = normalizeMetaFieldName(firstText(
        question.id,
        question.label,
        question.question,
        entry.id,
        entry.question
      ));
      const rawAnswer = entry.answer;
      const value = Array.isArray(rawAnswer)
        ? rawAnswer.map((item) => firstText(object(item).label, object(item).value, item)).filter(Boolean).join(", ")
        : firstText(object(rawAnswer).label, object(rawAnswer).value, rawAnswer);
      if (key && value) result[key] = value;
    }
  }
  return result;
}

function applicationTimestamp(root: Record<string, unknown>, application: Record<string, unknown>) {
  const millis = Number(root.appliedOnMillis ?? application.appliedOnMillis);
  if (Number.isFinite(millis) && millis > 0) return new Date(millis).toISOString();
  const supplied = firstText(
    root.applied_at,
    root.appliedAt,
    root.created_at,
    root.createdAt,
    application.created_at
  );
  if (!supplied) return null;
  if (Number.isNaN(Date.parse(supplied))) {
    throw new IndeedIngestionError("Indeed application timestamp is invalid.", 422, "invalid_timestamp");
  }
  return new Date(supplied).toISOString();
}

function resumeFile(applicant: Record<string, unknown>) {
  const resume = object(applicant.resume);
  const file = object(resume.file);
  const fileName = firstText(file.fileName);
  const contentType = firstText(file.contentType);
  const data = firstText(file.data);
  if (!fileName || !contentType || !data) return null;
  return { fileName, contentType, data };
}

export function normalizeIndeedApplication(payload: unknown): NormalizedRecruitmentApplication {
  const root = object(payload);
  const applicant = object(root.applicant);
  const candidate = object(root.candidate);
  const job = object(root.job);
  const application = object(root.application);
  const answers = {
    ...normalizedAnswers(root.answers),
    ...normalizedAnswers(application.answers),
    ...normalizedAnswers(root.questionnaire),
    ...questionAnswers(root)
  };
  const externalEventId = firstText(
    root.id,
    root.event_id,
    root.eventId,
    root.application_id,
    root.applicationId,
    application.id
  );
  const jobId = firstText(
    job.jobId,
    root.job_id,
    root.jobId,
    application.job_id
  );
  const jobName = firstText(
    job.jobTitle,
    root.job_name,
    root.jobName,
    root.job_title,
    root.jobTitle,
    job.name,
    job.title,
    application.job_name
  );
  if (!externalEventId) {
    throw new IndeedIngestionError("Indeed application ID is required.", 400, "missing_application_id");
  }
  if (!jobId) throw new IndeedIngestionError("Indeed job ID is required.", 400, "missing_job_id");
  if (!jobName) throw new IndeedIngestionError("Indeed job title is required.", 400, "missing_job_title");
  return {
    source: "indeed",
    externalEventId,
    jobId,
    jobName,
    jobMeta: firstText(job.jobMeta, root.job_meta, root.jobMeta),
    fullName: firstText(applicant.fullName, root.full_name, root.fullName, root.name, candidate.full_name, candidate.name),
    phone: firstText(applicant.phoneNumber, root.phone, root.mobile, root.phone_number, candidate.phone, candidate.mobile),
    email: firstText(applicant.email, root.email, root.email_address, candidate.email)?.toLowerCase() ?? null,
    city: firstText(root.city, candidate.city, object(candidate.location).city, job.jobLocation),
    postCode: firstText(root.post_code, root.postCode, root.postal_code, candidate.post_code),
    appliedAt: applicationTimestamp(root, application),
    questionnaire: answers,
    resume: resumeFile(applicant),
    rawPayload: payload
  };
}

export function verifyIndeedSignature(rawBody: string, signature: string | null, secret: string) {
  if (!secret.trim() || !signature?.trim()) return false;
  const supplied = signature.trim();
  const expected = createHmac("sha1", secret).update(rawBody, "utf8").digest("base64");
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(supplied, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

export function validateIndeedMappingInput(input: {
  internalCode: string;
  publicTitle: string;
  roleCode: string;
  roleStream: string;
}) {
  const internalCode = input.internalCode.trim().toUpperCase();
  const publicTitle = input.publicTitle.trim();
  const roleCode = input.roleCode.trim().toUpperCase();
  if (input.roleStream !== "hr") throw new Error("Indeed mappings are limited to HR designations.");
  if (publicTitle.length < 3 || publicTitle.length > 120) {
    throw new Error("Candidate-facing title must be between 3 and 120 characters.");
  }
  if (!/^[A-Z0-9]+_[A-Z0-9]+$/.test(internalCode)) {
    throw new Error("Internal code must use LOCATION_OR_REGION_ROLE format.");
  }
  if (internalCode.split("_").at(-1) !== roleCode) {
    throw new Error("Internal code must end with the selected HR designation code.");
  }
  if (publicTitle.toUpperCase() === internalCode) {
    throw new Error("Candidate-facing title cannot expose the internal routing code.");
  }
  return { internalCode, publicTitle };
}

function payloadWithoutResumeData(payload: unknown) {
  const root = object(payload);
  const applicant = object(root.applicant);
  const resume = object(applicant.resume);
  const file = object(resume.file);
  if (!Object.prototype.hasOwnProperty.call(file, "data")) return payload;
  return {
    ...root,
    applicant: {
      ...applicant,
      resume: {
        ...resume,
        file: { ...file, data: "[stored in private recruitment document storage]" }
      }
    }
  };
}

function decodeResume(file: IndeedResumeFile) {
  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(file.data)) {
    throw new IndeedIngestionError("Indeed resume is not valid Base64 data.", 422, "invalid_resume");
  }
  const bytes = Buffer.from(file.data, "base64");
  if (!bytes.length || bytes.length > 15 * 1024 * 1024) {
    throw new IndeedIngestionError("Indeed resume must be between 1 byte and 15 MB.", 413, "resume_too_large");
  }
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

type MappingRow = {
  id: string;
  indeed_job_id: string;
  public_title: string;
  internal_code: string;
  location_id: string;
  role_id: string;
  is_active: boolean;
};

async function mappedIndeedJob(companyId: string, jobId: string) {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  const mapping = await supabaseAdmin.from("recruitment_indeed_job_mappings")
    .select("id,indeed_job_id,public_title,internal_code,location_id,role_id,is_active")
    .eq("company_id", companyId).eq("indeed_job_id", jobId).maybeSingle();
  if (mapping.error) throw new Error(mapping.error.message);
  if (!mapping.data) throw new IndeedIngestionError("Indeed job is not mapped in DropX.", 404, "job_not_mapped");
  if (!mapping.data.is_active) throw new IndeedIngestionError("Indeed job mapping is inactive.", 410, "job_inactive");
  const role = await supabaseAdmin.from("recruitment_roles")
    .select("id,code,stream,is_active")
    .eq("company_id", companyId).eq("id", mapping.data.role_id).maybeSingle();
  const location = await supabaseAdmin.from("recruitment_locations")
    .select("id,is_active")
    .eq("company_id", companyId).eq("id", mapping.data.location_id).maybeSingle();
  if (role.error || location.error) throw new Error(role.error?.message || location.error?.message);
  if (!role.data?.is_active || role.data.stream !== "hr" || !location.data?.is_active) {
    throw new IndeedIngestionError("Indeed job mapping is not linked to active HR masters.", 404, "invalid_mapping");
  }
  validateIndeedMappingInput({
    internalCode: mapping.data.internal_code,
    publicTitle: mapping.data.public_title,
    roleCode: role.data.code,
    roleStream: role.data.stream
  });
  return mapping.data as MappingRow;
}

export async function ingestExternalRecruitmentApplication(
  application: NormalizedRecruitmentApplication,
  options: { sourceSystem?: string; notifyCandidate?: boolean } = {}
) {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
  const sourceSystem = options.sourceSystem ?? `${application.source}_apply`;
  const mapping = await mappedIndeedJob(companyId, application.jobId);
  if (application.jobMeta && application.jobMeta !== mapping.internal_code) {
    throw new IndeedIngestionError("Indeed job metadata does not match the saved DropX mapping.", 404, "job_meta_mismatch");
  }

  const priorEvent = await supabaseAdmin.from("recruitment_lead_source_events")
    .select("lead_id")
    .eq("company_id", companyId).eq("event_key", `indeed:${application.externalEventId}`).maybeSingle();
  if (priorEvent.error) throw new Error(priorEvent.error.message);
  if (priorEvent.data) {
    return { saved: false, duplicate: true, duplicateReason: "source_event", leadId: priorEvent.data.lead_id };
  }

  const replay = await supabaseAdmin.from("recruitment_indeed_applications")
    .select("id,lead_id")
    .eq("company_id", companyId).eq("apply_id", application.externalEventId).maybeSingle();
  if (replay.error) throw new Error(replay.error.message);
  if (replay.data) {
    return { saved: false, duplicate: true, duplicateReason: "apply_id", leadId: replay.data.lead_id };
  }
  if (application.email) {
    const cutoff = new Date(Date.now() - 120 * 24 * 60 * 60_000).toISOString();
    const duplicate = await supabaseAdmin.from("recruitment_indeed_applications")
      .select("id,lead_id")
      .eq("company_id", companyId)
      .eq("indeed_job_id", application.jobId)
      .eq("applicant_email", application.email)
      .gte("received_at", cutoff)
      .order("received_at", { ascending: false })
      .limit(1).maybeSingle();
    if (duplicate.error) throw new Error(duplicate.error.message);
    if (duplicate.data) {
      return { saved: false, duplicate: true, duplicateReason: "job_email_120_days", leadId: duplicate.data.lead_id };
    }
  }

  const normalizedPhone = normalizePhone(application.phone);
  const normalizedEmail = application.email?.toLowerCase() ?? null;
  const canonicalKey = normalizedPhone
    ? `application:indeed:${application.jobId.toLowerCase()}:${normalizedPhone}`
    : normalizedEmail
      ? `application:indeed:${application.jobId.toLowerCase()}:email-${createHash("sha256").update(normalizedEmail).digest("hex").slice(0, 24)}`
      : `indeed:${application.externalEventId}`;

  let existing = await supabaseAdmin.from("recruitment_leads")
    .select("id,duplicate_count")
    .eq("company_id", companyId).eq("canonical_key", canonicalKey).maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (!existing.data && normalizedPhone) {
    existing = await supabaseAdmin.from("recruitment_leads")
      .select("id,duplicate_count")
      .eq("company_id", companyId).eq("normalized_phone", normalizedPhone)
      .order("archived", { ascending: true })
      .order("updated_at", { ascending: false })
      .limit(1).maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
  }
  if (!existing.data && normalizedEmail) {
    existing = await supabaseAdmin.from("recruitment_leads")
      .select("id,duplicate_count")
      .eq("company_id", companyId).ilike("email", normalizedEmail)
      .order("archived", { ascending: true })
      .order("updated_at", { ascending: false })
      .limit(1).maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
  }

  const now = new Date().toISOString();
  let leadId = existing.data?.id as string | undefined;
  if (leadId) {
    const duplicate = await supabaseAdmin.from("recruitment_leads").update({
      duplicate_count: Number(existing.data?.duplicate_count || 1) + 1,
      updated_at: now
    }).eq("company_id", companyId).eq("id", leadId);
    if (duplicate.error) throw new Error(duplicate.error.message);
  } else {
    const inserted = await supabaseAdmin.from("recruitment_leads").insert({
      company_id: companyId,
      canonical_key: canonicalKey,
      normalized_phone: normalizedPhone,
      full_name: application.fullName,
      phone: application.phone,
      email: normalizedEmail,
      city: application.city,
      post_code: application.postCode,
      location_id: mapping.location_id,
      role_id: mapping.role_id,
      stream: "hr",
      ad_name: mapping.internal_code,
      source: "indeed",
      status: "new",
      questionnaire: application.questionnaire,
      duplicate_count: 1,
      lead_created_at: application.appliedAt ?? now,
      updated_at: now
    }).select("id").single();
    if (inserted.error) throw new Error(inserted.error.message);
    leadId = inserted.data.id as string;
  }

  let storedResume: { path: string; name: string; type: string } | null = null;
  if (application.resume) {
    storedResume = await uploadRecruitmentDocument({
      companyId,
      leadId: leadId!,
      documentType: "resume",
      fileName: application.resume.fileName,
      contentType: application.resume.contentType,
      bytes: decodeResume(application.resume)
    });
    const documentHistory = await supabaseAdmin.from("recruitment_lead_history").insert({
      company_id: companyId,
      lead_id: leadId,
      event_type: "hr_document_uploaded",
      remarks: "Resume received securely from Indeed Apply.",
      actor_email: "system:indeed_apply",
      metadata: {
        path: storedResume.path,
        new_path: storedResume.path,
        file_name: storedResume.name,
        document_type: "resume",
        source: "indeed"
      }
    });
    if (documentHistory.error) throw new Error(documentHistory.error.message);
  }

  const safePayload = payloadWithoutResumeData(application.rawPayload);
  const payloadHash = createHash("sha256").update(JSON.stringify(application.rawPayload)).digest("hex");
  const eventKey = `indeed:${application.externalEventId}`;
  const event = await supabaseAdmin.from("recruitment_lead_source_events").insert({
    company_id: companyId,
    lead_id: leadId,
    event_key: eventKey,
    source_system: sourceSystem,
    ad_name: mapping.internal_code,
    payload: safePayload,
    payload_hash: payloadHash,
    status: "processed",
    processed_at: now
  });
  if (event.error) throw new Error(event.error.message);

  const applicationRow = await supabaseAdmin.from("recruitment_indeed_applications").insert({
    company_id: companyId,
    mapping_id: mapping.id,
    lead_id: leadId,
    apply_id: application.externalEventId,
    indeed_job_id: application.jobId,
    applicant_email: normalizedEmail,
    payload_hash: payloadHash,
    applied_at: application.appliedAt,
    resume_path: storedResume?.path ?? null,
    resume_name: storedResume?.name ?? null,
    resume_content_type: application.resume?.contentType ?? null,
    processed_at: now
  });
  if (applicationRow.error) throw new Error(applicationRow.error.message);

  const history = await supabaseAdmin.from("recruitment_lead_history").insert({
    company_id: companyId,
    lead_id: leadId,
    event_type: "source_ingest",
    field_name: "source",
    old_value: null,
    new_value: "indeed",
    remarks: `Indeed application received for ${mapping.public_title}.`,
    actor_email: `system:${sourceSystem}`,
    metadata: {
      source_system: sourceSystem,
      apply_id: application.externalEventId,
      indeed_job_id: application.jobId,
      public_title: mapping.public_title,
      internal_code: mapping.internal_code,
      duplicate_person: Boolean(existing.data),
      candidate_notification: Boolean(options.notifyCandidate)
    },
    source_event_key: `${eventKey}:audit`
  });
  if (history.error) throw new Error(history.error.message);

  const mappingUpdate = await supabaseAdmin.from("recruitment_indeed_job_mappings")
    .update({ last_application_at: now, updated_at: now })
    .eq("company_id", companyId).eq("id", mapping.id);
  if (mappingUpdate.error) throw new Error(mappingUpdate.error.message);

  if (!existing.data && options.notifyCandidate) await enqueueStoredLeadWelcome(leadId!);
  return { saved: true, duplicate: false, duplicatePerson: Boolean(existing.data), leadId };
}
