import { createClient } from "@supabase/supabase-js";
import { timeoutFetch } from "./timeout-fetch";
import { fetchWithSupabaseTransientRetry } from "./supabase-transient-retry";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const supabaseAdmin = url && serviceRoleKey
  ? createClient(url, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: {
        fetch: timeoutFetch((input, init) =>
          fetchWithSupabaseTransientRetry(input, { ...init, cache: "no-store" })
        )
      }
    })
  : null;
