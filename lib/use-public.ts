"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { coarse } from "@/lib/area";
import { whenIdle } from "@/lib/idle";
import { withoutPhones, type MyPlaces } from "@/lib/me";
import { readStored, useStored, writeStored } from "@/lib/phone-store";
import type { GaugeData } from "@/lib/map-data";
import type { NearbyPlaces } from "@/lib/places";
import { STATUS_URL, type PublicStatus } from "@/lib/public-status";
import { isSessionCookie } from "@/lib/supabase/env";

/** Users poll the alert status every 5 minutes, and when the app is opened again (CLAUDE.md). */
const POLL_MS = 5 * 60_000;

export type LoadState = "loading" | "ok" | "unavailable";

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return (await response.json()) as T;
}

/** How long to wait before trying a dropped request again. */
const TRY_AGAIN_MS = [1500, 4000];

/**
 * The same request, tried up to three times. A phone drops whatever is in flight the moment
 * Jaga on the home screen is switched away or the screen locks, and these answers are asked for
 * once, as a page opens: on 18 Oct signing in as an admin and then going to the mail app left
 * the Admin link missing until the app was started again. `stopped` is the hook being taken
 * off the page, and ends it at once.
 */
async function getJsonTrying<T>(url: string, stopped: () => boolean): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await getJson<T>(url);
    } catch (failure) {
      const wait = TRY_AGAIN_MS[attempt];
      if (wait === undefined || stopped()) throw failure;
      await new Promise((done) => setTimeout(done, wait));
      if (stopped()) throw failure;
    }
  }
}

/**
 * Ask again when the app comes back to the screen and when the connection returns, until an
 * answer has been had. Nothing is asked a second time once one arrives: these answers change
 * rarely, and a phone that has one must not spend a request on every glance at the app.
 */
function askUntilAnswered(ask: () => void): () => void {
  const onVisible = () => {
    if (document.visibilityState === "visible") ask();
  };
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("online", ask);
  window.addEventListener("pageshow", ask);
  return () => {
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("online", ask);
    window.removeEventListener("pageshow", ask);
  };
}

type StoredStatus = { status: PublicStatus; checkedAt: number };

/**
 * The public alert status. The last answer is kept on the phone, so it is there at once on the
 * next visit and when offline (safety rule 7); `checkedAt` says how old it is and `failed` that
 * the last try didn't get through.
 */
export function usePublicStatus(): {
  status: PublicStatus | null;
  checkedAt: number | null;
  failed: boolean;
  refresh: () => void;
} {
  const stored = useStored<StoredStatus>("status");
  const [failed, setFailed] = useState(false);
  const refresh = useCallback(() => {
    // The home page starts this request from its HTML, before the app's code has arrived.
    const early = window.__jagaStatus;
    window.__jagaStatus = undefined;
    const request = early
      ? early.then((status) => status ?? getJson<PublicStatus>(STATUS_URL))
      : getJson<PublicStatus>(STATUS_URL);
    request.then(
      (status) => {
        writeStored("status", { status, checkedAt: Date.now() } satisfies StoredStatus);
        setFailed(false);
      },
      () => setFailed(true),
    );
  }, []);
  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", refresh);
    };
  }, [refresh]);
  return {
    status: stored?.status ?? null,
    checkedAt: stored?.checkedAt ?? null,
    failed,
    refresh,
  };
}

function hasSession(): boolean {
  return document.cookie.split(";").some((c) => isSessionCookie(c.trim().split("=")[0] ?? ""));
}

const noSubscribe = () => () => {};

/**
 * Whether this browser holds a session, for the words of a link (Sign in or Account) and the
 * hints on features that need an account. False on the server and in the first paint, so a
 * visitor (the usual case) sees the invitation at once and someone signed in sees it turn into
 * Account as the page wakes. It only chooses words: what a session may read is RLS's to decide.
 */
export function useSignedIn(): boolean {
  return useSyncExternalStore(noSubscribe, hasSession, () => false);
}

