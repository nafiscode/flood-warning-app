"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { flush, type Delivered, pending, type Queued, takeDelivered } from "@/lib/queue";
import { rememberCase, rememberedCases, type SentSos } from "@/lib/sos";

/**
 * The phone side of sending: where the person is, how full the battery is, and emptying the
 * offline queue. Kept apart from the screens so both the SOS and the report form use the same
 * behaviour, and so the queue is retried wherever the app is opened (safety rules 1 and 7).
 */

export type Located = {
  point: { lat: number; lon: number } | null;
  accuracy: number | null;
  state: "idle" | "locating" | "found" | "failed";
  /** Ask again (after the person turned GPS on, or to follow them while a case is open). */
  locate: () => void;
};

/**
 * The person's location. An SOS screen starts asking the moment it opens, so the location is
 * usually ready before the button is pressed; `watch` keeps it fresh while a case is open.
 */
export function useLocation(options: { start?: boolean; watch?: boolean } = {}): Located {
  const { start = true, watch = false } = options;
  const [point, setPoint] = useState<{ lat: number; lon: number } | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  // Asking starts with the screen, so "locating" is where it begins rather than a first render
  // that says "no location" and corrects itself a moment later.
  const [state, setState] = useState<Located["state"]>(start ? "locating" : "idle");
  const [asked, setAsked] = useState(0);

  const locate = useCallback(() => {
    setState((current) => (current === "found" ? current : "locating"));
    setAsked((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!start && asked === 0) return;
    const geolocation = typeof navigator === "undefined" ? undefined : navigator.geolocation;
    if (!geolocation) {
      // Not in this browser: say so, but after this render rather than during it.
      queueMicrotask(() => setState("failed"));
      return;
    }
    const accept = (position: GeolocationPosition) => {
      setPoint({ lat: position.coords.latitude, lon: position.coords.longitude });
      setAccuracy(Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null);
      setState("found");
    };
    const refuse = () => setState((current) => (current === "found" ? current : "failed"));
    const settings: PositionOptions = {
      enableHighAccuracy: true,
      timeout: 20_000,
      maximumAge: 30_000,
    };
    if (!watch) {
      geolocation.getCurrentPosition(accept, refuse, settings);
      return;
    }
    const id = geolocation.watchPosition(accept, refuse, settings);
    return () => geolocation.clearWatch(id);
  }, [start, watch, asked]);

  return { point, accuracy, state, locate };
}

/** How full the battery is, where the browser says (Chrome on Android). Never asked for twice. */
export function useBattery(): number | null {
  const [level, setLevel] = useState<number | null>(null);
  useEffect(() => {
    const api = navigator as Navigator & { getBattery?: () => Promise<{ level: number }> };
    if (!api.getBattery) return;
    let cancelled = false;
    api
      .getBattery()
      .then((battery) => {
        if (!cancelled && Number.isFinite(battery.level)) {
          setLevel(Math.round(battery.level * 100));
        }
      })
      .catch(() => {
        // Not available: an SOS is sent without it.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return level;
}

/** What a delivered SOS means for the phone's memory of its cases. */
function remember(delivered: Delivered[]): void {
  for (const item of delivered) {
    if (item.kind !== "sos") continue;
    const result = item.result as unknown as SentSos;
    if (!result?.id) continue;
    const earlier = rememberedCases().find((c) => c.queueKey === item.key);
    rememberCase({
      id: result.id,
      token: result.token ?? earlier?.token ?? null,
      status: result.status ?? "received",
      createdAt: result.createdAt ?? item.at,
      queueKey: null,
    });
  }
}

export type QueueState = { left: number; failed: number; delivered: Delivered[] };

/**
 * Empty the queue: when the app opens, when the connection comes back, when the app is brought
 * forward again, and - while something is waiting - every 15 seconds. Background Sync does the
 * same from the service worker where the browser has it; doing both is harmless, because an item
 * is removed from the queue only once it has been accepted.
 */
export function useQueue(options: { poll?: boolean } = {}): QueueState & { run: () => void } {
  const { poll = false } = options;
  const [state, setState] = useState<QueueState>({ left: 0, failed: 0, delivered: [] });
  const running = useRef(false);

  const run = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      const result = await flush();
      const delivered = await takeDelivered();
      remember(delivered);
      const left = await pending();
      setState({
        left: left.filter((item: Queued) => !item.failed).length,
        failed: left.filter((item: Queued) => item.failed).length || result.failed,
        delivered,
      });
    } finally {
      running.current = false;
    }
  }, []);

  useEffect(() => {
    void run();
    const again = () => void run();
    window.addEventListener("online", again);
    document.addEventListener("visibilitychange", again);
    const timer = poll ? window.setInterval(again, 15_000) : null;
    return () => {
      window.removeEventListener("online", again);
      document.removeEventListener("visibilitychange", again);
      if (timer) window.clearInterval(timer);
    };
  }, [run, poll]);

  return { ...state, run };
}
