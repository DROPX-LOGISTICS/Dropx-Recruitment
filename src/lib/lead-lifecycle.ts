export const leadTransitions: Record<string, readonly string[]> = {
  "": ["assigned", "contacting", "no_response", "call_back", "interested", "not_interested", "not_fit", "long_distance", "wrong_number", "unmapped", "invalid"],
  new: ["assigned", "contacting", "no_response", "call_back", "interested", "not_interested", "not_fit", "long_distance", "wrong_number"],
  unmapped: ["new", "assigned", "invalid"],
  assigned: ["contacting", "no_response", "call_back", "interested", "not_interested", "not_fit", "long_distance", "wrong_number"],
  contacting: ["no_response", "call_back", "interested", "not_interested", "not_fit", "long_distance", "wrong_number"],
  no_response: ["contacting", "call_back", "interested", "not_interested", "not_fit", "closed"],
  call_back: ["contacting", "no_response", "interested", "not_interested", "not_fit", "closed"],
  interested: ["interview_scheduled", "hold", "not_interested", "not_fit"],
  interview_scheduled: ["interview_rescheduled", "interview_completed", "interview_no_show", "selected", "no_response", "call_back", "not_interested", "not_fit", "long_distance"],
  interview_rescheduled: ["interview_scheduled", "interview_completed", "interview_no_show", "selected", "no_response", "call_back", "not_interested", "not_fit", "long_distance"],
  interview_no_show: ["interview_rescheduled", "no_response", "call_back", "rejected", "closed"],
  interview_completed: ["selected", "hold", "rejected"],
  hold: ["interview_scheduled", "selected", "rejected", "closed"],
  selected: ["documents_pending", "offer_pending", "rejected"],
  documents_pending: ["offer_pending", "rejected"],
  offer_pending: ["offered", "rejected"],
  offered: ["joined", "did_not_join"],
  joined: ["archived"],
  did_not_join: ["closed", "archived"],
  rejected: ["closed", "archived"],
  not_interested: ["closed", "archived"],
  not_fit: ["closed", "archived"],
  long_distance: ["closed", "archived"],
  wrong_number: ["closed", "archived"],
  invalid: ["new", "archived"],
  closed: ["archived"],
  archived: []
};

export function canTransition(from: string | null | undefined, to: string) {
  return (leadTransitions[from ?? ""] ?? []).includes(to);
}

export function contactAttemptUpdate(options: {
  nextStatus: string;
  totalAttempts?: number | null;
  noResponseAttempts?: number | null;
  callBackAttempts?: number | null;
  now: string;
}) {
  const fields: Record<string, unknown> = {};
  let actualStatus = options.nextStatus;
  if (!["no_response", "call_back"].includes(options.nextStatus)) {
    return { actualStatus, fields };
  }

  fields.total_attempts = Number(options.totalAttempts || 0) + 1;
  if (options.nextStatus === "no_response") {
    const attempts = Number(options.noResponseAttempts || 0) + 1;
    fields.no_response_attempts = attempts;
    if (attempts >= 5) {
      actualStatus = "archived";
      Object.assign(fields, {
        status: "archived",
        archived: true,
        archived_at: options.now
      });
    }
  } else {
    fields.call_back_attempts = Number(options.callBackAttempts || 0) + 1;
  }
  return { actualStatus, fields };
}
