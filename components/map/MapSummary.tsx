import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { LevelCounts } from "@/components/alerts/LevelCounts";
import { AlertHero, type HeroStatus } from "@/components/home/AlertHero";
import type { LevelTally } from "@/lib/map-console";
import { card, hint } from "@/lib/ui";

/**
 * "Where things stand", above the map at every screen size (the owner, 17 Oct 2026).
 *
 * Until now a phone opening the Flood Risk Map saw no overall status at all until it tapped a
 * subdistrict, and the four readouts that answer the question on a laptop are drawn only there.
 * This card answers it everywhere, in the order the owner asked for: **the person's own
 * subdistrict first**, then the province around it.
 *
 * The person's own level is drawn by `AlertHero` itself - the same component the home screen and
 * the tapped-subdistrict panel use - so everything safety rule 3 asks for (level, area, issuer,
 * issue time, reason, next update, and the grey marker when it is late) comes with it and there
 * is no second piece of level markup anywhere in the app to keep in step.
 *
 * Nothing here says what an absence means by itself. "No alert is in force" is written out in
 * full, with the reason it is not an all-clear; a status that could not be loaded says so and
 * draws no counts at all, because a figure of nought and a figure nobody could read are
 * different things (safety rule 10).
 */
export type MapSummaryProps = {
  /** Exactly `heroStatusFor(status, myTambon, fresh)`. Null when no area is saved. */
  hero: HeroStatus | null;
  myTambonCode: string | null;
  myTambonName: string | null;
  /** The published levels of the province on show: `levelTally` over the narrowed alerts. */
  levels: readonly LevelTally[];
  /** False when the status failed and nothing kept counts as current. */
  statusKnown: boolean;
  inService: boolean;
  /** Null means "could not be read", which is never drawn as nought. */
  gaugesOver: number | null;
  reportsTotal: number | null;
  /** The province in words, or null for all four. */
  provinceWord: string | null;
  allWord: string;
  /** The monitoring section, passed in so this card fetches nothing. */
  monitoring?: ReactNode;
  /** The page's clock, so a late alert gets its grey marker here too (safety rule 3). */
  now: number;
  /** Opens the person's own subdistrict in the map's own panel. */
  onOpenMyArea?: () => void;
};

export function MapSummary(props: MapSummaryProps) {
  const t = useTranslations("map.summary");
  const scope = props.provinceWord ?? props.allWord;
  const anyInForce = props.levels.some((x) => x.tambons > 0);

  const figure = (key: "gaugesOver" | "reports", count: number | null) =>
    count === null ? (
      <li data-summary-figure={key} data-summary-unknown="true" className={hint}>
        {t(`${key}`, { count: t("unknownFigure"), scope })}
      </li>
    ) : (
      <li data-summary-figure={key}>{t(`${key}`, { count, scope })}</li>
    );

  return (
    <section className={card} data-map-summary="true">
      <h2 className="text-h3 font-bold text-jaga-ink">{t("title")}</h2>

      {/* The person's own subdistrict, with everything a level must carry (safety rule 3). */}
      <div data-map-summary-part="area" className="flex flex-col gap-2">
        {props.hero && props.myTambonCode ? (
          <>
            <AlertHero
              status={props.hero}
              area={<p className="font-bold">{props.myTambonName ?? props.myTambonCode}</p>}
              areaName={props.myTambonName ?? undefined}
              now={props.now}
            />
            {props.onOpenMyArea && (
              <button
                type="button"
                data-open-my-area="true"
                onClick={props.onOpenMyArea}
                className="min-h-tap self-start underline"
              >
                {t("openArea", { tambon: props.myTambonName ?? props.myTambonCode })}
              </button>
            )}
          </>
        ) : (
          // No level, no colour: nobody has said where they are, so there is nothing to grade.
          <p data-map-summary-noarea="true" className="rounded-xl bg-jaga-ground px-4 py-3">
            {t("noArea")}
          </p>
        )}
      </div>

      {/* The province around them. */}
      <div data-map-summary-part="province" className="flex flex-col gap-2">
        <h3 className="font-bold">{t("province", { scope })}</h3>
        {!props.statusKnown ? (
          <p data-map-summary-status="unknown">{t("statusUnknown")}</p>
        ) : !props.inService ? (
          <p data-map-summary-status="notInService">{t("notInService")}</p>
        ) : anyInForce ? (
          <LevelCounts tally={props.levels} />
        ) : (
          <p data-map-summary-status="none">{t("noneInForce", { scope })}</p>
        )}
        <ul className="flex flex-col gap-1">
          {figure("gaugesOver", props.gaugesOver)}
          {figure("reports", props.reportsTotal)}
        </ul>
      </div>

      {props.monitoring}
    </section>
  );
}
