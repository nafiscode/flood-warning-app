import { FIELD_URL, toFieldResult, type FieldResult } from "@/lib/field-rescue";
import { compressImage } from "@/lib/media";
import type { Vulnerable } from "@/lib/sos";
import { uploadFieldPhotos } from "@/lib/upload";

/**
 * A rescue recorded where there was no signal (the owner, 14 Oct). Everything is taken at the
 * place - the phone's position and its time, the number, the photo - and kept on this phone
 * until it can be sent. The server then holds every late arrival for an admin, because it cannot
 * vouch for a time it did not see.
 *
 * Kept in IndexedDB because a photo does not fit in localStorage. What is kept includes the
 * rescued person's phone number: it stays on this phone only, and is removed the moment the
 * record has been sent (or refused for good).
 */

const DB = "jaga-field";
const STORE = "records";

export type QueuedField = {
  id: string;
  unitId: string;
  lat: number;
  lon: number;
  accuracy: number | null;
  locatedAt: string;
  people: number;
  vulnerable: Vulnerable[];
  phone: string;
  note: string;
  /** Already shrunk, so the phone is not asked to hold full-size pictures. */
  photos: Blob[];
  /** Paths of photos that reached storage on an earlier try, so they are not sent twice. */
  uploaded?: string[];
};

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = work(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

/** Keep a record for later. The photos are shrunk first; one that cannot be read is left out. */
export async function keepField(record: Omit<QueuedField, "photos">, photos: Blob[]) {
  const small: Blob[] = [];
  for (const photo of photos.slice(0, 3)) {
    try {
      small.push((await compressImage(photo)).blob);
    } catch {
      small.push(photo);
    }
  }
  await withStore("readwrite", (s) => s.put({ ...record, photos: small } satisfies QueuedField));
}

export async function waitingFields(): Promise<QueuedField[]> {
  if (typeof indexedDB === "undefined") return [];
  try {
    return await withStore<QueuedField[]>("readonly", (s) => s.getAll());
  } catch {
    return [];
  }
}

export type SendOutcome =
  | { kind: "sent"; result: FieldResult }
  /** Refused for a reason that trying again will not change: the record is let go. */
  | { kind: "refused"; error: string }
  /** No signal, or the server could not be reached: it stays on the phone. */
  | { kind: "later" };

/** What the server said, in the three ways that matter to a queue. */
export function outcomeOf(status: number, body: unknown): SendOutcome {
  const b = (body ?? {}) as { result?: Record<string, unknown>; error?: string };
  const result = toFieldResult(b.result);
  if (status >= 200 && status < 300 && result) return { kind: "sent", result };
  // Not signed in any more is not final: signing in again lets it go.
  if (status === 401 || status >= 500 || status === 0) return { kind: "later" };
  // "duplicate" means an earlier try did arrive: the record is already there.
  return { kind: "refused", error: typeof b.error === "string" ? b.error : "failed" };
}

/**
 * Send one record: its photos first, then the record itself. `kept` says the record is one of
 * those waiting on the phone, so what was achieved is written back to it; a record being sent
 * straight from the form must leave nothing behind on the phone.
 */
export async function sendField(record: QueuedField, kept = false): Promise<SendOutcome> {
  let paths = record.uploaded ?? [];
  if (paths.length === 0) {
    const up = await uploadFieldPhotos(record.unitId, record.id, record.photos).catch(() => null);
    if (!up || up.photos.length === 0) return { kind: "later" };
    paths = up.photos;
    // Remembered at once, in case the next step fails: the photo is not sent a second time.
    if (kept) {
      await withStore("readwrite", (s) => s.put({ ...record, uploaded: paths })).catch(() => {});
    }
  }
  let response: Response;
  try {
    response = await fetch(FIELD_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: record.id,
        lat: record.lat,
        lon: record.lon,
        accuracy: record.accuracy,
        locatedAt: record.locatedAt,
        people: record.people,
        vulnerable: record.vulnerable,
        phone: record.phone,
        note: record.note,
        photos: paths,
      }),
    });
  } catch {
    return { kind: "later" };
  }
  return outcomeOf(response.status, await response.json().catch(() => null));
}

let running: Promise<{ sent: number; left: number }> | null = null;

/**
 * Try everything that is waiting, one at a time. Safe to call from several places at once (the
 * page, the "back online" event): a second call joins the first.
 */
export function flushFields(): Promise<{ sent: number; left: number }> {
  running ??= (async () => {
    let sent = 0;
    let left = 0;
    for (const record of await waitingFields()) {
      const outcome = await sendField(record, true);
      if (outcome.kind === "later") left += 1;
      else {
        if (outcome.kind === "sent") sent += 1;
        await withStore("readwrite", (s) => s.delete(record.id)).catch(() => {});
      }
    }
    return { sent, left };
  })().finally(() => {
    running = null;
  });
  return running;
}
