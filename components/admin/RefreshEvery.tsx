"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Reads a server-rendered page again every few minutes while it is on screen, so a console left
 * open shows the feeds as they are, not as they were when it was opened. It never reloads while
 * someone is typing into a form on the page (a half-typed threshold must not be lost), and it
 * catches up at once when the tab comes back after being hidden for longer than the period.
 */
export function RefreshEvery({ minutes }: { minutes: number }) {
  const router = useRouter();
  const last = useRef(0);
  const editing = useRef(false);

  useEffect(() => {
    const period = minutes * 60_000;
    last.current = Date.now();
    const tick = () => {
      if (
        !shouldRefresh(Date.now(), last.current, period, document.visibilityState, editing.current)
      )
        return;
      last.current = Date.now();
      router.refresh();
    };
    // Any typing marks the page as being edited until the form is sent (which navigates).
    const onInput = (e: Event) => {
      if ((e.target as Element | null)?.closest?.("form")) editing.current = true;
    };
    const onSubmit = () => {
      editing.current = false;
    };
    const id = window.setInterval(tick, 30_000);
    document.addEventListener("visibilitychange", tick);
    document.addEventListener("input", onInput, true);
    document.addEventListener("submit", onSubmit, true);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
      document.removeEventListener("input", onInput, true);
      document.removeEventListener("submit", onSubmit, true);
    };
  }, [minutes, router]);

  return null;
}

/** Whether to read the page again now: the period has passed, the page is seen, nobody is typing. */
export function shouldRefresh(
  now: number,
  last: number,
  periodMs: number,
  visibility: DocumentVisibilityState,
  editing: boolean,
): boolean {
  return visibility === "visible" && !editing && now - last >= periodMs;
}
