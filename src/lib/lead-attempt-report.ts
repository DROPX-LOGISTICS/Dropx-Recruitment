export type LeadAttemptEvent = {
  created_at: string;
  actor_email?: string | null;
  event_type?: string | null;
  field_name?: string | null;
  old_value?: string | null;
  new_value?: string | null;
  remarks?: string | null;
  lead_id: string;
};

export type LeadAttemptLead = {
  id: string;
  full_name?: string | null;
  phone?: string | null;
  city?: string | null;
  post_code?: string | null;
  remarks?: string | null;
  callback_at?: string | null;
  follow_up_at?: string | null;
  source?: string | null;
  ad_name?: string | null;
  recruitment_locations?: { code?: string | null; name?: string | null } | null;
  recruitment_roles?: { code?: string | null; name?: string | null } | null;
};

export function formatRecruitmentIstDateTime(value?: string | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata"
  }).format(new Date(value)).replace(",", "");
}

export function buildLeadAttemptRows(events: LeadAttemptEvent[], leads: LeadAttemptLead[]) {
  const leadById = new Map(leads.map((lead) => [lead.id, lead]));
  return [...events]
    .sort((left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime())
    .map((event, index) => {
      const lead = leadById.get(event.lead_id);
      return [
        index + 1,
        formatRecruitmentIstDateTime(event.created_at),
        event.actor_email ?? "System",
        lead?.full_name ?? "",
        lead?.phone ?? "",
        [lead?.city, lead?.post_code].filter(Boolean).join(" / "),
        [lead?.recruitment_locations?.code, lead?.recruitment_locations?.name].filter(Boolean).join(" - "),
        lead?.recruitment_roles?.name ?? lead?.recruitment_roles?.code ?? "",
        event.old_value ?? "",
        event.new_value ?? "",
        event.remarks || lead?.remarks || "",
        formatRecruitmentIstDateTime(lead?.callback_at || lead?.follow_up_at),
        lead?.source ?? "",
        lead?.ad_name ?? ""
      ];
    });
}

