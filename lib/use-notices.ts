"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Area } from "@/lib/area";
import {
  buildNotices,
  keepRead,
  myTambons,
  unreadCount,
  type KnownCase,
  type NoticeItem,
  type AdminAttention,
  type AutoAlarm,
  type NoticeRow,
  type ReportDecision,
} from "@/lib/notices";
import { FIELD_URL, type MyFieldRescue } from "@/lib/field-rescue";
import { REQUESTS_URL, type FieldWaiting, type UnitRequest } from "@/lib/journey";
import { readStored, useStored, writeStored } from "@/lib/phone-store";
import { caseToken, rememberedCases, type SosTimeline } from "@/lib/sos";
import { isSessionCookie } from "@/lib/supabase/env";
import { useMyPlaces, useNow } from "@/lib/use-public";

/** The same five minutes as the alert status: the bell carries the same news (CLAUDE.md). */
const POLL_MS = 5 * 60_000;

type StoredFeed = { key: string; rows: NoticeRow[]; checkedAt: number };
type StoredCases = { cases: KnownCase[]; checkedAt: number };
type StoredUnits = {
  units: UnitRequest[];
  field?: MyFieldRescue[];
  fieldWaiting?: FieldWaiting | null;
  /** What an admin decided about their own flood reports. */
  reports?: ReportDecision[];
  /** For an admin: automatic alarms, and every alert when they chose to hear all of them. */
  admin?: {
    allAlerts: boolean;
    autoAlarms: AutoAlarm[];
    alerts: NoticeRow[];
    /** Every queue with something waiting in it (A10, 22 Oct). */
    attention?: AdminAttention[];
  } | null;
  checkedAt: number;
};

function hasSession(): boolean {
  return document.cookie.split(";").some((c) => isSessionCookie(c.trim().split("=")[0] ?? ""));
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return (await response.json()) as T;
}

/**
 * What the bell shows, and what is still unread.
 *
 * Everything it has last seen is kept on the phone, so the list and the number are there at once
 * on the next visit and with no connection (safety rule 7). `ask` is false on the SOS screens:
 * nothing there competes with the request (safety rule 1).
 */
