/** Public Supabase settings. Read at request time, never at build time: CI builds without them. */
export function supabaseEnv(): { url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are not set (see .env.example).",
    );
  }
  return { url, key };
}

export function supabaseConfigured(): boolean {
  return !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
}

/** Supabase stores the session in cookies named sb-<project ref>-auth-token (possibly chunked). */
export function isSessionCookie(name: string): boolean {
  return name.startsWith("sb-") && name.includes("-auth-token");
}
