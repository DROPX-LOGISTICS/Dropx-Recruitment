import { NextResponse } from "next/server";
import { loadCapacityDemand } from "@/lib/capacity-demand";
import { canUseRecruitmentMenu, recruitmentSession, requiredEnv } from "@/lib/recruitment-api";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { loadWorkforceConfig, workforceTeamProfileIds } from "@/lib/recruitment-workforce-config";
import { adjustedHiringNeed, loadWorkforcePlanning } from "@/lib/workforce-planning";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function istYesterday() {
  const date = new Date();
  const current = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
  const previous = new Date(`${current}T00:00:00Z`);
  previous.setUTCDate(previous.getUTCDate() - 1);
  return previous.toISOString().slice(0, 10);
}

function relationValue<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function isAmazonCapacityStation(station: {
  station_code: string | null;
  station_name: string | null;
  providers?: { code?: string | null; name?: string | null } | Array<{ code?: string | null; name?: string | null }> | null;
  location_models?: { code?: string | null; name?: string | null } | Array<{ code?: string | null; name?: string | null }> | null;
}) {
  const provider = relationValue(station.providers);
  const model = relationValue(station.location_models);
  const providerName = `${provider?.code ?? ""} ${provider?.name ?? ""}`.toUpperCase();
  const modelName = `${model?.code ?? ""} ${model?.name ?? ""}`.toUpperCase();
  const code = String(station.station_code ?? "").trim().toUpperCase();
  const name = String(station.station_name ?? "").trim().toUpperCase();
  const nonOperational = /^(TEST|DEMO)(?:_|$)/.test(code) || /^(TEST|DEMO)(?:\s|$)/.test(name);
  return !nonOperational
    && providerName.includes("AMAZON")
    && (modelName.includes("EDSP") || modelName.includes("XPT"));
}

