"use client";

import { ASK_GAP_MS, type AskMemory } from "@/lib/feedback";
import { readStored, useStored, writeStored } from "@/lib/phone-store";

/**
 * What the phone remembers about feedback: when it last asked, and the comments it sent.
 *
 * **Why the phone and not the account.** Spec 17 gives an anonymous sender the same power over
 * their own published comment as a signed-in one, and the only thing that can stand for "the
 * person who wrote this" without an account is a secret the phone kept - the same device
 * the request-for-help flow reads a case back with. So the key lives here, in the phone's own
 * storage, and nowhere else: the database holds only its hash.
 *
 * A cleared browser therefore loses the power to withdraw an anonymous comment. That is the price
 * of not demanding an account to speak, and it is the right way round: the comment stays
 * anonymous, and an admin can always take it down on request.
 */

/** "Asked once, and never again within 30 days on that phone" (spec 17). */
const ASKED = "feedback.asked";
/** The comments this device sent, newest last. */
const SENT = "feedback.sent";
/** At most this many are remembered; a phone needs its own last few, not a history. */
const KEEP = 10;

export type SentFeedback = {
  id: string;
  /** The withdrawal key, for a comment sent without an account. Null when signed in. */
  key: string | null;
  /** Whether the sender asked for it to be shown on the page at all. */
  publicOk: boolean;
  at: string;
};

export function askedAt(): number | null {
  const memory = readStored<AskMemory>(ASKED);
  return typeof memory?.shownAt === "number" ? memory.shownAt : null;
}

/** The ask has been put in front of somebody: the 30 days start now, answered or not. */
export function markAsked(sent = false): void {
  writeStored(ASKED, { shownAt: Date.now(), sent } satisfies AskMemory);
}

/** React to the ask memory, so a page that shows the ask hides it the moment it is answered. */
export function useAskedAt(): number | null {
  const memory = useStored<AskMemory>(ASKED);
  return typeof memory?.shownAt === "number" ? memory.shownAt : null;
}

export function sentFeedback(): SentFeedback[] {
  const kept = readStored<SentFeedback[]>(SENT);
  return Array.isArray(kept) ? kept.filter((s) => typeof s?.id === "string") : [];
}

export function useSentFeedback(): SentFeedback[] {
  const kept = useStored<SentFeedback[]>(SENT);
  return Array.isArray(kept) ? kept.filter((s) => typeof s?.id === "string") : [];
}

/**
 * Keep what was just sent. Only the ones the sender offered for the page are worth keeping - a
 * rating nobody can see needs no way back - but a key is kept whenever there is one, because
 * that is the only copy of it there will ever be.
 */
export function rememberSent(item: {
  id: string;
  key: string | null;
  publicOk: boolean;
}): void {
  if (!item.publicOk && !item.key) {
    // Nothing to come back for. The 30-day gate is marked either way.
    markAsked(true);
    return;
  }
  const kept = [
    ...sentFeedback().filter((s) => s.id !== item.id),
    { ...item, at: new Date().toISOString() },
  ].slice(-KEEP);
  writeStored(SENT, kept);
  markAsked(true);
}

/** Forget one: it was withdrawn, or the server no longer knows it. */
export function forgetSent(id: string): void {
  const kept = sentFeedback().filter((s) => s.id !== id);
  writeStored(SENT, kept.length > 0 ? kept : null);
}

/** Exported for the tests, so the gap is one number in one place. */
export { ASK_GAP_MS };
