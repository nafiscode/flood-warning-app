import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { LevelCounts } from "@/components/alerts/LevelCounts";
import { AlertHero, type HeroStatus } from "@/components/home/AlertHero";
import { DamHistory } from "@/components/map/DamHistory";
import { GaugeSpread, RainAhead } from "@/components/monitoring/MonitoringCharts";
import { MonitoringNow, type ScopeWords } from "@/components/monitoring/MonitoringNow";
import type { Dam } from "@/lib/dam";
import type { LevelTally } from "@/lib/map-console";
import type { GaugeReading } from "@/lib/map-data";
import type { Monitoring } from "@/lib/monitoring";
import type { Weather } from "@/lib/weather";
import { buttonQuiet, hint } from "@/lib/ui";

/**
 * What opens when the monitoring card is tapped (the owner, 17 Oct 2026: on a laptop a section
 * under the dashboard; on a phone and a tablet the same thing under the map legend; and the same
 * on the home screen).
 *
 * The order is the order a person asks in: **what is in force where I am**, then what is in
 * force around me, then what the instruments read, then the charts behind them. The level at the
 * top is drawn by the home screen's own `AlertHero`, so everything safety rule 3 requires comes
 * with it and there is no second piece of level markup in the app. Everything below that line
 * wears no alert colour at all, because none of it is a level anyone issued (safety rule 2).
 *
 * It fetches nothing: every figure is handed to it by the screen that already holds it.
 */
export type MonitoringDetailProps = {
  summary: Monitoring;
  scopeWords: ScopeWords;
  damName: string | null;
  damTambon: string | null;
  rainPlace: string | null;
  time: (iso: string) => string;
  place: "home" | "map";
  /** The page's clock, so a late alert keeps its grey marker here too (safety rule 3). */
  now: number;

  /**
   * The person's own subdistrict and its published level. Left out on the home screen, where the
   * hero three inches above already says it and a second copy would only invite a reader to
   * wonder which one is current.
   */
  area?: { hero: HeroStatus; code: string; name: string | null } | null;
  /** The province's published levels, and how far the figures reach, for the map. */
  province?: {
    levels: readonly LevelTally[];
    statusKnown: boolean;
    inService: boolean;
    scope: string;
  } | null;

  /** The stations behind the spread chart, and the words for how far they reach. */
  gauges?: readonly GaugeReading[] | null;
  gaugeScope: string;
  /** The kept weather reading, for the rain chart. */
  weather?: Weather | null;
  /** The dam whose fortnight is drawn, when the screen has one. */
  dam?: Dam | null;
  /** A way back to the map's own card for this dam, where there is one. */
  damLink?: ReactNode;

  /**
   * Shuts the detail again from its own foot, and takes the reader back up to the dashboard (the
   * owner, 17 Oct 2026). The way in is a long way above once the charts have drawn, so the way
   * out has to be where the reading ends. Left out and no button is drawn.
   */
  onHide?: () => void;
};

export function MonitoringDetail(props: MonitoringDetailProps) {
  const t = useTranslations("monitoring.detail");
  const tCard = useTranslations("monitoring");
  const { area, province, gauges, weather } = props;
  /*
   * The reservoir's fortnight is drawn only where the reservoir is one of this reader's concerns,
   * which is the same question the composer already answered: no note, no chart (the owner,
   * 18 Oct 2026).
   */
  const dam = props.summary.notes.some((n) => n.kind === "dam") ? (props.dam ?? null) : null;
  const charts =
    (gauges && gauges.length > 0) || weather || dam ? (
      <section className="flex flex-col gap-5" data-monitoring-charts="true">
        <h3 className="text-h3 font-bold text-jaga-ink">{t("charts")}</h3>
        <p className={hint}>{t("chartsNote")}</p>
        {gauges && gauges.length > 0 && <GaugeSpread gauges={gauges} scope={props.gaugeScope} />}
        {weather && props.rainPlace && <RainAhead weather={weather} place={props.rainPlace} />}
        {dam && (
          <div className="flex flex-col gap-2" data-monitoring-dam="true">
            <DamHistory dam={dam} />
            {props.damLink}
          </div>
        )}
      </section>
    ) : null;

  return (
    <div className="flex flex-col gap-6" data-monitoring-detail={props.place}>
      {area ? (
        <section className="flex flex-col gap-2" data-monitoring-part="area">
          <AlertHero
            status={area.hero}
            area={<p className="font-bold">{area.name ?? area.code}</p>}
            areaName={area.name ?? undefined}
            now={props.now}
          />
        </section>
      ) : (
        // Only where a level was expected: the home screen's hero is a few inches above.
        province && (
          <p data-monitoring-noarea="true" className="rounded-xl bg-jaga-ground px-4 py-3">
            {t("noArea")}
          </p>
        )
      )}

      {province && (
        <section className="flex flex-col gap-2" data-monitoring-part="province">
          <h3 className="font-bold">{t("province", { scope: province.scope })}</h3>
          {!province.statusKnown ? (
            <p data-monitoring-province="unknown">{t("statusUnknown")}</p>
          ) : !province.inService ? (
            <p data-monitoring-province="notInService">{t("notInService")}</p>
          ) : province.levels.some((x) => x.tambons > 0) ? (
            <LevelCounts tally={province.levels} />
          ) : (
            <p data-monitoring-province="none">{t("noneInForce", { scope: province.scope })}</p>
          )}
        </section>
      )}

      <MonitoringNow
        summary={props.summary}
        scopeWords={props.scopeWords}
        damName={props.damName}
        damTambon={props.damTambon}
        rainPlace={props.rainPlace}
        time={props.time}
        place={props.place}
      />

      {charts}

      {props.onHide && (
        <button
          type="button"
          data-monitoring-hide={props.place}
          onClick={props.onHide}
          className={`${buttonQuiet} min-h-tap self-start`}
        >
          {tCard("hideDetail")}
        </button>
      )}
    </div>
  );
}
