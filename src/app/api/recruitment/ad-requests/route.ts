import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { canAccessLead, recruitmentSession, requiredEnv } from "@/lib/recruitment-api";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getConnectionConfig } from "@/lib/connection-config";
import {
  getMetaAdBuilderCatalog,
  publishMetaRecruitmentAd,
  type MetaAdDraft,
  type MetaPublishProgress
} from "@/lib/meta-ad-builder";
import { resolveRecruitmentAdAudience } from "@/lib/recruitment-ad-audience";
import { requireMetaFormForDesignation } from "@/lib/meta-form-matching";
import {
  allowedAdRequestLifecycleActions,
  nextAdRequestStatus,
  normalizeAdRequestStatus,
  type AdRequestLifecycleAction
} from "@/lib/ad-request-lifecycle";
import { resolveMetaDailyBudgetTarget } from "@/lib/meta-budget";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Session = NonNullable<Awaited<ReturnType<typeof recruitmentSession>>>;

class AdChangeError extends Error {
  constructor(message: string, readonly metaCode?: number, readonly metaSubcode?: number) {
    super(message);
  }
}

type MetaErrorPayload = {
  success?: boolean;
  error?: {
    message?: string;
    error_user_title?: string;
    error_user_msg?: string;
    code?: number;
    error_subcode?: number;
  };
};

function requestActor(session: Session) {
  return session.email || session.displayName || session.profileId;
}

