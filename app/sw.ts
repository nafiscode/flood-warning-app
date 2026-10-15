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
import {
  CacheableResponsePlugin,
  CacheFirst,
  ExpirationPlugin,
  NetworkFirst,
  NetworkOnly,
  Serwist,
} from "serwist";
import {
  isPublicData,
  mapAsset,
  offlinePageFor,
  PAGES_CACHE,
  PUBLIC_DATA_CACHE,
  WARM_MESSAGE,
} from "@/lib/offline-warm";
import { readPayload } from "@/lib/push";
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
    // A9: public answers that are the same for everyone (the area list, tambon outlines, the
    // map's alert colours and safe places) are asked for first and kept for offline, so the SOS
    // screen's "choose your area" and the map still work without signal. Before the private rule,
    // which covers all of /api/.
    {
      matcher: ({ url, sameOrigin, request }) =>
        sameOrigin && request.method === "GET" && isPublicData(url.pathname),
      handler: new NetworkFirst({
        cacheName: PUBLIC_DATA_CACHE,
        networkTimeoutSeconds: 6,
        plugins: [
          new CacheableResponsePlugin({ statuses: [200] }),
          new ExpirationPlugin({ maxEntries: 24, maxAgeSeconds: 14 * 24 * 60 * 60 }),
        ],
      }),
    },
    // Personal and sign-in pages are never stored: on a shared phone the next person must not
    // see the last person's account, cases or admin screens from the cache.
    {
      matcher: ({ url, sameOrigin }) => sameOrigin && PRIVATE_PATH.test(url.pathname),
      handler: new NetworkOnly(),
    },
    // Page loads: network first, but give up after 5 s on a bad connection and use the copy of
    // this exact page from the last visit, or from the warm-up (below). A page never visited falls
    // back to the offline page in its own language. Serwist's defaults match pages by a
    // Content-Type request header that navigations don't send. ignoreVary: a warmed copy was
    // fetched by the worker, not by a navigation, and Next's Vary headers would hide it.
    {
      matcher: ({ request, sameOrigin }) => sameOrigin && request.mode === "navigate",
      handler: new NetworkFirst({
        cacheName: PAGES_CACHE,
        networkTimeoutSeconds: 5,
        matchOptions: { ignoreVary: true },
        plugins: [new ExpirationPlugin({ maxEntries: 32, maxAgeSeconds: 7 * 24 * 60 * 60 })],
      }),
    },
    // A9: the app's own fonts, kept for good (their names change with every new file). The
    // default font cache holds only 4 files, fewer than the Thai font's weights and subsets.
    {
      matcher: ({ url, sameOrigin }) =>
        sameOrigin && url.pathname.startsWith("/_next/static/media/"),
      handler: new CacheFirst({
        cacheName: "app-fonts",
        plugins: [
          new CacheableResponsePlugin({ statuses: [200] }),
          new ExpirationPlugin({ maxEntries: 40, maxAgeSeconds: 365 * 24 * 60 * 60 }),
        ],
      }),
    },
    // A9: map tiles the person has looked at stay on the phone for a month, so the area they
    // know still draws offline. Only what was viewed: no download in the background (OpenFreeMap's
    // terms; decision 15 Oct 2026). About 600 tiles is a few tens of MB at most.
    {
      matcher: ({ url }) => mapAsset(url) === "tile",
      handler: new CacheFirst({
        cacheName: "map-tiles",
        plugins: [
          new CacheableResponsePlugin({ statuses: [200] }),
          new ExpirationPlugin({
            maxEntries: 600,
            maxAgeSeconds: 30 * 24 * 60 * 60,
            purgeOnQuotaError: true,
          }),
        ],
      }),
    },
    {
      matcher: ({ url }) => mapAsset(url) === "style",
      handler: new NetworkFirst({
        cacheName: "map-styles",
        networkTimeoutSeconds: 6,
        plugins: [
          new CacheableResponsePlugin({ statuses: [200] }),
          new ExpirationPlugin({ maxEntries: 60, maxAgeSeconds: 30 * 24 * 60 * 60 }),
        ],
      }),
    },
    ...defaultCache,
  ],
  fallbacks: {
    entries: [
      {
        url: "/ms/offline",
        matcher: ({ request }) =>
          request.destination === "document" &&
          offlinePageFor(new URL(request.url).pathname) === "/ms/offline",
      },
      {
        url: "/en/offline",
        matcher: ({ request }) =>
          request.destination === "document" &&
          offlinePageFor(new URL(request.url).pathname) === "/en/offline",
      },
      {
        url: "/offline",
        matcher: ({ request }) => request.destination === "document",
      },
    ],
  },
});

