"use client";

import { useSyncExternalStore } from "react";

/**
 * Small values kept on the phone (localStorage): the chosen area, the last alert status and safe
 * places received, ticked checklist items. They make the home screen work offline (safety
 * rule 7) and are never sent anywhere. Nothing personal with a phone number is stored here.
 */
const PREFIX = "jaga.";
const EVENT = "jaga-store";

// Parsed values by key, so a reader gets the same object until the stored text changes.
const parsed = new Map<string, { raw: string | null; value: unknown }>();

function read(key: string): unknown {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(PREFIX + key);
  } catch {
    // Storage can be switched off (private mode): the app then works without memory.
  }
  const known = parsed.get(key);
  if (known && known.raw === raw) return known.value;
  let value: unknown = null;
  if (raw !== null) {
    try {
      value = JSON.parse(raw);
    } catch {
      value = null;
    }
  }
  parsed.set(key, { raw, value });
  return value;
}

export function readStored<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  return read(key) as T | null;
}

export function writeStored(key: string, value: unknown): void {
  try {
    if (value === null || value === undefined) window.localStorage.removeItem(PREFIX + key);
    else window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Full or switched off: keep going without it.
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** The stored value, re-read whenever it changes (also from another tab). Null on the server. */
export function useStored<T>(key: string): T | null {
  return useSyncExternalStore(
    subscribe,
    () => read(key) as T | null,
    () => null,
  );
}

/** False while the page is still the server's HTML, true once it runs on the phone. */
export function useOnPhone(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}
