import { NextResponse } from "next/server";
import {
  getMetaAdCreativeReplacementContext,
  replaceMetaAdCreative
} from "@/lib/meta-ad-builder";
import {
  canAccessLead,
  canUseRecruitmentMenu,
  recruitmentSession,
  requiredEnv
} from "@/lib/recruitment-api";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function relatedRole(value: unknown) {
  return Array.isArray(value) ? value[0] : value;
}

function validHttpsUrl(value: unknown) {
  const url = String(value || "").trim();
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function eligibleLocalStatus(value: unknown) {
  return ["ACTIVE", "PAUSED"].includes(String(value || "").toUpperCase());
}

async function scopedAd(request: Request, id: string) {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  const session = await recruitmentSession(request);
  if (!session) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) } as const;
  const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
  const result = await supabaseAdmin
    .from("recruitment_ads")
    .select("id,company_id,meta_ad_id,ad_name,poster_url,status,location_id,role_id,raw_payload,recruitment_roles(stream)")
    .eq("company_id", companyId)
    .eq("id", id)
    .maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) return { error: NextResponse.json({ error: "Ad not found." }, { status: 404 }) } as const;
  const role = relatedRole(result.data.recruitment_roles) as { stream?: string } | null;
  const stream = role?.stream === "hr" ? "hr" : "workforce";
  if (!canUseRecruitmentMenu(session, "Active Ads", "all", stream)
    || !canAccessLead(session, {
      stream,
      location_id: result.data.location_id,
      role_id: result.data.role_id
    })) {
    return { error: NextResponse.json({ error: "Creative replacement access is not assigned to this user." }, { status: 403 }) } as const;
  }
  return { session, companyId, ad: result.data, stream } as const;
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const scoped = await scopedAd(request, params.id);
    if ("error" in scoped) return scoped.error;
    if (!scoped.ad.meta_ad_id) {
      return NextResponse.json({ error: "This record is not linked to a Meta ad." }, { status: 400 });
    }
    const context = await getMetaAdCreativeReplacementContext(scoped.ad.meta_ad_id);
    const localStatusEligible = eligibleLocalStatus(scoped.ad.status);
    const history = await supabaseAdmin!
      .from("recruitment_ad_creative_changes")
      .select("id,status,previous_creative_id,replacement_creative_id,reason,actor_email,created_at,completed_at")
      .eq("company_id", scoped.companyId)
      .eq("ad_id", scoped.ad.id)
      .order("created_at", { ascending: false })
      .limit(5);
    if (history.error) throw history.error;
    return NextResponse.json({
      ad: {
        id: scoped.ad.id,
        name: scoped.ad.ad_name,
        metaAdId: scoped.ad.meta_ad_id,
        localStatus: String(scoped.ad.status || "UNKNOWN").toUpperCase(),
        currentPosterUrl: context.posterUrl || scoped.ad.poster_url || null
      },
      creative: context,
      eligible: localStatusEligible && context.replaceable,
      blocker: !localStatusEligible
        ? "Only Active or Paused ads can receive a replacement poster."
        : context.replacementBlocker,
      recentChanges: history.data ?? []
    }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    console.error("Meta creative replacement context failed", error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Unable to load the current Meta creative."
    }, { status: 502 });
  }
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  let auditId = "";
  try {
    const scoped = await scopedAd(request, params.id);
    if ("error" in scoped) return scoped.error;
    if (!scoped.ad.meta_ad_id) {
      return NextResponse.json({ error: "This record is not linked to a Meta ad." }, { status: 400 });
    }
    if (!eligibleLocalStatus(scoped.ad.status)) {
      return NextResponse.json({ error: "Only Active or Paused ads can receive a replacement poster." }, { status: 409 });
    }
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const imageHash = String(body.imageHash || "").trim();
    const expectedCreativeId = String(body.expectedCreativeId || "").trim();
    const reason = String(body.reason || "").trim();
    const clientRequestId = String(body.clientRequestId || "").trim();
    const uploadedPosterUrl = validHttpsUrl(body.replacementPosterUrl);
    if (!/^[A-Za-z0-9_-]{16,256}$/.test(imageHash)) {
      return NextResponse.json({ error: "Upload the replacement poster again." }, { status: 400 });
    }
    if (!/^\d{5,30}$/.test(expectedCreativeId)) {
      return NextResponse.json({ error: "The current creative reference is invalid. Reopen the preview." }, { status: 400 });
    }
    if (reason.length < 3 || reason.length > 500) {
      return NextResponse.json({ error: "Enter a change reason between 3 and 500 characters." }, { status: 400 });
    }
    if (!/^[A-Za-z0-9_-]{12,128}$/.test(clientRequestId)) {
      return NextResponse.json({ error: "The request reference is invalid. Reopen the replacement window." }, { status: 400 });
    }

    const staleCutoff = new Date(Date.now() - 5 * 60_000).toISOString();
    const staleRecovery = await supabaseAdmin!
      .from("recruitment_ad_creative_changes")
      .update({
        status: "failed",
        error_message: "The replacement did not finish within five minutes and was released for a safe retry.",
        completed_at: new Date().toISOString()
      })
      .eq("company_id", scoped.companyId)
      .eq("ad_id", scoped.ad.id)
      .eq("status", "processing")
      .lt("created_at", staleCutoff);
    if (staleRecovery.error) throw staleRecovery.error;

    const previousRequest = await supabaseAdmin!
      .from("recruitment_ad_creative_changes")
      .select("id,status,replacement_creative_id,replacement_poster_url,effective_status_after,error_message")
      .eq("company_id", scoped.companyId)
      .eq("client_request_id", clientRequestId)
      .maybeSingle();
    if (previousRequest.error) throw previousRequest.error;
    if (previousRequest.data?.status === "completed") {
      return NextResponse.json({
        replaced: true,
        replayed: true,
        creativeId: previousRequest.data.replacement_creative_id,
        posterUrl: previousRequest.data.replacement_poster_url,
        effectiveStatus: previousRequest.data.effective_status_after
      });
    }
    if (previousRequest.data) {
      return NextResponse.json({
        error: previousRequest.data.status === "processing"
          ? "This poster replacement is already being processed."
          : "The previous replacement attempt failed. Retry from a fresh preview."
      }, { status: 409 });
    }

    const current = await getMetaAdCreativeReplacementContext(scoped.ad.meta_ad_id);
    if (!current.replaceable) {
      return NextResponse.json({ error: current.replacementBlocker || "This creative cannot be replaced." }, { status: 409 });
    }
    if (current.creativeId !== expectedCreativeId) {
      return NextResponse.json({
        error: "The creative changed after this preview opened. Close it and review the latest creative before replacing it."
      }, { status: 409 });
    }

    const inserted = await supabaseAdmin!
      .from("recruitment_ad_creative_changes")
      .insert({
        company_id: scoped.companyId,
        ad_id: scoped.ad.id,
        meta_ad_id: scoped.ad.meta_ad_id,
        client_request_id: clientRequestId,
        status: "processing",
        previous_creative_id: current.creativeId,
        previous_poster_url: current.posterUrl || scoped.ad.poster_url || null,
        replacement_image_hash: imageHash,
        replacement_poster_url: uploadedPosterUrl,
        reason,
        configured_status_before: current.configuredStatus,
        actor_profile_id: scoped.session.profileId,
        actor_email: scoped.session.email
      })
      .select("id")
      .single();
    if (inserted.error) {
      if (inserted.error.code === "23505") {
        return NextResponse.json({ error: "Another creative replacement is already in progress for this ad." }, { status: 409 });
      }
      throw inserted.error;
    }
    auditId = inserted.data.id;

    const replacement = await replaceMetaAdCreative({
      metaAdId: scoped.ad.meta_ad_id,
      expectedCreativeId,
      imageHash
    });
    const posterUrl = replacement.after.posterUrl || uploadedPosterUrl || scoped.ad.poster_url || null;
    const configuredStatus = replacement.after.configuredStatus;
    const localStatus = configuredStatus === "ACTIVE"
      ? "ACTIVE"
      : configuredStatus === "PAUSED"
        ? "PAUSED"
        : scoped.ad.status;
    const rawPayload = scoped.ad.raw_payload && typeof scoped.ad.raw_payload === "object"
      ? scoped.ad.raw_payload as Record<string, unknown>
      : {};
    const now = new Date().toISOString();
    const savedAd = await supabaseAdmin!
      .from("recruitment_ads")
      .update({
        poster_url: posterUrl,
        status: localStatus,
        last_synced_at: now,
        updated_at: now,
        raw_payload: {
          ...rawPayload,
          creative: {
            id: replacement.after.creativeId,
            name: replacement.after.creativeName,
            image_url: replacement.after.posterUrl
          },
          creative_replacement: {
            audit_id: auditId,
            previous_creative_id: replacement.before.creativeId,
            replacement_creative_id: replacement.replacementCreativeId,
            reason,
            actor_email: scoped.session.email,
            completed_at: now
          }
        }
      })
      .eq("company_id", scoped.companyId)
      .eq("id", scoped.ad.id);
    if (savedAd.error) throw savedAd.error;
    const savedAudit = await supabaseAdmin!
      .from("recruitment_ad_creative_changes")
      .update({
        status: "completed",
        replacement_creative_id: replacement.replacementCreativeId,
        replacement_poster_url: posterUrl,
        effective_status_after: replacement.after.effectiveStatus,
        meta_response: replacement.metaResponse,
        completed_at: now,
        error_message: null
      })
      .eq("id", auditId)
      .eq("company_id", scoped.companyId);
    if (savedAudit.error) throw savedAudit.error;
    return NextResponse.json({
      replaced: true,
      replayed: false,
      adId: scoped.ad.id,
      metaAdId: scoped.ad.meta_ad_id,
      creativeId: replacement.replacementCreativeId,
      posterUrl,
      configuredStatus: replacement.after.configuredStatus,
      effectiveStatus: replacement.after.effectiveStatus,
      auditId
    });
  } catch (error) {
    console.error("Meta creative replacement failed", error);
    if (auditId && supabaseAdmin) {
      await supabaseAdmin
        .from("recruitment_ad_creative_changes")
        .update({
          status: "failed",
          error_message: error instanceof Error ? error.message.slice(0, 1000) : "Creative replacement failed.",
          completed_at: new Date().toISOString()
        })
        .eq("id", auditId);
    }
    const message = error instanceof Error ? error.message : "Unable to replace the Meta creative.";
    return NextResponse.json({ error: message }, {
      status: /changed after this preview|already in progress/i.test(message) ? 409 : 502
    });
  }
}
