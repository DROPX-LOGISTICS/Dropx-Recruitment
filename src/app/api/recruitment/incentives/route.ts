import { NextResponse } from "next/server";
import { canUseRecruitmentMenu, recruitmentSession, requiredEnv } from "@/lib/recruitment-api";
import {
  loadWorkforceConfig,
  saveWorkforceConfig,
  type IncentiveRule,
  type InfluencerProgramConfig
} from "@/lib/recruitment-workforce-config";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

function cleanRule(raw: Record<string, unknown>): IncentiveRule {
  const effectiveFrom = String(raw.effectiveFrom ?? "").trim();
  const effectiveTo = String(raw.effectiveTo ?? "").trim() || null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) throw new Error("Every rule needs an effective-from date.");
  if (effectiveTo && !/^\d{4}-\d{2}-\d{2}$/.test(effectiveTo)) throw new Error("Enter a valid effective-to date.");
  if (effectiveTo && effectiveTo < effectiveFrom) throw new Error("Effective-to cannot be before effective-from.");
  return {
    effectiveFrom,
    effectiveTo,
    qualificationDays: Math.max(1, Math.min(366, Number(raw.qualificationDays ?? 30))),
    amountPerQualifiedAssociate: Math.max(0, Number(raw.amountPerQualifiedAssociate ?? 0)),
    minimumQualifiedAssociates: Math.max(1, Number(raw.minimumQualifiedAssociates ?? 1)),
    eligibleDesignations: Array.isArray(raw.eligibleDesignations)
      ? [...new Set(raw.eligibleDesignations.map((value) => String(value).trim().toUpperCase()).filter(Boolean))]
      : [],
    isActive: raw.isActive !== false
  };
}

function cleanDesignations(raw: unknown) {
  if (!Array.isArray(raw)) return [];
  const byCode = new Map<string, { code: string; name: string }>();
  for (const value of raw) {
    const item = value && typeof value === "object" ? value as Record<string, unknown> : {};
    const code = String(item.code ?? "").trim().toUpperCase();
    const name = String(item.name ?? "").trim();
    if (!/^[A-Z][A-Z0-9_]{1,39}$/.test(code) || !name) continue;
    byCode.set(code, { code, name: name.slice(0, 120) });
  }
  return [...byCode.values()].sort((a,b) => a.code.localeCompare(b.code));
}

function cleanInfluencerProgram(raw: unknown): InfluencerProgramConfig {
  const item = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  const rawMilestones = Array.isArray(item.milestones) ? item.milestones : [];
  const milestones = rawMilestones.map((value) => {
    const milestone = value && typeof value === "object" ? value as Record<string, unknown> : {};
    return {
      activeDays: Math.max(1, Math.min(366, Math.round(Number(milestone.activeDays ?? 0)))),
      amount: Math.max(0, Math.round(Number(milestone.amount ?? 0)))
    };
  }).filter((value) => Number.isFinite(value.activeDays) && Number.isFinite(value.amount))
    .sort((left, right) => left.activeDays - right.activeDays);
  if (!milestones.length) throw new Error("Add at least one influencer milestone.");
  if (new Set(milestones.map((value) => value.activeDays)).size !== milestones.length) {
    throw new Error("Each influencer milestone must use a different active-day target.");
  }
  return {
    attributionWindowDays: Math.max(1, Math.min(366, Math.round(Number(item.attributionWindowDays ?? 90)))),
    milestones
  };
}

export async function GET(request: Request) {
  try {
    const session = await recruitmentSession(request);
    if (!canUseRecruitmentMenu(session, "Incentive Master", "view", "workforce")) return NextResponse.json({ error: "Workforce access is required." }, { status: 403 });
    const config = await loadWorkforceConfig(requiredEnv("RECRUITMENT_COMPANY_ID"));
    const designations = supabaseAdmin
      ? await supabaseAdmin.from("designations").select("code,name").eq("company_id", requiredEnv("RECRUITMENT_COMPANY_ID"))
          .eq("is_active", true).order("code")
      : { data: [], error: null };
    if (designations.error) throw designations.error;
    const designationOptions = new Map<string, { code: string; name: string }>();
    for (const item of [...(designations.data ?? []), ...config.recruitmentDesignations]) {
      designationOptions.set(String(item.code).toUpperCase(), {
        code: String(item.code).toUpperCase(),
        name: String(item.name)
      });
    }
    return NextResponse.json({
      rules: config.incentiveMaster,
      influencerProgram: config.influencerProgram,
      designationOptions: [...designationOptions.values()].sort((a,b) => a.code.localeCompare(b.code)),
      editable: canUseRecruitmentMenu(session, "Incentive Master", "edit", "workforce")
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load incentive master." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const session = await recruitmentSession(request);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!canUseRecruitmentMenu(session, "Incentive Master", "edit", "workforce")) return NextResponse.json({ error: "Edit access is required." }, { status: 403 });
    const body = await request.json() as { rules?: Record<string, unknown>[]; designationOptions?: unknown; influencerProgram?: unknown };
    if (!Array.isArray(body.rules) || !body.rules.length) {
      return NextResponse.json({ error: "Add at least one incentive rule." }, { status: 400 });
    }
    const rules = body.rules.map(cleanRule).sort((a,b)=>b.effectiveFrom.localeCompare(a.effectiveFrom));
    const designationOptions = cleanDesignations(body.designationOptions);
    const influencerProgram = cleanInfluencerProgram(body.influencerProgram);
    const allowedCodes = new Set(designationOptions.map((item) => item.code));
    if (rules.some((rule) => rule.eligibleDesignations.some((code) => !allowedCodes.has(code)))) {
      return NextResponse.json({ error: "Every eligible designation must exist in the Incentive Master catalog." }, { status: 400 });
    }
    await saveWorkforceConfig(requiredEnv("RECRUITMENT_COMPANY_ID"), {
      incentive_master: rules,
      recruitment_designations: designationOptions,
      influencer_program: influencerProgram
    }, session.profileId, session.email);
    return NextResponse.json({ saved: true, rules, designationOptions, influencerProgram });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to save incentive master." }, { status: 400 });
  }
}
