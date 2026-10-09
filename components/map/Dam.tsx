"use client";

import { useFormatter, useLocale, useTranslations } from "next-intl";
import { ClockIcon, WaveIcon } from "@/components/icons";
import { Link } from "@/i18n/navigation";
import { ageHours, attention, flow, trend, type Dam, type DamAttention } from "@/lib/dam";
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

function Figures({ dam, now }: { dam: Dam; now: number }) {
  const t = useTranslations("dam");
  const format = useFormatter();
  const signal = dam.signal;
  if (!signal) return <p className={hint}>{t("figures.none")}</p>;
  const age = ageHours(signal, now);
  const outflow = flow(signal.outflowCms);
  const spilled = flow(signal.spilledCms);
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
  tambonName,
  now,
}: {
  dam: Dam;
  /** Whether the river itself runs through their area, or only a stream that joins it. */
  via: "main" | "tributary" | "outlet";
  tambonName: string;
  /** Passed in, never read from the clock here: this renders on the server first. */
  now: number;
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
        <p>{t(`notice.${state}.body`, { dam: name, river: localName(dam.river, locale) })}</p>
        <p>
          {t(via === "tributary" ? "notice.whereTributary" : "notice.where", {
            tambon: tambonName,
            river: localName(dam.river, locale),
          })}
        </p>
        <Figures dam={dam} now={now} />
        {/*
         * The disclaimer is not small print. It says the two things a person could otherwise get
         * wrong: this is not Jaga telling them to do something, and nobody knows when the water
         * arrives.
         */}
        <p className="font-medium">{t("disclaimer.notAnAlert")}</p>
        <p>{t("disclaimer.noArrivalTime")}</p>
        <p className={hint}>{t("source", { operator: dam.operator })}</p>
        <Link href="/map" prefetch={false} className="min-h-tap self-start underline">
          {t("notice.openMap")}
        </Link>
      </div>
    </section>
  );
}

/** The dam's card: what it is, what its figures say, and what the lines on the map do not say. */
export function DamCard({ dam, now }: { dam: Dam; now: number }) {
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

      {/* The state in words with an icon, never by colour alone (CLAUDE.md, accessibility). */}
      <p className="font-medium">{t(`grade.${dam.signal?.grade ?? "unknown"}`)}</p>
      {(dam.signal?.reasons ?? []).map((reason) => (
        <p key={reason}>{t(`reason.${reason}`)}</p>
      ))}
      {(dam.signal?.awaiting ?? []).map((awaiting) => (
        <p key={awaiting} className={hint}>
          {t(`awaiting.${awaiting}`, { readings: dam.signal?.confirmedOver ?? 2 })}
        </p>
      ))}

      <Figures dam={dam} now={now} />

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

      <p>{t("disclaimer.noArrivalTime")}</p>
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