serwist.addEventListeners();

/**
 * A9 warm-up: the page asks for a short list of addresses (lib/offline-warm.ts) and the worker
 * fetches them into the caches above, so they open with no signal even if never visited. Fetched
 * without cookies, so a stored copy never holds anyone's account; a redirect or an error is not
 * stored. The page is told when it is done, and keeps the time on the phone.
 */
type WarmMessage = { type: typeof WARM_MESSAGE; urls: string[] };

async function warm(urls: string[]): Promise<number> {
  const pages = await caches.open(PAGES_CACHE);
  const data = await caches.open(PUBLIC_DATA_CACHE);
  let kept = 0;
  for (const raw of urls) {
    const url = new URL(raw, self.location.origin);
    if (url.origin !== self.location.origin) continue;
    const isData = isPublicData(url.pathname);
    if (!isData && PRIVATE_PATH.test(url.pathname)) continue;
    try {
      const response = await fetch(url.href, { credentials: "omit", cache: "no-store" });
      if (!response.ok || response.redirected) continue;
      await (isData ? data : pages).put(url.href, response);
      kept += 1;
    } catch {
      // No signal or a slow server: the next warm-up tries again.
    }
  }
  return kept;
}

self.addEventListener("message", (event) => {
  const message = event.data as WarmMessage | null;
  if (message?.type !== WARM_MESSAGE || !Array.isArray(message.urls)) return;
  const urls = message.urls.filter((u): u is string => typeof u === "string").slice(0, 12);
  const reply = event.ports?.[0];
  event.waitUntil(
    warm(urls).then(
      (kept) => reply?.postMessage({ ok: true, kept }),
      () => reply?.postMessage({ ok: false, kept: 0 }),
    ),
  );
});

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

/**
 * Web push (A7): an alert a person published, an SOS offered to a team, or a step of one's own
 * request, arriving with the app closed. The message carries
 * the level and the reviewed words; the notification is shown at once, because a push that shows
 * nothing loses the browser's permission to be sent. One alert is one notification: a
 * replacement with the same tag takes the old one's place and still makes itself heard.
 */
self.addEventListener("push", (event) => {
  let raw: unknown = null;
  try {
    raw = event.data?.json();
  } catch {
    // Not JSON: not one of ours.
  }
  const payload = readPayload(raw);
  if (!payload) return;
  // An open Jaga should not wait for its next five-minute look: tell it now, so the bell fills
  // and the app's own sound for this kind of thing plays (the owner, 13 Oct: it came late).
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windows) =>
        windows.forEach((w) => w.postMessage({ type: "jaga-push", kind: payload.kind })),
      )
      .catch(() => {}),
  );
  // The app icon is flagged too, where the system allows it; the real count replaces the flag
  // as soon as Jaga is opened and the bell has counted.
  const badge = (self.navigator as Navigator & { setAppBadge?: () => Promise<void> }).setAppBadge;
  if (badge) event.waitUntil(badge.call(self.navigator).catch(() => {}));
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: payload.url },
      // An evacuation stays on the screen until the person has dealt with it.
      requireInteraction: payload.kind === "alert" ? payload.level === "evacuate" : payload.sticky,
      ...({ renotify: true } as object),
    }),
  );
});

/** A tap on the notification opens Jaga on the home screen, in the window it already has. */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(
    (event.notification.data as { url?: string } | null)?.url ?? "/",
    self.location.origin,
  ).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if ("focus" in client) {
          await client.navigate(url).catch(() => null);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })(),
  );
});