function requestRaw(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function requestStream(row: any) {
  const relation = Array.isArray(row.recruitment_roles)
    ? row.recruitment_roles[0]
    : row.recruitment_roles;
  return String(relation?.stream || requestRaw(row.raw_payload).stream || "");
}

function isOwnRequest(session: Session, row: any) {
  const raw = requestRaw(row.raw_payload);
  const requestedBy = String(row.requested_by || "").trim().toLowerCase();
  const actors = [session.profileId, session.email, session.displayName]
    .map((item) => String(item || "").trim().toLowerCase())
    .filter(Boolean);
  return String(raw.requestedByProfileId || "") === session.profileId
    || actors.includes(requestedBy);
}

function withinRequestScope(session: Session, row: any) {
  const stream = requestStream(row);
  if (stream === "workforce" && !session.workforce) return false;
  if (stream === "hr" && !session.hr) return false;
  if (!session.allLocations && (!row.location_id || !session.locationIds.includes(row.location_id))) return false;
  if (session.roleIds.length && (!row.role_id || !session.roleIds.includes(row.role_id))) return false;
  return true;
}

function visibleRequest(session: Session, row: any) {
  const permissions = new Set(session.adRequestActions);
  if (isOwnRequest(session, row) && permissions.has("view_own")) return true;
  if (permissions.has("view_all")) {
    const stream = requestStream(row);
    return (stream !== "workforce" || session.workforce) && (stream !== "hr" || session.hr);
  }
  return permissions.has("view_scoped") && withinRequestScope(session, row);
}

function displayRequester(row: any) {
  const raw = requestRaw(row.raw_payload);
  const requestedBy = String(row.requested_by || "");
  return String(raw.requestedByName || raw.requestedByEmail || (
    /^https?:\/\//i.test(requestedBy) ? "Legacy imported request" : requestedBy
  ) || "Unknown requester");
}

function metaFailure(payload: MetaErrorPayload, status: number, target = "change") {
  const detail = payload.error?.error_user_msg
    || payload.error?.error_user_title
    || payload.error?.message
    || `Meta returned HTTP ${status}.`;
  const code = payload.error?.code
    ? ` (Meta code ${payload.error.code}${payload.error.error_subcode ? `/${payload.error.error_subcode}` : ""})`
    : "";
  return new AdChangeError(
    `Meta could not apply the ${target}: ${detail}${code}`,
    payload.error?.code,
    payload.error?.error_subcode
  );
}

async function metaPost(path: string, values: Record<string, string>, target = "change") {
  const config = await getConnectionConfig("meta");
  if (!config?.isEnabled || !config.secrets.access_token) {
    throw new AdChangeError("Meta Lead Ads must be enabled and tested before completing this change.");
  }
  const version = config.publicConfig.graph_version || "v25.0";
  let response: Response;
  try {
    response = await fetch(`https://graph.facebook.com/${version}/${encodeURIComponent(path)}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.secrets.access_token}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams(values),
      cache: "no-store",
      signal: AbortSignal.timeout(25_000)
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new AdChangeError("Meta did not respond within 25 seconds. No local budget was changed; please try again.");
    }
    throw error;
  }
  const payload = await response.json() as MetaErrorPayload;
  if (!response.ok || payload.error || payload.success === false) {
    throw metaFailure(payload, response.status, target);
  }
  return payload;
}

async function metaGet<T>(path: string, fields: string) {
  const config = await getConnectionConfig("meta");
  if (!config?.isEnabled || !config.secrets.access_token) {
    throw new AdChangeError("Meta Lead Ads must be enabled and tested before completing this change.");
  }
  const version = config.publicConfig.graph_version || "v25.0";
  let response: Response;
  try {
    response = await fetch(
      `https://graph.facebook.com/${version}/${encodeURIComponent(path)}?fields=${encodeURIComponent(fields)}`,
      {
        headers: { Authorization: `Bearer ${config.secrets.access_token}` },
        cache: "no-store",
        signal: AbortSignal.timeout(25_000)
      }
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new AdChangeError("Meta did not respond within 25 seconds. No local budget was changed; please try again.");
    }
    throw error;
  }
  const payload = await response.json() as T & MetaErrorPayload;
  if (!response.ok || payload.error) throw metaFailure(payload, response.status, "budget lookup");
  return payload;
}

async function completeMetaChange(companyId: string, requestId: string) {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  const pending = await supabaseAdmin.from("recruitment_ad_requests")
    .select("id,request_type,requested_budget,ad_id,recruitment_ads(id,meta_ad_id,daily_budget,raw_payload)")
    .eq("company_id", companyId)
    .eq("id", requestId)
    .maybeSingle();
  if (pending.error) throw new Error(pending.error.message);
  if (!pending.data) throw new Error("Advertising request was not found.");
  if (!["budget_change", "stop_ad", "resume_ad"].includes(pending.data.request_type)) return;
  const ad = pending.data.recruitment_ads as any;
  if (!ad?.meta_ad_id) throw new AdChangeError("This ad has no Meta Ad ID, so the change cannot be completed automatically.");
  if (pending.data.request_type === "stop_ad") {
    await metaPost(ad.meta_ad_id, { status: "PAUSED" });
    const saved = await supabaseAdmin.from("recruitment_ads").update({
      status: "PAUSED",
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }).eq("company_id", companyId).eq("id", ad.id);
    if (saved.error) throw new Error(saved.error.message);
    return;
  }
  if (pending.data.request_type === "resume_ad") {
    await metaPost(ad.meta_ad_id, { status: "ACTIVE" });
    const saved = await supabaseAdmin.from("recruitment_ads").update({
      status: "ACTIVE",
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }).eq("company_id", companyId).eq("id", ad.id);
    if (saved.error) throw new Error(saved.error.message);
    return;
  }
  const requestedBudget = Number(pending.data.requested_budget || 0);
  if (!(requestedBudget > 0)) throw new AdChangeError("The approved budget is invalid.");
  const raw = ad.raw_payload && typeof ad.raw_payload === "object"
    ? ad.raw_payload as Record<string, unknown>
    : {};
  const liveBudget = await metaGet<{
    status?: string;
    effective_status?: string;
    campaign?: { id?: string; daily_budget?: string; lifetime_budget?: string; status?: string; effective_status?: string };
    adset?: { id?: string; daily_budget?: string; lifetime_budget?: string; status?: string; effective_status?: string };
  }>(ad.meta_ad_id, "status,effective_status,campaign{id,daily_budget,lifetime_budget,status,effective_status},adset{id,daily_budget,lifetime_budget,status,effective_status}");
  const resolution = resolveMetaDailyBudgetTarget({
    campaign: liveBudget.campaign,
    adset: liveBudget.adset,
    fallback: {
      source: raw.budget_source,
      campaignId: raw.campaign_id,
      adsetId: raw.adset_id
    }
  });
  if (!resolution.target && resolution.reason === "lifetime") {
    throw new AdChangeError("This Meta ad uses a lifetime budget, not a daily budget. Change its lifetime schedule in Meta Ads Manager instead.");
  }
  if (!resolution.target) {
    throw new AdChangeError("Meta did not return the campaign or ad-set budget owner for this ad.");
  }
  const budgetOwner = resolution.target.source === "campaign" ? liveBudget.campaign : liveBudget.adset;
  const liveState = String(
    budgetOwner?.effective_status
      || budgetOwner?.status
      || liveBudget.effective_status
      || liveBudget.status
      || ""
  ).toUpperCase();
  const markUnavailable = async (status: "DELETED" | "ARCHIVED") => {
    const unavailable = await supabaseAdmin!.from("recruitment_ads").update({
      status,
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }).eq("company_id", companyId).eq("id", ad.id);
    if (unavailable.error) throw new Error(unavailable.error.message);
  };
  if (["DELETED", "ARCHIVED"].includes(liveState)) {
    const unavailableState = liveState as "DELETED" | "ARCHIVED";
    await markUnavailable(unavailableState);
    throw new AdChangeError(`This Meta ${resolution.target.source === "campaign" ? "campaign" : "ad set"} is ${unavailableState.toLowerCase()} and is no longer an active ad.`);
  }
  const targetLabel = resolution.target.source === "campaign" ? "campaign daily budget" : "ad-set daily budget";
  try {
    await metaPost(
      resolution.target.id,
      { daily_budget: String(Math.round(requestedBudget * 100)) },
      targetLabel
    );
  } catch (error) {
    if (error instanceof AdChangeError && error.metaCode === 100 && error.metaSubcode === 1487566) {
      await markUnavailable("DELETED");
      throw new AdChangeError("This Meta campaign has been deleted and is no longer an active ad.", error.metaCode, error.metaSubcode);
    }
    throw error;
  }
  const saved = await supabaseAdmin.from("recruitment_ads").update({
    daily_budget: requestedBudget,
    last_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }).eq("company_id", companyId).eq("id", ad.id);
  if (saved.error) throw new Error(saved.error.message);
}

export async function GET(request: Request) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase is not configured.");
    const session = await recruitmentSession(request);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const permissions = new Set(session.adRequestActions);
    if (![...permissions].some((item) => item.startsWith("view_"))) {
      return NextResponse.json({ error: "Ad-request visibility is not assigned to this user." }, { status: 403 });
    }
    const url = new URL(request.url);
    const stream = url.searchParams.get("stream");
    if (stream && !["workforce", "hr"].includes(stream)) {
      return NextResponse.json({ error: "Invalid recruitment workspace." }, { status: 400 });
    }
    const query = supabaseAdmin.from("recruitment_ad_requests")
      .select("*, recruitment_locations(code,name), recruitment_roles(code,name,stream), recruitment_ads(ad_name,meta_ad_id,status)")
      .eq("company_id", requiredEnv("RECRUITMENT_COMPANY_ID"))
      .order("requested_at", { ascending: false }).limit(500);
    const result = await query;
    if (result.error) throw new Error(result.error.message);
    const requests = (result.data ?? [])
      .filter((row) => (!stream || requestStream(row) === stream) && visibleRequest(session, row))
      .map((row) => {
        const own = isOwnRequest(session, row);
        const raw = requestRaw(row.raw_payload);
        return {
          ...row,
          status: normalizeAdRequestStatus(row.status),
          requested_by_display: displayRequester(row),
          isMine: own,
          lifecycleHistory: Array.isArray(raw.lifecycleHistory) ? raw.lifecycleHistory : [],
          allowedActions: allowedAdRequestLifecycleActions({
            current: row.status,
            permissions: session.adRequestActions,
            isMine: own
          })
        };
      });
    const counts = requests.reduce<Record<string, number>>((summary, row) => {
      summary[row.status] = (summary[row.status] || 0) + 1;
      return summary;
    }, {});
    return NextResponse.json({
      requests,
      counts,
      permissions: session.adRequestActions,
      isOwner: session.isOwner,
      stream: stream || null
    });
  } catch (error) {
    console.error("Recruitment ad requests failed", error);
    return NextResponse.json({ error: "Unable to load ad requests." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase is not configured.");
    const session = await recruitmentSession(request);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!session.adRequestActions.includes("create")) {
      return NextResponse.json({ error: "Request creation is not assigned to this user." }, { status: 403 });
    }
    const body = await request.json() as Record<string, unknown>;
    const requestType = String(body.requestType ?? "new_ad");
    if (!["new_ad", "budget_change", "stop_ad", "resume_ad"].includes(requestType)) return NextResponse.json({ error: "Invalid request type." }, { status: 400 });
    if (requestType === "new_ad" && (!body.locationId || !body.roleId)) return NextResponse.json({ error: "Station and designation are required." }, { status: 400 });
    if (requestType === "new_ad" && !(Number(body.requestedBudget) >= 100)) {
      return NextResponse.json({ error: "Daily budget must be at least ₹100." }, { status: 400 });
    }
    if (requestType === "new_ad" && (!(Number(body.daysRequired) >= 1) || Number(body.daysRequired) > 90)) {
      return NextResponse.json({ error: "Duration must be between 1 and 90 days." }, { status: 400 });
    }
    if (requestType === "new_ad") {
      try {
        const posterUrl = new URL(String(body.posterUrl || ""));
        if (posterUrl.protocol !== "https:") throw new Error("HTTPS required");
      } catch {
        return NextResponse.json({ error: "Add a complete HTTPS poster link for review." }, { status: 400 });
      }
    }
    if (requestType !== "new_ad" && !body.adId) return NextResponse.json({ error: "Choose an existing ad." }, { status: 400 });
    if (requestType === "budget_change" && !(Number(body.requestedBudget) > 0)) {
      return NextResponse.json({ error: "Enter the requested daily budget." }, { status: 400 });
    }
    if (["stop_ad", "resume_ad"].includes(requestType) && !String(body.reason ?? "").trim()) {
      return NextResponse.json({ error: `Enter the reason for ${requestType === "resume_ad" ? "resuming" : "pausing"} the ad.` }, { status: 400 });
    }
    const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
    let requestWorkspace = "";
    if (requestType === "new_ad") {
      const [location, role] = await Promise.all([
        supabaseAdmin.from("recruitment_locations").select("id")
          .eq("company_id", companyId).eq("id", String(body.locationId)).maybeSingle(),
        supabaseAdmin.from("recruitment_roles").select("id,stream")
          .eq("company_id", companyId).eq("id", String(body.roleId)).maybeSingle()
      ]);
      if (location.error || role.error) throw new Error(location.error?.message || role.error?.message);
      if (!location.data || !role.data) return NextResponse.json({ error: "The selected station or designation was not found." }, { status: 404 });
      if (!canAccessLead(session, {
        location_id: location.data.id,
        role_id: role.data.id,
        stream: role.data.stream
      })) return NextResponse.json({ error: "You cannot request an ad outside your assigned recruitment scope." }, { status: 403 });
      requestWorkspace = String(role.data.stream);
    } else {
      const ad = await supabaseAdmin.from("recruitment_ads").select("id,location_id,role_id,recruitment_roles(stream)")
        .eq("company_id", companyId).eq("id", String(body.adId)).maybeSingle();
      if (ad.error) throw new Error(ad.error.message);
      if (!ad.data) return NextResponse.json({ error: "The selected ad was not found." }, { status: 404 });
      const role = ad.data.recruitment_roles as { stream?: string | null } | null;
      if (!canAccessLead(session, {
        location_id: ad.data.location_id,
        role_id: ad.data.role_id,
        stream: role?.stream
      })) return NextResponse.json({ error: "You cannot request a change outside your assigned recruitment scope." }, { status: 403 });
      requestWorkspace = String(role?.stream || "");
    }
    const now = new Date().toISOString();
    const requestId = `AR-${Date.now()}-${randomUUID().slice(0, 6).toUpperCase()}`;
    const actor = requestActor(session);
    const rawPayload = {
      ...body,
      stream: requestWorkspace,
      requestedByProfileId: session.profileId,
      requestedByName: session.displayName,
      requestedByEmail: session.email,
      lifecycleHistory: [{
        action: "submit",
        from: null,
        to: "requested",
        at: now,
        actorProfileId: session.profileId,
        actorName: session.displayName,
        actorEmail: session.email,
        remarks: String(body.notes || "").trim() || null
      }]
    };
    const saved = await supabaseAdmin.from("recruitment_ad_requests").insert({
      company_id: companyId, request_id: requestId, request_type: requestType,
      ad_id: body.adId || null, location_id: body.locationId || null, role_id: body.roleId || null,
      status: "requested", requested_budget: body.requestedBudget || null, old_budget: body.oldBudget || null,
      days_required: body.daysRequired || null, payment_offer: body.paymentOffer || null,
      location_details: body.locationDetails || null, poster_url: body.posterUrl || null,
      notes: body.notes || null, reason: body.reason || null, requested_by: actor,
      requested_at: now, raw_payload: rawPayload, updated_at: now
    }).select("*").single();
    if (saved.error) throw new Error(saved.error.message);
    const canActDirectly = session.isOwner
      || (session.adRequestActions.includes("approve") && session.adRequestActions.includes("publish"));
    if (canActDirectly && requestType !== "new_ad") {
      try {
        await completeMetaChange(companyId, saved.data.id);
      } catch (error) {
        const failedAt = new Date().toISOString();
        const failedRaw = requestRaw(saved.data.raw_payload);
        const failureMessage = error instanceof AdChangeError
          ? error.message
          : "The direct Meta change could not be completed.";
        const failed = await supabaseAdmin.from("recruitment_ad_requests").update({
          status: "cancelled",
          admin_remarks: failureMessage,
          raw_payload: {
            ...failedRaw,
            lifecycleHistory: [
              ...(Array.isArray(failedRaw.lifecycleHistory) ? failedRaw.lifecycleHistory : []),
              {
                action: "direct_apply_failed", from: "requested", to: "cancelled", at: failedAt,
                actorProfileId: session.profileId, actorName: session.displayName, actorEmail: session.email,
                remarks: failureMessage
              }
            ]
          },
          updated_at: failedAt
        }).eq("company_id", companyId).eq("id", saved.data.id);
        if (failed.error) console.error("Unable to close failed direct ad request", failed.error);
        throw error;
      }
      const completedAt = new Date().toISOString();
      const completedRaw = requestRaw(saved.data.raw_payload);
      const completed = await supabaseAdmin.from("recruitment_ad_requests").update({
        status: "completed",
        admin_remarks: "Applied directly by an authorised recruitment administrator.",
        raw_payload: {
          ...completedRaw,
          lifecycleHistory: [
            ...(Array.isArray(completedRaw.lifecycleHistory) ? completedRaw.lifecycleHistory : []),
            {
              action: "direct_apply", from: "requested", to: "completed", at: completedAt,
              actorProfileId: session.profileId, actorName: session.displayName, actorEmail: session.email,
              remarks: "Applied directly; approval was not required."
            }
          ]
        },
        updated_at: completedAt
      }).eq("company_id", companyId).eq("id", saved.data.id).select("*").single();
      if (completed.error) throw new Error(completed.error.message);
      return NextResponse.json({ request: completed.data, appliedDirectly: true }, { status: 201 });
    }
    return NextResponse.json({ request: saved.data }, { status: 201 });
  } catch (error) {
    console.error("Recruitment ad request create failed", error);
    if (error instanceof AdChangeError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Unable to create ad request." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase is not configured.");
    const session = await recruitmentSession(request);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await request.json() as Record<string, unknown>;
    const id = String(body.id ?? "");
    const legacyAction: Record<string, AdRequestLifecycleAction> = {
      approved: "approve",
      rejected: "reject",
      completed: "complete",
      cancelled: "cancel"
    };
    const action = String(body.action ?? legacyAction[String(body.status ?? "")] ?? "") as AdRequestLifecycleAction;
    if (!id || !["review", "approve", "reject", "publish", "complete", "cancel"].includes(action)) {
      return NextResponse.json({ error: "Choose a valid request action." }, { status: 400 });
    }
    const remarks = String(body.remarks ?? body.adminRemarks ?? "").trim();
    if (action === "reject" && !remarks) {
      return NextResponse.json({ error: "A rejection reason is required." }, { status: 400 });
    }
    const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
    const current = await supabaseAdmin.from("recruitment_ad_requests")
      .select("*, recruitment_locations(code,name), recruitment_roles(code,name,stream), recruitment_ads(id,ad_name,meta_ad_id,status)")
      .eq("company_id", companyId)
      .eq("id", id)
      .maybeSingle();
    if (current.error) throw new Error(current.error.message);
    if (!current.data) return NextResponse.json({ error: "Advertising request was not found." }, { status: 404 });
    if (!visibleRequest(session, current.data)) {
      return NextResponse.json({ error: "This request is outside your assigned visibility." }, { status: 403 });
    }
    const own = isOwnRequest(session, current.data);
    const allowed = allowedAdRequestLifecycleActions({
      current: current.data.status,
      permissions: session.adRequestActions,
      isMine: own
    });
    if (!allowed.includes(action)) {
      return NextResponse.json({ error: "This action is not assigned to you or is not valid at the current stage." }, { status: 403 });
    }
    const nextStatus = nextAdRequestStatus(current.data.status, action);
    if (!nextStatus) {
      return NextResponse.json({ error: "This request cannot move to the selected stage." }, { status: 400 });
    }

    const raw = requestRaw(current.data.raw_payload);
    let finalRaw = raw;
    let publishedMetaAdId = String(body.metaAdId ?? "").trim() || null;
    let publishedUrl = String(body.publishedUrl ?? "").trim() || null;
    let publishedAdId = current.data.ad_id as string | null;
    if (action === "approve" || action === "publish") {
      if (current.data.request_type === "new_ad") {
        const location = Array.isArray(current.data.recruitment_locations)
          ? current.data.recruitment_locations[0]
          : current.data.recruitment_locations;
        const role = Array.isArray(current.data.recruitment_roles)
          ? current.data.recruitment_roles[0]
          : current.data.recruitment_roles;
        const code = `${location?.code || "UNMAPPED"}_${role?.code || "ROLE"}`;
        const publishMode = String(body.publishMode || "manual");
        let adName = code;
        let adSetName: string | null = null;
        let campaignName: string | null = null;
        let metaFormId: string | null = null;
        let metaProgress: MetaPublishProgress | null = null;
        let adStatus = "ACTIVE";

        if (publishMode === "api") {
          const sourceDraft = body.metaDraft && typeof body.metaDraft === "object" && !Array.isArray(body.metaDraft)
            ? body.metaDraft as Record<string, unknown>
            : {};
          const approvedBudget = Number(current.data.requested_budget || sourceDraft.dailyBudget || 0);
          const approvedDays = Number(current.data.days_required || sourceDraft.daysRequired || 0);
          const dateCode = new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit"
          }).format(new Date()).replaceAll("-", "");
          const audience = await resolveRecruitmentAdAudience({
            companyId,
            locationId: String(current.data.location_id || ""),
            radiusKm: sourceDraft.audienceRadiusKm
          });
          const draft = {
            campaignMode: sourceDraft.campaignMode === "existing" ? "existing" : "new",
            campaignId: String(sourceDraft.campaignId || "").trim() || null,
            campaignName: String(sourceDraft.campaignName || `${code} Recruitment`).trim(),
            formId: String(sourceDraft.formId || "").trim(),
            dailyBudget: approvedBudget,
            daysRequired: approvedDays,
            adName: String(sourceDraft.adName || `${code}_${dateCode}`).trim(),
            adSetName: String(sourceDraft.adSetName || `${code}_Local_${audience.radiusKm}KM`).trim(),
            creativeName: String(sourceDraft.creativeName || `${code}_Creative_${dateCode}`).trim(),
            primaryText: String(sourceDraft.primaryText || "").trim(),
            headline: String(sourceDraft.headline || "").trim(),
            description: String(sourceDraft.description || "").trim() || null,
            posterUrl: String(current.data.poster_url || sourceDraft.posterUrl || "").trim(),
            destinationUrl: String(sourceDraft.destinationUrl || "").trim(),
            callToAction: ["APPLY_NOW", "SIGN_UP", "LEARN_MORE"].includes(String(sourceDraft.callToAction))
              ? String(sourceDraft.callToAction)
              : "APPLY_NOW",
            audience
          } as MetaAdDraft;
          const catalog = await getMetaAdBuilderCatalog();
          requireMetaFormForDesignation(draft.formId, catalog.forms, role || {});
          const previousPublish = raw.metaPublish && typeof raw.metaPublish === "object" && !Array.isArray(raw.metaPublish)
            ? raw.metaPublish as Record<string, unknown>
            : {};
          if (previousPublish.status === "publishing") {
            const lockedAt = new Date(String(previousPublish.lockedAt || "")).getTime();
            if (Number.isFinite(lockedAt) && Date.now() - lockedAt < 5 * 60_000) {
              return NextResponse.json({ error: "This ad is already being created in Meta. Wait a moment and refresh." }, { status: 409 });
            }
          }
          const previousProgress = previousPublish.progress && typeof previousPublish.progress === "object"
            ? previousPublish.progress as MetaPublishProgress
            : {};
          let latestProgress: MetaPublishProgress = { ...previousProgress };
          const lockedAt = new Date().toISOString();
          const savePublishState = async (status: string, progress: MetaPublishProgress, error?: string) => {
            const nextRaw = {
              ...raw,
              metaPublish: {
                status,
                lockedAt,
                updatedAt: new Date().toISOString(),
                actorProfileId: session.profileId,
                actorName: session.displayName,
                progress,
                draft: { ...draft, primaryText: draft.primaryText, description: draft.description },
                error: error || null
              }
            };
            const checkpoint = await supabaseAdmin!.from("recruitment_ad_requests")
              .update({ raw_payload: nextRaw, updated_at: new Date().toISOString() })
              .eq("company_id", companyId).eq("id", id);
            if (checkpoint.error) throw new Error(checkpoint.error.message);
            finalRaw = nextRaw;
          };
          await savePublishState("publishing", previousProgress);
          try {
            const result = await publishMetaRecruitmentAd({
              draft,
              progress: previousProgress,
              onProgress: async (progress) => {
                latestProgress = progress;
                await savePublishState("publishing", progress);
              }
            });
            metaProgress = result.progress;
            publishedMetaAdId = result.progress.adId || null;
            adName = result.draft.adName;
            adSetName = result.draft.adSetName;
            campaignName = result.draft.campaignMode === "existing"
              ? String(sourceDraft.campaignName || "Existing Meta lead campaign")
              : String(result.draft.campaignName || "");
            metaFormId = result.draft.formId;
            adStatus = "PAUSED";
            await savePublishState("created_paused", result.progress);
          } catch (error) {
            await savePublishState(
              "failed",
              metaProgress || latestProgress,
              error instanceof Error ? error.message : "Meta ad creation failed."
            );
            throw error;
          }
        } else if (!publishedMetaAdId && !publishedUrl) {
          return NextResponse.json({
            error: "Create the ad through Meta API or enter a Meta Ad ID / published URL as fallback."
          }, { status: 400 });
        }

        const adValues = {
          company_id: companyId,
          meta_ad_id: publishedMetaAdId,
          meta_form_id: metaFormId,
          ad_name: adName,
          adset_name: adSetName,
          campaign_name: campaignName,
          location_id: current.data.location_id,
          role_id: current.data.role_id,
          route_status: current.data.location_id && current.data.role_id ? "mapped" : "unmapped",
          status: adStatus,
          daily_budget: current.data.requested_budget,
          poster_url: current.data.poster_url || publishedUrl,
          raw_payload: {
            source: "ad_request",
            ad_request_id: current.data.id,
            request_id: current.data.request_id,
            published_url: publishedUrl,
            campaign_id: metaProgress?.campaignId || null,
            adset_id: metaProgress?.adSetId || null,
            creative_id: metaProgress?.creativeId || null,
            created_via: publishMode === "api" ? "meta_marketing_api" : "manual",
            initial_status: adStatus,
            audience: publishMode === "api"
              ? (finalRaw.metaPublish as Record<string, any> | undefined)?.draft?.audience || null
              : null
          },
          created_on: new Date().toISOString(),
          last_synced_at: publishedMetaAdId ? new Date().toISOString() : null,
          updated_at: new Date().toISOString()
        };
        let adResult;
        if (publishedMetaAdId) {
          const existing = await supabaseAdmin.from("recruitment_ads")
            .select("id")
            .eq("company_id", companyId)
            .eq("meta_ad_id", publishedMetaAdId)
            .maybeSingle();
          if (existing.error) throw new Error(existing.error.message);
          adResult = existing.data
            ? await supabaseAdmin.from("recruitment_ads").update(adValues).eq("id", existing.data.id).select("id").single()
            : await supabaseAdmin.from("recruitment_ads").insert(adValues).select("id").single();
        } else {
          adResult = await supabaseAdmin.from("recruitment_ads").insert(adValues).select("id").single();
        }
        if (adResult.error) throw new Error(adResult.error.message);
        publishedAdId = adResult.data.id;
      } else {
        await completeMetaChange(companyId, id);
      }
    }

    const now = new Date().toISOString();
    const lifecycleHistory = Array.isArray(raw.lifecycleHistory) ? raw.lifecycleHistory : [];
    const saved = await supabaseAdmin.from("recruitment_ad_requests")
      .update({
        status: nextStatus,
        ad_id: publishedAdId,
        admin_remarks: remarks || null,
        raw_payload: {
          ...finalRaw,
          lifecycleHistory: [
            ...lifecycleHistory,
            {
              action,
              from: normalizeAdRequestStatus(current.data.status),
              to: nextStatus,
              at: now,
              actorProfileId: session.profileId,
              actorName: session.displayName,
              actorEmail: session.email,
              remarks: remarks || null,
              metaAdId: publishedMetaAdId,
              publishedUrl
            }
          ]
        },
        updated_at: now
      })
      .eq("company_id", companyId).eq("id", id).select("*").single();
    if (saved.error) throw new Error(saved.error.message);
    return NextResponse.json({ request: saved.data });
  } catch (error) {
    console.error("Recruitment ad request update failed", error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Unable to update ad request."
    }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase is not configured.");
    const session = await recruitmentSession(request);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!session.isOwner) {
      return NextResponse.json({ error: "Only the Owner can clear legacy advertising requests." }, { status: 403 });
    }

    const url = new URL(request.url);
    if (url.searchParams.get("scope") !== "legacy") {
      return NextResponse.json({ error: "Only the legacy request cleanup scope is supported." }, { status: 400 });
    }

    const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
    const legacy = await supabaseAdmin.from("recruitment_ad_requests")
      .select("id,request_id,status,requested_at")
      .eq("company_id", companyId)
      .like("request_id", "ADR-%")
      .order("requested_at", { ascending: false });
    if (legacy.error) throw new Error(legacy.error.message);

    const rows = legacy.data ?? [];
    if (url.searchParams.get("confirm") !== "yes") {
      return NextResponse.json({
        scope: "legacy",
        dryRun: true,
        count: rows.length,
        requestIds: rows.map((row) => row.request_id)
      });
    }

    if (!rows.length) {
      return NextResponse.json({ scope: "legacy", deleted: 0 });
    }

    const deleted = await supabaseAdmin.from("recruitment_ad_requests")
      .delete()
      .eq("company_id", companyId)
      .in("id", rows.map((row) => row.id))
      .select("id");
    if (deleted.error) throw new Error(deleted.error.message);

    return NextResponse.json({
      scope: "legacy",
      deleted: deleted.data?.length ?? 0
    });
  } catch (error) {
    console.error("Recruitment legacy ad request cleanup failed", error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Unable to clear legacy advertising requests."
    }, { status: 400 });
  }
}
