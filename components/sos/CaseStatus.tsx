"use client";

import { CasePush } from "@/components/push/PushCard";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { CallNow } from "@/components/CallNow";
import { CheckIcon, CrossIcon, HouseIcon, LifebuoyIcon, RetryIcon } from "@/components/icons";
import { SosDetailsForm } from "@/components/sos/SosDetailsForm";
import { Journey } from "@/components/journey/Journey";
import { TeamStatus } from "@/components/sos/TeamStatus";
import { sosJourney } from "@/lib/journey";
import { Link } from "@/i18n/navigation";
import { enqueue } from "@/lib/queue";
import { useOnPhone, useStored } from "@/lib/phone-store";
import {
  OPEN_STATUSES,
  rememberCase,
  soundForChange,
  type RememberedCase,
  type SosStatus,
  type SosTeamPhone,
  type SosTimeline,
} from "@/lib/sos";
import { arm, play } from "@/lib/sounds";
import { useNow } from "@/lib/use-public";
import { useBattery, useLocation, useQueue } from "@/lib/use-sending";
import { buttonPrimary, buttonSecondary, card, formColumn, hint, notice } from "@/lib/ui";

const FIVE_MINUTES = 5 * 60 * 1000;
// An open request is looked at often: the moment a team accepts is the news this screen is for.
const OPEN_POLL_MS = 20_000;
const CLOSED_POLL_MS = 60_000;

type Props = { id: string; merged: boolean };

/**
 * What the person who sent an SOS sees afterwards (spec 4.6): where their request stands, the
 * timeline, the optional details, and the two things only they can say - "I'm safe now" and
 * "Confirm I was rescued".
 *
 * While the case is open and this page is open, the location is sent every five minutes, so
 * rescuers follow someone who has moved. Nothing here shows the suspected-spam flag: the
 * database function does not return it.
 *
 * Two moments make a sound as well as changing the words (spec 4.8): a team accepting, and the
 * case ending in "rescued" or "I'm safe now". Both need one earlier tap anywhere on this screen,
 * because a browser plays nothing before one; without it the words and the vibration still come.
 */
