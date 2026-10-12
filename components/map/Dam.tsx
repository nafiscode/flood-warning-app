"use client";

import { useFormatter, useLocale, useTranslations } from "next-intl";
import { CheckIcon, ClockIcon, TriangleIcon, WaveIcon } from "@/components/icons";
import { Link } from "@/i18n/navigation";
import {
  ageHours,
  attention,
  dailyPart,
  damLevel,
  flow,
  trend,
  volume,
  type Dam,
  type DamAttention,
  type DamLevel,
  type DamSignal,
} from "@/lib/dam";
import { DamSectionFigure } from "@/components/dam/DamFigures";
import { DamArrivalLines } from "@/components/map/DamArrival";
import { DamHistory } from "@/components/map/DamHistory";
import { localName } from "@/lib/places";
import { BANGKOK_DATE_TIME } from "@/lib/time";
import { card, hint, notice } from "@/lib/ui";

/**
 * What the app says about the dam of its own accord (spec section 15, the owner's decision of
 * 10 Oct 2026).
 *
 * This is the **quiet** tier, and everything about it is deliberate:
 *
 *   * It is not an alert. It carries no alert level and no alert colour, because only a person
 *     may publish an alert (safety rule 2) and only the alert palette may show a level
 *     (docs/brand.md). It says what the dam's own published figures show, and nothing more.
 *   * It gives **no arrival time**, because nobody has measured the travel times yet (S7 steps
 *     2-3). Saying "water in two hours" from an unmeasured guess would be the worst thing on
 *     this screen.
 *   * It always carries the hour the figures were read and how old they are. The feed lags by
 *     hours, so a figure without its age would be a lie by omission (safety rule 8).
 *   * It makes no sound and sends nothing. The loud one is raised for the admins to review.
 */

/*
 * The dam's state as a colour, in Jaga's own alert hues (the owner's choice of 12 Oct: normal
 * green, attention yellow, a confirmed release red; one traffic light in the app, not two).
 *
 * Three things keep that honest. It is a **pill, not an alert badge** - a different shape from
 * the levels a person issues, which are square-cornered. It never carries the colour alone: an
 * icon and a word ride with it, as every level in this app does (docs/brand.md). And wherever it
 * appears, the words beside it say these are the dam's own published figures and not an alert
 * from Jaga, because only a person may issue one (safety rule 2).
 *
 * "unknown" is grey and never green: a dam that has published nothing is not a dam that is
 * behaving (safety rule 10).
 */
const LEVEL_CLASS: Record<DamLevel, string> = {
  unknown: "bg-alert-stale text-alert-stale-fg",
  normal: "bg-alert-normal text-alert-normal-fg",
  watch: "bg-alert-watch text-alert-watch-fg",
  releasing: "bg-alert-evacuate text-alert-evacuate-fg",
};

const LEVEL_ICON: Record<DamLevel, typeof CheckIcon> = {
  unknown: ClockIcon,
  normal: CheckIcon,
  watch: TriangleIcon,
  // A wave, not the running figure of an Evacuate alert: this says water is leaving the dam.
  releasing: WaveIcon,
};

export function DamStateChip({ signal }: { signal: DamSignal | null }) {
  const t = useTranslations("dam");
  const level = damLevel(signal);
  const Icon = LEVEL_ICON[level];
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span
        data-dam-chip={level}
        data-dam-level={level}
        className={`inline-flex min-h-tap items-center gap-2 rounded-full px-4 py-1 font-bold ${LEVEL_CLASS[level]}`}
      >
        <Icon size={24} aria-hidden="true" />
        <span>{t(`state.${level}`)}</span>
      </span>
      {/*
       * A figure from yesterday morning does not say what the dam is doing now, so a green chip
       * on its own would be a lie by omission. The app's rule for a stale alert is to keep the
       * level and add a grey marker beside it (docs/brand.md), and the same holds here: the last
       * known state stays, with the grey saying how old it is.
       */}
      {signal?.stale && (
        <span
          data-dam-stale="true"
          className="inline-flex min-h-tap items-center gap-2 rounded-full bg-alert-stale px-4 py-1 font-medium text-alert-stale-fg"
        >
          <ClockIcon size={20} aria-hidden="true" />
          <span>{t("state.stale")}</span>
        </span>
      )}
    </span>
  );
}

