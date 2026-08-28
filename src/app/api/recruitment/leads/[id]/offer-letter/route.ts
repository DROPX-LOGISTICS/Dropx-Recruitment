import { NextResponse } from "next/server";
import { getConnectionConfig } from "@/lib/connection-config";
import {
  loadHrLifecycleRules,
  loadHrWorkflowSettings,
  validateHrTransition
} from "@/lib/hr-recruitment-lifecycle";
import { buildOfferLetterPdf, type OfferLetterVariant } from "@/lib/offer-letter-pdf";
import { canAccessLead, canUseRecruitmentMenu, recruitmentSession, requiredEnv } from "@/lib/recruitment-api";
import {
  createRecruitmentDocumentSignedUrl,
  uploadRecruitmentDocument
} from "@/lib/recruitment-documents";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type OfferStatus = "draft" | "pending_approval" | "approved" | "issued" | "accepted" | "rejected" | "withdrawn";

function text(value: unknown, limit = 4000) {
  return String(value ?? "").trim().slice(0, limit);
}

function safeFileName(value: string) {
  return value.replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "") || "Candidate";
}

function missingTable(message: string) {
  return /relation .* does not exist|schema cache/i.test(message);
}

async function loadCandidate(companyId: string, leadId: string) {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  const result = await supabaseAdmin.from("recruitment_leads")
    .select("id,status,stream,full_name,email,phone,location_id,role_id,recruitment_roles(name),recruitment_locations(code,name,address)")
    .eq("company_id", companyId)
    .eq("id", leadId)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

async function writeHistory(input: {
  companyId: string;
  leadId: string;
  eventType: string;
  actorProfileId: string | null;
  actorEmail: string | null;
  remarks: string;
  oldValue?: string | null;
  newValue?: string | null;
  metadata?: Record<string, unknown>;
}) {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  const result = await supabaseAdmin.from("recruitment_lead_history").insert({
    company_id: input.companyId,
    lead_id: input.leadId,
    event_type: input.eventType,
    field_name: input.oldValue !== undefined || input.newValue !== undefined ? "offer_status" : null,
    old_value: input.oldValue ?? null,
    new_value: input.newValue ?? null,
    remarks: input.remarks,
    actor_profile_id: input.actorProfileId,
    actor_email: input.actorEmail,
    metadata: input.metadata ?? {}
  });
  if (result.error) throw new Error(result.error.message);
}

async function listVersions(companyId: string, leadId: string) {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  const result = await supabaseAdmin.from("recruitment_hr_offer_versions")
    .select("id,version_no,status,variant,job_title,work_location,compensation,content,joining_date,probation,additional_terms,storage_path,created_by_profile_id,approved_by_profile_id,issued_by_profile_id,approved_at,issued_at,created_at,updated_at")
    .eq("company_id", companyId)
    .eq("lead_id", leadId)
    .order("version_no", { ascending: false });
  if (result.error) {
    if (missingTable(result.error.message)) {
      throw new Error("Apply the HR lifecycle database migration before using versioned offers.");
    }
    throw new Error(result.error.message);
  }
  return Promise.all((result.data ?? []).map(async (version) => {
    let downloadUrl: string | null = null;
    if (version.storage_path) {
      try {
        downloadUrl = await createRecruitmentDocumentSignedUrl({
          companyId,
          leadId,
          path: version.storage_path
        });
      } catch {
        downloadUrl = null;
      }
    }
    return { ...version, downloadUrl };
  }));
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase is not configured.");
    const session = await recruitmentSession(request);
    if (!session?.hr || !canUseRecruitmentMenu(session, "Offers", "view", "hr")) {
      return NextResponse.json({ error: "View access to HR Offers is required." }, { status: 403 });
    }
    const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
    const lead = await loadCandidate(companyId, params.id);
    if (!lead) return NextResponse.json({ error: "Candidate not found." }, { status: 404 });
    if (lead.stream !== "hr" || !canAccessLead(session, lead)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const settings = await loadHrWorkflowSettings(supabaseAdmin, companyId);
    return NextResponse.json({
      versions: await listVersions(companyId, lead.id),
      requireApproval: settings.requireOfferApproval,
      canApprove: canUseRecruitmentMenu(session, "Offers", "all", "hr")
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Unable to load offer versions."
    }, { status: 400 });
  }
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase is not configured.");
    const session = await recruitmentSession(request);
    if (!session?.hr) {
      return NextResponse.json({ error: "HR access is required." }, { status: 403 });
    }
    const body = await request.json() as Record<string, unknown>;
    const action = text(body.action, 40).toLowerCase() || "draft";
    const requiredAction = ["draft", "submit"].includes(action) ? "add" : "edit";
    if (!canUseRecruitmentMenu(session, "Offers", requiredAction, "hr")) {
      return NextResponse.json({ error: `${requiredAction === "add" ? "Add" : "Edit"} access to HR Offers is required.` }, { status: 403 });
    }
    const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
    const lead = await loadCandidate(companyId, params.id);
    if (!lead) return NextResponse.json({ error: "Candidate not found." }, { status: 404 });
    if (lead.stream !== "hr" || !canAccessLead(session, lead)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const settings = await loadHrWorkflowSettings(supabaseAdmin, companyId);
    const canApprove = canUseRecruitmentMenu(session, "Offers", "all", "hr");

    if (["approve", "issue", "withdraw"].includes(action)) {
      const versionId = text(body.versionId, 80);
      if (!versionId) return NextResponse.json({ error: "Choose an offer version." }, { status: 400 });
      const versionResult = await supabaseAdmin.from("recruitment_hr_offer_versions")
        .select("*")
        .eq("company_id", companyId)
        .eq("lead_id", lead.id)
        .eq("id", versionId)
        .maybeSingle();
      if (versionResult.error) throw new Error(versionResult.error.message);
      if (!versionResult.data) return NextResponse.json({ error: "Offer version not found." }, { status: 404 });
      const version = versionResult.data;

      if (action === "approve") {
        if (!canApprove) return NextResponse.json({ error: "All access to HR Offers is required to approve." }, { status: 403 });
        if (version.status !== "pending_approval") {
          return NextResponse.json({ error: "Only a pending offer can be approved." }, { status: 409 });
        }
        const now = new Date().toISOString();
        const updated = await supabaseAdmin.from("recruitment_hr_offer_versions").update({
          status: "approved",
          approved_by_profile_id: session.profileId,
          approved_at: now,
          updated_at: now
        }).eq("company_id", companyId).eq("id", version.id).eq("status", "pending_approval");
        if (updated.error) throw new Error(updated.error.message);
        await writeHistory({
          companyId, leadId: lead.id, eventType: "hr_offer_approved",
          actorProfileId: session.profileId, actorEmail: session.email,
          oldValue: "pending_approval", newValue: "approved",
          remarks: text(body.note) || `Offer version ${version.version_no} approved.`,
          metadata: { offer_version_id: version.id, version_no: version.version_no }
        });
        return NextResponse.json({ message: `Offer version ${version.version_no} approved.`, versions: await listVersions(companyId, lead.id) });
      }

      if (action === "withdraw") {
        if (!canApprove) return NextResponse.json({ error: "All access to HR Offers is required to withdraw an offer." }, { status: 403 });
        if (["accepted", "rejected", "withdrawn"].includes(version.status)) {
          return NextResponse.json({ error: "This offer is already closed." }, { status: 409 });
        }
        const reason = text(body.note);
        if (!reason) return NextResponse.json({ error: "A withdrawal reason is required." }, { status: 400 });
        const now = new Date().toISOString();
        const updated = await supabaseAdmin.from("recruitment_hr_offer_versions").update({ status: "withdrawn", updated_at: now })
          .eq("company_id", companyId).eq("id", version.id);
        if (updated.error) throw new Error(updated.error.message);
        await writeHistory({
          companyId, leadId: lead.id, eventType: "hr_offer_withdrawn",
          actorProfileId: session.profileId, actorEmail: session.email,
          oldValue: version.status, newValue: "withdrawn", remarks: reason,
          metadata: { offer_version_id: version.id, version_no: version.version_no }
        });
        return NextResponse.json({ message: `Offer version ${version.version_no} withdrawn.`, versions: await listVersions(companyId, lead.id) });
      }

      if (settings.requireOfferApproval && !canApprove) {
        return NextResponse.json({ error: "All access to HR Offers is required to issue an approved offer." }, { status: 403 });
      }
      if (version.status !== "approved") {
        return NextResponse.json({ error: "Approve this offer version before issuing it." }, { status: 409 });
      }

      const content = (version.content ?? {}) as Record<string, unknown>;
      const compensationData = (version.compensation ?? {}) as Record<string, unknown>;
      const salary = (compensationData.salary ?? {}) as Record<string, number>;
      const config = await getConnectionConfig("google");
      const company = config?.publicConfig.offer_company_name || "DropX Logistics";
      const signatory = config?.publicConfig.offer_signatory_name || "Authorised Signatory";
      const signatoryTitle = config?.publicConfig.offer_signatory_title || "Human Resources";
      const validityDays = Math.max(1, Math.min(60, Number(config?.publicConfig.offer_validity_days) || 7));
      const standardTerms = (config?.publicConfig[
        version.variant === "statutory" ? "offer_statutory_terms" : "offer_non_statutory_terms"
      ] || config?.publicConfig.offer_default_terms || "")
        .split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
      const issueDate = new Date();
      const validUntil = new Date(issueDate.getTime() + validityDays * 86_400_000);
      const location = lead.recruitment_locations as { code?: string | null; name?: string | null; address?: string | null } | null;
      const referencePrefix = text(config?.publicConfig.offer_reference_prefix, 80) || "DROPX/HRD/OL";
      const reference = `${referencePrefix}/${issueDate.getFullYear()}/${String(issueDate.getMonth() + 1).padStart(2, "0")}/${lead.id.slice(0, 6).toUpperCase()}-V${version.version_no}`;
      const letter = await buildOfferLetterPdf({
        variant: version.variant as OfferLetterVariant,
        reference,
        issueDate,
        validUntil,
        candidateName: lead.full_name || "Candidate",
        jobTitle: version.job_title,
        compensation: text(compensationData.display, 300),
        joiningDate: new Date(`${version.joining_date}T00:00:00+05:30`),
        location: version.work_location || [location?.code, location?.name].filter(Boolean).join(" — ") || "As assigned",
        locationAddress: text(content.locationAddress) || location?.address || "",
        probation: version.probation || "As per company policy",
        additionalTerms: version.additional_terms ? [version.additional_terms] : [],
        standardTerms,
        incentiveTerms: text(config?.publicConfig.offer_non_statutory_incentive_terms, 2000),
        companyName: company,
        signatoryName: signatory,
        signatoryTitle,
        salary: {
          basic: Number(salary.basic) || 0,
          hra: Number(salary.hra) || 0,
          lta: Number(salary.lta) || 0,
          specialAllowance: Number(salary.specialAllowance) || 0,
          otherAllowance: Number(salary.otherAllowance) || 0,
          employeePf: Number(salary.employeePf) || 0,
          professionalTax: Number(salary.professionalTax) || 0,
          employerPf: Number(salary.employerPf) || 0
        }
      });
      const fileName = `DropX_Offer_${safeFileName(lead.full_name || "Candidate")}_V${version.version_no}_${version.joining_date}.pdf`;
      const upload = await uploadRecruitmentDocument({
        companyId,
        leadId: lead.id,
        documentType: "offer-letter",
        fileName,
        contentType: "application/pdf",
        bytes: Uint8Array.from(letter).buffer
      });
      const now = new Date().toISOString();
      const versionUpdate = await supabaseAdmin.from("recruitment_hr_offer_versions").update({
        status: "issued",
        storage_bucket: "recruitment-documents",
        storage_path: upload.path,
        issued_by_profile_id: session.profileId,
        issued_at: now,
        updated_at: now,
        content: { ...content, reference, validityDays }
      }).eq("company_id", companyId).eq("id", version.id).eq("status", "approved");
      if (versionUpdate.error) throw new Error(versionUpdate.error.message);
      if (lead.status !== "offered") {
        const rules = await loadHrLifecycleRules(supabaseAdmin, companyId);
        validateHrTransition({ currentCode: lead.status, nextCode: "offered", actor: "hr_head", remarks: `Offer ${reference} issued.`, rules });
        const leadUpdate = await supabaseAdmin.from("recruitment_leads").update({
          status: "offered",
          follow_up_at: version.joining_date,
          last_updated_by: session.profileId,
          updated_at: now
        }).eq("company_id", companyId).eq("id", lead.id);
        if (leadUpdate.error) throw new Error(leadUpdate.error.message);
      }
      await writeHistory({
        companyId, leadId: lead.id, eventType: "hr_offer_issued",
        actorProfileId: session.profileId, actorEmail: session.email,
        oldValue: "approved", newValue: "issued",
        remarks: `Offer ${reference} issued for ${version.job_title}; joining ${version.joining_date}.`,
        metadata: { offer_version_id: version.id, version_no: version.version_no, reference, storage_path: upload.path }
      });
      const downloadUrl = await createRecruitmentDocumentSignedUrl({ companyId, leadId: lead.id, path: upload.path });
      return NextResponse.json({
        message: `Offer version ${version.version_no} issued and candidate marked as Offered.`,
        downloadUrl,
        fileName,
        versions: await listVersions(companyId, lead.id)
      });
    }

    if (!["draft", "submit"].includes(action)) {
      return NextResponse.json({ error: "Unsupported offer action." }, { status: 400 });
    }
    const jobTitle = text(body.jobTitle, 300);
    const compensation = text(body.compensation, 300);
    const joiningDate = text(body.joiningDate, 30);
    const probation = text(body.probation, 200);
    const notes = text(body.notes);
    const variant: OfferLetterVariant = body.variant === "statutory" ? "statutory" : "non_statutory";
    if (!jobTitle || !compensation || !/^\d{4}-\d{2}-\d{2}$/.test(joiningDate)) {
      return NextResponse.json({ error: "Job title, compensation and a valid joining date are required." }, { status: 400 });
    }
    const number = (value: unknown) => Math.max(0, Number(value) || 0);
    const salary = {
      basic: number(body.basic), hra: number(body.hra), lta: number(body.lta),
      specialAllowance: number(body.specialAllowance), otherAllowance: number(body.otherAllowance),
      employeePf: number(body.employeePf), professionalTax: number(body.professionalTax),
      employerPf: number(body.employerPf)
    };
    if (variant === "statutory" && salary.basic + salary.hra + salary.lta + salary.specialAllowance + salary.otherAllowance <= 0) {
      return NextResponse.json({ error: "Enter the statutory monthly salary components." }, { status: 400 });
    }
    const latest = await supabaseAdmin.from("recruitment_hr_offer_versions")
      .select("version_no")
      .eq("company_id", companyId)
      .eq("lead_id", lead.id)
      .order("version_no", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latest.error) throw new Error(latest.error.message);
    const versionNo = Number(latest.data?.version_no || 0) + 1;
    const now = new Date().toISOString();
    const location = lead.recruitment_locations as { code?: string | null; name?: string | null; address?: string | null } | null;
    const status: OfferStatus = action === "draft"
      ? "draft"
      : settings.requireOfferApproval ? "pending_approval" : "approved";
    const created = await supabaseAdmin.from("recruitment_hr_offer_versions").insert({
      company_id: companyId,
      lead_id: lead.id,
      version_no: versionNo,
      status,
      variant,
      job_title: jobTitle,
      work_location: [location?.code, location?.name].filter(Boolean).join(" — ") || "As assigned",
      compensation: { display: compensation, salary },
      content: { locationAddress: location?.address || "" },
      joining_date: joiningDate,
      probation: probation || "As per company policy",
      additional_terms: notes || null,
      created_by_profile_id: session.profileId,
      approved_by_profile_id: status === "approved" ? session.profileId : null,
      approved_at: status === "approved" ? now : null,
      created_at: now,
      updated_at: now
    }).select("id").single();
    if (created.error) throw new Error(created.error.message);

    if (action === "submit" && lead.status !== "offer_pending" && lead.status !== "offered") {
      const rules = await loadHrLifecycleRules(supabaseAdmin, companyId);
      validateHrTransition({ currentCode: lead.status, nextCode: "offer_pending", actor: "recruiter", remarks: `Offer version ${versionNo} submitted.`, rules });
      const leadUpdate = await supabaseAdmin.from("recruitment_leads").update({
        status: "offer_pending",
        last_updated_by: session.profileId,
        updated_at: now
      }).eq("company_id", companyId).eq("id", lead.id);
      if (leadUpdate.error) throw new Error(leadUpdate.error.message);
    }
    await writeHistory({
      companyId,
      leadId: lead.id,
      eventType: action === "draft" ? "hr_offer_draft_created" : "hr_offer_submitted",
      actorProfileId: session.profileId,
      actorEmail: session.email,
      oldValue: null,
      newValue: status,
      remarks: action === "draft"
        ? `Offer version ${versionNo} saved as draft.`
        : status === "approved"
          ? `Offer version ${versionNo} submitted and auto-approved by policy.`
          : `Offer version ${versionNo} submitted for approval.`,
      metadata: { offer_version_id: created.data.id, version_no: versionNo, variant, job_title: jobTitle, joining_date: joiningDate }
    });
    return NextResponse.json({
      message: action === "draft"
        ? `Offer version ${versionNo} saved as draft.`
        : status === "approved"
          ? `Offer version ${versionNo} is approved and ready to issue.`
          : `Offer version ${versionNo} submitted for approval.`,
      versions: await listVersions(companyId, lead.id)
    });
  } catch (error) {
    console.error("Offer lifecycle action failed", error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Unable to update offer."
    }, { status: 400 });
  }
}
