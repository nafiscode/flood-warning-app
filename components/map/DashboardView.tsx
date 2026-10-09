"use client";

import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { AlertBadge } from "@/components/alerts/AlertBadge";
import { AlertStatus } from "@/components/alerts/AlertStatus";
import { AlertHero } from "@/components/home/AlertHero";
import { heroStatusFor, NORMAL_NEEDS_CHECK_WITHIN_MS } from "@/components/home/HomeView";
import { PlaceStatus } from "@/components/home/WatchedPlaces";
import { SafePlaceCard } from "@/components/places/SafePlaceCard";
import { PhoneIcon } from "@/components/icons";
import { ProvinceSelect } from "@/components/ProvinceSelect";
import { areaName, pickName, type Area, type AreaDirectory } from "@/lib/area";
import { ALERT_LEVELS } from "@/lib/brand/tokens";
import { layersFor, type Hazard, type MapLayer, type MapMode } from "@/lib/hazards";
import { PROVINCE_BOUNDS } from "@/lib/map";
import type { MapData } from "@/lib/map-data";
import type { MyPlaces } from "@/lib/me";
import { HOME_COLOR, mineColor } from "@/lib/mine-colors";
import { localName } from "@/lib/places";
import { hasActiveAlerts, type PublicStatus } from "@/lib/public-status";
import { BANGKOK_DATE_TIME } from "@/lib/time";
import { buttonSecondary, card, hint, notice } from "@/lib/ui";
import type { LoadState } from "@/lib/use-public";
import { HazardPlaceholder } from "./HazardPlaceholder";
import { Link } from "@/i18n/navigation";
import { checkBox, checkRow } from "@/lib/ui";
import { MapView, type MapSelection, type MinePlace } from "./MapView";

export type DashboardViewProps = {
  status: PublicStatus | null;
  checkedAt: number | null;
  /** The latest try to load the alert status failed. */
  failed: boolean;
  /** Null while loading; the switcher then offers floods only. */
  hazards: Hazard[] | null;
  hazardsState: LoadState;
  directory: AreaDirectory | null;
  directoryState: LoadState;
  data: MapData | null;
  dataState: LoadState;
  now: number;
  /** The Transparency tab exists only once donations are switched on (A11, safety rule 9). */
  transparency: boolean;
  /** The signed-in person's home and watched places, or null for a visitor. */
  me?: MyPlaces | null;
  /** The area the person chose on the home screen: where the map opens (the owner's note). */
  area?: Area | null;
  /** The province the map opens on; all four when left out. */
  initialProvince?: string;
  userAgent?: string;
};

const chip =
  "inline-flex min-h-tap items-center gap-2 rounded-full border-2 px-4 py-1 font-medium active:translate-y-px";
const chipOn = "border-jaga-edge bg-jaga-slate text-white";
const chipOff = "border-jaga-edge bg-jaga-surface text-jaga-ink";
/*
 * A hazard that is not the chosen one takes less room on a phone or tablet (the owner's note, 9
 * Oct): every hazard but floods is still "coming soon", and the switcher was eating the top of
 * a 360 px screen. The pill is smaller to look at, but the invisible box after it keeps the
 * target at the full 48 px (CLAUDE.md), so it is no harder to hit. On a laptop, where there is
 * room, every chip keeps its usual size.
 */
const chipQuiet =
  "relative inline-flex min-h-9 items-center gap-1.5 rounded-full border-2 px-3 py-0.5 text-small font-medium after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-[''] active:translate-y-px lg:min-h-tap lg:gap-2 lg:px-4 lg:py-1 lg:text-body lg:after:hidden";

/**
 * The map dashboard (spec 4.2), drawn from what it is given. Map tab: hazard switcher, province
 * selector, risk or live view, the map, what a tap selected, the legend, and the alerts in force
 * as a plain list that also works when the map can't load.
 */
