import { createServerClient } from "@supabase/ssr";
import type { NextRequest } from "next/server";
import { isSessionCookie, supabaseConfigured, supabaseEnv } from "./env";

type CookieToSet = { name: string; value: string; options?: Record<string, unknown> };

/**
 * Keep a signed-in visitor's session fresh. Runs only when a session cookie is present, so
 * visitors (most people, and everyone during an alert burst) cost no extra work, and it never
 * blocks a request: if Supabase can't be reached the page is served anyway.
 * Returns the cookies to copy onto the response.
 */
export async function refreshSession(request: NextRequest): Promise<CookieToSet[]> {
  if (!supabaseConfigured()) return [];
  if (!request.cookies.getAll().some((c) => isSessionCookie(c.name))) return [];
  const refreshed: CookieToSet[] = [];
  try {
    const { url, key } = supabaseEnv();
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value, options } of cookiesToSet) {
            request.cookies.set(name, value);
            refreshed.push({ name, value, options });
          }
        },
      },
    });
    await supabase.auth.getClaims();
  } catch {
    // Offline or Supabase down: serve the page; the next request tries again.
  }
  return refreshed;
}
