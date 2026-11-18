"use client";

import { useCallback, useEffect, useState } from "react";
import { whenIdle } from "@/lib/idle";
import { readStored, useStored, writeStored } from "@/lib/phone-store";
import type { TmdWarning } from "@/lib/tmd";

/** TMD announces a few times a day; the edge keeps one answer for ten minutes. */
const POLL_MS = 15 * 60_000;

/** Kept on the phone so the notice is on screen before the network answers, and offline too. */
const KEY = "tmd.warnings";

type Stored = { warnings: TmdWarning[]; fetchedAt: number };

let inflight: Promise<Stored> | null = null;

function load(): Promise<Stored> {
  if (inflight) return inflight;
  inflight = fetch("/api/public/tmd/warnings", { cache: "no-store" })
    .then((response) => {
      if (!response.ok) throw new Error(String(response.status));
      return response.json() as Promise<{ warnings: TmdWarning[] }>;
    })
    .then((body) => ({ warnings: body.warnings ?? [], fetchedAt: Date.now() }))
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/**
 * TMD's current warnings for the South (the owner's request, 18 Nov 2026).
 *
 * Nothing here blocks or delays a screen: the notice appears when it arrives, and its absence
 * looks exactly like a quiet day. The last answer stays on the phone with the time it was fetched,
 * so a reader with no connection still sees the warning that was running when they last had one -
 * and `staleAfterMs` lets a screen stop showing it once it is too old to stand behind.
 */
export function useTmdWarnings(enabled = true): {
  warnings: TmdWarning[];
  fetchedAt: number | null;
} {
  const stored = useStored<Stored>(KEY);
  const [, setTick] = useState(0);

  const refresh = useCallback(() => {
    load().then(
      (fresh) => {
        const now = readStored<Stored>(KEY);
        // Don't replace a newer answer with a slower one that started earlier.
        if (now && now.fetchedAt > fresh.fetchedAt) return;
        writeStored(KEY, fresh);
      },
      // A failed fetch keeps whatever the phone had. TMD being unreachable is not an emergency,
      // and a red error box about a third party would only frighten people.
      () => setTick((n) => n + 1),
    );
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const cancelIdle = whenIdle(refresh);
    const timer = window.setInterval(refresh, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", refresh);
    return () => {
      cancelIdle();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", refresh);
    };
  }, [enabled, refresh]);

  return { warnings: stored?.warnings ?? [], fetchedAt: stored?.fetchedAt ?? null };
}
