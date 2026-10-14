/**
 * The phone's half of the usage counter (the owner, 14 Oct). Nothing here ever waits for an
 * answer or holds a page up: the open note goes with navigator.sendBeacon, the rest with a
 * fire-and-forget fetch, and every failure is swallowed (safety rule 1: a counter must never cost
 * a request for help a moment).
 *
 * Not sent at all when the browser asks sites not to track it (Global Privacy Control), and not
 * from a test browser unless the test asks for it.
 */
import type { Area } from "@/lib/area";
import type { MyPlaces } from "@/lib/me";
import { isSessionCookie } from "@/lib/supabase/env";

export const INSTALL_KEY = "jaga.install";
export const SESSION_KEY = "jaga.usage.session";
export const TEST_KEY = "jaga-usage-test";
/** A visit ends after this long with the app off screen. */
export const SESSION_GAP_MS = 30 * 60_000;
/** "Still on screen" while the app is visible. */
export const BEAT_MS = 5 * 60_000;

export type StoredSession = { id: string; last: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function newId(random: () => number = Math.random): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const hex = Array.from({ length: 32 }, () => Math.floor(random() * 16).toString(16));
  hex[12] = "4";
  hex[16] = ((parseInt(hex[16]!, 16) & 3) | 8).toString(16);
  const s = hex.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

/** Whether the stored visit is still going at `now`, or a new one starts. */
export function continueSession(stored: unknown, now: number): StoredSession | null {
  if (!stored || typeof stored !== "object") return null;
  const s = stored as Partial<StoredSession>;
  if (typeof s.id !== "string" || !UUID.test(s.id) || typeof s.last !== "number") return null;
  if (now - s.last > SESSION_GAP_MS || s.last > now + 60_000) return null;
  return { id: s.id, last: now };
}

/** Whether this browser should be counted at all. */
export function counted(
  nav: { webdriver?: boolean; globalPrivacyControl?: boolean },
  testing: boolean,
): boolean {
  if (nav.globalPrivacyControl === true) return false;
  if (nav.webdriver === true && !testing) return false;
  return true;
}

function storage(kind: "localStorage" | "sessionStorage"): Storage | null {
  try {
    return window[kind];
  } catch {
    return null;
  }
}

function readJson(store: Storage | null, key: string): unknown {
  try {
    const raw = store?.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function installId(): string {
  const store = storage("localStorage");
  try {
    const known = store?.getItem(INSTALL_KEY);
    if (known && UUID.test(JSON.parse(known))) return JSON.parse(known) as string;
  } catch {
    // Not readable: a fresh code below.
  }
  const id = newId();
  try {
    store?.setItem(INSTALL_KEY, JSON.stringify(id));
  } catch {
    // Private mode: this visit counts as a new phone, which is the honest reading anyway.
  }
  return id;
}

/** The visit going on now, and whether it has just started. */
export function touchSession(now = Date.now()): { id: string; fresh: boolean } {
  const store = storage("sessionStorage");
  const going = continueSession(readJson(store, SESSION_KEY), now);
  const session = going ?? { id: newId(), last: now };
  try {
    store?.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // Keep going without it.
  }
  return { id: session.id, fresh: going === null };
}

type Nav = Navigator & {
  globalPrivacyControl?: boolean;
  deviceMemory?: number;
  connection?: { effectiveType?: string };
  standalone?: boolean;
};

export function shouldCount(): boolean {
  if (typeof window === "undefined") return false;
  let testing = false;
  try {
    testing = window.sessionStorage.getItem(TEST_KEY) === "1";
  } catch {
    testing = false;
  }
  return counted(navigator as Nav, testing);
}

/** What the open note says about this phone. Nothing in it names the person. */
export function openNote(sessionId: string, path: string): Record<string, unknown> {
  const nav = navigator as Nav;
  const area = readJson(storage("localStorage"), "jaga.area") as Area | null;
  const me = readJson(storage("localStorage"), "jaga.me") as MyPlaces | null;
  const paint = performance.getEntriesByName?.("first-contentful-paint")[0];
  const navEntry = performance.getEntriesByType?.("navigation")[0] as
    PerformanceNavigationTiming | undefined;
  let installed = false;
  try {
    installed = window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true;
  } catch {
    installed = nav.standalone === true;
  }
  let push = false;
  try {
    push = typeof Notification !== "undefined" && Notification.permission === "granted";
  } catch {
    push = false;
  }
  return {
    install: installId(),
    session: sessionId,
    path,
    locale: document.documentElement.lang,
    installed,
    push,
    signedIn: document.cookie.split(";").some((c) => isSessionCookie(c.trim().split("=")[0] ?? "")),
    tambon: area?.code ?? null,
    areaFrom: area?.from ?? null,
    watched: me && me.signedIn ? me.places.length : 0,
    memory: nav.deviceMemory ?? null,
    cores: nav.hardwareConcurrency ?? null,
    net: nav.connection?.effectiveType ?? null,
    screen: Math.round(window.screen?.width ?? window.innerWidth),
    touch: nav.maxTouchPoints ?? 0,
    fcp: paint ? Math.round(paint.startTime) : null,
    ready:
      navEntry && navEntry.domContentLoadedEventEnd > 0
        ? Math.round(navEntry.domContentLoadedEventEnd)
        : null,
  };
}

/** The open note, through Jaga's own server (which adds the rough city). */
export function sendOpen(note: Record<string, unknown>): void {
  const body = JSON.stringify(note);
  try {
    if (navigator.sendBeacon?.("/api/usage", new Blob([body], { type: "application/json" })))
      return;
  } catch {
    // Fall through to fetch.
  }
  fetch("/api/usage", {
    method: "POST",
    body,
    keepalive: true,
    headers: { "Content-Type": "application/json" },
  }).catch(() => {});
}

/** A page change or "still on screen", straight to the database. */
export function sendPing(sessionId: string, kind: "view" | "beat", path: string | null): void {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return;
  fetch(`${url}/rest/v1/rpc/usage_ping`, {
    method: "POST",
    keepalive: true,
    headers: { apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify({ p_session: sessionId, p_kind: kind, p_path: path }),
  }).catch(() => {});
}
