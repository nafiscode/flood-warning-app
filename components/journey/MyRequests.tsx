"use client";

import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { FeedbackAsk } from "@/components/feedback/FeedbackAsk";
import { Journey } from "@/components/journey/Journey";
import { Link } from "@/i18n/navigation";
import { pickName } from "@/lib/area";
import { FIELD_URL, fieldJourney, type MyFieldRescue } from "@/lib/field-rescue";
import type { MyReport } from "@/lib/flood-reports";
import {
  REQUESTS_URL,
  reportJourney,
  sosJourney,
  unitJourney,
  type UnitRequest,
} from "@/lib/journey";
import type { KnownCase } from "@/lib/notices";
import { readStored, useOnPhone, writeStored } from "@/lib/phone-store";
import { caseToken, rememberedCases, type SosTimeline } from "@/lib/sos";
import { isSessionCookie } from "@/lib/supabase/env";
import { BANGKOK_DATE_TIME } from "@/lib/time";
import { buttonSecondary, card, hint, notice } from "@/lib/ui";
import { ForwardIcon } from "@/components/icons";

export type MyRequestsData = {
  cases: KnownCase[];
  units: UnitRequest[];
  reports: MyReport[];
  /** Rescues the person's team found by itself. */
  field?: MyFieldRescue[];
  /** False for a visitor: teams and reports belong to an account. */
  signedIn: boolean;
  /** Something shown is this phone's copy because the connection failed (A9). */
  fromPhone?: boolean;
  /** When the oldest copy shown was saved; null when unknown. */
  savedAt?: number | null;
};

/** The last answer about teams, reports and field rescues, kept for offline (no phone numbers). */
type StoredRequests = {
  units: UnitRequest[];
  reports: MyReport[];
  field: MyFieldRescue[];
  savedAt: number;
};

/**
 * "My requests": everything this person has sent that somebody else acts on, each with its line
 * of steps. In-progress things first. Drawn from what it is given, so it is tested without a
 * server; `MyRequests` below does the asking.
 */
