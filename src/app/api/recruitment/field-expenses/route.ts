import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { lockedFieldDutyLocation } from "@/lib/field-duty-location";
import { parseExpenseReceiptDataUrl } from "@/lib/field-expense";
import { canSubmitFieldTravel, canSubmitTravelForDutyDay, fieldTravelStatus, maskBankAccount, validateTravelApprovalChain } from "@/lib/field-travel";
import { canUseRecruitmentMenu, recruitmentSession, requiredEnv } from "@/lib/recruitment-api";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const paymentBucket = "payment-request-documents";

function safeFileName(value: unknown) {
  return String(value ?? "receipt").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 120) || "receipt";
}

async function uniqueRequestNo(companyId: string) {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const value = randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase();
    const found = await supabaseAdmin.from("payment_requests").select("id")
      .eq("company_id", companyId).eq("request_no", value).maybeSingle();
    if (found.error) throw found.error;
    if (!found.data) return value;
  }
  throw new Error("Unable to generate a unique payment request number.");
}

async function registeredBank(companyId: string, profileId: string, requestedAccountId?: string) {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  const profile = await supabaseAdmin.from("profiles")
    .select("id,employee_id,email,full_name,reports_to_user_id")
    .eq("company_id", companyId).eq("id", profileId).maybeSingle();
  if (profile.error) throw profile.error;
  if (!profile.data) throw new Error("Your DropX user profile is not linked to a workforce profile.");
  const recruiterProfile = profile.data;

  let source: any = null;
  let profileType: "employee" | "field_executive" = "employee";
  if (recruiterProfile.employee_id) {
    const employee = await supabaseAdmin.from("employees")
      .select("id,full_name,bank_account_no,ifsc")
      .eq("company_id", companyId).eq("employee_code", recruiterProfile.employee_id).maybeSingle();
    if (employee.error) throw employee.error;
    source = employee.data;
  }
  if (!source && recruiterProfile.email) {
    const executive = await supabaseAdmin.from("field_executives")
      .select("id,full_name,bank_account_no,ifsc_code")
      .eq("company_id", companyId).ilike("email", recruiterProfile.email).maybeSingle();
    if (executive.error) throw executive.error;
    source = executive.data;
    profileType = "field_executive";
  }
  if (!source) throw new Error("No registered workforce bank profile is linked. Complete your profile in DropX One.");
  const account = String(source.bank_account_no ?? "").trim();
  const ifsc = String(source.ifsc ?? source.ifsc_code ?? "").trim().toUpperCase();
  const verification = await supabaseAdmin.from("connect_profile_verifications")
    .select("verified,manual_review,block_submit,display_name,message")
    .eq("company_id", companyId).eq("profile_type", profileType).eq("account_id", source.id)
    .eq("kind", "bank").maybeSingle();
  if (verification.error) throw verification.error;
  const verificationRow = verification.data;
  const primaryVerified = Boolean(account && ifsc && verificationRow?.verified && !verificationRow.block_submit && !verificationRow.manual_review);
  const primary = primaryVerified ? {
    id: "registered",
    label: "Registered bank account",
    profile: recruiterProfile,
    sourceId: source.id as string,
    profileType,
    account,
    ifsc,
    accountHolder: String(verificationRow?.display_name || source.full_name || recruiterProfile.full_name || "").trim(),
    maskedAccount: maskBankAccount(account),
    payoutAccountId: null as string | null,
    isDefault: false
  } : null;
  const alternates = await supabaseAdmin.from("workforce_payout_accounts")
    .select("id,label,account_holder_name,bank_account_no,ifsc,is_default,verified_at")
    .eq("company_id", companyId).eq("profile_type", profileType).eq("profile_id", source.id)
    .eq("is_active", true).not("verified_at", "is", null).order("is_default", { ascending: false });
  if (alternates.error) throw alternates.error;
  const alternateBanks = (alternates.data ?? []).map((row) => ({
    id: row.id as string,
    label: String(row.label || "Alternate payout account"),
    profile: recruiterProfile,
    sourceId: source.id as string,
    profileType,
    account: String(row.bank_account_no),
    ifsc: String(row.ifsc).toUpperCase(),
    accountHolder: String(row.account_holder_name || recruiterProfile.full_name || ""),
    maskedAccount: maskBankAccount(row.bank_account_no),
    payoutAccountId: row.id as string,
    isDefault: row.is_default === true
  }));
  const choices = [...(primary ? [primary] : []), ...alternateBanks];
  const selected = requestedAccountId
    ? choices.find((row) => row.id === requestedAccountId)
    : alternateBanks.find((row) => row.isDefault) ?? primary ?? alternateBanks[0];
  if (!selected && requestedAccountId) throw new Error("The selected payout account is not available.");
  if (!selected) throw new Error(verificationRow?.message || "No verified payout account is available. Complete bank verification or add an alternate account in DropX One.");
  return { ...selected, choices };
}

