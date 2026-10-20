"use client";

import { useSyncExternalStore } from "react";

/**
 * Which of the three arrangements this screen gets. The same three bands the CSS asks for in
 * app/globals.css, kept here for the few things CSS alone cannot do (opening a folded panel,
 * drawing a `<section>` where a phone draws a `<details>`), and for tests to read.
 *
 * The bands are exclusive and between them they cover every screen:
 *
 *   * **laptop** - 1280 px or wider with a pointer that can hover. The three-column console.
 *   * **tablet** - 1024 px or wider, held sideways, that is not a laptop: a tablet with a finger,
 *     a tablet with a keyboard, or a narrow window on a laptop (the owner chose this on 21 Oct
 *     2026, option B). Two columns - the map and the answer panel - with the controls under them.
 *   * **phone** - everything else, including every tablet held upright: measured at 744-1024 px,
 *     two columns and a map worth looking at do not fit.
 *
 * The floor moved from 1024 to 1280 on 21 Oct ("floor OK"): a tablet with a keyboard reports a
 * fine pointer, passed the old test, and was given a 216-369 px map. Measured, not guessed
 * (.claude/local/q-tablet.mjs).
 */
export const LAPTOP_QUERY = "(min-width: 1280px) and (pointer: fine)";
export const TABLET_QUERY =
  "(min-width: 1024px) and (max-width: 1279.98px) and (orientation: landscape), (min-width: 1280px) and (orientation: landscape) and (pointer: coarse)";
/** The exact complement of the other two: what is neither a laptop nor a tablet held sideways. */
export const PHONE_QUERY =
  "(max-width: 1023.98px), (orientation: portrait) and (max-width: 1279.98px), (orientation: portrait) and (pointer: coarse)";

/**
 * Is this the console at all - laptop or tablet? Keep this string and the `@custom-variant
 * console` in app/globals.css in step; a test holds them to each other.
 */
export const CONSOLE_QUERY = `${LAPTOP_QUERY}, ${TABLET_QUERY}`;

export type ConsoleBand = "laptop" | "tablet" | "phone";

/** The band a screen falls in, as a pure function of what the browser would answer. */
export function bandFor(screen: {
  width: number;
  height: number;
  pointer: "fine" | "coarse";
}): ConsoleBand {
  // A square screen counts as landscape, as the media feature does.
  const landscape = screen.width >= screen.height;
  if (screen.width >= 1280 && screen.pointer === "fine") return "laptop";
  if (screen.width >= 1024 && landscape) return "tablet";
  return "phone";
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const query = window.matchMedia(CONSOLE_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

const onConsole = () =>
  typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(CONSOLE_QUERY).matches;

/**
 * False on the server and until the page has hydrated, so the markup the server sends is the
 * phone's and nothing depends on the width before the browser can say what it is.
 */
export function useConsoleView(): boolean {
  return useSyncExternalStore(subscribe, onConsole, () => false);
}