export function CaseStatus({ id, merged }: Props) {
  const t = useTranslations("sos");
  const tJourney = useTranslations("journey");
  // The token the phone kept when this case was sent: the only way to an anonymous case.
  const ready = useOnPhone();
  const cases = useStored<RememberedCase[]>("sos.cases");
  const token = (cases ?? []).find((c) => c.id === id)?.token ?? null;
  const [timeline, setTimeline] = useState<SosTimeline | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "failed" | "unknown">("loading");
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [closing, setClosing] = useState(false);
  const open = timeline ? OPEN_STATUSES.includes(timeline.status) : true;
  // The team has reported the rescue and the case waits for this person's word (spec 5.4).
  const pending = timeline?.status === "rescued" && !timeline.closedAt;
  const [disputeFailed, setDisputeFailed] = useState(false);
  // A request for food and water (spec 4.10) says "delivered" where a rescue says "rescued".
  const supplies = timeline?.kind === "supplies";
  const [escalated, setEscalated] = useState<"done" | "failed" | null>(null);
  const gps = useLocation({ start: false, watch: open && state === "ok" });
  const battery = useBattery();
  useQueue();
  const lastPing = useRef(0);
  const now = useNow();
  const [teamPhone, setTeamPhone] = useState<SosTeamPhone | "failed" | null>(null);
  const [askingPhone, setAskingPhone] = useState(false);
  // What the screen last showed, so a change can be heard once and an old case stays quiet.
  const shown = useRef<{ status: SosStatus; hasTeam: boolean } | null>(null);

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
          const next = { status: answer.status, hasTeam: answer.team?.searching === false };
          const sound = soundForChange(shown.current, next);
          shown.current = next;
          if (sound) play(sound);
          // A team that gave the case back takes its number with it.
          if (!next.hasTeam) setTeamPhone(null);
          // An answer written before requests had kinds is a rescue with nothing asked for: this
          // screen must never fall over on the shape of what it was sent.
          setTimeline({ ...answer, kind: answer.kind ?? "rescue", needs: answer.needs ?? [] });
          setState("ok");
          setCheckedAt(new Date());
          rememberCase({ id, token, status: answer.status, createdAt: answer.createdAt });
        },
        () => setState((current) => (current === "ok" ? current : "failed")),
      );
  }, [id, token, ready]);

  // Follow the case: on opening, every 20 seconds while it is open, and when the app comes
  // forward.
  useEffect(() => {
    if (!ready) return;
    load();
    const timer = window.setInterval(load, open || pending ? OPEN_POLL_MS : CLOSED_POLL_MS);
    const again = () => load();
    document.addEventListener("visibilitychange", again);
    window.addEventListener("online", again);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", again);
      window.removeEventListener("online", again);
    };
  }, [load, ready, open, pending]);

  // The first tap anywhere on this screen lets the later sounds play.
  useEffect(() => {
    const once = () => void arm();
    window.addEventListener("pointerdown", once, { once: true });
    return () => window.removeEventListener("pointerdown", once);
  }, []);

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

  /** The number of the team that accepted: one tap, and the look is logged (safety rule 5). */
  function askTeamPhone() {
    setAskingPhone(true);
    fetch(`/api/sos/${id}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { "x-jaga-sos-token": token } : {}),
      },
      body: JSON.stringify({ action: "team_phone", token }),
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        return (await response.json()) as SosTeamPhone;
      })
      .then(setTeamPhone, () => setTeamPhone("failed"))
      .finally(() => setAskingPhone(false));
  }

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
      const sound = soundForChange(shown.current, { status: answer.status, hasTeam: false });
      if (shown.current) shown.current = { ...shown.current, status: answer.status };
      if (sound) play(sound);
      setTimeline((current) =>
        current
          ? { ...current, status: answer.status, closedAt: new Date().toISOString() }
          : current,
      );
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

  /**
   * "No, I still need help": the team's report is set aside and the case goes straight back to
   * looking for a team. Not queued for later like a closing - if it cannot be sent the screen
   * says so at once, with the hotlines under it.
   */
  function dispute() {
    setClosing(true);
    setDisputeFailed(false);
    fetch(`/api/sos/${id}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { "x-jaga-sos-token": token } : {}),
      },
      body: JSON.stringify({ action: "not_rescued", token }),
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        return (await response.json()) as { status: SosStatus };
      })
      .then(
        (answer) => {
          shown.current = { status: answer.status, hasTeam: false };
          setTeamPhone(null);
          setTimeline((current) =>
            current ? { ...current, status: answer.status, closedAt: null, team: null } : current,
          );
          rememberCase({
            id,
            token,
            status: answer.status,
            createdAt: timeline?.createdAt ?? new Date().toISOString(),
          });
          load();
        },
        () => setDisputeFailed(true),
      )
      .finally(() => setClosing(false));
  }

  /**
   * "It got worse, I need rescue": the request becomes a rescue case and the rescue teams are
   * called at once. Like a dispute it is never queued: if it cannot be sent the screen says so
   * immediately, with the SOS button and the hotlines under it.
   */
  function needRescue() {
    setClosing(true);
    setEscalated(null);
    fetch(`/api/sos/${id}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { "x-jaga-sos-token": token } : {}),
      },
      body: JSON.stringify({ action: "need_rescue", token }),
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        return (await response.json()) as { status: SosStatus };
      })
      .then(
        (answer) => {
          shown.current = { status: answer.status, hasTeam: false };
          setTeamPhone(null);
          setTimeline((current) =>
            current
              ? { ...current, kind: "rescue", status: answer.status, closedAt: null, team: null }
              : current,
          );
          setEscalated("done");
          load();
        },
        () => setEscalated("failed"),
      )
      .finally(() => setClosing(false));
  }

  // The words for one status or event: the delivery's own where it has them.
  const word = (key: string, values?: Record<string, string>) =>
    supplies && t.has(`supplies.status.${key}`)
      ? t(`supplies.status.${key}`, values)
      : t(`status.${key}`, values);

  if (!ready || state === "loading") {
    return <p role="status">{t("status.title")}</p>;
  }

  if (state === "unknown") {
    const others = (cases ?? []).filter((c) => c.id !== id);
    return (
      <section className={`flex flex-col gap-4 ${formColumn}`} data-case-state="unknown">
        <h1 className="text-h3 font-bold text-jaga-ink">{t("status.title")}</h1>
        <p className={notice}>{t("status.notFound")}</p>
        {others.length > 0 && (
          <Link href={`/sos/${others[0]!.id}`} className={buttonSecondary}>
            <LifebuoyIcon size={22} />
            {t("status.openCaseLink")}
          </Link>
        )}
        <Link href="/sos" className={buttonPrimary}>
          <LifebuoyIcon size={22} />
          {t("action")}
        </Link>
        <CallNow />
      </section>
    );
  }

  return (
    <section
      className={`flex flex-col gap-4 ${formColumn}`}
      data-case-state={timeline?.status ?? "unknown"}
      data-case-kind={timeline?.kind ?? "rescue"}
    >
      <h1 className="text-h3 font-bold text-jaga-ink">
        {supplies ? t("supplies.statusTitle") : t("status.title")}
      </h1>
      {merged && <p className={notice}>{t("sent.merged")}</p>}
      {!merged && <p>{supplies ? t("supplies.sentBody") : t("sent.body")}</p>}
      {escalated === "done" && (
        <p role="status" className={`${notice} font-bold`} data-escalated="true">
          {t("supplies.escalate.done")}
        </p>
      )}

      {/* Where the request stands, as steps (the owner, 13 Oct). */}
      {timeline && (
        <div className={card} data-case-journey="true">
          <Journey journey={sosJourney(timeline)} />
          <Link href="/requests" prefetch={false} className="min-h-tap self-start underline">
            {tJourney("link")}
          </Link>
        </div>
      )}

      {timeline && (
        <div className={card}>
          <p className="text-h3 font-bold text-jaga-ink" data-case-status={timeline.status}>
            {pending
              ? word("rescued_by_team")
              : timeline.status === "assigned"
                ? timeline.unitName
                  ? word("assigned", { unit: timeline.unitName })
                  : word("accepted")
                : word(timeline.status)}
          </p>
          {timeline.status === "received" && !timeline.team && !supplies && (
            <p>{t("status.waiting")}</p>
          )}
          {timeline.needs.length > 0 && (
            <div className="flex flex-col gap-1" data-case-needs={timeline.needs.join(",")}>
              <h2 className="font-bold">{t("supplies.asked")}</h2>
              <p>{timeline.needs.map((need) => t(`needs.${need}`)).join(" · ")}</p>
              {timeline.suppliesLeft && (
                <p className={hint}>{t(`supplies.left.${timeline.suppliesLeft}`)}</p>
              )}
              {timeline.needsNote && <p>{timeline.needsNote}</p>}
            </div>
          )}
          {timeline.unitName && !timeline.team && (
            <p>{t("status.unit", { unit: timeline.unitName })}</p>
          )}
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
                    {event.event === "assigned" || event.event === "accepted"
                      ? event.unit
                        ? word("assigned", { unit: event.unit })
                        : word("accepted")
                      : word(event.event)}
                  </span>
                  <span className={hint}>{time(event.at)}</span>
                </li>
              ))}
          </ol>
        </div>
      )}

      {pending && (
        <section
          className="flex flex-col gap-3 rounded-2xl border-2 border-jaga-edge bg-jaga-surface p-5"
          data-confirm-rescue="true"
        >
          <h2 className="text-h3 font-bold text-jaga-ink">
            {timeline?.unitName
              ? t(supplies ? "supplies.confirm.title" : "confirm.title", {
                  unit: timeline.unitName,
                })
              : t(supplies ? "supplies.confirm.titleNoUnit" : "confirm.titleNoUnit")}
          </h2>
          <p>{t(supplies ? "supplies.confirm.body" : "confirm.body")}</p>
          <button
            type="button"
            onClick={() => void close(true)}
            disabled={closing}
            data-confirm-yes="true"
            className={buttonPrimary}
          >
            <CheckIcon size={22} />
            {closing ? t("status.closing") : t(supplies ? "supplies.confirm.yes" : "confirm.yes")}
          </button>
          <button
            type="button"
            onClick={dispute}
            disabled={closing}
            data-confirm-no="true"
            className={buttonSecondary}
          >
            <CrossIcon size={22} />
            {t(supplies ? "supplies.confirm.no" : "confirm.no")}
          </button>
          <p className={hint}>{t(supplies ? "supplies.confirm.noHint" : "confirm.noHint")}</p>
          {disputeFailed && (
            <p role="alert" className="font-bold">
              {t("confirm.failed")}
            </p>
          )}
        </section>
      )}

      {timeline?.team && open && (
        <TeamStatus
          team={timeline.team}
          createdAt={timeline.createdAt}
          supplies={supplies}
          now={now}
          phone={teamPhone}
          asking={askingPhone}
          onAskPhone={askTeamPhone}
        />
      )}

      {state === "failed" && <p className={notice}>{t("status.loadFailed")}</p>}
      <button type="button" onClick={load} className={buttonSecondary}>
        <RetryIcon size={22} />
        {t("status.refresh")}
      </button>

      {/* Safe an hour ago is not safe now: one tap turns the request into a rescue (spec 4.10). */}
      {supplies && (open || pending) && (
        <section
          className="flex flex-col gap-2 rounded-2xl border-2 border-sos bg-jaga-surface p-5"
          data-need-rescue="true"
        >
          <button
            type="button"
            onClick={needRescue}
            disabled={closing}
            data-need-rescue-button="true"
            className="flex min-h-16 w-full items-center justify-center gap-3 rounded-2xl bg-sos px-4 py-3 text-h3 font-bold text-sos-fg active:translate-y-px disabled:opacity-70"
          >
            <LifebuoyIcon size={30} />
            {closing ? t("status.closing") : t("supplies.escalate.button")}
          </button>
          <p className={hint}>{t("supplies.escalate.hint")}</p>
          {escalated === "failed" && (
            <>
              <p role="alert" className="font-bold">
                {t("supplies.escalate.failed")}
              </p>
              <Link href="/sos" className={buttonPrimary}>
                <LifebuoyIcon size={22} />
                {t("send")}
              </Link>
            </>
          )}
        </section>
      )}

      {open && (
        <>
          {/* After sending, never before: "tell this phone when a team accepts" (A7). */}
          <CasePush id={id} token={token} />
          {!supplies && <SosDetailsForm id={id} token={token} />}
          <div className={card}>
            <button
              type="button"
              onClick={() => void close(false)}
              disabled={closing}
              data-case-safe="true"
              className={buttonSecondary}
            >
              <CheckIcon size={22} />
              {closing
                ? t("status.closing")
                : supplies
                  ? t("supplies.cancel")
                  : t("status.safeNow")}
            </button>
            <p className={hint}>{supplies ? t("supplies.cancelHint") : t("status.safeConfirm")}</p>
            <button
              type="button"
              onClick={() => void close(true)}
              disabled={closing}
              data-case-rescued="true"
              className={buttonSecondary}
            >
              <CheckIcon size={22} />
              {supplies ? t("supplies.gotIt") : t("status.rescuedNow")}
            </button>
          </div>
        </>
      )}

      {!open && !pending && (
        <div className="flex flex-col gap-3">
          <p className={notice}>{supplies ? t("supplies.closed") : t("status.closed")}</p>
          <Link href="/" className={buttonSecondary}>
            <HouseIcon size={22} />
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
  "accepted",
  "released",
  "en_route",
  "on_site",
  "rescued",
  "rescued_by_team",
  "confirmed",
  "not_rescued",
  "needs_rescue",
  "safe_cancelled",
  "dismissed",
  "repeat_merged",
  "details_added",
];
function known(event: string): boolean {
  return KNOWN_EVENTS.includes(event);
}
