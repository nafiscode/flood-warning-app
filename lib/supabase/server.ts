import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseEnv } from "./env";

export type PlainCookie = { name: string; value: string };

type ClientOptions = {
  /** Cookies to present as if the browser had sent them (a sign-in key kept in the database). */
  extraCookies?: PlainCookie[];
  /** Called with every cookie the client sets, before it goes to the browser. */
  onSetCookies?: (cookies: PlainCookie[]) => void;
};

/**
 * Supabase client for server components, server actions and route handlers. It acts as the
 * signed-in user (or a visitor): row-level security decides what it can read and write.
 */
export async function createClient({ extraCookies = [], onSetCookies }: ClientOptions = {}) {
  const cookieStore = await cookies();
  const { url, key } = supabaseEnv();
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return [...cookieStore.getAll(), ...extraCookies];
      },
      setAll(cookiesToSet) {
        onSetCookies?.(cookiesToSet.map(({ name, value }) => ({ name, value })));
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server components can't set cookies; proxy.ts refreshes the session instead.
        }
      },
    },
  });
}
