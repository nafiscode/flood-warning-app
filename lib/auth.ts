import type { SupabaseClient } from "@supabase/supabase-js";
import { headers } from "next/headers";
import { hasLocale } from "next-intl";
import { routing, type Locale } from "@/i18n/routing";
import { supabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export type Role = "user" | "authority" | "admin" | "super_admin";

export type SessionProfile = {
  userId: string;
  role: Role;
  displayName: string;
  locale: Locale;
};

/**
 * The signed-in person, or null for a visitor. The role is read from the database with the
 * caller's own session; pages use it only to decide what to show. What a person can actually
 * read or change is enforced by row-level security, never here (safety rule 5).
 */
export async function getSessionProfile(): Promise<SessionProfile | null> {
  if (!supabaseConfigured()) return null;
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims.sub;
  if (!userId) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, display_name, preferred_locale")
    .eq("user_id", userId)
    .maybeSingle();
  if (!profile) return null;
  return {
    userId,
    role: profile.role as Role,
    displayName: profile.display_name as string,
    locale: hasLocale(routing.locales, profile.preferred_locale)
      ? profile.preferred_locale
      : routing.defaultLocale,
  };
}

/**
 * Where to send someone who has signed in but has no display name yet: the setup page, and back
 * to where they were going. A display name is required of every account (spec section 3), and
 * the pages that keep someone's own details should not be filled in by a nameless profile.
 * Nothing in the way of an SOS or a report ever calls this: asking for help waits for nobody.
 */
export function needsName(session: SessionProfile | null): boolean {
  return session !== null && session.displayName.trim() === "";
}

export function setupPath(locale: string, back: string): string {
  const next = localePath(locale, back);
  return `${localePath(locale, "/account/setup")}?${new URLSearchParams({ next })}`;
}

export function isAdminRole(role: Role): boolean {
  return role === "admin" || role === "super_admin";
}

/** Only same-site paths are followed after sign-in. */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return null;
  return next;
}

/** The address this request came to, for links that must come back to the same deployment. */
export async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/** A path with the locale prefix the routing uses (Thai has none). */
export function localePath(locale: string, path: string): string {
  return locale === routing.defaultLocale ? path : `/${locale}${path === "/" ? "" : path}`;
}

/**
 * Steps after any successful sign-in: copy the LINE user ID from the sign-in identity, take up a
 * pending admin invitation, then decide where to go. A profile without a name goes to setup.
 */
export async function finishSignIn(supabase: SupabaseClient, next: string | null): Promise<string> {
  await supabase.rpc("sync_line_identity");
  await supabase.rpc("accept_admin_invitation");
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims.sub;
  const { data: profile } = userId
    ? await supabase
        .from("profiles")
        .select("role, display_name, preferred_locale")
        .eq("user_id", userId)
        .maybeSingle()
    : { data: null };
  const locale = (profile?.preferred_locale as string | undefined) ?? routing.defaultLocale;
  if (!profile || ((profile.display_name as string) ?? "").trim() === "") {
    const setup = localePath(locale, "/account/setup");
    return next ? `${setup}?next=${encodeURIComponent(next)}` : setup;
  }
  if (next) return next;
  return localePath(locale, isAdminRole(profile.role as Role) ? "/admin" : "/account");
}
