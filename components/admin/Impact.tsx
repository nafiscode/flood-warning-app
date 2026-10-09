"use client";

import { useTranslations } from "next-intl";
import { DualTime } from "@/components/admin/DualTime";
import {
  BarRow,
  Chip,
  MilestoneChip,
  NextStepBar,
  Numbers,
  StatTile,
  WeekColumns,
} from "@/components/admin/ImpactBits";
import { CheckIcon, LifebuoyIcon, TriangleIcon } from "@/components/icons";
import {
  byProvince,
  confirmedShare,
  earnedMilestones,
  honours,
  maxOf,
  nextMilestone,
  OUTCOMES,
  percent,
  seasonChange,
  sumBy,
  unansweredShare,
  WAIT_BANDS,
  type ImpactSeason,
  type UnitImpact,
} from "@/lib/impact";
import { card, hint, notice } from "@/lib/ui";

/**
 * The impact dashboard (spec section 16), admin-only for now, fed with made-up data until the
 * first season (owner, 9 Oct). It is one pure component so the same screen can be rendered by a
 * test and, later, by the real aggregates.
 *
 * The decisions it carries, all from the log of 9 Oct:
 *  - **Jaga carried requests; the teams did the rescues.** No sentence here claims otherwise.
 *  - **The failures sit beside the successes**, in the same size type.
 *  - **Recognition, not ranking.** Every unit gets its own card with what it did, the milestones
 *    it has reached and the next one to aim at, and it is compared with *its own* last season.
 *    The only ordered list is the month's honours: a top, never a bottom.
 *  - **No person is named**, and no unit carries a response time of its own.
 */