function Figures({
  dam,
  now,
  brief = false,
}: {
  dam: Dam;
  now: number;
  /**
   * The notice is read on the home screen, where the day's second line would push the SOS button
   * further down the page, so it keeps only the figure a person downstream needs: how much water
   * has been coming down the river. What arrives in the reservoir is the dam's own business and
   * stays on the dam's card, one tap away.
   */
  brief?: boolean;
}) {
  const t = useTranslations("dam");
  const format = useFormatter();
  const signal = dam.signal;
  if (!signal) return <p className={hint}>{t("figures.none")}</p>;
  const age = ageHours(signal, now);
  const outflow = flow(signal.outflowCms);
  const spilled = flow(signal.spilledCms);
  /*
   * The day behind the newest reading (the owner asked for it on 11 Oct). The hourly figure and
   * the day's mean answer different questions, and the hour alone can say the opposite of what
   * the day did: on 11 Oct the newest hour had the dam releasing nothing while the day behind it
   * had passed 3.98 million m3 downstream. Each mean says how many hours it rests on, because
   * the feed has gaps (safety rule 8).
   */
  const daily = dam.daily;
  const dailyOut = dailyPart(daily, "outflow");
  const dailyIn = brief ? null : dailyPart(daily, "inflow");
  const dailySpill = volume(daily?.spilledMcm ?? null);
  return (
    <div className="flex flex-col gap-1">
      {outflow !== null && (
        <p>
          <span className="font-medium">{t("figures.outflow", { cms: outflow })}</span>
          {spilled !== null && spilled > 0 && <> · {t("figures.spilled", { cms: spilled })}</>}
        </p>
      )}
      {signal.storageMcm !== null && (
        <p>
          {t("figures.storage", {
            mcm: Math.round(signal.storageMcm),
            percent: signal.percentFull ?? 0,
          })}
        </p>
      )}
      {signal.levelM !== null && <p>{t("figures.level", { m: signal.levelM.toFixed(2) })}</p>}
      <p>{t(`figures.trend.${trend(signal)}`, { hours: signal.riseWindowH })}</p>
      {daily && (dailyOut || dailyIn) && (
        <div className="flex flex-col gap-1">
          <p className="font-medium">{t("figures.daily.title", { window: daily.windowH })}</p>
          {dailyOut && (
            <p>
              {t("figures.daily.outflow", {
                cms: dailyOut.cms,
                mcm: dailyOut.mcm,
                hours: dailyOut.hours,
              })}
              {dailySpill !== null && dailySpill > 0 && (
                <> {t("figures.daily.spilled", { mcm: dailySpill })}</>
              )}
            </p>
          )}
          {dailyIn && (
            <p>
              {t("figures.daily.inflow", {
                cms: dailyIn.cms,
                mcm: dailyIn.mcm,
                hours: dailyIn.hours,
              })}
            </p>
          )}
        </div>
      )}
      <p className={`${hint} flex items-center gap-1.5`}>
        <ClockIcon size={18} aria-hidden="true" />
        {t("figures.observed", {
          time: format.dateTime(new Date(signal.observedAt), BANGKOK_DATE_TIME),
        })}{" "}
        {/* "0 hours ago" is not something anybody says. */}·{" "}
        {age < 1 ? t("figures.ageRecent") : t("figures.age", { hours: Math.round(age) })}
      </p>
      {signal.stale && (
        <p role="status" className={hint}>
          {t("figures.stale")}
        </p>
      )}
    </div>
  );
}

/**
 * The quiet notice. Shown only to someone whose own area or watched place is on the river below
 * the dam; everyone else can still read everything by tapping the dam on the map.
 */
export function DamNotice({
  dam,
  via,
  tambonCode,
  tambonName,
  now,
  gatesOpenAt = null,
}: {
  dam: Dam;
  /** Whether the river itself runs through their area, or only a stream that joins it. */
  via: "main" | "tributary" | "outlet";
  /** The tambon the notice is about: the same one the arrival time is read for. */
  tambonCode?: string | null;
  tambonName: string;
  /** Passed in, never read from the clock here: this renders on the server first. */
  now: number;
  /** When a person has sent a release notice saying the gates opened; null on an ordinary day. */
  gatesOpenAt?: string | null;
}) {
  const t = useTranslations("dam");
  const locale = useLocale();
  const state: DamAttention = attention(dam.signal);
  if (state === "none") return null;
  const name = localName(dam.name, locale);
  return (
    <section className={notice} data-dam-notice={state} role="status">
      <div className="flex flex-col gap-2">
        <p className="flex items-center gap-2 font-bold text-jaga-ink">
          <WaveIcon size={24} aria-hidden="true" />
          {t(`notice.${state}.title`, { dam: name })}
        </p>
        <DamStateChip signal={dam.signal} />
        {/* The drawing the owner chose on 12 Oct, where the notice already goes. */}
        <DamSectionFigure dam={dam} />
        <p>{t(`notice.${state}.body`, { dam: name, river: localName(dam.river, locale) })}</p>
        <p>
          {t(via === "tributary" ? "notice.whereTributary" : "notice.where", {
            tambon: tambonName,
            river: localName(dam.river, locale),
          })}
        </p>
        <Figures dam={dam} now={now} brief />
        {/*
         * The disclaimer is not small print. It says the two things a person could otherwise get
         * wrong: this is not Jaga telling them to do something, and nobody knows when the water
         * arrives.
         */}
        <p className="font-medium">{t("disclaimer.notAnAlert")}</p>
        {dam.arrivals.length > 0 ? (
          <DamArrivalLines
            dam={dam}
            tambonCodes={tambonCode ? [tambonCode] : []}
            tambonName={tambonName}
            gatesOpenAt={gatesOpenAt}
          />
        ) : (
          <p>{t("disclaimer.noArrivalTime")}</p>
        )}
        <p className={hint}>{t("source", { operator: dam.operator })}</p>
        <Link href="/map" prefetch={false} className="min-h-tap self-start underline">
          {t("notice.openMap")}
        </Link>
      </div>
    </section>
  );
}

