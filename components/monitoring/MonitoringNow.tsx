import { useTranslations } from "next-intl";
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
};

const ICON: Record<Note["kind"], typeof WaveIcon> = {
  gauges: WaveIcon,
  dam: DropIcon,
  reports: MessageIcon,
  rain: RainIcon,
};

export function MonitoringNow(props: MonitoringNowProps) {
  const { summary, scopeWords, damName, damTambon, rainPlace, time, place } = props;
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
      return n.over > 0 && n.near > 0
        ? t("gauges.overNear", { over: n.over, near: n.near, scope: scope(n.scope) })
        : n.over > 0
          ? t("gauges.over", { count: n.over, total: n.total, scope: scope(n.scope) })
          : t("gauges.near", { count: n.near, scope: scope(n.scope) });
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
    return n.say === "active"
      ? t("rain.now", { what: tWeather(`codes.${n.group ?? "overcast"}`), place: where })
      : t("rain.dry", { place: where });
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