export function DashboardView(props: DashboardViewProps) {
  const { status, checkedAt, failed, directory, data, now } = props;
  const t = useTranslations("map");
  const tHome = useTranslations("home");
  const locale = useLocale();
  const format = useFormatter();
  const time = (iso: string) => format.dateTime(new Date(iso), BANGKOK_DATE_TIME);

  const [tab, setTab] = useState<"map" | "transparency">("map");
  const [hazardCode, setHazardCode] = useState("flood");
  const [chosenMode, setChosenMode] = useState<MapMode | null>(null);
  /*
   * The map opens where the person already said they are: the area chosen on the home screen
   * (their home if they have one saved) decides the province in the selector, where the map
   * looks, and which tambon's alert is shown first (the owner's note, 9 Oct). Everything stays
   * theirs to change: once they pick a province or tap the map, their choice holds.
   */
  const areaProvince = props.area ? props.area.code.slice(0, 2) : "";
  const [chosenProvince, setChosenProvince] = useState<string | null>(
    props.initialProvince ?? null,
  );
  const province = chosenProvince ?? areaProvince;
  const setProvince = (code: string) => {
    setChosenProvince(code);
    setTouched(true);
  };
  const [picked, setPicked] = useState<MapSelection | null>(null);
  const [touched, setTouched] = useState(false);
  const areaSelection: MapSelection | null = props.area
    ? {
        kind: "tambon",
        code: props.area.code,
        nameTh: props.area.nameTh,
        nameEn: props.area.nameEn,
      }
    : null;
  const selection = touched ? picked : areaSelection;
  const setSelection = (next: MapSelection | null) => {
    setTouched(true);
    setPicked(next);
  };
  const [showMine, setShowMine] = useState(true);

  /*
   * The person's own places on the map (spec 4.9, the owner's request on 8 Oct): their home and
   * the places they watch. This comes from their own session and is drawn only in their browser;
   * it is in no public answer. A place pinned outside the covered tambons has no area and is
   * left out, because the map covers only the four provinces.
   */
  const mine: MinePlace[] = !props.me?.signedIn
    ? []
    : [
        ...(props.me.home
          ? [
              {
                id: "home",
                label: t("mine.home"),
                lat: props.me.home.lat,
                lon: props.me.home.lon,
                home: true,
                color: HOME_COLOR,
                lines: [areaName(locale, props.me.home)],
                call: null,
              },
            ]
          : []),
        ...props.me.places
          .filter((place) => place.area)
          .map((place, index) => ({
            id: place.id,
            label: place.label,
            lat: place.area!.lat,
            lon: place.area!.lon,
            home: false,
            // In the order they were added, so a pin keeps its colour while the list does.
            color: mineColor(index),
            // What the pin says on hover or on tap: the person there, then the address.
            lines: [
              ...(place.contactName ? [t("mine.person", { name: place.contactName })] : []),
              areaName(locale, place.area!),
            ],
            /*
             * The number of the person there, when one is stored: the label and the card both
             * carry a button that dials it, as the home screen does. It is in memory only - the
             * phone's storage never keeps it (lib/me.ts) - so after an offline start the button
             * appears once the places have been read again.
             */
            call: place.contactPhone
              ? {
                  tel: place.contactPhone,
                  label: tHome("watched.call", { name: place.contactName ?? place.label }),
                }
              : null,
          })),
      ];

  // Until the list arrives (or if it can't), floods are the one hazard the map knows.
  const hazards: Hazard[] = props.hazards ?? [
    {
      code: "flood",
      status: "active",
      name: { [locale]: t("hazard.flood") },
      description: {},
      placeholder: {},
      hotline: "1784",
    },
  ];
  const hazard = hazards.find((h) => h.code === hazardCode) ?? hazards[0]!;
  // Pre-season the risk view opens first; with any alert in force, the live view (spec 4.2).
  const mode: MapMode = chosenMode ?? (hasActiveAlerts(status) ? "live" : "risk");
  const layers = layersFor(hazard, mode);
  const fresh = checkedAt !== null && now - checkedAt < NORMAL_NEEDS_CHECK_WITHIN_MS;

  const tambonName = (code: string) => {
    const entry = directory?.tambons.find((x) => x.code === code);
    return entry ? pickName(locale, entry.nameTh, entry.nameEn) : code;
  };
  const alerts = (status?.alerts ?? [])
    .filter((a) => a.hazard === "flood")
    .map((a) => ({ alert: a, tambons: a.tambons.filter((c) => c.startsWith(province)) }))
    .filter((a) => a.tambons.length > 0);

  const pending: MapLayer[] = [
    ...(layers.includes("hazard") ? (["hazard"] as const) : []),
    ...(layers.includes("alerts") && status && !status.inService ? (["alerts"] as const) : []),
    ...(layers.includes("places") && data && data.places.length === 0 ? (["places"] as const) : []),
    ...(layers.includes("reports") && data && data.reports.length === 0
      ? (["reports"] as const)
      : []),
    ...(layers.includes("gauges") && data && data.gauges.length === 0 ? (["gauges"] as const) : []),
  ];
  const drawn = layers.filter((l) => l !== "alerts" && !pending.includes(l));

  /*
   * Where the map looks: close around the person's own area while that is what is chosen, the
   * whole province once they pick one from the list, and all four when they clear it. The box is
   * about 22 by 17 km, which holds a tambon and its neighbours.
   */
  const mapBounds: [number, number, number, number] | undefined =
    chosenProvince === null && props.area
      ? [props.area.lon - 0.1, props.area.lat - 0.08, props.area.lon + 0.1, props.area.lat + 0.08]
      : PROVINCE_BOUNDS[province];

  let selected: React.ReactNode = null;
  if (selection?.kind === "tambon" && layers.includes("alerts")) {
    selected = (
      <AlertHero
        status={heroStatusFor(status, selection.code, fresh)}
        area={<p className="font-bold">{pickName(locale, selection.nameTh, selection.nameEn)}</p>}
        now={now}
      />
    );
  } else if (selection?.kind === "place") {
    const place = data?.places.find((p) => p.id === selection.id);
    selected = place ? <SafePlaceCard place={place} userAgent={props.userAgent} /> : null;
  } else if (selection?.kind === "reports") {
    const bin = data?.reports[selection.index];
    selected = bin ? (
      <section className={card} data-selected="reports">
        <p className="font-bold">{t("reports.count", { count: bin.count })}</p>
        {bin.deepest && <p>{t("reports.deepest", { depth: t(`depth.${bin.deepest}`) })}</p>}
        <p>{t("reports.latest", { time: time(bin.latest) })}</p>
        <p className={hint}>{t("reports.note")}</p>
      </section>
    ) : null;
  } else if (selection?.kind === "mine") {
    const place = mine.find((p) => p.id === selection.id);
    const area =
      selection.id === "home"
        ? props.me?.signedIn
          ? props.me.home
          : null
        : ((props.me?.signedIn ? props.me.places.find((p) => p.id === selection.id)?.area : null) ??
          null);
    selected = place ? (
      <section className={card} data-selected="mine">
        <p className="font-bold">{place.label}</p>
        {area && <p className={hint}>{pickName(locale, area.nameTh, area.nameEn)}</p>}
        <PlaceStatus
          status={area ? heroStatusFor(status, area.code, fresh) : { kind: "outside" }}
          now={now}
        />
        {place.call && (
          <a href={`tel:${place.call.tel}`} className={`${buttonSecondary} gap-2`}>
            <PhoneIcon size={22} />
            {place.call.label} · {place.call.tel}
          </a>
        )}
        <p className={hint}>{t("mine.note")}</p>
        <Link href="/account/places" prefetch={false} className="min-h-tap underline">
          {t("mine.manage")}
        </Link>
      </section>
    ) : null;
  } else if (selection?.kind === "gauge") {
    const gauge = data?.gauges.find((g) => g.id === selection.id);
    selected = gauge ? (
      <section className={card} data-selected="gauge">
        <p className="font-bold">{localName(gauge.name, locale)}</p>
        <p>{t(`gauge.${gauge.status}`)}</p>
        {gauge.value !== null && <p>{t("gauge.level", { value: gauge.value.toFixed(2) })}</p>}
        {gauge.observedAt && (
          <p className={hint}>{t("gauge.at", { time: time(gauge.observedAt) })}</p>
        )}
      </section>
    ) : null;
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-h3 font-bold text-jaga-ink">{t("title")}</h1>

      {props.transparency && (
        <div role="tablist" aria-label={t("tabs.label")} className="flex gap-2">
          {(["map", "transparency"] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`${chip} ${tab === id ? chipOn : chipOff}`}
            >
              {t(`tabs.${id}`)}
            </button>
          ))}
        </div>
      )}

      {tab === "transparency" ? (
        // Filled by A11 (donations and running costs). Never the default tab.
        <div role="tabpanel" data-transparency-slot="true" />
      ) : (
        <>
          <div className="flex flex-col gap-1">
            <p className="font-medium" id="hazard-label">
              {t("hazard.label")}
            </p>
            <ul aria-labelledby="hazard-label" className="flex flex-wrap gap-2">
              {hazards.map((h) => (
                <li key={h.code}>
                  <button
                    type="button"
                    aria-pressed={h.code === hazard.code}
                    data-hazard={h.code}
                    data-hazard-status={h.status}
                    onClick={() => {
                      setHazardCode(h.code);
                      setSelection(null);
                    }}
                    className={`${h.code === hazard.code ? `${chip} ${chipOn}` : `${chipQuiet} ${chipOff}`}`}
                  >
                    {localName(h.name, locale)}
                    {h.status !== "active" && (
                      <span className="text-small font-normal">({t("hazard.comingSoon")})</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
            {props.hazardsState === "unavailable" && <p className={hint}>{t("hazard.failed")}</p>}
          </div>

          {hazard.status !== "active" ? (
            <HazardPlaceholder hazard={hazard} />
          ) : (
            <>
              {directory ? (
                <ProvinceSelect
                  id="map-province"
                  provinces={directory.provinces}
                  value={province}
                  onChange={setProvince}
                  emptyLabel={t("province.all")}
                />
              ) : (
                props.directoryState === "unavailable" && (
                  <p className={hint}>{t("province.failed")}</p>
                )
              )}

              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium" id="mode-label">
                  {t("mode.label")}
                </p>
                <div role="group" aria-labelledby="mode-label" className="flex gap-2">
                  {(["risk", "live"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      aria-pressed={mode === m}
                      data-mode={m}
                      onClick={() => {
                        setChosenMode(m);
                        setSelection(null);
                      }}
                      className={`${chip} ${mode === m ? chipOn : chipOff}`}
                    >
                      {t(`mode.${m}`)}
                    </button>
                  ))}
                </div>
              </div>

              <MapView
                layers={layers}
                status={fresh ? status : null}
                data={data}
                now={now}
                bounds={mapBounds}
                onSelect={setSelection}
                text={{ loading: t("loading"), failed: t("failed") }}
                mine={mine}
                showMine={showMine}
              />
              {mine.length > 0 && (
                <label className={checkRow} data-mine-toggle="true">
                  <input
                    type="checkbox"
                    className={checkBox}
                    checked={showMine}
                    onChange={(event) => setShowMine(event.target.checked)}
                  />
                  <span>{t("mine.toggle", { count: mine.length })}</span>
                </label>
              )}
              <p className={hint}>{t("tapHint")}</p>
              {props.dataState === "unavailable" && (
                <p role="status" className={notice}>
                  {t("dataFailed")}
                </p>
              )}

              {selected && (
                <div className="flex flex-col gap-2" data-selected-panel="true">
                  {selected}
                  <button
                    type="button"
                    onClick={() => setSelection(null)}
                    className="min-h-tap self-start underline"
                  >
                    {t("close")}
                  </button>
                </div>
              )}

              <section className={card} data-legend={mode}>
                <h2 className="text-body font-bold">{t("layers.title")}</h2>
                {layers.includes("alerts") && (
                  <div className="flex flex-col gap-2">
                    <p className="font-medium">{t("layers.alerts")}</p>
                    <ul className="flex flex-wrap gap-2">
                      {ALERT_LEVELS.filter((l) => l !== "normal" || status?.inService).map(
                        (level) => (
                          <li key={level}>
                            <AlertBadge level={level} />
                          </li>
                        ),
                      )}
                    </ul>
                    <p className={hint}>{t("legendStale")}</p>
                  </div>
                )}
                {showMine && mine.length > 0 && (
                  /* Each place with its own colour, so the pins can be told apart without
                     hovering over every one of them, and so the colours mean something to
                     someone who cannot tell these hues apart. */
                  <div className="flex flex-col gap-1" data-layer="mine">
                    <p className="font-medium">{t("layers.mine")}</p>
                    <ul className="flex flex-col gap-1">
                      {mine.map((place) => (
                        <li
                          key={place.id}
                          className="flex items-center gap-2"
                          data-mine-legend={place.id}
                        >
                          <span
                            aria-hidden="true"
                            style={{ backgroundColor: place.color }}
                            className="size-4 shrink-0 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,.15)]"
                          />
                          <span>{place.label}</span>
                        </li>
                      ))}
                    </ul>
                    <p className={hint}>{t("mine.hint")}</p>
                  </div>
                )}
                {drawn.length > 0 && (
                  <ul className="flex flex-col gap-1">
                    {drawn.map((layer) => (
                      <li key={layer} className="flex items-center gap-2" data-layer={layer}>
                        <span
                          aria-hidden="true"
                          className={
                            layer === "gauges"
                              ? "size-4 shrink-0 rounded-full border-4 border-jaga-edge bg-white"
                              : layer === "reports"
                                ? "size-4 shrink-0 border-2 border-jaga-edge bg-jaga-slate/40"
                                : "size-4 shrink-0 rounded-full border-2 border-white bg-jaga-slate"
                          }
                        />
                        {t(`layers.${layer}`)}
                      </li>
                    ))}
                  </ul>
                )}
                {pending.length > 0 && (
                  <div className="flex flex-col gap-1" data-pending="true">
                    <p className="font-medium">{t("pending.title")}</p>
                    <ul className={`flex list-disc flex-col gap-1 ps-5 ${hint}`}>
                      {pending.map((layer) => (
                        <li key={layer} data-pending-layer={layer}>
                          {t(`pending.${layer}`)}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>

              {mode === "live" && (
                <section className={card} data-alerts-list="true">
                  <h2 className="text-body font-bold">{t("alertsList.title")}</h2>
                  {!status || (failed && !fresh) ? (
                    <p>{t("alertsList.unknown")}</p>
                  ) : alerts.length === 0 ? (
                    <p>{status.inService ? t("alertsList.none") : tHome("notInService.body")}</p>
                  ) : (
                    <ul className="flex flex-col gap-4">
                      {alerts.map(({ alert, tambons }) => (
                        <li key={alert.id} className="flex flex-col gap-1">
                          <AlertStatus
                            level={alert.level}
                            nextUpdateAt={new Date(alert.nextUpdateAt)}
                            now={new Date(now)}
                          />
                          <p>
                            <span className={`block ${hint}`}>{t("alertsList.areas")}</span>
                            {tambons.map(tambonName).join(", ")}
                          </p>
                          <p className={hint}>
                            {t("alertsList.nextUpdate", { time: time(alert.nextUpdateAt) })}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
