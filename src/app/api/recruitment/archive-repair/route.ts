import { NextResponse } from "next/server";
import {
  canUseRecruitmentMenu,
  hasFullLeadAccess,
  recruitmentSession,
  requiredEnv
} from "@/lib/recruitment-api";
import {
  archiveRepairReason,
  type ArchiveRepairLead,
  type ArchiveRepairReason
} from "@/lib/archive-repair";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

type RepairLead = ArchiveRepairLead & {
  location_id?: string | null;
  role_id?: string | null;
};

type EligibleLead = RepairLead & {
  repairReason: ArchiveRepairReason;
};

const PAGE_SIZE = 1000;
const APPLY_CHUNK_SIZE = 200;

function increment(target: Record<string, number>, key: string) {
  target[key] = (target[key] || 0) + 1;
}

async function archivedLeads(companyId: string) {
  const rows: RepairLead[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const page = await supabaseAdmin!
      .from("recruitment_leads")
      .select("id,status,stream,source,no_response_attempts,location_id,role_id")
      .eq("company_id", companyId)
      .eq("archived", true)
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (page.error) throw new Error(page.error.message);
    rows.push(...((page.data ?? []) as RepairLead[]));
    if ((page.data?.length ?? 0) < PAGE_SIZE) break;
  }
  return rows;
}

function summarize(all: RepairLead[], eligible: EligibleLead[]) {
  const byReason: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  const byStream: Record<string, number> = {};
  for (const lead of eligible) {
    increment(byReason, lead.repairReason);
    increment(byStatus, String(lead.status || "New"));
    increment(byStream, String(lead.stream || "unmapped"));
  }
  return {
    totalArchived: all.length,
    eligibleCount: eligible.length,
    preservedCount: all.length - eligible.length,
    byReason,
    byStatus,
    byStream,
    sample: eligible.slice(0, 10).map((lead) => ({
      id: lead.id,
      status: lead.status || "New",
      stream: lead.stream || "unmapped",
      source: lead.source || "unknown",
      reason: lead.repairReason
    }))
  };
}

export async function POST(request: Request) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase is not configured.");
    const session = await recruitmentSession(request);
    if (!session || !canUseRecruitmentMenu(session, "System Health", "all") || !hasFullLeadAccess(session)) {
      return NextResponse.json({ error: "System Health All access and complete lead scope are required." }, { status: 403 });
    }
    const body = await request.json().catch(() => ({}));
    const action = body?.action === "apply" ? "apply" : body?.action === "preview" ? "preview" : null;
    if (!action) {
      return NextResponse.json({ error: "Action must be preview or apply." }, { status: 400 });
    }

    const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
    const all = await archivedLeads(companyId);
    const eligible = all.flatMap((lead) => {
      const repairReason = archiveRepairReason(lead);
      return repairReason ? [{ ...lead, repairReason }] : [];
    });
    const before = summarize(all, eligible);
    if (action === "preview") {
      return NextResponse.json({ mode: "preview", ...before });
    }

    const operationId = crypto.randomUUID();
    let applied = 0;
    for (let start = 0; start < eligible.length; start += APPLY_CHUNK_SIZE) {
      const chunk = eligible.slice(start, start + APPLY_CHUNK_SIZE);
      const ids = chunk.map((lead) => lead.id);
      const restored = await supabaseAdmin
        .from("recruitment_leads")
        .update({ archived: false, archived_at: null })
        .eq("company_id", companyId)
        .eq("archived", true)
        .in("id", ids)
        .select("id");
      if (restored.error) throw new Error(restored.error.message);
      const restoredIds = new Set((restored.data ?? []).map((row) => row.id));
      const restoredLeads = chunk.filter((lead) => restoredIds.has(lead.id));
      if (restoredLeads.length) {
        const history = await supabaseAdmin.from("recruitment_lead_history").insert(
          restoredLeads.map((lead) => ({
            company_id: companyId,
            lead_id: lead.id,
            event_type: "archive_repair",
            field_name: "archived",
            old_value: "true",
            new_value: "false",
            actor_profile_id: session.profileId,
            actor_email: session.email,
            metadata: {
              source: "owner_archive_reconciliation",
              operation_id: operationId,
              reason: lead.repairReason,
              preserved_status: lead.status || ""
            }
          }))
        );
        if (history.error) throw new Error(history.error.message);
      }
      applied += restoredLeads.length;
    }

    const remaining = await archivedLeads(companyId);
    return NextResponse.json({
      mode: "applied",
      operationId,
      applied,
      before,
      after: {
        totalArchived: remaining.length,
        eligibleCount: remaining.filter((lead) => archiveRepairReason(lead)).length
      }
    });
  } catch (error) {
    console.error("Archive repair failed", error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Unable to repair archived leads."
    }, { status: 500 });
  }
}
