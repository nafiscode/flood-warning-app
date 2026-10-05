import { createClient } from "@supabase/supabase-js";
import { supabaseEnv } from "./env";

/**
 * Server-only client with the secret key: it bypasses row-level security. Use it only for what
 * the Auth admin API requires (creating an invited admin's account), after checking the caller's
 * role with their own session. Never import this from a client component.
 */
export function createAdminClient() {
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) return null;
  return createClient(supabaseEnv().url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
