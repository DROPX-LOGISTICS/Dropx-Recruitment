import type { MobileSessionContext } from "./mobile-session";

export function canSubmitFieldTravel(session: Pick<MobileSessionContext, "recruitmentFunction" | "readOnly" | "isPreview">) {
  return session.recruitmentFunction === "field_recruiter" && !session.readOnly && !session.isPreview;
}

export function maskBankAccount(value: unknown) {
  const account = String(value ?? "").trim();
  if (!account) return "";
  return `${"•".repeat(Math.max(0, Math.min(8, account.length - 4)))}${account.slice(-4)}`;
}

export function fieldTravelSubmissionDay(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
}

export function canSubmitTravelForDutyDay(dutyDate: unknown, now = new Date()) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(dutyDate ?? ""))
    && String(dutyDate) === fieldTravelSubmissionDay(now);
}

export function fieldTravelStatus(request: { status?: unknown; approval_status?: unknown; bank_status?: unknown }) {
  const status = String(request.status ?? "").toLowerCase();
  const approval = String(request.approval_status ?? "").toLowerCase();
  const bank = String(request.bank_status ?? "").toLowerCase();
  if (status === "processed" || bank === "paid" || bank === "success") return "paid";
  if (status === "processing") return "payment_processing";
  if (["failed", "cancelled"].includes(bank) || status === "cancelled") return bank === "failed" ? "failed" : "cancelled";
  if (["rejected", "returned"].includes(status)) return status;
  if (status === "approved" || approval === "approved" || approval.endsWith("_approved")) return "approved";
  if (approval.includes("reporting") || approval.includes("business")) return "pending_reporting_approval";
  return "pending_location_validation";
}

export function validateTravelApprovalChain(input: {
  recruiterProfileId: string;
  locationApproverProfileId?: string | null;
  reportingApproverProfileId?: string | null;
}) {
  const location = String(input.locationApproverProfileId ?? "").trim();
  const reporting = String(input.reportingApproverProfileId ?? "").trim();
  if (!location) throw new Error("No active location travel approver is configured in Approval Master.");
  if (!reporting) throw new Error("The field recruiter does not have a reporting/business approver configured.");
  if (location === input.recruiterProfileId) throw new Error("A field recruiter cannot validate their own travel claim.");
  if (reporting === input.recruiterProfileId) throw new Error("A field recruiter cannot approve their own travel claim.");
  if (location === reporting) throw new Error("Location validation and reporting approval must resolve to two different users.");
  return { locationApproverProfileId: location, reportingApproverProfileId: reporting };
}
