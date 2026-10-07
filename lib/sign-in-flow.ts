import { randomBytes } from "node:crypto";
import { routing } from "@/i18n/routing";
import { localePath } from "@/lib/auth";
import type { PlainCookie } from "@/lib/supabase/server";

/**
 * A LINE sign-in may finish in another browser than the one that started it: from inside
 * Messenger and similar apps the LINE app returns to the phone's own browser (decision
 * 2026-10-07). The one-time key Supabase puts in a cookie when a sign-in starts is therefore
 * also kept in the database (`sign_in_flows`) under a random id that travels in the return
 * address, and is handed back as that cookie when the browser has none.
 */

/** The cookie (or its chunks) holding the one-time key of a started sign-in. */
export function isVerifierCookie(name: string): boolean {
  return /^sb-.+-auth-token-code-verifier(\.\d+)?$/.test(name);
}

export function newFlowId(): string {
  return randomBytes(32).toString("base64url");
}

/** An id as newFlowId makes them; anything else in the address is ignored. */
export function isFlowId(value: string | null | undefined): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

export function packVerifier(cookies: PlainCookie[]): string | null {
  const kept = cookies.filter((c) => isVerifierCookie(c.name) && c.value !== "");
  return kept.length > 0 ? JSON.stringify(kept.map(({ name, value }) => [name, value])) : null;
}

/** The cookies packed by packVerifier; empty for anything malformed. */
export function unpackVerifier(packed: unknown): PlainCookie[] {
  if (typeof packed !== "string") return [];
  try {
    const list: unknown = JSON.parse(packed);
    if (!Array.isArray(list)) return [];
    const cookies: PlainCookie[] = [];
    for (const item of list) {
      if (!Array.isArray(item) || item.length !== 2) return [];
      const [name, value] = item as unknown[];
      if (typeof name !== "string" || typeof value !== "string" || !isVerifierCookie(name)) {
        return [];
      }
      cookies.push({ name, value });
    }
    return cookies;
  } catch {
    return [];
  }
}

/**
 * Where a sign-in that finished in another browser goes first: a page that says whose account
 * this is, in the language of the page the person was heading for.
 */
export function signedInNoticePath(destination: string): string {
  const locale =
    routing.locales.find((l) => destination === `/${l}` || destination.startsWith(`/${l}/`)) ??
    routing.defaultLocale;
  return `${localePath(locale, "/account/signed-in")}?next=${encodeURIComponent(destination)}`;
}
