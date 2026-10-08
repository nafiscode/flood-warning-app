/// <reference lib="webworker" />
/**
 * Jaga's service worker (bundled by app/serwist/[path]/route.ts).
 * A0: precaches the app shell and falls back to /offline for pages that can't load.
 * The last alert status and top-3 safe places are kept by the home screen itself, in the phone's
 * storage (lib/phone-store.ts), so they show offline with the cached page (safety rule 7).
 * A4: it also empties the offline queue (lib/queue.ts) through Background Sync, so a queued SOS
 * goes out as soon as the phone has signal again even if the app was closed (safety rules 1, 7).
 */
import { defaultCache } from "@serwist/turbopack/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { ExpirationPlugin, NetworkFirst, NetworkOnly, Serwist } from "serwist";
import { flush, SYNC_TAG } from "@/lib/queue";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

// With or without a language prefix (/ms/account, /account).
const PRIVATE_PATH = /^\/(?:(?:th|ms|en)\/)?(?:account|admin|authority|sign-in|api)(?:\/|$)/;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    // Personal and sign-in pages are never stored: on a shared phone the next person must not
    // see the last person's account, cases or admin screens from the cache.
    {
      matcher: ({ url, sameOrigin }) => sameOrigin && PRIVATE_PATH.test(url.pathname),
      handler: new NetworkOnly(),
    },
    // Page loads: network first, but give up after 5 s on a bad connection and use the copy of
    // this exact page from the last visit. A page never visited falls back to /offline (below).
    // Serwist's defaults match pages by a Content-Type request header that navigations don't send.
    {
      matcher: ({ request, sameOrigin }) => sameOrigin && request.mode === "navigate",
      handler: new NetworkFirst({
        cacheName: "pages-html",
        networkTimeoutSeconds: 5,
        plugins: [new ExpirationPlugin({ maxEntries: 32, maxAgeSeconds: 7 * 24 * 60 * 60 })],
      }),
    },
    ...defaultCache,
  ],
  fallbacks: {
    entries: [
      {
        url: "/offline",
        matcher: ({ request }) => request.destination === "document",
      },
    ],
  },
});

serwist.addEventListeners();

/**
 * Background Sync: the browser wakes this worker when the connection is back and lets it send
 * what is waiting. Chrome has it; Safari does not, where the page's own retries do the same job.
 * The queue removes an item only once the server has accepted it, so trying twice is harmless.
 */
type SyncEvent = ExtendableEvent & { tag: string };

self.addEventListener("sync", (event) => {
  const sync = event as SyncEvent;
  if (sync.tag !== SYNC_TAG) return;
  sync.waitUntil(flush());
});
