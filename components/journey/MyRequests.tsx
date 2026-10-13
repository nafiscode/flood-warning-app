"use client";

import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Journey } from "@/components/journey/Journey";
import { Link } from "@/i18n/navigation";
import { pickName } from "@/lib/area";
import type { MyReport } from "@/lib/flood-reports";
import {
  REQUESTS_URL,
  reportJourney,
  sosJourney,
  unitJourney,
  type UnitRequest,
} from "@/lib/journey";
import type { KnownCase } from "@/lib/notices";
import { readStored, useOnPhone } from "@/lib/phone-store";
import { caseToken, rememberedCases, type SosTimeline } from "@/lib/sos";
import { isSessionCookie } from "@/lib/supabase/env";
import { BANGKOK_DATE_TIME } from "@/lib/time";
import { buttonSecondary, card, hint, notice } from "@/lib/ui";

export type MyRequestsData = {
  cases: KnownCase[];
  units: UnitRequest[];
  reports: MyReport[];
  /** False for a visitor: teams and reports belong to an account. */
  signedIn: boolean;
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
  ].sort(
    (a, b) =>
      Number(b.journey.open) - Number(a.journey.open) || Date.parse(b.at) - Date.parse(a.at),
  );
  const unread = data.cases.filter((c) => !c.timeline).length;

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
              {c.open}
            </Link>
          </article>
        ))}
      </div>
      {!data.signedIn && <p className={hint}>{t("page.signInNote")}</p>}
    </div>
  );
}

const hasSession = () =>
  document.cookie.split(";").some((c) => isSessionCookie(c.trim().split("=")[0] ?? ""));

async function getJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const response = await fetch(url, { cache: "no-store", ...init });
    return response.ok ? ((await response.json()) as T) : null;
  } catch {
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
      const stored = readStored<{ cases: KnownCase[] }>("noticeCases")?.cases ?? [];
      const [cases, units, reports] = await Promise.all([
        Promise.all(
          rememberedCases()
            .slice(0, 8)
            .map(async (one): Promise<KnownCase> => {
              const token = caseToken(one.id);
              const timeline = await getJson<SosTimeline>(`/api/sos/${one.id}`, {
                headers: token ? { "x-jaga-sos-token": token } : undefined,
              });
              // A case that could not be read keeps what was last known of it.
              return {
                id: one.id,
                timeline: timeline ?? stored.find((s) => s.id === one.id)?.timeline ?? null,
              };
            }),
        ),
        signedIn ? getJson<{ units: UnitRequest[] }>(REQUESTS_URL) : null,
        signedIn ? getJson<{ reports: MyReport[] }>("/api/report/mine") : null,
      ]);
      if (cancelled) return;
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
        units: units?.units ?? [],
        reports: reports?.reports ?? [],
        signedIn,
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
