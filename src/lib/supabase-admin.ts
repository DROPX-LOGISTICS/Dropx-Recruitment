import { createClient } from "@supabase/supabase-js";
import { timeoutFetch } from "./timeout-fetch";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const supabaseAdmin = url && serviceRoleKey
  ? createClient(url, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: {
        fetch: timeoutFetch((input, init) => fetch(input, { ...init, cache: "no-store" }))
      }
    })
  : null;
