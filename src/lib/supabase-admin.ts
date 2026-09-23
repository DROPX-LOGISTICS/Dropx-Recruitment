import { createClient } from "@supabase/supabase-js";
import { timeoutFetch } from "./timeout-fetch";
import { fetchWithSupabaseTransientRetry } from "./supabase-transient-retry";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function isReadRequest(input: RequestInfo | URL, init?: RequestInit) {
  const method = init?.method?.toUpperCase() ?? (input instanceof Request ? input.method.toUpperCase() : "GET");
  return method === "GET" || method === "HEAD";
}

const noStoreFetch = (input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init, cache: "no-store" });
const writeFetch = timeoutFetch(noStoreFetch);
const readAttemptFetch = timeoutFetch(noStoreFetch, 6_000);

export const supabaseAdmin = url && serviceRoleKey
  ? createClient(url, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: {
        fetch: (input, init) => isReadRequest(input, init)
          ? fetchWithSupabaseTransientRetry(input, init, readAttemptFetch)
          : writeFetch(input, init)
      }
    })
  : null;
