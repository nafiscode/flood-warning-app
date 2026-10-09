"use client";

import { useLocale, useTranslations } from "next-intl";
import { DualTime } from "@/components/admin/DualTime";
import { Chip } from "@/components/admin/WarRoomBits";
import { HouseIcon, PhoneIcon } from "@/components/icons";
import { Link } from "@/i18n/navigation";
import { card, hint, input } from "@/lib/ui";
import { topAreas, type PeoplePage, type WatchedCount } from "@/lib/war-room";

/**
 * Who has registered, and where they said they are.
 *
 * Two lines are held here, from spec 9:
 *  - a phone number is never in this list. "Has a number" is a yes or no; the number itself is
 *    read one person at a time through reveal_profile_phone(), which writes an audit entry
 *    (safety rule 5).
 *  - the places someone watches for other people are counted, never listed. The label, the person
 *    named on it and their phone belong to the owner of that place alone, and an admin reads none
 *    of them. The counts per tambon are what the war room needs: how many people here expect a
 *    warning.
 */

type Props = {
  page: PeoplePage;
  watched: WatchedCount[] | null;
  /** The number an admin asked to see, already read through the logged function. */
  reveal: { userId: string; phone: string | null } | null;
  /** Null on the example page: the search box and the reveal buttons then sit idle. */
  path: string | null;
};

/** One row of the list on a laptop, one card on a phone: the same markup for both. */
const ROW =
  "grid gap-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_repeat(4,minmax(0,1fr))] lg:items-center lg:gap-3";

export function WarRoomPeople({ page, watched, reveal, path }: Props) {
  const t = useTranslations("warRoom");
  const locale = useLocale();
  const latin = locale !== "th";
  const shown = page.rows.length;

  return (
    <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start lg:gap-6">
      <div className="flex flex-col gap-4">
        {/* No action: a GET form submits to the address it is on, which already has the
            language in it. The hidden field keeps the tab. */}
        <form className="flex flex-col gap-2 sm:flex-row">
          <input type="hidden" name="view" value="people" />
          <label className="sr-only" htmlFor="people-search">
            {t("people.search")}
          </label>
          <input
            id="people-search"
            name="q"
            defaultValue={page.search}
            placeholder={t("people.searchHint")}
            className={input}
            disabled={!path}
          />
          <button
            type="submit"
            className="inline-flex min-h-tap items-center justify-center rounded-xl border-2 border-jaga-edge bg-jaga-surface px-5 font-medium text-jaga-ink"
            disabled={!path}
          >
            {t("people.searchDo")}
          </button>
        </form>

        <p className={hint}>
          {t("people.count", { shown, total: page.total })}
          {page.search ? ` · ${t("people.searching", { q: page.search })}` : ""}
        </p>

        {/* The column names, on a laptop only: on a phone each card repeats what it shows. */}
        <div
          className={`${ROW} hidden border-b border-jaga-line pb-2 text-small font-bold text-jaga-text-2 lg:grid`}
        >
          <span>{t("people.name")}</span>
          <span>{t("people.area")}</span>
          <span>{t("people.watching")}</span>
          <span>{t("people.sosSent")}</span>
          <span>{t("people.joined")}</span>
          <span>{t("people.phone")}</span>
        </div>

        <ul className="flex flex-col gap-3">
          {page.rows.map((p) => (
            <li
              key={p.userId}
              className="rounded-2xl border border-jaga-line bg-jaga-surface p-4 lg:rounded-none lg:border-0 lg:border-b lg:border-jaga-line lg:p-0 lg:pb-3"
            >
              <div className={ROW}>
                <span className="font-bold text-jaga-ink">
                  {p.displayName || t("people.noName")}
                  {p.role !== "user" && (
                    <span className="ms-2 align-middle">
                      <Chip>{t.has(`role.${p.role}`) ? t(`role.${p.role}`) : p.role}</Chip>
                    </span>
                  )}
                </span>
                <span>
                  {[latin && p.tambonEn ? p.tambonEn : p.tambonTh, p.districtTh, p.provinceTh]
                    .filter(Boolean)
                    .join(" · ") || t("people.noArea")}
                  {p.lat != null && (
                    <span className="ms-2 align-middle text-jaga-text-2">
                      <HouseIcon size={18} className="inline" aria-hidden="true" />
                      <span className="sr-only">{t("people.hasHomePin")}</span>
                    </span>
                  )}
                </span>
                <span className="tabular-nums">
                  <span className="lg:hidden">{t("people.watching")}: </span>
                  {p.watchedPlaces}
                </span>
                <span className="tabular-nums">
                  <span className="lg:hidden">{t("people.sosSent")}: </span>
                  {p.sosSent}
                </span>
                <span className="text-small text-jaga-text-2">
                  <DualTime iso={p.createdAt} bangkokLabel={t("bangkok")} />
                </span>
                <span>
                  {reveal?.userId === p.userId ? (
                    reveal.phone ? (
                      <a href={`tel:${reveal.phone}`} className="font-bold underline">
                        {reveal.phone}
                      </a>
                    ) : (
                      <span className={hint}>{t("people.noPhone")}</span>
                    )
                  ) : p.hasPhone && path ? (
                    <Link
                      href={`${path}?${new URLSearchParams({ view: "people", q: page.search, person: p.userId })}`}
                      prefetch={false}
                      className="inline-flex min-h-tap items-center gap-2 text-small underline"
                    >
                      <PhoneIcon size={20} />
                      {t("people.showPhone")}
                    </Link>
                  ) : (
                    <span className={hint}>
                      {p.hasPhone ? t("people.hasPhone") : t("people.noPhone")}
                    </span>
                  )}
                </span>
              </div>
            </li>
          ))}
          {shown === 0 && <li className={hint}>{t("people.none")}</li>}
        </ul>

        {path && page.total > shown && (
          <Link
            href={`${path}?${new URLSearchParams({ view: "people", q: page.search, from: String(page.offset + shown) })}`}
            prefetch={false}
            className="inline-flex min-h-tap items-center justify-center rounded-xl border-2 border-jaga-edge px-5 font-medium text-jaga-ink"
          >
            {t("people.more")}
          </Link>
        )}
      </div>

      <section className={card}>
        <h2 className="text-body font-bold text-jaga-ink">{t("people.areasTitle")}</h2>
        <p className={hint}>{t("people.areasNote")}</p>
        {watched === null ? (
          <p className={hint}>{t("loading")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {topAreas(watched).map((a) => (
              <li
                key={a.tambon}
                className="flex items-baseline justify-between gap-3 border-b border-jaga-line pb-2 last:border-0"
              >
                <span>
                  <b>{latin && a.tambonEn ? a.tambonEn : a.tambonTh}</b>
                  <span className={`${hint} ms-2`}>{a.districtTh}</span>
                </span>
                <span className="shrink-0 tabular-nums">
                  {t("people.areaCounts", { homes: a.homes, places: a.places })}
                </span>
              </li>
            ))}
            {watched.length === 0 && <li className={hint}>{t("people.noAreas")}</li>}
          </ul>
        )}
      </section>
    </div>
  );
}
