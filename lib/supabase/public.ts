import { createClient } from "@supabase/supabase-js";
import { supabaseEnv } from "./env";

/**
 * Supabase client for the public endpoints (/api/public/*, /api/geo/*). It always acts as a
 * visitor and never reads cookies, so an answer cannot differ by who asks and is safe to keep in
 * a shared cache for everyone.
 */
export function createPublicClient() {
  const { url, key } = supabaseEnv();
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/**
 * Shared-cache header for the public endpoints: Vercel's edge keeps one answer for everyone for
 * 60 s, so a burst of people opening the app after an alert does not reach the database (spec
 * section 10). While a new answer is fetched the old one is still served, and if the database
 * can't be reached the last answer is served for up to 10 minutes rather than an error.
 */
export const CACHE_60S =
  "public, max-age=0, s-maxage=60, stale-while-revalidate=60, stale-if-error=600";
export const CACHE_1H = "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400";
export const NO_STORE = "no-store";

/** The answer of a public endpoint that can't answer: an error, never cached. */
export function unavailable(status = 503): Response {
  return Response.json({ error: "unavailable" }, { status, headers: { "Cache-Control": NO_STORE } });
}