export function MyRequestsView({ data, loading }: { data: MyRequestsData; loading: boolean }) {
  const t = useTranslations("journey");
  const locale = useLocale();
  const format = useFormatter();
  const when = (iso: string) => format.dateTime(new Date(iso), BANGKOK_DATE_TIME);

  const cards = [
    ...data.cases.flatMap((c) => {
      if (!c.timeline) return [];
      const journey = sosJourney(c.timeline);
      return [
        {
          key: `sos:${c.id}`,
          at: c.timeline.createdAt,
          journey,
          title: t(`${journey.kind}.title`),
          href: `/sos/${c.id}`,
          open: t("page.openCase"),
        },
      ];
    }),
    ...data.units.map((u) => {
      const journey = unitJourney(u);
      return {
        key: `unit:${u.id}`,
        at: u.createdAt,
        journey,
        title: t("unit.titleNamed", { name: u.name }),
        href: u.status === "verified" ? "/authority" : "/account",
        open: u.status === "verified" ? t("page.openConsole") : t("page.openAccount"),
      };
    }),
    ...data.reports.map((r) => {
      const journey = reportJourney(r);
      return {
        key: `report:${r.id}`,
        at: r.createdAt,
        journey,
        title: t("report.titleNamed", { place: pickName(locale, r.nameTh, r.nameEn) }),
        href: "/report",
        open: t("page.openReport"),
      };
    }),
    ...(data.field ?? []).map((r) => {
      const journey = fieldJourney(r);
      return {
        key: `field:${r.id}`,
        at: r.createdAt,
        journey,
        title: t("field.titleNamed", { place: pickName(locale, r.tambonTh, r.tambonEn) }),
        href: "/authority/field-rescue",
        open: t("page.openField"),
      };
    }),
  ].sort(
    (a, b) =>
      Number(b.journey.open) - Number(a.journey.open) || Date.parse(b.at) - Date.parse(a.at),
  );
  const unread = data.cases.filter((c) => !c.timeline).length;
  /*
   * What has finished, with nothing still open. A case counts only once the journey itself says
   * it is closed, which for a request for help means the sender confirmed it (lib/journey.ts) -
   * the ask must not follow a case a team merely reported as done.
   */
  const stillOpen = cards.some((c) => c.journey.open);
  const finished: "case" | "report" | null = stillOpen
    ? null
    : cards.some((c) => c.key.startsWith("sos:"))
      ? "case"
      : cards.some((c) => c.key.startsWith("report:"))
        ? "report"
        : null;

  return (
    <div className="flex flex-col gap-5" data-my-requests={cards.length}>
      <h1 className="text-h3 font-bold text-jaga-ink">{t("page.title")}</h1>
      <p className={hint}>{t("page.intro")}</p>
      {loading && cards.length === 0 && <p>{t("page.loading")}</p>}
      {!loading && cards.length === 0 && (
        <p className={notice} data-requests-empty="true">
          {t("page.none")}
        </p>
      )}
      {unread > 0 && !loading && <p className={hint}>{t("page.unread", { count: unread })}</p>}
      {/* Every saved thing says how old it is (A9). */}
      {data.fromPhone && cards.length > 0 && (
        <p
          className={notice}
          role="status"
          data-requests-saved={data.savedAt != null ? "time" : "old"}
        >
          {data.savedAt != null
            ? t("page.savedAt", {
                time: format.dateTime(new Date(data.savedAt), BANGKOK_DATE_TIME),
              })
            : t("page.savedOld")}
        </p>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        {cards.map((c) => (
          <article
            key={c.key}
            className={card}
            data-request={c.key}
            data-request-open={c.journey.open}
          >
            <h2 className="text-body font-bold text-jaga-ink">
              {c.title}
              <span className={`block font-normal ${hint}`}>
                {t("page.sent", { time: when(c.at) })} ·{" "}
                {t(c.journey.open ? "page.inProgress" : "page.finished")}
              </span>
            </h2>
            <Journey journey={c.journey} />
            <Link href={c.href} prefetch={false} className={buttonSecondary}>
              <ForwardIcon size={22} />
              {c.open}
            </Link>
          </article>
        ))}
      </div>
      {!data.signedIn && <p className={hint}>{t("page.signInNote")}</p>}
      {/*
        The quiet ask (A15, spec 17), once and never again for 30 days on this phone. The moment
        is "nothing of theirs is still open and something of theirs has finished": a request that
        closed and was confirmed, or a report that ended. **Never while a request is open** - that
        is what `when` carries, and it is why the ask lives at the foot of this page rather than
        inside the SOS flow, which may never show it at all.
      */}
      <FeedbackAsk moment={finished === "case" ? "closed_request" : "ended_report"} when={!!finished} />
    </div>
  );
}

const hasSession = () =>
  document.cookie.split(";").some((c) => isSessionCookie(c.trim().split("=")[0] ?? ""));

/** Null for a refusal or no connection; `missed` is set only for no connection. */
async function getJson<T>(
  url: string,
  init?: RequestInit,
  missed?: { any: boolean },
): Promise<T | null> {
  try {
    const response = await fetch(url, { cache: "no-store", ...init });
    return response.ok ? ((await response.json()) as T) : null;
  } catch {
    if (missed) missed.any = true;
    return null;
  }
}

const POLL_MS = 30_000;

/**
 * Asks for each thing where it lives: a request for help with the key this phone holds for it
 * (so it works without an account), teams and reports with the person's own session. What the
 * bell last stored is shown at once, so the page is not empty while it asks, nor offline.
 */
export function MyRequests() {
  const ready = useOnPhone();
  const [data, setData] = useState<MyRequestsData | null>(null);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const load = async () => {
      const signedIn = hasSession();
      // A personal copy is kept only while someone is signed in (like their places).
      if (!signedIn && readStored("requests") !== null) writeStored("requests", null);
      const noticeCases = readStored<{ cases: KnownCase[]; checkedAt?: number }>("noticeCases");
      const stored = noticeCases?.cases ?? [];
      const caseMissed = { any: false };
      const accountMissed = { any: false };
      const [cases, units, reports, field] = await Promise.all([
        Promise.all(
          rememberedCases()
            .slice(0, 8)
            .map(async (one): Promise<KnownCase> => {
              const token = caseToken(one.id);
              const timeline = await getJson<SosTimeline>(
                `/api/sos/${one.id}`,
                { headers: token ? { "x-jaga-sos-token": token } : undefined },
                caseMissed,
              );
              // A case that could not be read keeps what was last known of it.
              return {
                id: one.id,
                timeline: timeline ?? stored.find((s) => s.id === one.id)?.timeline ?? null,
              };
            }),
        ),
        signedIn ? getJson<{ units: UnitRequest[] }>(REQUESTS_URL, {}, accountMissed) : null,
        signedIn ? getJson<{ reports: MyReport[] }>("/api/report/mine", {}, accountMissed) : null,
        signedIn ? getJson<{ rescues: MyFieldRescue[] }>(FIELD_URL, {}, accountMissed) : null,
      ]);
      if (cancelled) return;
      const kept = signedIn ? readStored<StoredRequests>("requests") : null;
      const fromKept = accountMissed.any && kept !== null;
      if (signedIn && !accountMissed.any && units && reports && field) {
        writeStored("requests", {
          units: units.units,
          reports: reports.reports,
          field: field.rescues,
          savedAt: Date.now(),
        } satisfies StoredRequests);
      }
      const fromCases = caseMissed.any && stored.length > 0;
      const times = [
        fromKept ? kept.savedAt : null,
        fromCases ? (noticeCases?.checkedAt ?? null) : null,
      ].filter((x): x is number => x !== null);
      setData({
        cases: cases.map((c) =>
          c.timeline
            ? {
                ...c,
                timeline: {
                  ...c.timeline,
                  kind: c.timeline.kind ?? "rescue",
                  events: c.timeline.events ?? [],
                },
              }
            : c,
        ),
        units: units?.units ?? (fromKept ? kept.units : []),
        reports: reports?.reports ?? (fromKept ? kept.reports : []),
        field: field?.rescues ?? (fromKept ? kept.field : []),
        signedIn,
        fromPhone: fromKept || fromCases,
        savedAt: times.length > 0 ? Math.min(...times) : null,
      });
    };
    void load();
    const timer = window.setInterval(load, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [ready]);

  return (
    <MyRequestsView
      data={data ?? { cases: [], units: [], reports: [], signedIn: true }}
      loading={data === null}
    />
  );
}

/**
 * The way in from the home screen: shown only when this phone has sent something or the person
 * is signed in, and it says how many requests are still open on this phone.
 */
export function RequestsLink() {
  const t = useTranslations("journey");
  const ready = useOnPhone();
  if (!ready) return null;
  const open = rememberedCases().filter((c) =>
    ["received", "assigned", "en_route", "on_site"].includes(c.status),
  ).length;
  if (open === 0 && rememberedCases().length === 0 && !hasSession()) return null;
  return (
    <Link
      href="/requests"
      prefetch={false}
      data-requests-link={open}
      className={`${buttonSecondary} flex-col`}
    >
      <span>{t("link")}</span>
      {open > 0 && <span className={`font-normal ${hint}`}>{t("linkOpen", { count: open })}</span>}
    </Link>
  );
}