/**
 * The signed-in person's home and watched places. Asked only when this browser holds a session,
 * so visitors never call the server for it. Phone numbers stay in memory; the rest is kept on
 * the phone for offline use and removed as soon as nobody is signed in.
 */
export function useMyPlaces(): MyPlaces | null {
  const stored = useStored<MyPlaces>("me");
  const [live, setLive] = useState<MyPlaces | null>(null);
  useEffect(() => {
    if (!hasSession()) {
      if (readStored("me") !== null) writeStored("me", null);
      return;
    }
    let cancelled = false;
    let answered = false;
    let busy = false;
    const ask = () => {
      if (cancelled || answered || busy) return;
      busy = true;
      getJsonTrying<MyPlaces>("/api/me/places", () => cancelled)
        .then(
          (me) => {
            if (cancelled) return;
            answered = true;
            writeStored("me", me.signedIn ? withoutPhones(me) : null);
            setLive(me);
          },
          () => {},
        )
        .finally(() => {
          busy = false;
        });
    };
    ask();
    const stopAsking = askUntilAnswered(ask);
    return () => {
      cancelled = true;
      stopAsking();
    };
  }, []);
  return live ?? stored;
}

/**
 * The signed-in person's role, for the Admin link in the header. Asked when the app opens and
 * only when this browser holds a session, so visitors never call the server for it; the
 * answer is kept on the phone, so the link is there at once on the next page and offline. It is
 * forgotten as soon as nobody is signed in.
 *
 * It only decides whether a link is drawn. The admin pages and row-level security decide what an
 * admin can actually do (safety rule 5), so a stale "admin" here opens nothing.
 *
 * A dropped request is tried again, and asked for afresh when the app comes back to the screen,
 * until an answer arrives: on an iPhone, signing in and then switching to the mail app used to
 * leave an admin with no way into the console until they closed Jaga and opened it again
 * (owner, 18 Oct).
 */
export function useMyRole(ask = true): string | null {
  const stored = useStored<string>("role");
  const [live, setLive] = useState<string | null>(null);
  useEffect(() => {
    if (!hasSession()) {
      if (readStored("role") !== null) writeStored("role", null);
      return;
    }
    if (!ask) return;
    let cancelled = false;
    let answered = false;
    let busy = false;
    const askNow = () => {
      if (cancelled || answered || busy) return;
      busy = true;
      getJsonTrying<{ role: string | null }>("/api/me/role", () => cancelled)
        .then(
          (me) => {
            if (cancelled) return;
            answered = true;
            writeStored("role", me.role);
            setLive(me.role);
          },
          () => {},
        )
        .finally(() => {
          busy = false;
        });
    };
    askNow();
    const stopAsking = askUntilAnswered(askNow);
    return () => {
      cancelled = true;
      stopAsking();
    };
  }, [ask]);
  return live ?? stored;
}

/** `checkedAt` since A9 (15 Oct 2026); lists kept before then have none. */
type StoredPlaces = { key: string; places: NearbyPlaces; checkedAt?: number };

/**
 * The top safe places from a point, sent rounded to about 100 m. Kept on the phone for offline.
 * When this visit could not refresh them, `savedAt` says when the list shown was kept (A9: every
 * saved item says how old it is); null otherwise, and for a list kept before the time was.
 */