/** The dam's card: what it is, what its figures say, and what the lines on the map do not say. */
export function DamCard({
  dam,
  now,
  tambonCode = null,
  tambonName = null,
}: {
  dam: Dam;
  now: number;
  /** The person's own area, when the screen showing the card knows it. */
  tambonCode?: string | null;
  tambonName?: string | null;
}) {
  const t = useTranslations("dam");
  const locale = useLocale();
  const state = attention(dam.signal);
  const note = dam.geometryNote;
  return (
    <section className={card} data-selected="dam" data-dam-state={state}>
      <div className="flex flex-col gap-1">
        <p className="flex items-center gap-2 text-h3 font-bold text-jaga-ink">
          <WaveIcon size={26} aria-hidden="true" />
          {localName(dam.name, locale)}
        </p>
        <p className={hint}>
          {t("panel.operator", { operator: dam.operator })} ·{" "}
          {t("panel.river", { river: localName(dam.river, locale) })}
        </p>
      </div>

      {/*
       * The drawing of what the dam is doing, above the words (the owner, 13 Oct). Without its
       * own caption here: the chip, the grade line and the figures below already say all of it,
       * and in a browser the three readings of "normal range" ran one under the other.
       */}
      <DamSectionFigure dam={dam} caption={false} />

      {/* The state in colour, icon and words, never by colour alone (CLAUDE.md, accessibility). */}
      <DamStateChip signal={dam.signal} />
      <p className="font-medium">{t(`grade.${dam.signal?.grade ?? "unknown"}`)}</p>
      {/*
       * The card now wears the alert hues, so it has to carry the line the notice always had:
       * this is the dam's own figure, not a level Jaga issued (safety rule 2).
       */}
      <p className={hint}>{t("disclaimer.notAnAlert")}</p>
      {(dam.signal?.reasons ?? []).map((reason) => (
        /* "rising_fast" names the window it measured over, so every reason is given it. */
        <p key={reason}>{t(`reason.${reason}`, { hours: dam.signal?.riseWindowH ?? 6 })}</p>
      ))}
      {(dam.signal?.awaiting ?? []).map((awaiting) => (
        <p key={awaiting} className={hint}>
          {t(`awaiting.${awaiting}`, { readings: dam.signal?.confirmedOver ?? 2 })}
        </p>
      ))}

      <Figures dam={dam} now={now} />

      {/*
       * The fortnight (the owner, 12 Oct). On the card and not in the notice: the notice is read
       * on the home screen, and two charts there would push the SOS button off a small phone.
       */}
      <DamHistory dam={dam} />

      <div className="flex flex-col gap-1">
        <p className="font-medium">{t("path.title")}</p>
        <p>
          {t("path.tambons", {
            count: dam.tambons.filter((x) => x.via === "main").length,
            tributary: dam.tambons.filter((x) => x.via === "tributary").length,
          })}
        </p>
        {/*
         * Safety rule 8 and rule 10 together: a layer never travels without what it does not
         * say. These lines are a river's course, not a flood extent, and the tributaries are
         * only the ones somebody has mapped.
         */}
        <p className={hint}>{t("path.limits")}</p>
        {note.spillway_channel_mapped === false && (
          <p className={hint}>{t("path.spillwayNotMapped")}</p>
        )}
        <p className={hint}>{t("path.credit")}</p>
      </div>

      {dam.arrivals.length > 0 ? (
        <DamArrivalLines
          dam={dam}
          tambonCodes={tambonCode ? [tambonCode] : []}
          tambonName={tambonName}
        />
      ) : (
        <p>{t("disclaimer.noArrivalTime")}</p>
      )}
      <p className={hint}>{t("source", { operator: dam.operator })}</p>
    </section>
  );
}

/** The dam's rows in the map legend, so the lines can be read without tapping them. */
export function DamLegend({ dam }: { dam: Dam }) {
  const t = useTranslations("dam");
  const locale = useLocale();
  return (
    <>
      <li className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="inline-block h-3 w-5 shrink-0 rounded-sm border border-jaga-dam bg-jaga-dam/30"
        />
        {t("legend.reservoir", { dam: localName(dam.name, locale) })}
      </li>
      <li className="flex items-center gap-2">
        <span aria-hidden="true" className="inline-block h-1.5 w-5 shrink-0 rounded bg-jaga-dam" />
        {t("legend.river", { river: localName(dam.river, locale) })}
      </li>
      <li className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="inline-block h-0.5 w-5 shrink-0 border-t-2 border-dashed border-jaga-dam"
        />
        {t("legend.tributary")}
      </li>
    </>
  );
}
