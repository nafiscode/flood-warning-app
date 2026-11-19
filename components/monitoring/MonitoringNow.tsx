import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { OpenMeteoAttribution } from "@/components/OpenMeteoAttribution";
import { ClockIcon, DropIcon, MessageIcon, RainIcon, WaveIcon } from "@/components/icons";
import type {
  DamNote,
  GaugeNote,
  Monitoring,
  Note,
  NoteScope,
  RainNote,
  ReportNote,
} from "@/lib/monitoring";
import { localName } from "@/lib/places";
import { hint } from "@/lib/ui";

/**
 * "What the monitoring shows now" (the owner, 17 Oct 2026): under the hero on the home screen and
 * inside the summary above the map, the live measurements in plain words.
 *
 * **Nothing in here may look like a level.** It wears none of the alert hues, no badge, no pill
 * and none of the five levels' icons, because the only level on either screen is the published
 * one above it and only a person issues one (safety rule 2). The icons it does use mean a kind of
 * thing - a river, a reservoir, what people said, the sky - and never a severity.
 *
 * Every line says what was measured, how far it reaches, when it was taken and who is speaking:
 * the station operators, the dam's operator, residents, or a forecast model. A feed Jaga could not
 * read says so, and a feed with nothing in it says what was measured rather than that all is well
 * - because an absence must never read as "no risk" (safety rule 10).
 */

export type ScopeWords = Partial<Record<NoteScope, string | null>>;

export type MonitoringNowProps = {
  summary: Monitoring;
  /** The words for each scope token; the screen knows the province and the person's places. */
  scopeWords: ScopeWords;
  /** The dam's name in the reader's language, and the tambon its river runs through. */
  damName: string | null;
  damTambon: string | null;
  /** The place the kept weather reading is for. */
  rainPlace: string | null;
  /** Bangkok time of an instant, as the screen already formats it. */
  time: (iso: string) => string;
  place: "home" | "map";
  /**
   * The way to the rivers that are rising, drawn under their names (the owner, 19 Nov 2026: "they
   * can click to see those river gauge name and should also blink and little bit zoom in in the
   * map"). The screen supplies it, because the two screens answer the press differently: the map
   * lights the marks where it stands, and the home screen has to travel to the map first. Left
   * out and the names are simply a list.
   */
  risingLink?: ReactNode;
};

const ICON: Record<Note["kind"], typeof WaveIcon> = {
  gauges: WaveIcon,
  dam: DropIcon,
  reports: MessageIcon,
  rain: RainIcon,
};

