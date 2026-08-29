import { requiredEnv } from "./recruitment-api";
import { supabaseAdmin } from "./supabase-admin";

export type ConnectionProvider = "meta" | "indeed" | "whatsapp" | "google" | "mobile";
export type ConnectionConfig = {
  isEnabled: boolean;
  publicConfig: Record<string, string>;
  secrets: Record<string, string>;
};

const cache = new Map<ConnectionProvider, { expires: number; value: ConnectionConfig | null }>();

export function invalidateConnectionConfig(provider?: ConnectionProvider) {
  if (provider) cache.delete(provider);
  else cache.clear();
}

function mapConnectionRow(row: {
  is_enabled?: boolean | null;
  public_config?: Record<string, unknown> | null;
  secrets?: Record<string, unknown> | null;
} | null | undefined): ConnectionConfig | null {
  if (!row) return null;
  return {
    isEnabled: Boolean(row.is_enabled),
    publicConfig: Object.fromEntries(
      Object.entries(row.public_config ?? {}).map(([key, item]) => [key, String(item ?? "")])
    ),
    secrets: Object.fromEntries(
      Object.entries(row.secrets ?? {}).map(([key, item]) => [key, String(item ?? "")])
    )
  };
}

async function directConnectionConfig(companyId: string, provider: ConnectionProvider) {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  const result = await supabaseAdmin.from("recruitment_connection_settings")
    .select("is_enabled,public_config")
    .eq("company_id", companyId)
    .eq("provider", provider)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return mapConnectionRow(result.data ? {
    is_enabled: result.data.is_enabled,
    public_config: result.data.public_config as Record<string, unknown>,
    secrets: {}
  } : null);
}

export async function getConnectionConfig(provider: ConnectionProvider) {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  const cached = cache.get(provider);
  if (cached && cached.expires > Date.now()) return cached.value;

  const companyId = requiredEnv("RECRUITMENT_COMPANY_ID");
  const result = await supabaseAdmin.rpc("recruitment_get_connection_config", {
    p_company_id: companyId,
    p_provider: provider
  });
  let value: ConnectionConfig | null = null;
  if (result.error) {
    if (result.error.code === "PGRST202" || result.error.message.includes("schema cache")) {
      value = await directConnectionConfig(companyId, provider);
    } else {
      throw new Error(result.error.message);
    }
  } else {
    value = mapConnectionRow(result.data?.[0]);
  }
  cache.set(provider, { expires: Date.now() + 60_000, value });
  return value;
}
