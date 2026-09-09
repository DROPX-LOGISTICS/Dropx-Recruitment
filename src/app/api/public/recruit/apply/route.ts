import { supabaseAdmin } from "@/lib/supabase-admin";
import { requiredEnv } from "@/lib/recruitment-api";
import { uploadRecruitmentDocument, deleteRecruitmentDocument } from "@/lib/recruitment-documents";
import { allowedOrigin, cleanAttribution, preflight, publicResponse, requestHash, validPhone, verifyIntakeToken } from "@/lib/public-recruit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export const OPTIONS = preflight;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function POST(request: Request) {
  if (!allowedOrigin(request)) return publicResponse(request, { error: "Origin not allowed." }, 403);
  if (Number(request.headers.get("content-length")) > 3_400_000) return publicResponse(request, { error: "Choose a PDF smaller than 3 MB." }, 413);
  let receipt: string | null = null;
  try {
    if (!supabaseAdmin) throw new Error("Unavailable");
    const form = await request.formData();
    const text = (key: string, max = 200) => String(form.get(key) || "").trim().slice(0, max);
    receipt = verifyIntakeToken(text("token", 200));
    if (!receipt || text("companyWebsite")) return publicResponse(request, { error: "Please reload the form and try again." }, 400);
    const fullName = text("fullName", 120), phone = validPhone(text("phone", 30)), email = text("email", 180).toLowerCase();
    const kind = text("kind"), location = text("locationId"), role = text("roleId"), job = text("jobId");
    if (fullName.length < 2 || !phone || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) || text("consent") !== "yes") {
      return publicResponse(request, { error: "Enter your name, a valid Indian mobile number, and consent to be contacted about your application." }, 400);
    }
    if (!(["workforce", "hr"].includes(kind)) || (kind === "workforce" && (!uuid.test(location) || !uuid.test(role))) || (kind === "hr" && (!uuid.test(job) || !email))) {
      return publicResponse(request, { error: "Select an available opportunity and complete your contact details." }, 400);
    }
    const file = form.get("resume");
    let resume: { file: File; bytes: ArrayBuffer } | null = null;
    if (kind === "hr") {
      if (!(file instanceof File) || file.size < 5 || file.size > 3_000_000 || !file.name.toLowerCase().endsWith(".pdf")) return publicResponse(request, { error: "Add your CV as a PDF, up to 3 MB." }, 400);
      const bytes = await file.arrayBuffer();
      if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") return publicResponse(request, { error: "The CV must be a valid PDF." }, 400);
      resume = { file, bytes };
    }
    let attribution = {};
    try { attribution = cleanAttribution(JSON.parse(text("attribution", 1500))); } catch { /* optional */ }
    const company = requiredEnv("RECRUITMENT_COMPANY_ID");
    const ip = request.headers.get("x-vercel-forwarded-for")?.split(",")[0] || request.headers.get("x-forwarded-for")?.split(",")[0] || "unknown";
    const result = await supabaseAdmin.rpc("website_recruit_apply", {
      p_company: company, p_receipt: receipt, p_ip_hash: requestHash(ip), p_phone_hash: requestHash(phone),
      p_kind: kind, p_name: fullName, p_phone: phone, p_email: email || null,
      p_location: kind === "workforce" ? location : null, p_role: kind === "workforce" ? role : null,
      p_job: kind === "hr" ? job : null,
      p_details: { consent: { version: "website-recruit-2026-09", accepted: true }, attribution, experience: text("experience", 2000) }
    });
    if (result.error) {
      if (result.error.message.includes("rate_limited")) return publicResponse(request, { error: "You’ve made several requests. Please try again in 15 minutes." }, 429);
      if (result.error.message.includes("not_available")) return publicResponse(request, { error: "That opportunity is no longer available. Reload to see current opportunities." }, 409);
      throw result.error;
    }
    const saved = result.data;
    if (resume && saved.application_id && saved.allow_resume) {
      const uploaded = await uploadRecruitmentDocument({ companyId: company, leadId: saved.lead_id, documentType: "resume", fileName: resume.file.name.slice(0,120), contentType: "application/pdf", bytes: resume.bytes });
      const updated = await supabaseAdmin.from("recruitment_applications").update({ resume_storage_path: uploaded.path, resume_file_name: resume.file.name.slice(0,120), resume_content_type: "application/pdf" }).eq("company_id", company).eq("id", saved.application_id).is("resume_storage_path", null).select("id");
      if (updated.error || !updated.data?.length) {
        await deleteRecruitmentDocument({ companyId: company, leadId: saved.lead_id, path: uploaded.path });
        if (updated.error) throw updated.error;
      }
    }
    return publicResponse(request, { received: true, reference: `DX-${receipt.slice(0, 8).toUpperCase()}`, message: "Your application is with our recruitment team. They’ll contact you about suitable next steps." });
  } catch (error) {
    console.error("Public recruitment submission failed", error);
    return publicResponse(request, { error: "We couldn’t complete your submission. Please retry with the same form; retries won’t create duplicate applications." }, 503);
  }
}