export function useNotices(options: {
  /** False on the SOS screens: nothing there competes with the request (safety rule 1). */
  ask?: boolean;
  /** The word for "my home" and the name of a chosen area, both in the reader's language. */
  homeLabel: string;
  areaLabel: (area: Area) => string;
}): {
  items: NoticeItem[];
  unread: number;
  /** The ids already read, so a panel can keep its "new" marks while it is open. */
  read: string[];
  checkedAt: number | null;
  markRead: (ids: string[]) => void;
  markAllRead: () => void;
} {
  const { ask = true, homeLabel, areaLabel } = options;
  const area = useStored<Area>("area");
  const me = useMyPlaces();
  const stored = useStored<StoredFeed>("notices");
  const storedCases = useStored<StoredCases>("noticeCases");
  const storedUnits = useStored<StoredUnits>("noticeUnits");
  const read = useStored<string[]>("noticesRead");
  const now = useNow();
  const [syncedRead, setSyncedRead] = useState<string[] | null>(null);

  const tambons = useMemo(() => myTambons(area, me), [area, me]);
  const key = tambons.join(",");

  // The feed: alerts and announcements for the places this person cares about.
  useEffect(() => {
    if (!ask || key === "") return;
    let cancelled = false;
    const load = () => {
      getJson<{ notices: NoticeRow[] }>(`/api/public/notices?t=${key}`).then(
        (answer) => {
          if (!cancelled) {
            writeStored("notices", {
              key,
              rows: answer.notices,
              checkedAt: Date.now(),
            } satisfies StoredFeed);
          }
        },
        () => {},
      );
    };
    load();
    const timer = window.setInterval(load, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", load);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", load);
    };
  }, [ask, key]);

  // Their own SOS cases, read one at a time with the key their phone holds. Only the cases the
  // phone remembers, so a visitor asks for nothing.
  useEffect(() => {
    if (!ask) return;
    const known = rememberedCases();
    if (known.length === 0) {
      if (readStored("noticeCases") !== null) writeStored("noticeCases", null);
      return;
    }
    let cancelled = false;
    const load = () => {
      Promise.all(
        known.slice(0, 5).map(async (one): Promise<KnownCase> => {
          const token = caseToken(one.id);
          try {
            const timeline = await getJson<SosTimeline>(`/api/sos/${one.id}`, {
              headers: token ? { "x-jaga-sos-token": token } : undefined,
            });
            return { id: one.id, timeline };
          } catch {
            return { id: one.id, timeline: null };
          }
        }),
      ).then((cases) => {
        if (cancelled) return;
        const answered = cases.filter((one) => one.timeline !== null);
        const previous = readStored<StoredCases>("noticeCases")?.cases ?? [];
        // A case that could not be read keeps whatever was last known of it, so a lost
        // connection never empties the list.
        const merged = cases.map(
          (one) =>
            answered.find((a) => a.id === one.id) ?? previous.find((p) => p.id === one.id) ?? one,
        );
        writeStored("noticeCases", { cases: merged, checkedAt: Date.now() } satisfies StoredCases);
      });
    };
    load();
    const timer = window.setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [ask]);

  // The teams this person registered: news when an admin has verified one. Asked only of a
  // signed-in browser, and forgotten when the session goes.
  useEffect(() => {
    if (!ask) return;
    if (!hasSession()) {
      if (readStored("noticeUnits") !== null) writeStored("noticeUnits", null);
      return;
    }
    let cancelled = false;
    const load = () => {
      getJson<{
        units: UnitRequest[];
        fieldWaiting?: FieldWaiting | null;
        reports?: ReportDecision[];
        admin?: StoredUnits["admin"];
      }>(REQUESTS_URL).then(
        async (answer) => {
          // Only someone with a verified team has field records to hear about.
          const field = answer.units.some((u) => u.status === "verified")
            ? await getJson<{ rescues: MyFieldRescue[] }>(FIELD_URL).then(
                (a) => a.rescues,
                () => [],
              )
            : [];
          if (!cancelled) {
            writeStored("noticeUnits", {
              units: answer.units,
              field,
              fieldWaiting: answer.fieldWaiting ?? null,
              reports: answer.reports ?? [],
              admin: answer.admin ?? null,
              checkedAt: Date.now(),
            } satisfies StoredUnits);
          }
        },
        () => {},
      );
    };
    load();
    const timer = window.setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [ask]);

  const items = useMemo(() => {
    const own = stored?.key === key ? stored.rows : [];
    // An admin who chose to hear every alert gets the rest of them too, once each.
    const extra = (storedUnits?.admin?.alerts ?? []).filter((r) => !own.some((o) => o.id === r.id));
    const rows = [...own, ...extra];
    return buildNotices({
      rows,
      area,
      me,
      cases: storedCases?.cases ?? [],
      units: storedUnits?.units ?? [],
      field: storedUnits?.field ?? [],
      fieldWaiting: storedUnits?.fieldWaiting ?? null,
      reports: storedUnits?.reports ?? [],
      autoAlarms: storedUnits?.admin?.autoAlarms ?? [],
      attention: storedUnits?.admin?.attention ?? [],
      // Zero until the phone's clock is readable (the server's HTML draws an empty bell).
      now,
      homeLabel,
      areaLabel,
    });
  }, [stored, key, area, me, storedCases, storedUnits, now, homeLabel, areaLabel]);

  const readIds = useMemo(() => syncedRead ?? read ?? [], [syncedRead, read]);

  /** Send what this phone has read to the account, and take back what the account has read. */
  const sync = useCallback((ids: string[]) => {
    if (!hasSession()) return;
    getJson<{ read: string[] }>("/api/me/notices", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ read: ids }),
    }).then(
      (answer) => setSyncedRead(answer.read),
      () => {},
    );
  }, []);

  // Once when the app opens: the account may have read things this phone has not.
  useEffect(() => {
    if (!ask) return;
    sync(readStored<string[]>("noticesRead") ?? []);
  }, [ask, sync]);

  const markRead = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      const next = [...new Set([...(readStored<string[]>("noticesRead") ?? []), ...ids])];
      writeStored("noticesRead", next);
      setSyncedRead((current) => (current ? [...new Set([...current, ...ids])] : current));
      sync(ids);
    },
    [sync],
  );

  const markAllRead = useCallback(() => markRead(items.map((item) => item.id)), [items, markRead]);

  // Ids of things that have fallen out of the fourteen-day window are dropped, so the phone's
  // list cannot grow for ever.
  useEffect(() => {
    const current = readStored<string[]>("noticesRead") ?? [];
    if (current.length === 0 || items.length === 0) return;
    const kept = keepRead(current, items);
    if (kept.length !== current.length) writeStored("noticesRead", kept);
  }, [items]);

  return {
    items,
    unread: unreadCount(items, readIds),
    read: readIds,
    checkedAt: stored?.checkedAt ?? null,
    markRead,
    markAllRead,
  };
}