export function MonitoringNow(props: MonitoringNowProps) {
  const { summary, scopeWords, damName, damTambon, rainPlace, time, place } = props;
  const locale = useLocale();
  const t = useTranslations("monitoring");
  // The weather widget's own words for what is falling, so every screen says it the same way.
  const tWeather = useTranslations("weather");

  if (summary.notes.length === 0) return null;

  /** The screen supplies the names it knows (a province, a weather place); the rest are words. */
  const scope = (which: NoteScope): string => scopeWords[which] ?? t(`scope.${which}`);

  /** A reading's age, but only once it is old enough to matter: the time is written anyway. */
  const age = (note: Note): string | null => {
    if (note.ageMin === null) return null;
    if (note.ageMin < 60) return note.ageMin < 5 ? null : t("age", { minutes: note.ageMin });
    return t("hours", { hours: Math.floor(note.ageMin / 60) });
  };

  const gauges = (n: GaugeNote): ReactNode => {
    if (n.say === "unknown") {
      // A feed that answered with nobody reporting is not a feed saying the rivers are low.
      return n.total > 0 && n.reporting === 0
        ? t("gauges.noneReporting", { scope: scope(n.scope) })
        : t("gauges.unknown");
    }
    if (n.say === "active") {
      if (n.over > 0 && n.near > 0)
        return t("gauges.overNear", { over: n.over, near: n.near, scope: scope(n.scope) });
      if (n.over > 0)
        return t("gauges.over", { count: n.over, total: n.total, scope: scope(n.scope) });
      if (n.near > 0) return t("gauges.near", { count: n.near, scope: scope(n.scope) });
      /* Nothing at a bank, and a river still climbing: said as the hours it has been measured. */
      return t("gauges.rising", { count: n.rising, scope: scope(n.scope) });
    }
    return t("gauges.quiet", { reporting: n.reporting, total: n.total, scope: scope(n.scope) });
  };

  const dam = (n: DamNote): ReactNode => {
    const name = damName ?? t("dam.theDam");
    /*
     * Two different silences (the owner, 18 Oct 2026). A station that has published nothing for
     * this moment is the station being quiet, and saying "Jaga cannot read it" would blame the
     * app for something it is reporting faithfully. Only a feed that did not answer gets that.
     */
    if (n.say === "unknown")
      return t(n.noFigures === "reading" ? "dam.noReading" : "dam.unknown", { dam: name });
    if (n.say === "active") {
      if ((n.spilledCms ?? 0) > 0) return t("dam.spilling", { dam: name, value: n.spilledCms! });
      if (n.attention === "releasing")
        return t("dam.releasing", { dam: name, value: n.outflowCms ?? 0 });
      if (n.attention === "awaiting") return t("dam.awaiting", { dam: name });
      return t("dam.watch", { dam: name, percent: n.percentFull ?? 0, value: n.outflowCms ?? 0 });
    }
    return t("dam.quiet", { dam: name, percent: n.percentFull ?? 0, value: n.outflowCms ?? 0 });
  };

  const reports = (n: ReportNote): ReactNode => {
    if (n.say === "unknown") return t("reports.unknown");
    if (n.say === "active") {
      return n.here > 0
        ? t("reports.here", { reports: n.here })
        : t("reports.near", { reports: n.reports, tambons: n.tambons, scope: scope(n.scope) });
    }
    return t("reports.quiet", { scope: scope(n.scope) });
  };

  const rain = (n: RainNote): ReactNode => {
    const where = rainPlace ?? t("scope.myPlace");
    if (n.say === "unknown") return t("rain.unknown");
    if (n.say !== "active") return t("rain.dry", { place: where });
    /*
     * Two halves, and the forecast half is named as a forecast every time it is said (safety
     * rule 8): what the sky is doing now, and what the model puts in the hours just ahead. Where
     * it is dry now and wet soon, only the second half is said - a sentence beginning "no rain"
     * would be the very thing that costs this screen its credibility.
     */
    const now = n.wet
      ? t("rain.now", { what: tWeather(`codes.${n.group ?? "overcast"}`), place: where })
      : null;
    const soon = n.soon?.wet
      ? t("rain.soon", {
          what: tWeather(`codes.${n.soon.group}`),
          hours: n.soon.hours,
          mm: n.soon.mm,
          place: where,
        })
      : null;
    return [now, soon].filter(Boolean).join(" ") || t("rain.dry", { place: where });
  };

  /**
   * Which rivers, by name, when the card has just said how many are rising. The count stays the
   * authority: where the feed named fewer than it counted, the rest are said as a number rather
   * than left out, so a river cannot vanish from the screen for want of a name (safety rule 10).
   */
  const RISING_NAMES = 5;
  /**
   * Only under the rising sentence, and never under a bank one. With a river at or near its bank
   * the line above is about that river, and a list of the ones merely climbing would read as its
   * own - and the button beside it would light the banks, which is what a press lights first
   * (`gaugesLit`). The names must always be the names of what was just said.
   */
  const saysRising = (n: GaugeNote): boolean =>
    n.say === "active" && n.over === 0 && n.near === 0 && n.rising > 0;
  const risers = (n: GaugeNote): ReactNode => {
    if (!saysRising(n) || n.risingNamed.length === 0) return null;
    const shown = n.risingNamed.slice(0, RISING_NAMES);
    const names = shown.map((g) => localName(g.name, locale)).join(", ");
    const rest = n.rising - shown.length;
    return (
      <p data-monitoring-risers={n.rising} className="text-jaga-ink">
        {rest > 0
          ? t("gauges.risingNames", { names: t("gauges.risingMore", { names, count: rest }) })
          : t("gauges.risingNames", { names })}
      </p>
    );
  };

  const sentence = (n: Note): ReactNode =>
    n.kind === "gauges"
      ? gauges(n)
      : n.kind === "dam"
        ? dam(n)
        : n.kind === "reports"
          ? reports(n)
          : rain(n);

  /** The second line: who is speaking, plus what is late and what is still quiet about it. */
  const aside = (n: Note): string[] => {
    const parts = [t(`${n.kind}.who`)];
    if (n.kind === "dam" && n.stale) parts.push(t("dam.stale"));
    if (n.kind === "rain" && n.stale) parts.push(t("rain.stale"));
    if (n.kind === "gauges" && n.say !== "unknown" && n.silent > 0)
      parts.push(t("gauges.silent", { count: n.silent }));
    /*
     * How many rivers have been climbing for a week, where that could be measured at all. An
     * aside and not a sentence of its own: it is the season's background, and the stations it
     * could not be judged for are counted with it rather than passed off as steady (rule 10).
     */
    if (n.kind === "gauges" && n.say !== "unknown" && n.risingWeek > 0)
      parts.push(t("gauges.risingWeek", { count: n.risingWeek, judged: n.weekJudged }));
    if (n.kind === "reports" && n.say === "active" && n.confirmed > 0)
      parts.push(t("reports.confirmed", { count: n.confirmed }));
    if (n.kind === "dam" && n.onMyRiver && damTambon)
      parts.push(t("dam.onMyRiver", { tambon: damTambon }));
    return parts;
  };

  const Heading = place === "home" ? "h2" : "h3";

  return (
    <section
      data-monitoring={place}
      className="flex flex-col gap-3 rounded-2xl border-2 border-jaga-line bg-jaga-surface p-5"
    >
      <Heading className="text-h3 font-bold text-jaga-ink">{t("title")}</Heading>
      <p data-monitoring-caption="true">{t("caption")}</p>
      {summary.allUnknown ? (
        <p data-monitoring-say="allUnknown" className="font-medium">
          {t("allUnknown")}
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-3">
            {summary.notes.map((note) => {
              const Icon = ICON[note.kind];
              const old = age(note);
              return (
                <li
                  key={note.kind}
                  data-monitoring-note={note.kind}
                  data-monitoring-say={note.say}
                  className="flex items-start gap-2"
                >
                  <Icon size={24} aria-hidden="true" className="mt-1 shrink-0" />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <p>{sentence(note)}</p>
                    {note.kind === "gauges" && (
                      <>
                        {risers(note)}
                        {saysRising(note) && props.risingLink}
                      </>
                    )}
                    <p className={hint}>
                      {aside(note).join(" · ")}
                      {note.at !== null && ` · ${time(note.at)}`}
                    </p>
                    {old && (
                      <p data-monitoring-age="true" className={`${hint} flex items-center gap-1.5`}>
                        <ClockIcon size={18} aria-hidden="true" />
                        {old}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {summary.newestAt && (
            <p data-monitoring-asof="true" className={hint}>
              {t("asOf", { time: time(summary.newestAt) })}
            </p>
          )}
          {summary.anyUnknown && (
            <p data-monitoring-incomplete="true" className={hint}>
              {t("someUnknown")}
            </p>
          )}
        </>
      )}
      {summary.notes.some((n) => n.kind === "rain") && <OpenMeteoAttribution />}
    </section>
  );
}
