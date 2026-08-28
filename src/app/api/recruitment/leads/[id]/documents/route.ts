import { NextResponse } from "next/server";
import { canAccessLead, canUseRecruitmentMenu, recruitmentSession, requiredEnv } from "@/lib/recruitment-api";
import {
  deleteRecruitmentDocument,
  listRecruitmentDocuments,
  uploadRecruitmentDocument
} from "@/lib/recruitment-documents";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const allowedTypes = new Set(["resume","identity","education","experience","salary","other"]);
const allowedMimeTypes = new Set([
  "application/pdf","image/png","image/jpeg","application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
]);

async function authorizedLead(request: Request, id: string) {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  const session = await recruitmentSession(request);
  if (!session?.hr) return { error: NextResponse.json({ error: "HR access is required." }, { status: 403 }) };
  const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
  const lead = await supabaseAdmin.from("recruitment_leads")
    .select("id,stream,location_id,role_id")
    .eq("company_id", companyId).eq("id", id).maybeSingle();
  if (lead.error) throw new Error(lead.error.message);
  if (!lead.data) return { error: NextResponse.json({ error: "Lead not found." }, { status: 404 }) };
  if (lead.data.stream !== "hr" || !canAccessLead(session, lead.data)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { session, companyId, lead: lead.data };
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const resolved = await authorizedLead(request, params.id);
    if (resolved.error) return resolved.error;
    if (!canUseRecruitmentMenu(resolved.session, "Documents", "view", "hr")) {
      return NextResponse.json({ error: "Access to HR Documents is required." }, { status: 403 });
    }
    const documents = await listRecruitmentDocuments(resolved.companyId!, params.id);
    const canDeleteAny = canUseRecruitmentMenu(resolved.session, "Documents", "all", "hr");
    return NextResponse.json({ documents: documents.map((document) => ({
      ...document,
      canDelete: canDeleteAny || (
        Boolean(document.uploadedByProfileId) &&
        document.uploadedByProfileId === resolved.session?.profileId
      )
    })) });
  } catch (error) {
    console.error("Recruitment document list failed", error);
    return NextResponse.json({ error: "Unable to load candidate documents." }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase is not configured.");
    const resolved = await authorizedLead(request, params.id);
    if (resolved.error) return resolved.error;
    const form = await request.formData();
    const file = form.get("file");
    const documentType = String(form.get("documentType") ?? "").trim().toLowerCase();
    const replacePath = String(form.get("replacePath") ?? "").trim();
    const requiredAction = replacePath ? "edit" : "add";
    if (!canUseRecruitmentMenu(resolved.session, "Documents", requiredAction, "hr")) {
      return NextResponse.json({ error: `${requiredAction === "add" ? "Add" : "Edit"} access to HR Documents is required.` }, { status: 403 });
    }
    if (!(file instanceof File)) return NextResponse.json({ error: "Choose a document." }, { status: 400 });
    if (!allowedTypes.has(documentType)) return NextResponse.json({ error: "Choose a supported document type." }, { status: 400 });
    if (!allowedMimeTypes.has(file.type)) return NextResponse.json({ error: "Upload a PDF, image, DOC or DOCX file." }, { status: 400 });
    if (file.size <= 0 || file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: "Document must be between 1 byte and 10 MB." }, { status: 400 });
    }
    let replacedDocument: Awaited<ReturnType<typeof listRecruitmentDocuments>>[number] | null = null;
    if (replacePath) {
      const documents = await listRecruitmentDocuments(resolved.companyId!, params.id);
      replacedDocument = documents.find((document) => document.path === replacePath) ?? null;
      if (!replacedDocument) return NextResponse.json({ error: "The document to replace was not found." }, { status: 404 });
      const canDeleteAny = canUseRecruitmentMenu(resolved.session, "Documents", "all", "hr");
      const isUploader = Boolean(replacedDocument.uploadedByProfileId) &&
        replacedDocument.uploadedByProfileId === resolved.session?.profileId;
      if (!canDeleteAny && !isUploader) {
        return NextResponse.json({ error: "Only the uploader or a user with All document access can replace this file." }, { status: 403 });
      }
    }
    const uploaded = await uploadRecruitmentDocument({
      companyId: resolved.companyId!,
      leadId: params.id,
      documentType,
      fileName: file.name,
      contentType: file.type,
      bytes: await file.arrayBuffer()
    });
    if (replacedDocument) {
      await deleteRecruitmentDocument({
        companyId: resolved.companyId!,
        leadId: params.id,
        path: replacedDocument.path
      });
    }
    const audit = await supabaseAdmin.from("recruitment_lead_history").insert({
      company_id: resolved.companyId,
      lead_id: params.id,
      event_type: replacedDocument ? "hr_document_replaced" : "hr_document_uploaded",
      remarks: replacedDocument
        ? `${documentType.replaceAll("_", " ")} replaced (${replacedDocument.name} → ${uploaded.name})`
        : `${documentType.replaceAll("_", " ")} uploaded`,
      actor_profile_id: resolved.session!.profileId,
      actor_email: resolved.session!.email,
      metadata: {
        path: uploaded.path,
        new_path: uploaded.path,
        old_path: replacedDocument?.path ?? null,
        old_file_name: replacedDocument?.name ?? null,
        file_name: uploaded.name,
        document_type: uploaded.type,
        size: file.size
      }
    });
    if (audit.error) throw new Error(audit.error.message);
    return NextResponse.json({ uploaded: true, replaced: Boolean(replacedDocument), document: uploaded });
  } catch (error) {
    console.error("Recruitment document upload failed", error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Unable to upload candidate document."
    }, { status: 400 });
  }
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase is not configured.");
    const resolved = await authorizedLead(request, params.id);
    if (resolved.error) return resolved.error;
    if (!canUseRecruitmentMenu(resolved.session, "Documents", "edit", "hr")) {
      return NextResponse.json({ error: "Edit access to HR Documents is required." }, { status: 403 });
    }
    const body = await request.json() as { path?: unknown; reason?: unknown };
    const path = String(body.path ?? "").trim();
    const reason = String(body.reason ?? "Wrong candidate document").trim().slice(0, 500);
    const documents = await listRecruitmentDocuments(resolved.companyId!, params.id);
    const document = documents.find((item) => item.path === path);
    if (!document) return NextResponse.json({ error: "Document not found." }, { status: 404 });
    const canDeleteAny = canUseRecruitmentMenu(resolved.session, "Documents", "all", "hr");
    const isUploader = Boolean(document.uploadedByProfileId) &&
      document.uploadedByProfileId === resolved.session?.profileId;
    if (!canDeleteAny && !isUploader) {
      return NextResponse.json({ error: "Only the uploader or a user with All document access can delete this file." }, { status: 403 });
    }
    await deleteRecruitmentDocument({ companyId: resolved.companyId!, leadId: params.id, path });
    const audit = await supabaseAdmin.from("recruitment_lead_history").insert({
      company_id: resolved.companyId,
      lead_id: params.id,
      event_type: "hr_document_deleted",
      remarks: `${document.name} deleted. ${reason}`,
      actor_profile_id: resolved.session!.profileId,
      actor_email: resolved.session!.email,
      metadata: { path: document.path, file_name: document.name, document_type: document.type, reason }
    });
    if (audit.error) throw new Error(audit.error.message);
    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error("Recruitment document delete failed", error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Unable to delete candidate document."
    }, { status: 400 });
  }
}
