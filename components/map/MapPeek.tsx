"use client";

import { useLocale, useTranslations } from "next-intl";
import { ForwardIcon } from "@/components/icons";
import { DamStateChip } from "@/components/map/Dam";
import { CheckThisPlace, ResidentsSaidLine } from "@/components/places/PlaceCheck";
import { LastChecked, NavigateChooser } from "@/components/places/SafePlaceCard";
import { type Dam } from "@/lib/dam";
import { gaugeLook, trendOf } from "@/lib/gauge-marks";
import type { Gauge } from "@/lib/map-data";
import { localName, type SafePlace } from "@/lib/places";
import { hint } from "@/lib/ui";
import { GaugeGlyph } from "./GaugeGlyph";

/*
 * The small pop-ups on the map itself (the owner, 14 Oct): a reservoir, a river gauge or a safe
 * place says how it stands where it is drawn - on hover with a mouse, on tap on a phone - with a
 * button down to the full card under the map. They are compact on purpose: the card keeps every
 * figure and the disclaimer in full, and a box taller than the map would lose its own bottom - so
 * the lines here are the short ones, and MapView caps the box at the map's height besides.
 */

type More = { onMore: () => void };

export function MoreButton({ onMore }: More) {
  const t = useTranslations("map.peek");
  return (
    <button
      type="button"
      onClick={onMore}
      data-peek-more="true"
      className="inline-flex min-h-tap items-center gap-1 self-start text-small font-medium text-jaga-ink underline"
    >
      {t("more")}
      <ForwardIcon size={18} />
    </button>
  );
}

export function GaugePeek({
  gauge,
  dark,
  time,
  onMore,
}: { gauge: Gauge; dark: boolean; time: (iso: string) => string } & More) {
  const t = useTranslations("map.gauge");
  const locale = useLocale();
  const look = gaugeLook(gauge.status);
  const live = gauge.status !== "no_recent_data";
  return (
    <div className="flex flex-col gap-1 text-jaga-text" data-peek="gauge" data-peek-id={gauge.id}>
      <div className="flex items-center gap-2">
        <GaugeGlyph look={look} dark={dark} size={28} />
        <b>{localName(gauge.name, locale)}</b>
      </div>
      <p className="font-medium" data-gauge-state={gauge.status}>
        {t(gauge.status)}
      </p>
      {live && gauge.value !== null && (
        <p className="text-small">
          {t("level", { value: gauge.value.toFixed(2) })}
          {gauge.bank != null &&
            ` · ${
              gauge.value >= gauge.bank
                ? t("overBank", { value: (gauge.value - gauge.bank).toFixed(2) })
                : t("belowBank", { value: (gauge.bank - gauge.value).toFixed(2) })
            }`}
        </p>
      )}
      {live && gauge.rise3h != null && (
        <p className="text-small" data-gauge-trend={trendOf(gauge.rise3h, look)}>
          {t(`rise.${trendOf(gauge.rise3h, look)}`, { value: Math.abs(gauge.rise3h).toFixed(2) })}
        </p>
      )}
      {gauge.observedAt && <p className={hint}>{t("at", { time: time(gauge.observedAt) })}</p>}
      <p className={hint}>{t("notAlertShort")}</p>
      <MoreButton onMore={onMore} />
    </div>
  );
}

export function DamPeek({ dam, time, onMore }: { dam: Dam; time: (iso: string) => string } & More) {
  const t = useTranslations("dam");
  const locale = useLocale();
  const s = dam.signal;
  return (
    <div className="flex flex-col gap-1 text-jaga-text" data-peek="dam" data-peek-id={dam.code}>
      <b>{localName(dam.name, locale)}</b>
      <DamStateChip signal={s} />
      {!s ? (
        <p className="text-small">{t("figures.none")}</p>
      ) : (
        <>
          {s.storageMcm !== null && s.percentFull !== null && (
            <p className="text-small">
              {t("figures.storage", {
                // A small reservoir holds a few million m³: whole numbers would say 0.
                mcm:
                  s.storageMcm < 10 ? Math.round(s.storageMcm * 10) / 10 : Math.round(s.storageMcm),
                percent: Math.round(s.percentFull),
              })}
            </p>
          )}
          {s.outflowCms !== null && (
            <p className="text-small">
              {t("figures.outflow", { cms: Math.round(s.outflowCms) })}
              {s.spilledCms !== null && s.spilledCms > 0 && (
                <> {t("figures.spilled", { cms: Math.round(s.spilledCms) })}</>
              )}
            </p>
          )}
          <p className={hint}>{t("figures.observed", { time: time(s.observedAt) })}</p>
        </>
      )}
      {/* The chip wears the alert colours (decided 12 Oct), so it says what it is not. */}
      <p className={hint}>{t("disclaimer.notAnAlertShort")}</p>
      <MoreButton onMore={onMore} />
    </div>
  );
}

export function PlacePeek({
  place,
  userAgent,
  onMore,
}: { place: SafePlace; userAgent?: string } & More) {
  const t = useTranslations("places");
  const locale = useLocale();
  return (
    <div className="flex flex-col gap-1 text-jaga-text" data-peek="place" data-peek-id={place.id}>
      <b>{localName(place.name, locale)}</b>
      <p className={hint}>
        {t(`type.${place.type}`)} · {t(place.verified ? "verified" : "unverified")}
      </p>
      <p className="font-medium">{t(`status.${place.status}`)}</p>
      {/* How old that status is. The pop-up is how most people look at a shelter, so it may not
          be the one place that shows a reading with no time on it. */}
      <LastChecked place={place} />
      <ResidentsSaidLine said={place.residentsSaid} />
      <NavigateChooser id={place.id} lat={place.lat} lon={place.lon} userAgent={userAgent} />
      {/* The owner, 20 Oct: the pin is where people already look, so it is where somebody
          standing at the place can say what it is really like. Brief: the pop-up has no room
          for the water and the road, and the three answers are the part that matters. */}
      <CheckThisPlace placeId={place.id} status={place.status} brief />
      <MoreButton onMore={onMore} />
    </div>
  );
}
