"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { DualTime } from "@/components/admin/DualTime";
import {
  Chip,
  consolePanel,
  Cup,
  lift,
  MilestoneChip,
  NextStepBar,
  now,
  Numbers,
  OutcomeDots,
  PanelStat,
  ProvinceMap,
  Reveal,
  Ring,
  rise,
  WaitCurve,
  WeekWave,
} from "@/components/admin/ImpactBits";
import { CheckIcon, TriangleIcon } from "@/components/icons";
import {
  byProvince,
  confirmedShare,
  earnedMilestones,
  honours,
  nextMilestone,
  percent,
  seasonChange,
  unansweredShare,
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
 *  - **It moves, and it is not all bars** (owner, 13 Oct): a navy panel with a dial at the top,
 *    every request as one mark, waiting as a curve, the season as a wave, a ring per province,
 *    and the four provinces on a map - at province grain and no finer (ImpactMap.tsx).
 *    The movement is an entrance played once; the rules for it are in ImpactBits.tsx.
 *  - **Recognition, not ranking.** Every unit gets its own card with what it did, the milestones
 *    it has reached and the next one to aim at, and it is compared with *its own* last season.
 *    The only ordered list is the month's honours: a top, never a bottom - and the only place
 *    a cup is given (owner, 13 Oct: a cup for the top teams, kept minimal).
 *  - **No person is named**, and no unit carries a response time of its own.
 */
export function Impact({ season, locale }: { season: ImpactSeason; locale: string }) {
  const t = useTranslations("impact");
  const n = useMemo(() => {
    const nf = new Intl.NumberFormat(
      locale === "th" ? "th-TH" : locale === "ms" ? "ms-MY" : "en-GB",
    );
    return (value: number) => nf.format(value);
  }, [locale]);
  const day = new Intl.DateTimeFormat(locale === "en" ? "en-GB" : locale, {
    day: "numeric",
    month: "short",
    timeZone: "Asia/Bangkok",
  });
  const date = (iso: string) => day.format(new Date(`${iso}T00:00:00+07:00`));

  const { totals, outcomes, waits, weeks, provinces, units, gaps } = season;
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
          <DualTime iso={season.computedAt} />
        </p>
        <p className="max-w-prose font-medium">{t("carriedNotSaved")}</p>
      </header>

      {/* 1. What Jaga carried, and what came of it: the panel the page opens on. */}
      <section
        className={`flex flex-col gap-5 rounded-3xl p-5 text-white lg:p-7 ${consolePanel} ${now}`}
        data-impact-panel
      >
        <h2 className="text-body font-bold text-white">{t("headline.title")}</h2>
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:gap-10">
          <div className="flex items-center gap-4">
            <Ring share={confirmedShare(totals)} size={144} onDark>
              <span className="text-h2 font-bold tabular-nums text-white">
                {confirmedShare(totals)}%
              </span>
            </Ring>
            <p className="max-w-48 font-medium text-white lg:hidden">
              {t("headline.rescues")}
              <span className="block text-small font-normal text-white/75">
                {t("headline.rescuesNote", { percent: confirmedShare(totals) })}
              </span>
            </p>
          </div>
          <div className="grid flex-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <PanelStat
              step={1}
              value={totals.requestsCarried}
              format={n}
              label={t("headline.requests")}
              note={t("headline.requestsNote")}
            />
            <PanelStat
              step={2}
              value={totals.confirmedRescues}
              format={n}
              label={t("headline.rescues")}
              note={t("headline.rescuesNote", { percent: confirmedShare(totals) })}
            />
            <PanelStat
              step={3}
              value={totals.peopleReached}
              format={n}
              label={t("headline.people")}
              note={t("headline.peopleNote", { count: totals.vulnerableInvolved })}
            />
            <PanelStat
              step={4}
              value={totals.teamsThatAccepted}
              format={n}
              label={t("headline.teams")}
              note={t("headline.teamsNote")}
            />
          </div>
        </div>
      </section>

      <div className="grid gap-7 lg:grid-cols-2">
        {/* 2. The honest half: every request one mark, whatever became of it. */}
        <Reveal className={card}>
          <h2 className="text-body font-bold">{t("outcomes.title")}</h2>
          <p className={hint}>{t("outcomes.note")}</p>
          <OutcomeDots
            outcomes={outcomes}
            total={totals.requestsCarried}
            label={(outcome) => t(`outcomes.${outcome}`)}
            note={(outcome) => t(`outcomes.${outcome}Note`)}
            cases={(count, share) => t("casesWithPercent", { count, percent: share })}
          />
          <p className="font-medium text-jaga-ink">
            {t("outcomes.unanswered", { percent: unansweredShare(outcomes) })}
          </p>
        </Reveal>

        {/* 3. How long people waited for a team to accept. Province-wide, never per unit. */}
        <Reveal className={card}>
          <h2 className="text-body font-bold">{t("waits.title")}</h2>
          <p className={hint}>{t("waits.note")}</p>
          <WaitCurve
            waits={waits}
            by={(band) => t(`waits.by.${band}`)}
            band={(band) => t(`waits.${band}`)}
          />
          <p className="text-small text-jaga-text-2">
            {t("waits.medianLongest", {
              median: n(season.medianAcceptMinutes),
              longest: n(season.longestAcceptMinutes),
            })}
          </p>
        </Reveal>
      </div>

      {/* 4. Through the season. */}
      <Reveal className={card}>
        <h2 className="text-body font-bold">{t("season.title")}</h2>
        <p className={hint}>{t("season.note")}</p>
        <WeekWave weeks={weeks} weekLabel={date} />
      </Reveal>

      {/* 5. Province by province, with the usage figures beside the help. */}
      <Reveal className={card}>
        <h2 className="text-body font-bold">{t("provinces.title")}</h2>
        <p className={hint}>{t("provinces.note")}</p>
        <ProvinceMap
          provinces={provinces}
          gaps={gaps.map((gap) => gap.tambon)}
          name={(province) => t(`province.${province}`)}
          format={n}
        />
        <ul className="grid list-none gap-4 p-0 sm:grid-cols-2 lg:grid-cols-4">
          {provinces.map((row, i) => {
            const share = percent(row.confirmed, row.requests);
            return (
              <li
                key={row.province}
                className={`flex items-center gap-3 lg:flex-col lg:items-start ${rise}`}
                style={{ "--i": i } as React.CSSProperties}
              >
                <Ring share={share} size={88}>
                  <span className="font-bold tabular-nums text-jaga-ink">{share}%</span>
                </Ring>
                <div className="flex flex-col">
                  <span className="font-bold text-jaga-ink">{t(`province.${row.province}`)}</span>
                  <span className="tabular-nums">
                    {t("provinces.value", {
                      requests: n(row.requests),
                      confirmed: n(row.confirmed),
                    })}
                  </span>
                  <span className="text-small text-jaga-text-2">
                    {t("provinces.rowNote", { teams: row.teams, opened: n(row.openedApp) })}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
        <p className="text-small text-jaga-text-2">{t("provinces.ringNote")}</p>
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
      </Reveal>

      {/* 6. The month's honours: a top, never a bottom. The only place a cup is given. */}
      {thanked.length > 0 && (
        <Reveal className="flex flex-col gap-3">
          <h2 className="text-body font-bold">{t("honours.title")}</h2>
          <p className={hint}>{t("honours.note")}</p>
          <ol className="grid list-none gap-3 p-0 sm:grid-cols-3">
            {thanked.map((unit, i) => (
              <li
                key={unit.id}
                className={`flex flex-col gap-2 rounded-2xl border-2 border-jaga-teal-ink bg-jaga-surface p-4 ${lift} ${rise}`}
                style={{ "--i": i } as React.CSSProperties}
              >
                <Cup first={i === 0} size={i === 0 ? 28 : 24} />
                <span className="font-bold text-jaga-ink">{unit.unit}</span>
                <span className="text-small text-jaga-text-2">{unit.org}</span>
                <span className="font-medium text-jaga-teal-ink">
                  {t("honours.count", { count: n(unit.confirmedThisMonth) })}
                </span>
              </li>
            ))}
          </ol>
        </Reveal>
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
                <UnitCard
                  key={unit.id}
                  unit={unit}
                  n={n}
                  thanked={thanked.some((u) => u.id === unit.id)}
                />
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
function UnitCard({
  unit,
  n,
  thanked,
}: {
  unit: UnitImpact;
  n: (value: number) => string;
  /** One of the month's honours: the same small cup, beside the name. */
  thanked: boolean;
}) {
  const t = useTranslations("impact");
  const earned = earnedMilestones(unit);
  const next = nextMilestone(unit);
  const change = seasonChange(unit);
  return (
    <li
      className={`flex flex-col gap-3 rounded-2xl border border-jaga-line bg-jaga-surface p-4 ${lift}`}
    >
      <div className="flex flex-col gap-1">
        <span className="flex items-start justify-between gap-2 font-bold text-jaga-ink">
          {unit.unit}
          {thanked && (
            <span title={t("teams.thanked")}>
              <Cup size={20} />
              <span className="sr-only">{t("teams.thanked")}</span>
            </span>
          )}
        </span>
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
