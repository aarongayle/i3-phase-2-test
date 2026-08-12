import { createClient } from "@supabase/supabase-js";

let supabase = null;
let initialized = false;

/**
 * Lazy init so CLI scripts can dotenv.config() before first use.
 * Production/server usually has env vars set before process start.
 */
export function getSupabase() {
  if (!initialized) {
    initialized = true;
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (url && key) {
      supabase = createClient(url, key, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      });
    } else {
      console.warn(
        "[Supabase] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing; Supabase client not initialized."
      );
    }
  }
  return supabase;
}

// Back-compat default export. Prefer getSupabase() for enabled checks —
// this Proxy is always truthy even when the client is null.
const supabaseProxy = new Proxy(
  {},
  {
    get(_target, prop) {
      if (prop === "then") return undefined;
      const client = getSupabase();
      if (!client) return undefined;
      const value = client[prop];
      return typeof value === "function" ? value.bind(client) : value;
    },
  }
);

export default supabaseProxy;
