"use client";

import { useEffect, useRef } from "react";
import { ringFor, type NoticeItem } from "@/lib/notices";
import { readStored, writeStored } from "@/lib/phone-store";
import { arm, isArmed, play, type Playing } from "@/lib/sounds";

/** A repeating sound (the dam release) stops by itself after this long, or at the next tap. */
export const RING_MAX_MS = 30_000;
const RUNG_KEPT = 200;
/** Watch and Safe to return ring too, but quieter than Warning and Evacuate. */
const LOUD_VOLUME = 0.6;
const SOFT_VOLUME = 0.3;

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
    const ring = () => {
      const now = latest.current;
      if (now.quiet || !now.ready || !isArmed()) return;
      const rung = readStored<string[]>("noticesRung") ?? [];
      const due = ringFor(now.items, now.read, rung);
      if (!due.sound) return;
      writeStored("noticesRung", [...rung, ...due.ids].slice(-RUNG_KEPT));
      stop();
      playing.current = play(due.sound, { volume: due.soft ? SOFT_VOLUME : LOUD_VOLUME });
      stopTimer.current = window.setTimeout(stop, RING_MAX_MS);
    };
    const onTap = () => {
      // A tap silences what is ringing; the first tap of a visit is also what lets sound play.
      if (playing.current) stop();
      if (isArmed()) return;
      arm().then((ok) => {
        if (ok) ring();
      });
    };
    document.addEventListener("pointerdown", onTap);
    document.addEventListener("keydown", onTap);
    ringNow.current = ring;
    return () => {
      document.removeEventListener("pointerdown", onTap);
      document.removeEventListener("keydown", onTap);
      stop();
    };
  }, []);

  useEffect(() => {
    ringNow.current();
  }, [items, read, quiet, ready]);
}