export function useNearbyPlaces(point: { lat: number; lon: number } | null): {
  places: NearbyPlaces | null;
  state: LoadState;
  fromPhone: boolean;
  savedAt: number | null;
} {
  const key = point ? `${coarse(point.lat)},${coarse(point.lon)}` : null;
  const stored = useStored<StoredPlaces>("places");
  const [failedKey, setFailedKey] = useState<string | null>(null);
  useEffect(() => {
    if (!key) return;
    const [lat, lon] = key.split(",");
    let cancelled = false;
    getJson<NearbyPlaces>(`/api/public/places?lat=${lat}&lon=${lon}`).then(
      (places) => {
        if (cancelled) return;
        writeStored("places", { key, places, checkedAt: Date.now() } satisfies StoredPlaces);
        setFailedKey(null);
      },
      () => {
        if (!cancelled) setFailedKey(key);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key]);
  const places = key && stored?.key === key ? stored.places : null;
  const fromPhone = places !== null && failedKey === key;
  return {
    places,
    state: places ? "ok" : key && failedKey === key ? "unavailable" : "loading",
    fromPhone,
    savedAt: fromPhone ? (stored?.checkedAt ?? null) : null,
  };
}

/**
 * Fetch a public JSON address once (and again when `url` changes). Null `url`: nothing yet.
 * `servedAt` is when the server made the answer (its Date header): without signal the service
 * worker hands back the copy it kept, Date and all, so this says how old that copy is (A9).
 */
export function useFetched<T>(
  url: string | null,
  options: {
    /**
     * Hold the request until the page is quiet. For a background figure only - the hero, the
     * checklist and the SOS button must never wait behind one on a slow phone. Off by default,
     * so nothing that was asked for at once now arrives later.
     */
    afterIdle?: boolean;
  } = {},
): {
  data: T | null;
  state: LoadState;
  servedAt: number | null;
} {
  const afterIdle = options.afterIdle ?? false;
  const [result, setResult] = useState<{
    url: string;
    data: T | null;
    servedAt: number | null;
  } | null>(null);
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    const ask = () =>
      fetch(url, { cache: "no-store" })
        .then(async (response) => {
          if (!response.ok) throw new Error(`${url}: ${response.status}`);
          const date = Date.parse(response.headers.get("date") ?? "");
          return {
            data: (await response.json()) as T,
            servedAt: Number.isFinite(date) ? date : null,
          };
        })
        .then(
          ({ data, servedAt }) => {
            if (!cancelled) setResult({ url, data, servedAt });
          },
          () => {
            if (!cancelled) setResult({ url, data: null, servedAt: null });
          },
        );
    const cancelIdle = afterIdle ? whenIdle(ask) : (ask(), () => {});
    return () => {
      cancelled = true;
      cancelIdle();
    };
  }, [url, afterIdle]);
  if (!url || result?.url !== url) return { data: null, state: "loading", servedAt: null };
  return {
    data: result.data,
    state: result.data ? "ok" : "unavailable",
    servedAt: result.servedAt,
  };
}

const TICK_MS = 30_000;
function subscribeTick(onChange: () => void): () => void {
  const timer = window.setInterval(onChange, TICK_MS);
  return () => window.clearInterval(timer);
}

/** The current time, moving on every 30 s, so a stale marker appears without a reload. 0 on the server. */
export function useNow(): number {
  return useSyncExternalStore(
    subscribeTick,
    () => Math.floor(Date.now() / TICK_MS) * TICK_MS,
    () => 0,
  );
}

/** How often an open map asks for the gauges again (the budget's five minutes; CLAUDE.md). */
export const GAUGES_POLL_MS = 5 * 60_000;

/**
 * The river gauges, asked for when the map opens, every five minutes while the page is visible,
 * and at once when the person comes back to it. A failed ask keeps the last answer: a gauge goes
 * grey by its own reading's age, never because one request failed.
 */
export function useLiveGauges(url: string): { data: GaugeData | null; askedAt: number } {
  const [state, setState] = useState<{ data: GaugeData | null; askedAt: number }>({
    data: null,
    askedAt: 0,
  });
  useEffect(() => {
    let cancelled = false;
    let last = 0;
    const ask = () => {
      if (document.visibilityState !== "visible") return;
      last = Date.now();
      getJson<GaugeData>(url).then(
        (data) => {
          if (!cancelled) setState({ data, askedAt: Date.now() });
        },
        () => {},
      );
    };
    ask();
    const timer = window.setInterval(ask, GAUGES_POLL_MS);
    const back = () => {
      if (Date.now() - last > 60_000) ask();
    };
    document.addEventListener("visibilitychange", back);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", back);
    };
  }, [url]);
  return state;
}
