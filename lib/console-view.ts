"use client";

import { useSyncExternalStore } from "react";

/**
 * Is this a laptop console? The same question the `console:` breakpoint asks in CSS - a wide
 * screen with a mouse or a trackpad - for the few things CSS alone cannot do, such as opening a
 * folded panel.
 *
 * Keep this string and the `@custom-variant console` in app/globals.css in step; a test holds
 * them to each other.
 */
export const CONSOLE_QUERY = "(min-width: 1024px) and (pointer: fine)";

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
