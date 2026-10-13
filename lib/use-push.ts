"use client";

import { useCallback, useEffect, useState } from "react";
import { readStored, writeStored } from "@/lib/phone-store";
import { keyBytes, pushState, type PushState } from "@/lib/push";

const PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

const apple = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  // An iPad that says it is a Mac.
  (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
const standalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;
const hasPush = () =>
  PUBLIC_KEY !== "" &&
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window;

/** This browser's subscription, if it has one. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  return current();
}

async function current(): Promise<PushSubscription | null> {
  if (!hasPush()) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  return (await registration?.pushManager.getSubscription()) ?? null;
}

async function save(sub: PushSubscription, tambons: string[], locale: string): Promise<boolean> {
  const json = sub.toJSON();
  const response = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys, tambons, locale }),
    cache: "no-store",
  });
  if (response.ok) writeStored("push.sent", `${locale}:${tambons.join(",")}`);
  return response.ok;
}

/**
 * Notifications on this phone (A7): whether they can be asked for, are on, or are blocked, and
 * the two things a person can do about it.
 *
 * Asking happens only from a tap (browsers require it, and a permission box nobody asked for is
 * how people learn to say no). Once on, the tambons this phone follows are sent again whenever
 * they change, so an alert for a place added yesterday reaches it today. No tambons, no
 * question: there would be nothing to notify about.
 */
export function usePush(
  tambons: string[],
  locale: string,
): {
  state: PushState | null;
  busy: boolean;
  failed: boolean;
  enable: () => Promise<void>;
  disable: () => Promise<void>;
} {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const key = tambons.join(",");

  // After a tap: read the phone again and show what it says now.
  const look = useCallback(async () => {
    const sub = await current().catch(() => null);
    setState(
      pushState({
        hasPush: hasPush(),
        permission: "Notification" in window ? Notification.permission : null,
        apple: apple(),
        standalone: standalone(),
        subscribed: sub !== null,
      }),
    );
    return sub;
  }, []);

  useEffect(() => {
    let cancelled = false;
    current()
      .catch(() => null)
      .then((sub) => {
        if (cancelled) return;
        setState(
          pushState({
            hasPush: hasPush(),
            permission: "Notification" in window ? Notification.permission : null,
            apple: apple(),
            standalone: standalone(),
            subscribed: sub !== null,
          }),
        );
        // Already on: keep the server's copy of the followed tambons in step with the phone's.
        if (!sub || Notification.permission !== "granted" || key === "") return;
        if (readStored<string>("push.sent") === `${locale}:${key}`) return;
        void save(sub, key.split(","), locale).catch(() => {});
      });
    return () => {
      cancelled = true;
    };
  }, [key, locale]);

  const enable = useCallback(async () => {
    setBusy(true);
    setFailed(false);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        await look();
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const sub =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes(PUBLIC_KEY),
        }));
      if (!(await save(sub, key === "" ? [] : key.split(","), locale))) throw new Error("save");
      await look();
    } catch {
      setFailed(true);
      await look().catch(() => {});
    } finally {
      setBusy(false);
    }
  }, [key, locale, look]);

  const disable = useCallback(async () => {
    setBusy(true);
    setFailed(false);
    try {
      const sub = await current();
      if (sub) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
          cache: "no-store",
        });
        await sub.unsubscribe();
      }
      writeStored("push.sent", null);
      await look();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }, [look]);

  return { state, busy, failed, enable, disable };
}
