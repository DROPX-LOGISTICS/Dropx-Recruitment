import { supabaseAdmin } from "./supabase-admin";

const bucket = "recruitment-documents";

function safeName(value: string) {
  return value.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120) || "document";
}

async function ensureBucket() {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  const existing = await supabaseAdmin.storage.getBucket(bucket);
  if (!existing.error) return;
  const created = await supabaseAdmin.storage.createBucket(bucket, {
    public: false,
    fileSizeLimit: 15 * 1024 * 1024,
    allowedMimeTypes: [
      "application/pdf",
      "image/png",
      "image/jpeg",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/rtf",
      "text/plain"
    ]
  });
  if (created.error && !created.error.message.toLowerCase().includes("already exists")) {
    throw new Error(created.error.message);
  }
}

export async function uploadRecruitmentDocument(options: {
  companyId: string;
  leadId: string;
  documentType: string;
  fileName: string;
  contentType: string;
  bytes: ArrayBuffer;
}) {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  await ensureBucket();
  const path = `${options.companyId}/${options.leadId}/${Date.now()}--${safeName(options.documentType)}--${safeName(options.fileName)}`;
  const uploaded = await supabaseAdmin.storage.from(bucket).upload(path, options.bytes, {
    contentType: options.contentType,
    upsert: false
  });
  if (uploaded.error) throw new Error(uploaded.error.message);
  return { path, name: options.fileName, type: options.documentType };
}

export async function deleteRecruitmentDocument(options: {
  companyId: string;
  leadId: string;
  path: string;
}) {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  const prefix = `${options.companyId}/${options.leadId}/`;
  if (!options.path.startsWith(prefix) || options.path.includes("..")) {
    throw new Error("Invalid candidate document path.");
  }
  const removed = await supabaseAdmin.storage.from(bucket).remove([options.path]);
  if (removed.error) throw new Error(removed.error.message);
}

export async function createRecruitmentDocumentSignedUrl(options: {
  companyId: string;
  leadId: string;
  path: string;
  expiresInSeconds?: number;
}) {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  const prefix = `${options.companyId}/${options.leadId}/`;
  if (!options.path.startsWith(prefix) || options.path.includes("..")) {
    throw new Error("Invalid candidate document path.");
  }
  await ensureBucket();
  const signed = await supabaseAdmin.storage.from(bucket).createSignedUrl(
    options.path,
    Math.max(60, Math.min(60 * 60, options.expiresInSeconds ?? 15 * 60))
  );
  if (signed.error) throw new Error(signed.error.message);
  return signed.data.signedUrl;
}

export async function listRecruitmentDocuments(companyId: string, leadId: string) {
  if (!supabaseAdmin) return [];
  await ensureBucket();
  const prefix = `${companyId}/${leadId}`;
  const listed = await supabaseAdmin.storage.from(bucket).list(prefix, {
    limit: 100,
    sortBy: { column: "created_at", order: "desc" }
  });
  if (listed.error) throw new Error(listed.error.message);
  const history = await supabaseAdmin.from("recruitment_lead_history")
    .select("event_type,actor_profile_id,actor_email,created_at,metadata")
    .eq("company_id", companyId)
    .eq("lead_id", leadId)
    .in("event_type", ["hr_document_uploaded", "hr_document_replaced"])
    .order("created_at", { ascending: false })
    .limit(250);
  if (history.error) throw new Error(history.error.message);
  const uploadByPath = new Map<string, {
    actorProfileId: string | null;
    actorEmail: string | null;
    createdAt: string | null;
  }>();
  for (const event of history.data ?? []) {
    const metadata = (event.metadata ?? {}) as Record<string, unknown>;
    const path = String(metadata.new_path ?? metadata.path ?? "").trim();
    if (!path || uploadByPath.has(path)) continue;
    uploadByPath.set(path, {
      actorProfileId: event.actor_profile_id ?? null,
      actorEmail: event.actor_email ?? null,
      createdAt: event.created_at ?? null
    });
  }
  return Promise.all((listed.data ?? []).filter((item) => item.name && item.id).map(async (item) => {
    const path = `${prefix}/${item.name}`;
    const upload = uploadByPath.get(path);
    const signed = await supabaseAdmin!.storage.from(bucket).createSignedUrl(path, 15 * 60);
    if (signed.error) throw new Error(signed.error.message);
    const parts = item.name.split("--");
    return {
      path,
      type: parts[1]?.replaceAll("-", " ") || "document",
      name: parts.slice(2).join("--") || item.name,
      size: Number(item.metadata?.size || 0),
      createdAt: upload?.createdAt || item.created_at || item.updated_at || null,
      uploadedByProfileId: upload?.actorProfileId ?? null,
      uploadedBy: upload?.actorEmail ?? null,
      url: signed.data.signedUrl
    };
  }));
}
