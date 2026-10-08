"use client";

import { useQueue } from "@/lib/use-sending";

/**
 * Nothing to see: it sends what is waiting in the offline queue whenever the app is opened or the
 * connection comes back, from whichever page the person lands on (safety rules 1 and 7). A
 * request for help must not wait for someone to open the SOS screen again.
 */
export function QueueRunner() {
  useQueue();
  return null;
}