async function signedReceipt(path: string | null) {
  if (!supabaseAdmin || !path) return null;
  const signed = await supabaseAdmin.storage.from(paymentBucket).createSignedUrl(path, 15 * 60);
  return signed.error ? null : signed.data.signedUrl;
}

async function claims(companyId: string, profileId: string) {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  const details = await supabaseAdmin.from("field_travel_reimbursements")
    .select("id,payment_request_id,duty_id,expense_type_id,station_id,client_expense_id,distance_meters,gps_coverage_percent,people_contacted,qualified_contacts,receipt_path,receipt_file_name,approval_stage,created_at,field_travel_expense_types(code,name),stations(station_code,station_name),recruitment_field_duties(duty_date,started_at,ended_at,worked_minutes)")
    .eq("company_id", companyId).eq("recruiter_profile_id", profileId).order("created_at", { ascending: false }).limit(100);
  if (details.error) throw details.error;
  const ids = (details.data ?? []).map((row: any) => row.payment_request_id);
  const payments = ids.length ? await supabaseAdmin.from("payment_requests")
    .select("id,request_no,amount,amount_requested,status,approval_status,bank_status,bank_processing_remarks,utr_cin,created_at,updated_at")
    .eq("company_id", companyId).in("id", ids) : { data: [], error: null };
  if (payments.error) throw payments.error;
  const byId = new Map((payments.data ?? []).map((row: any) => [row.id, row]));
  return Promise.all((details.data ?? []).map(async (row: any) => {
    const payment: any = byId.get(row.payment_request_id) ?? {};
    return {
      ...row,
      payment,
      status: fieldTravelStatus(payment),
      receiptUrl: await signedReceipt(row.receipt_path)
    };
  }));
}

