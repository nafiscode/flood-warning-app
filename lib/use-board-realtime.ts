"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/browser";

/**
 * Tell the war room the moment a case, a claim or an assignment changes (24 Oct 2026), so it
 * reads the board again at once instead of waiting for the next tick.
 *
 * Only a nudge: the board itself is still read through the board function, and the 8-second
 * poll stays, because an offer moves from team to team by the clock and no row changes when it
 * does. Realtime delivers a row only to someone whose own read policy lets them see it, so a
 * team hears nothing about a case it could not read. If the connection cannot be made the war
 * room simply carries on with the poll.
 */
const TABLES = ["sos_requests", "sos_claims", "case_assignments"] as const;
const SETTLE_MS = 400;

export function useBoardRealtime(onChange: () => void, enabled: boolean): boolean {
  const [connected, setConnected] = useState(false);
  const latest = useRef(onChange);
  useEffect(() => {
    latest.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!enabled) return;
    let timer: number | undefined;
    let client: ReturnType<typeof createClient>;
    try {
      client = createClient();
    } catch {
      return;
    }
    // Several rows change together (a claim and the case's status); one read is enough.
    const nudge = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => latest.current(), SETTLE_MS);
    };
    const channel = client.channel("team-war-room");
    for (const table of TABLES) {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, nudge);
    }
    channel.subscribe((status) => setConnected(status === "SUBSCRIBED"));
    return () => {
      window.clearTimeout(timer);
      void client.removeChannel(channel);
    };
  }, [enabled]);

  return enabled && connected;
}