export function Impact({ season, locale }: { season: ImpactSeason; locale: string }) {
  const t = useTranslations("impact");
  const nf = new Intl.NumberFormat(locale === "th" ? "th-TH" : locale === "ms" ? "ms-MY" : "en-GB");
  const n = (value: number) => nf.format(value);
  const day = new Intl.DateTimeFormat(locale === "en" ? "en-GB" : locale, {
    day: "numeric",
    month: "short",
    timeZone: "Asia/Bangkok",
  });
  const date = (iso: string) => day.format(new Date(`${iso}T00:00:00+07:00`));

  const { totals, outcomes, waits, weeks, provinces, units, gaps } = season;
  const outcomeMax = maxOf(outcomes.map((o) => o.cases));
  const waitMax = maxOf(waits.map((w) => w.cases));
  const waitTotal = sumBy(waits, (w) => w.cases);
  const requestMax = maxOf(provinces.map((p) => p.requests));
  const thanked = honours(units);
  const groups = byProvince(units);

  return (
    <div className="flex flex-col gap-7">
      {/* Nothing on this page is real, and that is the first thing it says. */}
      <div className="flex gap-3 rounded-2xl border-2 border-jaga-edge bg-jaga-surface px-4 py-3">
        <TriangleIcon size={24} className="mt-1 shrink-0 text-jaga-ink" />
        <div className="flex flex-col gap-1">
          <p className="font-bold text-jaga-ink">{t("example.title")}</p>
          <p className="text-small text-jaga-text-2">{t("example.body")}</p>
        </div>
      </div>

      <header className="flex flex-col gap-2">
        <h1 className="text-h3 font-bold text-jaga-ink">{t("title")}</h1>
        <p className={hint}>
          {t("period", { from: date(season.from), to: date(season.to) })} · {t("computed")}{" "}
          <DualTime iso={season.computedAt} bangkokLabel={t("bangkok")} />
        </p>
        <p className="max-w-prose font-medium">{t("carriedNotSaved")}</p>
      </header>

      {/* 1. What Jaga carried, and what came of it. */}
      <section className="flex flex-col gap-3">
        <h2 className="text-body font-bold">{t("headline.title")}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            value={n(totals.requestsCarried)}
            label={t("headline.requests")}
            note={t("headline.requestsNote")}
          />
          <StatTile
            value={n(totals.confirmedRescues)}
            label={t("headline.rescues")}
            note={t("headline.rescuesNote", { percent: confirmedShare(totals) })}
          />
          <StatTile
            value={n(totals.peopleReached)}
            label={t("headline.people")}
            note={t("headline.peopleNote", { count: totals.vulnerableInvolved })}
          />
          <StatTile
            value={n(totals.teamsThatAccepted)}
            label={t("headline.teams")}
            note={t("headline.teamsNote")}
          />
        </div>
      </section>

      {/* 2. The honest half, in the same size type as the headline. */}
      <section className={card}>
        <h2 className="text-body font-bold">{t("outcomes.title")}</h2>
        <p className={hint}>{t("outcomes.note")}</p>
        <div className="flex flex-col gap-1">
          {OUTCOMES.map((outcome) => {
            const cases = outcomes.find((o) => o.outcome === outcome)?.cases ?? 0;
            return (
              <BarRow
                key={outcome}
                label={t(`outcomes.${outcome}`)}
                value={t("casesWithPercent", {
                  count: cases,
                  percent: percent(cases, totals.requestsCarried),
                })}
                share={cases}
                max={outcomeMax}
                note={t(`outcomes.${outcome}Note`)}
              />
            );
          })}
        </div>
        <p className="font-medium text-jaga-ink">
          {t("outcomes.unanswered", { percent: unansweredShare(outcomes) })}
        </p>
      </section>

      {/* 3. How long people waited for a team to accept. Province-wide, never per unit. */}
      <section className={card}>
        <h2 className="text-body font-bold">{t("waits.title")}</h2>
        <p className={hint}>{t("waits.note")}</p>
        <div className="flex flex-col gap-1">
          {WAIT_BANDS.map((band) => {
            const cases = waits.find((w) => w.band === band)?.cases ?? 0;
            return (
              <BarRow
                key={band}
                label={t(`waits.${band}`)}
                value={t("casesWithPercent", {
                  count: cases,
                  percent: percent(cases, waitTotal),
                })}
                share={cases}
                max={waitMax}
              />
            );
          })}
        </div>
        <p className="text-small text-jaga-text-2">
          {t("waits.medianLongest", {
            median: n(season.medianAcceptMinutes),
            longest: n(season.longestAcceptMinutes),
          })}
        </p>
      </section>

      {/* 4. Through the season. */}
      <section className={card}>
        <h2 className="text-body font-bold">{t("season.title")}</h2>
        <p className={hint}>{t("season.note")}</p>
        <WeekColumns weeks={weeks} weekLabel={date} />
      </section>

      {/* 5. Province by province, with the usage figures beside the help. */}
      <section className={card}>
        <h2 className="text-body font-bold">{t("provinces.title")}</h2>
        <p className={hint}>{t("provinces.note")}</p>
        <div className="flex flex-col gap-1">
          {provinces.map((row) => (
            <BarRow
              key={row.province}
              label={t(`province.${row.province}`)}
              value={t("provinces.value", {
                requests: n(row.requests),
                confirmed: n(row.confirmed),
              })}
              share={row.requests}
              max={requestMax}
              note={t("provinces.rowNote", { teams: row.teams, opened: n(row.openedApp) })}
            />
          ))}
        </div>
        <Numbers
          caption={t("provinces.tableCaption")}
          head={[
            t("provinces.province"),
            t("season.requests"),
            t("season.confirmed"),
            t("provinces.teams"),
            t("provinces.opened"),
          ]}
          rows={provinces.map((row) => [
            t(`province.${row.province}`),
            n(row.requests),
            n(row.confirmed),
            n(row.teams),
            n(row.openedApp),
          ])}
        />
        <p className="text-small text-jaga-text-2">{t("provinces.usageNote")}</p>
      </section>

      {/* 6. The month's honours: a top, never a bottom. */}
      {thanked.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-body font-bold">{t("honours.title")}</h2>
          <p className={hint}>{t("honours.note")}</p>
          <ul className="grid list-none gap-3 p-0 sm:grid-cols-3">
            {thanked.map((unit) => (
              <li
                key={unit.id}
                className="flex flex-col gap-2 rounded-2xl border-2 border-jaga-teal-ink bg-jaga-surface p-4"
              >
                <LifebuoyIcon size={24} className="text-jaga-teal-ink" />
                <span className="font-bold text-jaga-ink">{unit.unit}</span>
                <span className="text-small text-jaga-text-2">{unit.org}</span>
                <span className="font-medium text-jaga-teal-ink">
                  {t("honours.count", { count: n(unit.confirmedThisMonth) })}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 7. Every team, grouped by province, in name order. */}
      <section className="flex flex-col gap-4">
        <h2 className="text-body font-bold">{t("teams.title")}</h2>
        <p className={hint}>{t("teams.note")}</p>
        {groups.map((group) => (
          <div key={group.province} className="flex flex-col gap-3">
            <h3 className="font-bold text-jaga-ink">{t(`province.${group.province}`)}</h3>
            <ul className="grid list-none gap-3 p-0 lg:grid-cols-2">
              {group.units.map((unit) => (
                <UnitCard key={unit.id} unit={unit} n={n} />
              ))}
            </ul>
          </div>
        ))}
      </section>

      {/* 8. Where no rescue team covers, as an invitation rather than a complaint. */}
      <section className={card}>
        <h2 className="text-body font-bold">{t("gaps.title")}</h2>
        <p className={hint}>{t("gaps.note")}</p>
        <ul className="flex flex-col gap-2 p-0">
          {gaps.map((gap) => (
            <li key={gap.tambon} className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium">{gap.name}</span>
              <span className="text-small text-jaga-text-2">
                {gap.district} · {t(`province.${gap.province}`)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* 9. What this page does not know, and what will be public. */}
      <section className={`${notice} flex flex-col gap-2`}>
        <h2 className="text-body font-bold">{t("limits.title")}</h2>
        <ul className="flex list-disc flex-col gap-1 ps-5">
          <li>{t("limits.outside")}</li>
          <li>{t("limits.noRanking")}</li>
          <li>{t("limits.noNames")}</li>
          <li>{t("limits.grain")}</li>
        </ul>
        <p className="text-small text-jaga-text-2">{t("limits.later")}</p>
      </section>
    </div>
  );
}

/**
 * One team's card: what it did, the milestones it has reached, the next one to aim at, and how
 * this season compares with its own last one. Nothing on this card refers to another team.
 */
function UnitCard({ unit, n }: { unit: UnitImpact; n: (value: number) => string }) {
  const t = useTranslations("impact");
  const earned = earnedMilestones(unit);
  const next = nextMilestone(unit);
  const change = seasonChange(unit);
  return (
    <li className="flex flex-col gap-3 rounded-2xl border border-jaga-line bg-jaga-surface p-4">
      <div className="flex flex-col gap-1">
        <span className="font-bold text-jaga-ink">{unit.unit}</span>
        <span className="text-small text-jaga-text-2">{unit.org}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {unit.capabilities.map((capability) => (
          <Chip key={capability}>{t(`capability.${capability}`)}</Chip>
        ))}
        <Chip>{t("teams.seasons", { count: unit.seasons })}</Chip>
      </div>
      <dl className="m-0 grid grid-cols-3 gap-2 text-center">
        <div className="flex flex-col">
          <dd className="m-0 text-h3 font-bold tabular-nums text-jaga-ink">{n(unit.accepted)}</dd>
          <dt className="text-small text-jaga-text-2">{t("teams.accepted")}</dt>
        </div>
        <div className="flex flex-col">
          <dd className="m-0 text-h3 font-bold tabular-nums text-jaga-ink">{n(unit.confirmed)}</dd>
          <dt className="text-small text-jaga-text-2">{t("teams.confirmed")}</dt>
        </div>
        <div className="flex flex-col">
          <dd className="m-0 text-h3 font-bold tabular-nums text-jaga-ink">
            {n(unit.peopleReached)}
          </dd>
          <dt className="text-small text-jaga-text-2">{t("teams.people")}</dt>
        </div>
      </dl>
      {change ? (
        <p className="inline-flex items-center gap-2 text-small font-medium">
          <CheckIcon size={16} className="text-jaga-teal-ink" />
          {change.delta >= 0
            ? t("teams.upOnLast", { count: n(change.delta), percent: change.percent })
            : t("teams.downOnLast", { count: n(-change.delta) })}
        </p>
      ) : (
        <p className="text-small font-medium text-jaga-teal-ink">{t("teams.firstSeason")}</p>
      )}
      {earned.length > 0 && (
        <ul className="flex list-none flex-wrap gap-2 p-0">
          {earned.map((milestone) => (
            <li key={milestone.key}>
              <MilestoneChip>{t(`milestone.${milestone.key}`)}</MilestoneChip>
            </li>
          ))}
        </ul>
      )}
      {next && (
        <NextStepBar
          words={t(`next.${next.milestone.metric}`, {
            count: n(next.remaining),
            target: n(next.milestone.target),
          })}
          current={next.current}
          target={next.milestone.target}
        />
      )}
    </li>
  );
}
