/**
 * The offline queue for everything the app sends on someone's behalf: an SOS first of all, and
 * flood reports and later detail steps (safety rules 1 and 7).
 *
 * It lives in IndexedDB rather than the phone's small storage, and uses nothing from `window`, so
 * both the page and the service worker can empty it: the page tries again when the connection
 * returns and whenever the app is opened, and the service worker tries again through Background
 * Sync where the browser has it (Chrome; Safari has no Background Sync, hence the page retries).
 *
 * The answer to a sent item (a new case id and its token) is kept in the queue's own store,
 * because a service worker cannot write the phone's storage. Whichever page runs next collects it
 * and writes the case into the phone's memory of its own cases (lib/sos.ts, lib/use-sending.ts).
 */
const DB_NAME = "jaga-queue";
const DB_VERSION = 1;
const PENDING = "pending";
const DELIVERED = "delivered";

export const SYNC_TAG = "jaga-queue";

export type QueuedKind = "sos" | "sos-details" | "sos-location" | "sos-close" | "report";

export type Queued = {
  /** Local id, also the order: time plus a random tail, so it sorts by when it was added. */
  key: string;
  kind: QueuedKind;
  url: string;
  body: Record<string, unknown>;
  createdAt: string;
  tries: number;
  /** Set when the server refused the item for good; the UI then tells the person plainly. */
  failed?: string;
};

export type Delivered = {
  key: string;
  kind: QueuedKind;
  at: string;
  result: Record<string, unknown>;
};

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PENDING)) db.createObjectStore(PENDING, { keyPath: "key" });
      if (!db.objectStoreNames.contains(DELIVERED))
        db.createObjectStore(DELIVERED, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB is not available"));
  });
}

function run<T>(store: string, mode: IDBTransactionMode, work: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const request = work(tx.objectStore(store));
        request.onsuccess = () => resolve(request.result as T);
        request.onerror = () => reject(request.error ?? new Error("IndexedDB write failed"));
        tx.oncomplete = () => db.close();
      }),
  );
}

function newKey(): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `${Date.now().toString().padStart(14, "0")}-${random}`;
}

/** Put an item in the queue. Never throws: a phone with no IndexedDB still sends when online. */
export async function enqueue(
  kind: QueuedKind,
  url: string,
  body: Record<string, unknown>,
): Promise<string | null> {
  const item: Queued = { key: newKey(), kind, url, body, createdAt: new Date().toISOString(), tries: 0 };
  try {
    await run(PENDING, "readwrite", (s) => s.put(item));
  } catch {
    return null;
  }
  // Not awaited: the item is already safe on the phone, and nothing the person sees may wait for
  // the service worker (navigator.serviceWorker.ready never resolves where there is none).
  void askForSync();
  return item.key;
}

export async function pending(): Promise<Queued[]> {
  try {
    const all = await run<Queued[]>(PENDING, "readonly", (s) => s.getAll());
    return all.sort((a, b) => a.key.localeCompare(b.key));
  } catch {
    return [];
  }
}

export async function takeDelivered(): Promise<Delivered[]> {
  try {
    const all = await run<Delivered[]>(DELIVERED, "readonly", (s) => s.getAll());
    for (const item of all) await run(DELIVERED, "readwrite", (s) => s.delete(item.key));
    return all.sort((a, b) => a.key.localeCompare(b.key));
  } catch {
    return [];
  }
}

/** Ask the browser to send the queue in the background, even if the app is closed (Chrome). */
async function askForSync(): Promise<void> {
  try {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    // ready never resolves when no worker is registered (a blocked or first-ever load), so this
    // gives up after five seconds rather than hanging.
    const ready = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 5_000)),
    ]);
    const registration = ready as (ServiceWorkerRegistration & {
      sync?: { register: (tag: string) => Promise<void> };
    }) | null;
    await registration?.sync?.register(SYNC_TAG);
  } catch {
    // No Background Sync (Safari) or permission refused: the page's own retries cover it.
  }
}

export type FlushResult = { sent: number; left: number; failed: number };

/**
 * One run at a time in this browsing context. Several screens ask for a flush (the SOS screen,
 * the report form, the app shell), and two runs at once could send the same item twice.
 */
let running: Promise<FlushResult> | null = null;

/**
 * Try to send everything in the queue, oldest first. Order matters: a detail step must not pass
 * the SOS it belongs to, so a network failure stops the run and leaves the rest for later.
 * A refusal the server will give again (a 4xx that is not 429) marks the item failed instead of
 * jamming the queue for ever; the page then shows it and keeps the hotlines in reach.
 */
export function flush(): Promise<FlushResult> {
  if (!running) {
    running = run_().finally(() => {
      running = null;
    });
  }
  return running;
}

async function run_(): Promise<FlushResult> {
  const items = await pending();
  let sent = 0;
  let failed = 0;
  for (const item of items) {
    if (item.failed) {
      failed += 1;
      continue;
    }
    let response: Response;
    try {
      response = await fetch(item.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item.body),
        // The queue is the retry; a redirect or cache would only confuse it.
        cache: "no-store",
        redirect: "follow",
      });
    } catch {
      // Still offline. Leave this item and everything after it.
      return { sent, left: items.length - sent - failed, failed };
    }
    if (response.ok) {
      let result: Record<string, unknown> = {};
      try {
        result = (await response.json()) as Record<string, unknown>;
      } catch {
        result = {};
      }
      await run(DELIVERED, "readwrite", (s) =>
        s.put({ key: item.key, kind: item.kind, at: new Date().toISOString(), result } as Delivered),
      );
      await run(PENDING, "readwrite", (s) => s.delete(item.key));
      sent += 1;
      continue;
    }
    const permanent = response.status >= 400 && response.status < 500 && response.status !== 429;
    if (permanent) {
      await run(PENDING, "readwrite", (s) =>
        s.put({ ...item, tries: item.tries + 1, failed: `http_${response.status}` } as Queued),
      );
      failed += 1;
      continue;
    }
    // A server that is briefly unwell (5xx, 429): keep the order and try again later.
    await run(PENDING, "readwrite", (s) => s.put({ ...item, tries: item.tries + 1 } as Queued));
    return { sent, left: items.length - sent - failed, failed };
  }
  return { sent, left: 0, failed };
}

/** Forget one item (the person gave up on it, or it was replaced). */
export async function drop(key: string): Promise<void> {
  try {
    await run(PENDING, "readwrite", (s) => s.delete(key));
  } catch {
    // Nothing to do: the queue is gone anyway.
  }
}
