"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import {
  BEAT_MS,
  openNote,
  sendOpen,
  sendPing,
  shouldCount,
  touchSession,
} from "@/lib/usage-beacon";

/** How long after a page is ready before the open note goes: the page and its fetches come first. */
const SETTLE_MS = 3_000;

/**
 * Nothing to see: counts that Jaga is in use, for the admins' usage dashboard (the owner,
 * 14 Oct). One short note when a visit starts, one per page change, one every five minutes while
 * the app is on screen. It never waits for an answer and never runs before the page has settled.
 */
export function UsageBeacon() {
  const pathname = usePathname();
  const session = useRef<string | null>(null);
  const lastPath = useRef<string | null>(null);

  // A page change inside a visit.
  useEffect(() => {
    if (!session.current || lastPath.current === pathname) return;
    lastPath.current = pathname;
    const { id, fresh } = touchSession();
    session.current = id;
    if (fresh) sendOpen(openNote(id, pathname));
    else sendPing(id, "view", pathname);
  }, [pathname]);

  // The start of a visit (or a reload inside one), and "still on screen".
  useEffect(() => {
    if (!shouldCount()) return;
    const path = () => window.location.pathname;
    const start = window.setTimeout(() => {
      const { id, fresh } = touchSession();
      session.current = id;
      lastPath.current = path();
      if (fresh) sendOpen(openNote(id, path()));
      else sendPing(id, "view", path());
    }, SETTLE_MS);
    const beat = window.setInterval(() => {
      if (!session.current || document.visibilityState !== "visible") return;
      const { id, fresh } = touchSession();
      session.current = id;
      if (fresh) sendOpen(openNote(id, path()));
      else sendPing(id, "beat", path());
    }, BEAT_MS);
    const back = () => {
      if (!session.current || document.visibilityState !== "visible") return;
      // Back on screen after a long time away: a new visit.
      const { id, fresh } = touchSession();
      session.current = id;
      if (fresh) sendOpen(openNote(id, path()));
    };
    document.addEventListener("visibilitychange", back);
    return () => {
      window.clearTimeout(start);
      window.clearInterval(beat);
      document.removeEventListener("visibilitychange", back);
    };
  }, []);
  return null;
}
