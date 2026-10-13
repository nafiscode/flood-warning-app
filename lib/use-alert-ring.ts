"use client";

import { useEffect, useRef } from "react";
import { ringForAll } from "@/lib/notice-sounds";
import type { NoticeItem } from "@/lib/notices";
import { readStored, writeStored } from "@/lib/phone-store";
import { arm, isArmed, play, type Playing } from "@/lib/sounds";

/** A repeating sound (the dam release) stops by itself after this long, or at the next tap. */
export const RING_MAX_MS = 30_000;
const RUNG_KEPT = 200;
const VOLUME = 0.8;

/**
 * The app rings for every alert in force for this person's places - the area they chose, their
 * home and the places they watch - that they have not yet seen on this phone, whether it was
 * issued a minute ago or before they ever opened Jaga (the owner, 13 Oct; docs/brand.md "Sound").
 *
 * Two limits no web page can remove, so the screen never relies on the sound alone:
 *  - a browser plays nothing until the person has tapped the page once, so the first tap arms the
 *    sound and an alert that arrived before it rings at that tap;
 *  - with Jaga closed nothing here runs at all. That is what web push is for (A7), and a push
 *    plays the phone's own notification sound.
 *
 * Each alert rings once on a phone. `quiet` is the SOS screens: nothing competes with a request.
 */
export function useAlertRing(
  items: readonly NoticeItem[],
  read: readonly string[],
  options: { quiet: boolean; ready: boolean },
): void {
  const { quiet, ready } = options;
  const playing = useRef<Playing | null>(null);
  const stopTimer = useRef<number | null>(null);
  const ringNow = useRef<() => void>(() => {});
  const latest = useRef({ items, read, quiet, ready });
  useEffect(() => {
    latest.current = { items, read, quiet, ready };
  });

  useEffect(() => {
    const stop = () => {
      playing.current?.stop();
      playing.current = null;
      if (stopTimer.current !== null) window.clearTimeout(stopTimer.current);
      stopTimer.current = null;
    };
    const dueNow = () => {
      const now = latest.current;
      if (now.quiet || !now.ready) return null;
      const due = ringForAll(now.items, now.read, readStored<string[]>("noticesRung") ?? []);
      return due.sound ? { sound: due.sound, ids: due.ids } : null;
    };
    const sound = (due: NonNullable<ReturnType<typeof dueNow>>) => {
      const rung = readStored<string[]>("noticesRung") ?? [];
      writeStored("noticesRung", [...new Set([...rung, ...due.ids])].slice(-RUNG_KEPT));
      stop();
      playing.current = play(due.sound, { volume: VOLUME });
      stopTimer.current = window.setTimeout(stop, RING_MAX_MS);
    };
    const ring = () => {
      const due = isArmed() ? dueNow() : null;
      if (due) sound(due);
    };
    const onTap = () => {
      // A tap silences a repeating sound; the first tap of a visit is also what lets sound play.
      if (playing.current) stop();
      if (isArmed()) return;
      // What is due is worked out now, before the tap does anything else: if this very tap is
      // on the bell, opening it marks everything read, and the alert would never ring.
      const due = dueNow();
      arm().then((ok) => {
        if (ok && due) sound(due);
      });
    };
    document.addEventListener("pointerdown", onTap);
    document.addEventListener("keydown", onTap);
    /*
     * A push has just arrived while Jaga is open: the bell must not wait for its next
     * five-minute look. The bell reloads whenever the phone says it is back online, so that is
     * the knock used here; once now, and once more after the shared 60-second copy of the list
     * has turned over, because the first look can still be handed the copy from before.
     */
    const timers: number[] = [];
    const knock = () => window.dispatchEvent(new Event("online"));
    const onPush = (event: MessageEvent) => {
      if ((event.data as { type?: string } | null)?.type !== "jaga-push") return;
      knock();
      timers.push(window.setTimeout(knock, 20_000), window.setTimeout(knock, 70_000));
    };
    navigator.serviceWorker?.addEventListener("message", onPush);
    ringNow.current = ring;
    return () => {
      document.removeEventListener("pointerdown", onTap);
      document.removeEventListener("keydown", onTap);
      navigator.serviceWorker?.removeEventListener("message", onPush);
      timers.forEach((t) => window.clearTimeout(t));
      stop();
    };
  }, []);

  useEffect(() => {
    ringNow.current();
  }, [items, read, quiet, ready]);
}
