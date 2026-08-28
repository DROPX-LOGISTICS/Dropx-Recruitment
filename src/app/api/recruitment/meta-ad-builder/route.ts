import { NextResponse } from "next/server";
import {
  canAccessLead,
  canUseRecruitmentMenu,
  recruitmentSession,
  requiredEnv
} from "@/lib/recruitment-api";
import {
  getMetaAdBuilderCatalog,
  publishMetaRecruitmentAd,
  setMetaObjectStatus,
  validateMetaAdDraft,
  type MetaAdDraft,
  type MetaPublishProgress
} from "@/lib/meta-ad-builder";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { resolveRecruitmentAdAudience } from "@/lib/recruitment-ad-audience";
import { requireMetaFormForDesignation } from "@/lib/meta-form-matching";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

type Workspace = "workforce" | "hr";

function workspaceFrom(value: unknown): Workspace | null {
  return value === "workforce" || value === "hr" ? value : null;
}

function directPublishAccess(
  session: NonNullable<Awaited<ReturnType<typeof recruitmentSession>>>,
  workspace: Workspace
) {
  return canUseRecruitmentMenu(session, "Active Ads", "all", workspace);
}

export async function GET(request: Request) {
  try {
    const session = await recruitmentSession(request);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const url = new URL(request.url);
    const workspace = workspaceFrom(url.searchParams.get("stream"));
    const allowed = workspace
      ? directPublishAccess(session, workspace)
      : session.adRequestActions.includes("publish");
    if (!allowed) {
      return NextResponse.json({ error: "Meta publishing access is not assigned to this user." }, { status: 403 });
    }
    const locationId = String(url.searchParams.get("locationId") || "").trim();
    if (locationId && !session.allLocations && !session.locationIds.includes(locationId)) {
      return NextResponse.json({ error: "The selected station is outside your assigned scope." }, { status: 403 });
    }
    const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
    if (url.searchParams.get("audienceOnly") === "true") {
      if (!locationId) {
        return NextResponse.json({ error: "Choose a station before checking its audience." }, { status: 400 });
      }
      const audience = await resolveRecruitmentAdAudience({ companyId, locationId });
      return NextResponse.json({ audience });
    }
    const [catalog, audience] = await Promise.all([
      getMetaAdBuilderCatalog(),
      locationId
        ? resolveRecruitmentAdAudience({ companyId, locationId })
        : Promise.resolve(null)
    ]);
    return NextResponse.json({ catalog, audience });
  } catch (error) {
    console.error("Meta ad builder catalog failed", error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Unable to load Meta ad setup."
    }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase is not configured.");
    const session = await recruitmentSession(request);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await request.json() as Record<string, unknown>;
    const workspace = workspaceFrom(body.stream);
    if (!workspace) return NextResponse.json({ error: "Choose Workforce or HR." }, { status: 400 });
    if (!directPublishAccess(session, workspace)) {
      return NextResponse.json({ error: `Direct Meta publishing is not assigned for ${workspace === "hr" ? "HR" : "Workforce"}.` }, { status: 403 });
    }

    const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
    const locationId = String(body.locationId || "").trim();
    const roleId = String(body.roleId || "").trim();
    if (!locationId || !roleId) {
      return NextResponse.json({ error: "Choose a station and designation." }, { status: 400 });
    }
    const [locationResult, roleResult] = await Promise.all([
      supabaseAdmin.from("recruitment_locations").select("id,code,name")
        .eq("company_id", companyId).eq("id", locationId).eq("is_active", true).maybeSingle(),
      supabaseAdmin.from("recruitment_roles").select("id,code,name,stream")
        .eq("company_id", companyId).eq("id", roleId).eq("is_active", true).maybeSingle()
    ]);
    if (locationResult.error || roleResult.error) {
      throw new Error(locationResult.error?.message || roleResult.error?.message);
    }
    if (!locationResult.data || !roleResult.data) {
      return NextResponse.json({ error: "The selected station or designation is no longer active." }, { status: 400 });
    }
    if (roleResult.data.stream !== workspace) {
      return NextResponse.json({ error: "The designation does not belong to this workspace." }, { status: 400 });
    }
    if (!canAccessLead(session, { stream: workspace, location_id: locationId, role_id: roleId })) {
      return NextResponse.json({ error: "The selected station or designation is outside your assigned scope." }, { status: 403 });
    }

    const sourceDraft = body.draft && typeof body.draft === "object" && !Array.isArray(body.draft)
      ? body.draft as Record<string, unknown>
      : null;
    if (!sourceDraft) return NextResponse.json({ error: "Ad setup is missing." }, { status: 400 });
    const audience = await resolveRecruitmentAdAudience({
      companyId,
      locationId,
      radiusKm: sourceDraft.audienceRadiusKm
    });
    const draft = validateMetaAdDraft({ ...sourceDraft, audience } as MetaAdDraft);
    const stationCode = String(locationResult.data.code || "").trim().toUpperCase();
    const roleCode = String(roleResult.data.code || "").trim().toUpperCase();
    const escapedPrefix = `${stationCode}_${roleCode}_`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!new RegExp(`^${escapedPrefix}\\d{8}(?:_\\d{2})?$`).test(draft.adName)) {
      return NextResponse.json({
        error: `Ad name must follow ${stationCode}_${roleCode}_YYYYMMDD (optional _02 for another ad on the same day).`
      }, { status: 400 });
    }
    const launchMode = body.launchMode === "live" ? "live" : "paused";
    if (launchMode === "live" && body.confirmLive !== true) {
      return NextResponse.json({ error: "Confirm that this ad should start spending immediately." }, { status: 400 });
    }

    const catalog = await getMetaAdBuilderCatalog();
    requireMetaFormForDesignation(draft.formId, catalog.forms, roleResult.data);
    const selectedCampaign = draft.campaignMode === "existing"
      ? catalog.campaigns.find((campaign) => campaign.id === draft.campaignId)
      : null;
    if (draft.campaignMode === "existing" && !selectedCampaign) {
      return NextResponse.json({ error: "Choose a valid Employment Leads campaign." }, { status: 400 });
    }
    if (launchMode === "live" && selectedCampaign && selectedCampaign.effectiveStatus !== "ACTIVE") {
      return NextResponse.json({
        error: "The selected campaign is not active. Choose an active campaign or create a new campaign for a live launch."
      }, { status: 400 });
    }
    const review = {
      workspace,
      station: `${locationResult.data.code} — ${locationResult.data.name}`,
      designation: `${roleResult.data.code} — ${roleResult.data.name}`,
      campaign: draft.campaignMode === "existing"
        ? catalog.campaigns.find((item) => item.id === draft.campaignId)?.name
        : draft.campaignName,
      form: catalog.forms.find((item) => item.id === draft.formId)?.name,
      dailyBudget: draft.dailyBudget,
      durationDays: draft.daysRequired,
      audience: draft.audience,
      launchMode
    };
    if (body.validateOnly === true) return NextResponse.json({ valid: true, review });

    const clientRequestId = String(body.clientRequestId || "").trim();
    if (!/^[A-Za-z0-9_-]{12,100}$/.test(clientRequestId)) {
      return NextResponse.json({ error: "This submission has expired. Close the publisher and open it again." }, { status: 400 });
    }
    const requestId = `DIRECT-${workspace === "hr" ? "HR" : "WF"}-${clientRequestId}`;
    const existing = await supabaseAdmin.from("recruitment_ad_requests")
      .select("id,status,ad_id,raw_payload")
      .eq("company_id", companyId).eq("request_id", requestId).maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    const existingRaw = existing.data?.raw_payload && typeof existing.data.raw_payload === "object"
      ? existing.data.raw_payload as Record<string, unknown>
      : {};
    if (existing.data?.status === "completed" && existing.data.ad_id) {
      return NextResponse.json({ created: true, duplicatePrevented: true, adId: existing.data.ad_id, review });
    }
    const priorPublish = existingRaw.metaPublish && typeof existingRaw.metaPublish === "object"
      ? existingRaw.metaPublish as Record<string, unknown>
      : {};
    const priorUpdatedAt = Date.parse(String(priorPublish.updatedAt || ""));
    if (existing.data?.status === "publishing" && Number.isFinite(priorUpdatedAt)
      && Date.now() - priorUpdatedAt < 5 * 60 * 1000) {
      return NextResponse.json({
        error: "This Meta ad is already being published. Wait a moment and refresh instead of submitting again."
      }, { status: 409 });
    }

    const now = new Date().toISOString();
    const lifecycle = Array.isArray(existingRaw.lifecycleHistory) ? existingRaw.lifecycleHistory : [];
    const baseRaw = {
      ...existingRaw,
      stream: workspace,
      directPublish: true,
      launchMode,
      requestedByProfileId: session.profileId,
      requestedByName: session.displayName,
      requestedByEmail: session.email,
      review,
      lifecycleHistory: lifecycle.length ? lifecycle : [{
        action: "direct_publish_started", to: "publishing", at: now,
        actorProfileId: session.profileId, actorName: session.displayName, actorEmail: session.email
      }]
    };
    let requestRowId = existing.data?.id;
    if (!requestRowId) {
      const inserted = await supabaseAdmin.from("recruitment_ad_requests").insert({
        company_id: companyId,
        request_id: requestId,
        request_type: "new_ad",
        location_id: locationId,
        role_id: roleId,
        status: "publishing",
        requested_budget: draft.dailyBudget,
        days_required: draft.daysRequired,
        poster_url: draft.posterUrl || null,
        notes: `${workspace === "hr" ? "HR" : "Workforce"} direct Meta publisher`,
        requested_by: session.email || session.displayName || session.profileId,
        requested_at: now,
        raw_payload: baseRaw,
        created_at: now,
        updated_at: now
      }).select("id").single();
      if (inserted.error) throw new Error(inserted.error.message);
      requestRowId = inserted.data.id;
    } else {
      const locked = await supabaseAdmin.from("recruitment_ad_requests").update({
        status: "publishing", raw_payload: baseRaw, updated_at: now
      }).eq("company_id", companyId).eq("id", requestRowId);
      if (locked.error) throw new Error(locked.error.message);
    }

    const oldPublish = existingRaw.metaPublish && typeof existingRaw.metaPublish === "object"
      ? existingRaw.metaPublish as Record<string, unknown>
      : {};
    let progress = oldPublish.progress && typeof oldPublish.progress === "object"
      ? oldPublish.progress as MetaPublishProgress
      : {};
    const saveCheckpoint = async (state: string, latest: MetaPublishProgress, error?: string) => {
      progress = { ...latest };
      const savedRaw = {
        ...baseRaw,
        metaPublish: { status: state, progress, draft, updatedAt: new Date().toISOString(), error: error || null }
      };
      const saved = await supabaseAdmin!.from("recruitment_ad_requests").update({
        status: state === "failed" ? "failed" : "publishing",
        raw_payload: savedRaw,
        updated_at: new Date().toISOString()
      }).eq("company_id", companyId).eq("id", requestRowId!);
      if (saved.error) throw new Error(saved.error.message);
    };

    try {
      const published = await publishMetaRecruitmentAd({
        draft,
        progress,
        onProgress: async (latest) => saveCheckpoint("publishing", latest)
      });
      progress = published.progress;
      if (launchMode === "live") {
        await setMetaObjectStatus(String(progress.adSetId), "ACTIVE");
        await setMetaObjectStatus(String(progress.adId), "ACTIVE");
        if (draft.campaignMode === "new") {
          await setMetaObjectStatus(String(progress.campaignId), "ACTIVE");
        }
      }
      const adValues = {
        company_id: companyId,
        meta_ad_id: progress.adId,
        meta_form_id: draft.formId,
        ad_name: draft.adName,
        adset_name: draft.adSetName,
        campaign_name: draft.campaignMode === "existing"
          ? catalog.campaigns.find((item) => item.id === draft.campaignId)?.name || "Existing Meta campaign"
          : draft.campaignName,
        location_id: locationId,
        role_id: roleId,
        route_status: "mapped",
        status: launchMode === "live" ? "ACTIVE" : "PAUSED",
        daily_budget: draft.dailyBudget,
        poster_url: draft.posterUrl || null,
        raw_payload: {
          source: "direct_dashboard_publisher", stream: workspace, request_id: requestId,
          campaign_id: progress.campaignId, adset_id: progress.adSetId,
          creative_id: progress.creativeId, image_hash: draft.imageHash || null,
          created_via: "meta_marketing_api",
          initial_status: launchMode === "live" ? "ACTIVE" : "PAUSED",
          audience: draft.audience
        },
        created_on: now,
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      const foundAd = await supabaseAdmin.from("recruitment_ads").select("id")
        .eq("company_id", companyId).eq("meta_ad_id", progress.adId).maybeSingle();
      if (foundAd.error) throw new Error(foundAd.error.message);
      const savedAd = foundAd.data
        ? await supabaseAdmin.from("recruitment_ads").update(adValues).eq("id", foundAd.data.id).select("id").single()
        : await supabaseAdmin.from("recruitment_ads").insert(adValues).select("id").single();
      if (savedAd.error) throw new Error(savedAd.error.message);
      const completedAt = new Date().toISOString();
      const finalRaw = {
        ...baseRaw,
        metaPublish: { status: launchMode === "live" ? "active" : "created_paused", progress, draft, updatedAt: completedAt, error: null },
        lifecycleHistory: [...(baseRaw.lifecycleHistory as unknown[]), {
          action: launchMode === "live" ? "launched_live" : "created_paused",
          to: "completed", at: completedAt, actorProfileId: session.profileId,
          actorName: session.displayName, actorEmail: session.email
        }]
      };
      const completed = await supabaseAdmin.from("recruitment_ad_requests").update({
        status: "completed", ad_id: savedAd.data.id, raw_payload: finalRaw, updated_at: completedAt
      }).eq("company_id", companyId).eq("id", requestRowId);
      if (completed.error) throw new Error(completed.error.message);
      return NextResponse.json({
        created: true,
        adId: savedAd.data.id,
        metaAdId: progress.adId,
        status: launchMode === "live" ? "ACTIVE" : "PAUSED",
        review
      });
    } catch (error) {
      await saveCheckpoint("failed", progress, error instanceof Error ? error.message : "Meta ad creation failed.");
      throw error;
    }
  } catch (error) {
    console.error("Direct Meta ad publishing failed", error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Unable to publish the Meta ad."
    }, { status: 400 });
  }
}
