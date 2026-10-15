"use client";

import { useLocale } from "next-intl";
import { useEffect } from "react";
import { usePathname } from "@/i18n/navigation";
import { WARM_MESSAGE, warmDue, warmUrls, type WarmLocale } from "@/lib/offline-warm";
import { readStored, writeStored } from "@/lib/phone-store";

/** Pages where the phone's connection belongs to the person's own request, never to a warm-up. */
const BUSY = /^\/(sos|report|supplies)(\/|$)/;

/**
 * A9: once a day, when the phone is idle and has signal, ask the service worker to keep home,
 * SOS, food and water and the map ready for a visit with no signal (lib/offline-warm.ts). About
 * 100 kB compressed. Never on the SOS, report or supplies pages, never with Data Saver on, and
 * never before a service worker controls the page (none in development).
 */
export function OfflineWarmup() {
  const locale = useLocale() as WarmLocale;
  const pathname = usePathname();

  useEffect(() => {
    if (BUSY.test(pathname)) return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } })
      .connection;
    if (connection?.saveData) return;
    const key = `warm.${locale}`;
    if (!warmDue(readStored<number>(key), Date.now())) return;

    let cancelled = false;
    const run = async () => {
      if (cancelled || !navigator.onLine) return;
      const worker = navigator.serviceWorker.controller;
      if (!worker) return;
      const channel = new MessageChannel();
      const done = new Promise<{ ok: boolean; kept: number }>((resolve) => {
        channel.port1.onmessage = (event) => resolve(event.data);
      });
      worker.postMessage({ type: WARM_MESSAGE, urls: warmUrls(locale) }, [channel.port2]);
      const answer = await done;
      if (answer?.ok && answer.kept > 0) writeStored(key, Date.now());
    };
    const idle = (window as Window & { requestIdleCallback?: typeof requestIdleCallback })
      .requestIdleCallback;
    const timer = window.setTimeout(() => {
      if (idle) idle(() => void run(), { timeout: 10_000 });
      else void run();
    }, 4000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [locale, pathname]);

  return null;
}
