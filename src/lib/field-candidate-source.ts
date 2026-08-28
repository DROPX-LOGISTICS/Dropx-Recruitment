export const FIELD_CANDIDATE_STATUSES = [
  "interested",
  "follow_up",
  "interview_scheduled",
  "not_interested",
  "not_eligible",
  "joining_reported"
] as const;

export type FieldCandidateStatus = typeof FIELD_CANDIDATE_STATUSES[number];

export function normalizeFieldCandidatePhone(value: unknown) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : "";
}

export function isFieldCandidateStatus(value: unknown): value is FieldCandidateStatus {
  return FIELD_CANDIDATE_STATUSES.includes(String(value ?? "") as FieldCandidateStatus);
}

export function fieldContactResult(input: unknown) {
  const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const accepted = value.accepted === true;
  const code = String(value.code ?? "");
  if (accepted && code === "CREATED") {
    return { accepted: true as const, contactId: String(value.contactId ?? "") };
  }
  if (code === "DUPLICATE_SYSTEM_LEAD") {
    return {
      accepted: false as const,
      code,
      status: 409,
      message: "This mobile number already exists in the DropX recruitment database. It cannot be added or counted again as a field-sourced lead."
    };
  }
  if (code === "DUPLICATE_FIELD_CONTACT") {
    return {
      accepted: false as const,
      code,
      status: 409,
      message: "This mobile number was already recorded as a field contact. Open My Field Candidates to review its current status."
    };
  }
  if (code === "INVALID_DUTY") {
    return { accepted: false as const, code, status: 409, message: "Your active field duty could not be verified. Refresh the mission and try again." };
  }
  return { accepted: false as const, code: code || "CONTACT_NOT_SAVED", status: 400, message: "This field contact could not be saved." };
}

export function publicAttemptResult(result: string) {
  if (result === "accepted") return "Accepted as unique field source";
  if (result === "duplicate_system") return "Already in recruitment database";
  if (result === "duplicate_field") return "Already submitted in field sourcing";
  return "Not accepted";
}
