"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { CallNow } from "@/components/CallNow";
import { SosDetailsForm } from "@/components/sos/SosDetailsForm";
import { Link } from "@/i18n/navigation";
import { enqueue } from "@/lib/queue";
import { useOnPhone, useStored } from "@/lib/phone-store";
import {
  OPEN_STATUSES,
  rememberCase,
  type RememberedCase,
  type SosStatus,
  type SosTimeline,
} from "@/lib/sos";
import { useBattery, useLocation, useQueue } from "@/lib/use-sending";
import { buttonPrimary, buttonSecondary, card, hint, notice } from "@/lib/ui";

const FIVE_MINUTES = 5 * 60 * 1000;

type Props = { id: string; merged: boolean };

/**
 * What the person who sent an SOS sees afterwards (spec 4.6): where their request stands, the
 * timeline, the optional details, and the two things only they can say - "I'm safe now" and
 * "Confirm I was rescued".
 *
 * While the case is open and this page is open, the location is sent every five minutes, so
 * rescuers follow someone who has moved. Nothing here shows the suspected-spam flag: the
 * database function does not return it.
 */
export function CaseStatus({ id, merged }: Props) {
  const t = useTranslations("sos");
  // The token the phone kept when this case was sent: the only way to an anonymous case.
  const ready = useOnPhone();
  const cases = useStored<RememberedCase[]>("sos.cases");
  const token = (cases ?? []).find((c) => c.id === id)?.token ?? null;
  const [timeline, setTimeline] = useState<SosTimeline | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "failed" | "unknown">("loading");
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [closing, setClosing] = useState(false);
  const open = timeline ? OPEN_STATUSES.includes(timeline.status) : true;
  const gps = useLocation({ start: false, watch: open && state === "ok" });
  const battery = useBattery();
  useQueue();
  const lastPing = useRef(0);

  // Not an async function: like the home screen's status (lib/use-public.ts), the state is set
  // in the promise's callbacks, never while the effect below is running.
  const load = useCallback(() => {
    if (!ready) return;
    fetch(`/api/sos/${id}`, {
      headers: token ? { "x-jaga-sos-token": token } : undefined,
      cache: "no-store",
    })
      .then(async (response) => {
        if (response.status === 403 || response.status === 404) return "unknown" as const;
        if (!response.ok) throw new Error(String(response.status));
        return (await response.json()) as SosTimeline;
      })
      .then(
        (answer) => {
          if (answer === "unknown") {
            setState("unknown");
            return;
          }
          setTimeline(answer);
          setState("ok");
          setCheckedAt(new Date());
          rememberCase({ id, token, status: answer.status, createdAt: answer.createdAt });
        },
        () => setState((current) => (current === "ok" ? current : "failed")),
      );
  }, [id, token, ready]);

  // Follow the case: on opening, every minute while it is open, and when the app comes forward.
  useEffect(() => {
    if (!ready) return;
    load();
    const timer = window.setInterval(load, 60_000);
    const again = () => load();
    document.addEventListener("visibilitychange", again);
    window.addEventListener("online", again);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", again);
      window.removeEventListener("online", again);
    };
  }, [load, ready]);

  // A location update every five minutes while the case is open (spec 4.6).
  useEffect(() => {
    if (!open || !gps.point || state !== "ok") return;
    const now = Date.now();
    if (now - lastPing.current < FIVE_MINUTES) return;
    lastPing.current = now;
    void fetch(`/api/sos/${id}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { "x-jaga-sos-token": token } : {}),
      },
      body: JSON.stringify({
        action: "location",
        token,
        lat: gps.point.lat,
        lon: gps.point.lon,
        accuracy: gps.accuracy,
        battery,
      }),
      cache: "no-store",
    }).catch(() => {
      // A missed location update is not worth queueing: the next one replaces it.
    });
  }, [gps.point, gps.accuracy, open, state, id, token, battery]);

  async function close(rescued: boolean) {
    setClosing(true);
    const body = { action: "close" as const, token, rescued };
    try {
      const response = await fetch(`/api/sos/${id}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "x-jaga-sos-token": token } : {}),
        },
        body: JSON.stringify(body),
        cache: "no-store",
      });
      if (!response.ok) throw new Error(String(response.status));
      const answer = (await response.json()) as { status: SosStatus };
      setTimeline((current) => (current ? { ...current, status: answer.status } : current));
      rememberCase({
        id,
        token,
        status: answer.status,
        createdAt: timeline?.createdAt ?? new Date().toISOString(),
      });
    } catch {
      // Offline: closing a case can wait for the connection, unlike asking for help.
      await enqueue("sos-close", `/api/sos/${id}`, body as unknown as Record<string, unknown>);
    } finally {
      setClosing(false);
    }
  }

  if (!ready || state === "loading") {
    return <p role="status">{t("status.title")}</p>;
  }

  if (state === "unknown") {
    const others = (cases ?? []).filter((c) => c.id !== id);
    return (
      <section className="flex flex-col gap-4" data-case-state="unknown">
        <h1 className="text-h3 font-bold text-jaga-slate">{t("status.title")}</h1>
        <p className={notice}>{t("status.notFound")}</p>
        {others.length > 0 && (
          <Link href={`/sos/${others[0]!.id}`} className={buttonSecondary}>
            {t("status.openCaseLink")}
          </Link>
        )}
        <Link href="/sos" className={buttonPrimary}>
          {t("action")}
        </Link>
        <CallNow />
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4" data-case-state={timeline?.status ?? "unknown"}>
      <h1 className="text-h3 font-bold text-jaga-slate">{t("status.title")}</h1>
      {merged && <p className={notice}>{t("sent.merged")}</p>}
      {!merged && <p>{t("sent.body")}</p>}

      {timeline && (
        <div className={card}>
          <p className="text-h3 font-bold text-jaga-slate" data-case-status={timeline.status}>
            {timeline.status === "assigned" && timeline.unitName
              ? t("status.assigned", { unit: timeline.unitName })
              : t(`status.${timeline.status}`)}
          </p>
          {timeline.status === "received" && <p>{t("status.waiting")}</p>}
          {timeline.unitName && <p>{t("status.unit", { unit: timeline.unitName })}</p>}
          <p className={hint}>
            {t("status.sentAt", { time: time(timeline.createdAt) })}
            {checkedAt ? ` · ${t("status.updated", { time: time(checkedAt.toISOString()) })}` : ""}
          </p>
          <h2 className="font-bold">{t("status.timeline")}</h2>
          <ol className="flex flex-col gap-2">
            {timeline.events
              .filter((event) => known(event.event))
              .map((event, index) => (
                <li key={`${event.event}-${index}`} className="flex flex-col">
                  <span className="font-medium">
                    {event.unit
                      ? t("status.assigned", { unit: event.unit })
                      : t(`status.${event.event}`)}
                  </span>
                  <span className={hint}>{time(event.at)}</span>
                </li>
              ))}
          </ol>
        </div>
      )}

      {state === "failed" && <p className={notice}>{t("status.loadFailed")}</p>}
      <button type="button" onClick={load} className={buttonSecondary}>
        {t("status.refresh")}
      </button>

      {open && (
        <>
          <SosDetailsForm id={id} token={token} />
          <div className={card}>
            <button
              type="button"
              onClick={() => void close(false)}
              disabled={closing}
              data-case-safe="true"
              className={buttonSecondary}
            >
              {closing ? t("status.closing") : t("status.safeNow")}
            </button>
            <p className={hint}>{t("status.safeConfirm")}</p>
            <button
              type="button"
              onClick={() => void close(true)}
              disabled={closing}
              data-case-rescued="true"
              className={buttonSecondary}
            >
              {t("status.rescuedNow")}
            </button>
          </div>
        </>
      )}

      {!open && (
        <div className="flex flex-col gap-3">
          <p className={notice}>{t("status.closed")}</p>
          <Link href="/" className={buttonSecondary}>
            {t("back")}
          </Link>
        </div>
      )}

      <CallNow />
    </section>
  );
}

/** Bangkok time for everyone in the service area (CLAUDE.md, Time). */
function time(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Bangkok",
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/** Events with wording of their own; anything else (media added, admin notes) is not shown. */
const KNOWN_EVENTS = [
  "received",
  "assigned",
  "en_route",
  "rescued",
  "safe_cancelled",
  "dismissed",
  "repeat_merged",
  "details_added",
];
function known(event: string): boolean {
  return KNOWN_EVENTS.includes(event);
}