export async function GET(request: Request) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase is not configured.");
    const session = await recruitmentSession(request);
    if (!session || (!canUseRecruitmentMenu(session, "Dashboard", "view", "workforce")
      && !canUseRecruitmentMenu(session, "Workforce Plan", "view", "workforce"))) {
      return NextResponse.json({ error: "Workforce Plan access is required." }, { status: 403 });
    }

    const requestedDate = new URL(request.url).searchParams.get("date")?.trim() ?? "";
    const date = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : istYesterday();
    const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
    let permittedCodes: string[] | null = null;
    // A field recruiter always sees only explicitly assigned stations, even if
    // a broader template was accidentally granted elsewhere.
    if (!session.allLocations || session.recruitmentFunction === "field_recruiter") {
      const scopedLocations = await supabaseAdmin
        .from("recruitment_locations")
        .select("id,code")
        .eq("company_id", companyId)
        .in("id", session.locationIds.length ? session.locationIds : ["00000000-0000-0000-0000-000000000000"])
        .eq("is_active", true);
      if (scopedLocations.error) throw new Error(scopedLocations.error.message);
      permittedCodes = (scopedLocations.data ?? []).map((location) => String(location.code ?? "").trim().toUpperCase()).filter(Boolean);
    }
    let stationQuery = supabaseAdmin
      .from("stations")
      .select("id,station_code,station_name,providers(code,name),location_models(code,name)")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .order("station_code");
    if (permittedCodes) {
      stationQuery = stationQuery.in("station_code", permittedCodes.length ? permittedCodes : ["__NO_PERMITTED_STATION__"]);
    }
    const stationResult = await stationQuery;
    if (stationResult.error) throw new Error(stationResult.error.message);
    const workforceStations = (stationResult.data ?? [])
      .filter(isAmazonCapacityStation)
      .map((station) => ({
        id: station.id,
        code: String(station.station_code ?? "").trim().toUpperCase(),
        name: String(station.station_name ?? station.station_code ?? "").trim()
      }));

    const config = await loadWorkforceConfig(companyId);
    const visibleCreatorIds = session.isOwner || session.manageUsers
      ? null
      : session.recruitmentFunction === "manager"
        ? workforceTeamProfileIds(session.profileId, config.userFunctions)
        : [session.profileId];
    const [demand, planning] = await Promise.all([
      loadCapacityDemand({
        companyId,
        date,
        locations: workforceStations,
        includeBalanced: true
      }),
      loadWorkforcePlanning({
        companyId,
        reportingDate: date,
        stations: workforceStations,
        visibleCreatorIds
      })
    ]);
    const rows = demand.rows.map((row) => {
      const associates = planning.byStation.get(row.stationCode) ?? [];
      const trainingHeadcount = associates.filter((item) => item.stage === "training").length;
      const scheduledHeadcount = associates.filter((item) => item.stage === "scheduled").length;
      const coolingHeadcount = associates.filter((item) => item.stage === "cooling").length;
      const attritionRiskHeadcount = associates.filter((item) => item.stage === "attrition_risk").length;
      const stoppedHeadcount = associates.filter((item) => item.stage === "stopped").length;
      const netHiringNeed = adjustedHiringNeed(row.gap, trainingHeadcount);
      return {
        ...row,
        capacityGap: row.gap,
        trainingHeadcount,
        scheduledHeadcount,
        coolingHeadcount,
        attritionRiskHeadcount,
        stoppedHeadcount,
        netHiringNeed,
        priorityScore: netHiringNeed * 100 + attritionRiskHeadcount * 20 + coolingHeadcount * 5,
        recommendation: netHiringNeed > 0
          ? `Hire ${netHiringNeed} after crediting ${trainingHeadcount} in training.`
          : trainingHeadcount > 0
            ? `Capacity gap is covered by ${trainingHeadcount} associate${trainingHeadcount === 1 ? "" : "s"} in training.`
            : row.modelledGap < 0
              ? `Capacity is ${Math.abs(Math.floor(row.modelledGap))} above the modelled requirement.`
              : "Capacity is balanced."
      };
    }).sort((left, right) => right.priorityScore - left.priorityScore || right.netHiringNeed - left.netHiringNeed || left.stationCode.localeCompare(right.stationCode));
    const stageCounts = planning.visibleAssociates.reduce<Record<string, number>>((counts, associate) => {
      counts[associate.stage] = (counts[associate.stage] ?? 0) + 1;
      return counts;
    }, {});
    return NextResponse.json({
      date,
      rows,
      totalCapacityGap: rows.reduce((sum, row) => sum + row.capacityGap, 0),
      totalTraining: rows.reduce((sum, row) => sum + row.trainingHeadcount, 0),
      totalGap: rows.reduce((sum, row) => sum + row.netHiringNeed, 0),
      gapStations: rows.filter((row) => row.netHiringNeed > 0).length,
      attritionRisk: rows.reduce((sum, row) => sum + row.attritionRiskHeadcount, 0),
      visibleAssociates: planning.visibleAssociates
        .sort((left, right) => right.dateOfJoin.localeCompare(left.dateOfJoin) || left.fullName.localeCompare(right.fullName))
        .slice(0, 200),
      stageCounts,
      visibility: visibleCreatorIds == null ? "all" : session.recruitmentFunction === "manager" ? "team" : "mine",
      unconfiguredStations: demand.unconfiguredStations,
      source: "Ops Pulse 14-day capacity model, Field Executive onboarding and canonical associate delivery days",
      definitions: {
        training: "Joined within 14 days and fewer than 3 active delivery days in the latest 7 days.",
        cooling: "No delivery activity for 4–7 days.",
        attritionRisk: "No delivery activity for 8–14 days.",
        stopped: "Inactive, closed, or no delivery activity for more than 14 days after training.",
        netHiringNeed: "Positive capacity gap minus associates currently in training; never below zero."
      },
      generatedAt: new Date().toISOString()
    });
  } catch (caught) {
    return NextResponse.json(
      { error: caught instanceof Error ? caught.message : "Unable to load capacity demand." },
      { status: 500 }
    );
  }
}