export async function GET(request: Request) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase is not configured.");
    const session = await recruitmentSession(request);
    if (!session || session.recruitmentFunction !== "field_recruiter"
      || !canUseRecruitmentMenu(session, "Field Recruitment", "view", "workforce")) {
      return NextResponse.json({ error: "Travel reimbursement is available only to field recruiters." }, { status: 403 });
    }
    const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
    const [types, history] = await Promise.all([
      supabaseAdmin.from("field_travel_expense_types")
        .select("id,code,name,requires_receipt,sort_order").eq("company_id", companyId)
        .eq("is_active", true).order("sort_order"),
      claims(companyId, session.profileId)
    ]);
    if (types.error) throw types.error;
    let bank: { id: string; label: string; maskedAccount: string; ifsc: string; accountHolder: string; verified: true } | null = null;
    let bankAccounts: Array<{ id: string; label: string; maskedAccount: string; ifsc: string; accountHolder: string; isDefault: boolean }> = [];
    let bankAction: string | null = null;
    try {
      const resolved = await registeredBank(companyId, session.profileId);
      bank = { id: resolved.id, label: resolved.label, maskedAccount: resolved.maskedAccount, ifsc: resolved.ifsc, accountHolder: resolved.accountHolder, verified: true };
      bankAccounts = resolved.choices.map((row) => ({ id: row.id, label: row.label, maskedAccount: row.maskedAccount, ifsc: row.ifsc, accountHolder: row.accountHolder, isDefault: row.id === resolved.id }));
    } catch (error) {
      bankAction = error instanceof Error ? error.message : "Complete bank verification in DropX One.";
    }
    return NextResponse.json({ expenseTypes: types.data ?? [], expenses: history, bank, bankAccounts, bankAction, sameDayOnly: true, manageAccountsUrl: "https://connect.dropxlogistics.com" });
  } catch (error) {
    console.error("Field travel reimbursement read failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load travel reimbursements." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let uploadedPath: string | null = null;
  let paymentRequestId: string | null = null;
  try {
    if (!supabaseAdmin) throw new Error("Supabase is not configured.");
    const session = await recruitmentSession(request);
    if (!session || !canSubmitFieldTravel(session)
      || !canUseRecruitmentMenu(session, "Field Recruitment", "add", "workforce")) {
      return NextResponse.json({ error: "Only the signed-in field recruiter can submit travel reimbursement." }, { status: 403 });
    }
    const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
    const body = await request.json();
    const dutyId = String(body.dutyId ?? "").trim();
    const clientExpenseId = String(body.clientExpenseId ?? "").trim().slice(0, 120);
    const typeId = String(body.expenseTypeId ?? "").trim();
    const amount = Number(body.amount);
    if (!dutyId || !clientExpenseId || !typeId || !Number.isFinite(amount) || amount <= 0 || amount > 100000) {
      return NextResponse.json({ error: "Choose a travel expense type and enter a valid amount." }, { status: 400 });
    }
    const replay = await supabaseAdmin.from("field_travel_reimbursements")
      .select("id,payment_request_id,approval_stage").eq("company_id", companyId)
      .eq("recruiter_profile_id", session.profileId).eq("client_expense_id", clientExpenseId).maybeSingle();
    if (replay.error) throw replay.error;
    if (replay.data) return NextResponse.json({ expense: replay.data, replayed: true });

    const [duty, expenseType, bank] = await Promise.all([
      supabaseAdmin.from("recruitment_field_duties")
        .select("id,duty_date,status,started_at,punch_out_at,primary_location_id,primary_station_id,primary_location_code,primary_location_name,distance_meters,gps_coverage_percent,gps_point_count")
        .eq("company_id", companyId).eq("id", dutyId).eq("recruiter_profile_id", session.profileId).maybeSingle(),
      supabaseAdmin.from("field_travel_expense_types").select("id,code,name,requires_receipt")
        .eq("company_id", companyId).eq("id", typeId).eq("is_active", true).maybeSingle(),
      registeredBank(companyId, session.profileId, String(body.payoutAccountId ?? "").trim() || undefined)
    ]);
    if (duty.error) throw duty.error;
    if (expenseType.error) throw expenseType.error;
    if (!duty.data || duty.data.status !== "completed" || !duty.data.punch_out_at) {
      return NextResponse.json({ error: "Close duty with a verified biometric or approved manual OUT before submitting travel reimbursement." }, { status: 409 });
    }
    if (!canSubmitTravelForDutyDay(duty.data.duty_date)) {
      return NextResponse.json({
        error: "Travel reimbursement must be submitted on the same calendar day as the field duty. Previous-day claims are locked."
      }, { status: 409 });
    }
    if (!expenseType.data) return NextResponse.json({ error: "This travel expense type is no longer active." }, { status: 400 });

    const lockedLocation = lockedFieldDutyLocation(duty.data);
    const recruitmentLocationId = lockedLocation.locationId ?? "";
    if (!recruitmentLocationId) {
      return NextResponse.json({
        error: `The locked duty location (${duty.data.primary_location_name || "unlisted location"}) is not mapped to Station Master. Ask your manager to map it before reimbursement.`
      }, { status: 409 });
    }
    const location = await supabaseAdmin.from("recruitment_locations").select("id,code,name")
      .eq("company_id", companyId).eq("id", recruitmentLocationId).eq("is_active", true).maybeSingle();
    if (location.error) throw location.error;
    if (!location.data) throw new Error("The selected recruitment location is not active.");
    let stationQuery = supabaseAdmin.from("stations").select("id,station_code,station_name")
      .eq("company_id", companyId).eq("is_active", true);
    stationQuery = duty.data.primary_station_id
      ? stationQuery.eq("id", duty.data.primary_station_id)
      : stationQuery.ilike("station_code", location.data.code);
    const station = await stationQuery.maybeSingle();
    if (station.error) throw station.error;
    if (!station.data) throw new Error("The assigned recruitment location is not mapped to a Main Dashboard station.");

    const assignment = await supabaseAdmin.from("field_travel_approval_assignments")
      .select("approver_profile_id").eq("company_id", companyId).eq("station_id", station.data.id)
      .eq("is_active", true).maybeSingle();
    if (assignment.error) throw assignment.error;
    let reportingApproverId = bank.profile.reports_to_user_id as string | null;
    if (reportingApproverId && reportingApproverId === assignment.data?.approver_profile_id) {
      const escalation = await supabaseAdmin.from("profiles").select("reports_to_user_id")
        .eq("company_id", companyId).eq("id", reportingApproverId).eq("is_active", true).maybeSingle();
      if (escalation.error) throw escalation.error;
      reportingApproverId = escalation.data?.reports_to_user_id ?? null;
    }
    const chain = validateTravelApprovalChain({
      recruiterProfileId: session.profileId,
      locationApproverProfileId: assignment.data?.approver_profile_id,
      reportingApproverProfileId: reportingApproverId
    });
    const [locationApprover, reportingApprover, head] = await Promise.all([
      supabaseAdmin.from("profiles").select("id,role_id,is_active").eq("company_id", companyId).eq("id", chain.locationApproverProfileId).maybeSingle(),
      supabaseAdmin.from("profiles").select("id,role_id,is_active").eq("company_id", companyId).eq("id", chain.reportingApproverProfileId).maybeSingle(),
      supabaseAdmin.from("payment_heads").select("id,final_approval_role_id,final_approval_role_ids,payment_process_role_ids")
        .eq("company_id", companyId).eq("code", "FIELD_TRAVEL_REIMBURSEMENT").eq("is_active", true).maybeSingle()
    ]);
    if (locationApprover.error || reportingApprover.error || head.error) throw locationApprover.error ?? reportingApprover.error ?? head.error;
    if (!locationApprover.data?.is_active || !reportingApprover.data?.is_active) throw new Error("A configured travel approver is inactive. Update Approval Master.");
    if (!head.data) throw new Error("Field travel payment head is not configured.");
    const finalRoleIds = head.data.final_approval_role_ids?.length
      ? head.data.final_approval_role_ids : head.data.final_approval_role_id ? [head.data.final_approval_role_id] : [];
    if (!finalRoleIds.length || !head.data.payment_process_role_ids?.length) {
      throw new Error("Final approval and payment processing roles must be configured for Field Travel Reimbursement.");
    }

    const receipt = parseExpenseReceiptDataUrl(body.receiptDataUrl);
    if (expenseType.data.requires_receipt && !receipt.bytes.length) throw new Error("A receipt or ticket is required.");
    const fileName = safeFileName(body.fileName || `${expenseType.data.code}.jpg`);
    uploadedPath = `${companyId}/field-travel/${session.profileId}/${dutyId}/${clientExpenseId}-${fileName}`;
    const upload = await supabaseAdmin.storage.from(paymentBucket).upload(uploadedPath, receipt.bytes, {
      contentType: receipt.contentType, upsert: false
    });
    if (upload.error) throw upload.error;

    const contacts = await supabaseAdmin.from("recruitment_field_contacts")
      .select("id,outcome").eq("company_id", companyId).eq("duty_id", dutyId);
    if (contacts.error) throw contacts.error;
    const requestNo = await uniqueRequestNo(companyId);
    const now = new Date().toISOString();
    const payment = await supabaseAdmin.from("payment_requests").insert({
      company_id: companyId,
      request_no: requestNo,
      location_id: station.data.id,
      location_code: station.data.station_code,
      station_code: station.data.station_code,
      payment_head_id: head.data.id,
      category: "expense",
      work_date: duty.data.duty_date,
      requested_for_name: session.displayName,
      amount,
      amount_requested: amount,
      payment_mode: "account_transfer",
      bank_account_no: bank.account,
      ifsc: bank.ifsc,
      account_holder_name: bank.accountHolder,
      beneficiary_account_no: bank.account,
      beneficiary_account_number: bank.account,
      beneficiary_ifsc: bank.ifsc,
      beneficiary_account_holder: bank.accountHolder,
      email: session.email,
      remarks: String(body.remarks ?? "").trim() || `${expenseType.data.name} for field duty ${duty.data.duty_date}`,
      supporting_document_path: uploadedPath,
      status: "pending",
      approval_status: "PENDING_LOCATION_VALIDATION",
      current_step_order: 1,
      current_approver_user_id: locationApprover.data.id,
      current_approver_role_id: locationApprover.data.role_id,
      final_approval_role_id: finalRoleIds[0],
      final_approval_role_ids: finalRoleIds,
      payment_process_role_ids: head.data.payment_process_role_ids,
      requested_by: session.profileId,
      source_system: "recruitment_field_travel",
      source_record_id: `${session.profileId}:${clientExpenseId}`,
      updated_at: now
    }).select("id,request_no,status,approval_status").single();
    if (payment.error) throw payment.error;
    paymentRequestId = payment.data.id;
    const qualified = (contacts.data ?? []).filter((row: any) => ["interview_scheduled", "joined", "qualified"].includes(row.outcome)).length;
    const saved = await supabaseAdmin.from("field_travel_reimbursements").insert({
      company_id: companyId,
      payment_request_id: payment.data.id,
      duty_id: dutyId,
      recruiter_profile_id: session.profileId,
      expense_type_id: expenseType.data.id,
      station_id: station.data.id,
      recruitment_location_id: location.data.id,
      client_expense_id: clientExpenseId,
      distance_meters: duty.data.distance_meters ?? 0,
      gps_coverage_percent: duty.data.gps_coverage_percent ?? 0,
      people_contacted: contacts.data?.length ?? 0,
      qualified_contacts: qualified,
      route_summary: { gpsPointCount: duty.data.gps_point_count ?? 0, dutyStartedAt: duty.data.started_at },
      receipt_path: uploadedPath,
      receipt_file_name: fileName,
      receipt_mime_type: receipt.contentType,
      bank_source_profile_type: bank.profileType,
      bank_source_profile_id: bank.sourceId,
      payout_account_id: bank.payoutAccountId,
      bank_verified_snapshot: true,
      location_approver_user_id: chain.locationApproverProfileId,
      reporting_approver_user_id: chain.reportingApproverProfileId,
      approval_stage: "location_validation",
      updated_at: now
    }).select("id,payment_request_id,approval_stage").single();
    if (saved.error) throw saved.error;
    return NextResponse.json({
      expense: saved.data,
      payment: payment.data,
      bank: { id: bank.id, label: bank.label, maskedAccount: bank.maskedAccount, ifsc: bank.ifsc, accountHolder: bank.accountHolder }
    }, { status: 201 });
  } catch (error) {
    if (supabaseAdmin && paymentRequestId) {
      try { await supabaseAdmin.from("payment_requests").delete().eq("id", paymentRequestId); } catch { /* best effort */ }
    }
    if (supabaseAdmin && uploadedPath) {
      try { await supabaseAdmin.storage.from(paymentBucket).remove([uploadedPath]); } catch { /* best effort */ }
    }
    console.error("Field travel reimbursement submission failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to submit travel reimbursement." }, { status: 500 });
  }
}

export async function PATCH() {
  return NextResponse.json({ error: "Travel claims are reviewed only in Main Dashboard or OpsPulse." }, { status: 405 });
}
