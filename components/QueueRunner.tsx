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
  // The photos and voice of a report sent without signal, once the report itself has arrived
  // (A9). Tried a little after the queue's own run, when the connection returns, and every 30 s.
  useEffect(() => {
    const send = async () => {
      try {
        if (!navigator.onLine) return;
        const list = await indexedDB.databases?.();
        if (list && !list.some((db) => db.name === "jaga-queue")) return;
        const { sendQueuedMedia } = await import("@/lib/queued-media");
        await sendQueuedMedia();
      } catch {
        // No IndexedDB, or nothing waiting.
      }
    };
    const first = window.setTimeout(send, 5000);
    const every = window.setInterval(send, 30_000);
    window.addEventListener("online", send);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(every);
      window.removeEventListener("online", send);
    };
  }, []);
  return null;
}
