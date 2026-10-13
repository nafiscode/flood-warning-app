"use client";

import { useEffect } from "react";
import { useQueue } from "@/lib/use-sending";

/**
 * Nothing to see: it sends what is waiting in the offline queue whenever the app is opened or the
 * connection comes back, from whichever page the person lands on (safety rules 1 and 7). A
 * request for help must not wait for someone to open the SOS screen again.
 */
export function QueueRunner() {
  useQueue();
  // A team's field rescues recorded without a signal (the owner, 14 Oct). The code that sends
  // them is only fetched on a phone that actually has some waiting, so nobody else pays for it.
  useEffect(() => {
    const flush = async () => {
      try {
        const list = await indexedDB.databases?.();
        if (!list?.some((db) => db.name === "jaga-field")) return;
        const { flushFields } = await import("@/lib/field-queue");
        await flushFields();
      } catch {
        // No IndexedDB here, or it is switched off: there is nothing waiting to send.
      }
    };
    void flush();
    window.addEventListener("online", flush);
    return () => window.removeEventListener("online", flush);
  }, []);
  return null;
}
