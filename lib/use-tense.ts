"use client";

import type { Area } from "@/lib/area";
import type { MyPlaces } from "@/lib/me";
import { useStored } from "@/lib/phone-store";
import { alertForTambon, type PublicStatus } from "@/lib/public-status";

type StoredStatus = { status: PublicStatus; checkedAt: number };

/**
 * Whether one of this person's places is at Warning or Evacuate - the one condition that silences
 * every invitation on the screen: the donation prompts (safety rule 9) and, from A15, the
 * feedback ask and its link (spec 17).
 *
 * **It reads only what is already on the phone** - the last alert status, the chosen area and the
 * saved places, all written by the home screen's own poll - and asks the server nothing. That is
 * the point: this hook hangs on the end of every page, and a page that happens to carry a quiet
 * link must not spend a request, or a moment of a slow 3G connection, to find out whether to draw
 * it. It also means it works offline, where the answer matters most.
 *
 * With nothing stored it returns false, so a first visit is not treated as a tense one. A missed
 * invitation on a page nobody has an area for costs nothing; the gate that matters - the home
 * screen - computes `tense` from its own live status (components/home/HomeView.tsx).
 */
export function useTense(): boolean {
  const stored = useStored<StoredStatus>("status");
  const me = useStored<MyPlaces>("me");
  const area = useStored<Area>("area");
  const status = stored?.status;
  if (!status) return false;

  const codes = new Set<string>();
  if (area?.code) codes.add(area.code);
  if (me?.signedIn) {
    if (me.home?.code) codes.add(me.home.code);
    for (const place of me.places ?? []) if (place.area?.code) codes.add(place.area.code);
  }
  if (codes.size === 0) return false;

  for (const code of codes) {
    const alert = alertForTambon(status, code);
    if (alert && (alert.level === "warning" || alert.level === "evacuate")) return true;
  }
  return false;
}
