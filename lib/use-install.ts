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
    /*
     * The event is kept but NOT cancelled (the owner, 28 Nov 2026, superseding 19 Oct's "the
     * card's button is the one way in"): cancelling it also took away Chrome's own install bar,
     * so an Android visitor who never scrolled was never asked by anybody. Chrome may now show
     * its bar as well; our banner and card still work, because the event is stored either way.
     */
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

/**
 * "Show me where that button is." The banner cannot open the card's own guide by itself, so it
 * asks here and the card listens. One shared signal, so there is never a second set of steps.
 */
let guideWanted = false;
const guideListeners = new Set<() => void>();

export function openGuide(): void {
  guideWanted = true;
  guideListeners.forEach((listener) => listener());
}

export function useGuideWanted(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      guideListeners.add(onChange);
      return () => guideListeners.delete(onChange);
    },
    () => guideWanted,
    () => false,
  );
}
