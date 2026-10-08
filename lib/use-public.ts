"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { coarse } from "@/lib/area";
import { withoutPhones, type MyPlaces } from "@/lib/me";
import { readStored, useStored, writeStored } from "@/lib/phone-store";
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
    getJson<MyPlaces>("/api/me/places").then(
      (me) => {
        if (cancelled) return;
        writeStored("me", me.signedIn ? withoutPhones(me) : null);
        setLive(me);
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, []);
  return live ?? stored;
}

type StoredPlaces = { key: string; places: NearbyPlaces };

/** The top safe places from a point, sent rounded to about 100 m. Kept on the phone for offline. */
export function useNearbyPlaces(point: { lat: number; lon: number } | null): {
  places: NearbyPlaces | null;
  state: LoadState;
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
        writeStored("places", { key, places } satisfies StoredPlaces);
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
  return { places, state: places ? "ok" : key && failedKey === key ? "unavailable" : "loading" };
}

/** Fetch a public JSON address once (and again when `url` changes). Null `url`: nothing yet. */
export function useFetched<T>(url: string | null): { data: T | null; state: LoadState } {
  const [result, setResult] = useState<{ url: string; data: T | null } | null>(null);
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    getJson<T>(url).then(
      (data) => {
        if (!cancelled) setResult({ url, data });
      },
      () => {
        if (!cancelled) setResult({ url, data: null });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [url]);
  if (!url || result?.url !== url) return { data: null, state: "loading" };
  return { data: result.data, state: result.data ? "ok" : "unavailable" };
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
