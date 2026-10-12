"use client";

import { useSyncExternalStore } from "react";
import { writeStored } from "@/lib/phone-store";

/** Chrome's "you may offer to install this" event. It is not in TypeScript's DOM types. */
type InstallEvent = Event & {
  prompt: () => Promise<unknown>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/*
 * The browser hands the event over once, soon after the page opens, and it has to be kept until
 * somebody taps the button. It is kept here, outside React, so it survives moving between pages
 * and is not lost when it arrives before the card is drawn.
 */
let offer: InstallEvent | null = null;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((listener) => listener());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    // Keeps Chrome's own small banner away: the card's button is the one way in.
    event.preventDefault();
    offer = event as InstallEvent;
    // The browser only offers when Jaga is not installed, so an old "installed" note is wrong.
    writeStored("install.done", null);
    changed();
  });
  window.addEventListener("appinstalled", () => {
    offer = null;
    writeStored("install.done", true);
    changed();
  });
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  const media = window.matchMedia?.("(display-mode: standalone)");
  media?.addEventListener?.("change", onChange);
  return () => {
    listeners.delete(onChange);
    media?.removeEventListener?.("change", onChange);
  };
}

/** Opened from its own icon, not in a browser tab. iPhones say so in their own way. */
function standalone(): boolean {
  return (
    !!window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** True when the browser will open its install dialog for us. False on the server. */
export function useInstallOffer(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => offer !== null,
    () => false,
  );
}

/** True when Jaga is already running as an installed app. True on the server: draw nothing. */
export function useStandalone(): boolean {
  return useSyncExternalStore(subscribe, standalone, () => true);
}

/** Open the browser's install dialog. The offer can be used once, whatever the answer. */
export async function askToInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const event = offer;
  if (!event) return "unavailable";
  offer = null;
  try {
    await event.prompt();
    const { outcome } = await event.userChoice;
    if (outcome === "accepted") writeStored("install.done", true);
    return outcome;
  } catch {
    return "unavailable";
  } finally {
    changed();
  }
}
