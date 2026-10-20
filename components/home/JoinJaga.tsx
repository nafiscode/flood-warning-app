"use client";

import { useEffect } from "react";
import { SignInOffer } from "@/components/account/SignInOffer";
import {
  UNIT_WAY_KEY,
  UNIT_WAY_SESSION,
  UnitCard,
  UnitWayLine,
  unitWayFull,
  type UnitWayState,
} from "@/components/authority/UnitWay";
import { useStored, writeStored } from "@/lib/phone-store";
import { useHasUnit } from "@/lib/use-public";

/**
 * The two ways in, under the hero: a rescue unit's and a resident's, as equals (the owner,
 * 18 Oct). Side by side when the column they sit in has the room, stacked when it has not, with
 * the unit card written first so a thumb reaches it first on a phone. After a few visits on this
 * device the unit card becomes one quiet line, and for someone who has a unit already it is that
 * line from the start.
 *
 * The width is read from the column, not the window (`@container`): this block lives in the
 * home screen's left column, which is the whole window on a phone and a third of it on a laptop.
 * They only go side by side from 34rem, because below that each card is too narrow to hold its
 * button on one line - measured, not guessed: at 26rem the register label wrapped and the button
 * grew to 74 px. And they sit at the top of the row rather than stretching to match, because
 * matching made the unit card as tall as the sign-in card and pushed its button 70% down the page.
 *
 * On the laptop console the unit's half moves to the action column, under "Follow my requests"
 * (the owner, 20 Oct): the home screen draws this block twice, `place="hero"` with the unit's half
 * hidden on the console and `place="act"` with only that half, shown only on the console - the
 * same one-copy-per-width pattern as the dam cards. The visit is still counted once (the session
 * key), and the card's heading id is per copy.
 */
export function JoinJaga({ place = "hero" }: { place?: "hero" | "act" }) {
  const state = useStored<UnitWayState>(UNIT_WAY_KEY);
  const hasUnit = useHasUnit();

  // One visit a browser session, not one a render.
  useEffect(() => {
    try {
      if (window.sessionStorage.getItem(UNIT_WAY_SESSION)) return;
      window.sessionStorage.setItem(UNIT_WAY_SESSION, "1");
    } catch {
      return;
    }
    const now = (JSON.parse(
      window.localStorage.getItem(`jaga.${UNIT_WAY_KEY}`) ?? "null",
    ) as UnitWayState | null) ?? { visits: 0 };
    writeStored(UNIT_WAY_KEY, { visits: now.visits + 1 });
  }, []);

  const full = unitWayFull(state, hasUnit);
  if (place === "act") {
    return (
      <div data-join-jaga-act={full ? "card" : "line"} className="hidden console:block">
        {full ? <UnitCard /> : <UnitWayLine where="home" />}
      </div>
    );
  }
  return (
    <div data-join-jaga={full ? "cards" : "line"} className="@container">
      {full ? (
        <div className="flex flex-col gap-4 @[34rem]:flex-row @[34rem]:items-start">
          <div className="contents console:hidden">
            <UnitCard />
          </div>
          {/* Nothing for someone signed in, and then the unit card has the row to itself. */}
          <SignInOffer compact className="flex-1" />
        </div>
      ) : (
        <div className="console:hidden">
          <UnitWayLine where="home" />
        </div>
      )}
    </div>
  );
}
