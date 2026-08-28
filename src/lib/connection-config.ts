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

export async function getConnectionConfig(provider: ConnectionProvider) {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  const cached = cache.get(provider);
  if (cached && cached.expires > Date.now()) return cached.value;

  const result = await supabaseAdmin.rpc("recruitment_get_connection_config", {
    p_company_id: requiredEnv("RECRUITMENT_COMPANY_ID"),
    p_provider: provider
  });
  if (result.error) {
    if (result.error.code === "PGRST202" || result.error.message.includes("schema cache")) return null;
    throw new Error(result.error.message);
  }
  const row = result.data?.[0];
  const value = row
    ? {
        isEnabled: Boolean(row.is_enabled),
        publicConfig: Object.fromEntries(
          Object.entries(row.public_config ?? {}).map(([key, item]) => [key, String(item ?? "")])
        ),
        secrets: Object.fromEntries(
          Object.entries(row.secrets ?? {}).map(([key, item]) => [key, String(item ?? "")])
        )
      }
    : null;
  cache.set(provider, { expires: Date.now() + 60_000, value });
  return value;
}
