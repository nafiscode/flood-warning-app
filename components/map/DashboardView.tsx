"use client";

import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { AlertBadge } from "@/components/alerts/AlertBadge";
import { AlertStatus } from "@/components/alerts/AlertStatus";
import { AlertHero } from "@/components/home/AlertHero";
import { heroStatusFor, NORMAL_NEEDS_CHECK_WITHIN_MS } from "@/components/home/HomeView";
import { PlaceStatus } from "@/components/home/WatchedPlaces";
import { SafePlaceCard } from "@/components/places/SafePlaceCard";
import { HAZARD_CLASSES, hazardColor, hazardKey } from "@/lib/hazard-layer";
import { BASEMAPS, type Basemap } from "@/lib/map";
import { HOUSE } from "@/lib/place-icons";
import { PhoneIcon, WaveIcon } from "@/components/icons";
import { ProvinceSelect } from "@/components/ProvinceSelect";
import {
  areaName,
  pickName,
  tambonName as tambonInWords,
  type Area,
  type AreaDirectory,
} from "@/lib/area";
import { ALERT_LEVELS } from "@/lib/brand/tokens";
import { DamCard, DamLegend, DamNotice } from "@/components/map/Dam";
import { damFrame, onPath, type Dam } from "@/lib/dam";
import { ReportsNear } from "@/components/reports/ReportsNear";
import { reportsNearMe, type TambonReports } from "@/lib/flood-reports";
import { layersFor, type Hazard, type MapLayer, type MapMode } from "@/lib/hazards";
import { boundsAround, darkNow, PROVINCE_BOUNDS, SERVICE_BOUNDS } from "@/lib/map";
import type { MapData } from "@/lib/map-data";
import type { MyPlaces } from "@/lib/me";
import { homeColor, mineColor } from "@/lib/mine-colors";
import { localName } from "@/lib/places";
import { damReleaseAt, hasActiveAlerts, type PublicStatus } from "@/lib/public-status";
import { BANGKOK_DATE_TIME } from "@/lib/time";
import { buttonQuiet, buttonSecondary, card, hint, notice } from "@/lib/ui";
import type { LoadState } from "@/lib/use-public";
import { HazardPlaceholder } from "./HazardPlaceholder";
import { SatelliteFloodPanel } from "./SatelliteFlood";
import type { SatelliteFlood, SatelliteWindow } from "@/lib/satellite-flood";
import { Link } from "@/i18n/navigation";
import { checkBox, checkRow } from "@/lib/ui";
import { MapView, type MapSelection, type MinePlace } from "./MapView";
import { GaugeGlyph, LiveDot } from "./GaugeGlyph";
import { gaugeLook, trendOf } from "@/lib/gauge-marks";

/** The safe places' marker as the map draws it (lib/place-icons.ts): a square with a house. */
function PlaceMark({ size }: { size: number }) {
  return (
    <svg
      aria-hidden="true"
      data-place-mark="true"
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className="shrink-0"
    >
      <rect
        x="6"
        y="6"
        width="88"
        height="88"
        rx="18"
        className="fill-jaga-slate stroke-white"
        strokeWidth="8"
      />
      <polygon
        points={HOUSE.map(([x, y]) => `${x * 100},${y * 100}`).join(" ")}
        className="fill-white"
      />
    </svg>
  );
}

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
  /** When the gauges were last asked for again (0: not yet); the legend's "live" line. */
  gaugesAskedAt?: number;
  /** The dams and their release path. Null while loading, or if the answer can't be had. */
  dams?: Dam[] | null;
  /** The `pmtiles://` address of the flood-hazard classes; null while there is none to draw. */
  hazardTiles?: string | null;
  /**
   * Flood seen by satellite (GISTDA): the window asked for (null = switched off), the answer
   * and how the asking went. Left out, the switch is not offered.
   */
  satelliteDays?: SatelliteWindow | null;
  onSatelliteDays?: (days: SatelliteWindow | null) => void;
  satellite?: SatelliteFlood | null;
  satelliteLoad?: LoadState;
  now: number;
  /** The Transparency tab exists only once donations are switched on (A11, safety rule 9). */
  transparency: boolean;
  /** The signed-in person's home and watched places, or null for a visitor. */
  me?: MyPlaces | null;
  /** The area the person chose on the home screen: where the map opens (the owner's note). */
  area?: Area | null;
  /** The province the map opens on; all four when left out. */
  initialProvince?: string;
  /** A dam whose whole report to open at once, asked for from the home screen (?dam=<code>). */
  openDam?: string | null;
  /** A tambon whose residents' flood reports were asked for from the home screen. */
  openReports?: { tambon: string; lat: number; lon: number } | null;
  /** Tambons with a standing flood report from residents. Null while loading or unavailable. */
  reports?: TambonReports[] | null;
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

/** Four corners of a frame: "show the whole area". */
function ZoomOutIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
    </svg>
  );
}

/**
 * The map dashboard (spec 4.2), drawn from what it is given. Map tab: hazard switcher, province
 * selector, risk or live view, the map, what a tap selected, the legend, and the alerts in force
 * as a plain list that also works when the map can't load.
 */
export function DashboardView(props: DashboardViewProps) {
  const { status, checkedAt, failed, directory, data, now } = props;
  const dams = props.dams ?? [];
  const t = useTranslations("map");
  const tHome = useTranslations("home");
  const tDam = useTranslations("dam");
  const tNear = useTranslations("reportsNear");
  const locale = useLocale();
  const format = useFormatter();
  const time = (iso: string) => format.dateTime(new Date(iso), BANGKOK_DATE_TIME);

  const [tab, setTab] = useState<"map" | "transparency">("map");
  const [hazardCode, setHazardCode] = useState("flood");
  // Someone who came to see reports wants the current situation, not the long-term risk.
  const [chosenMode, setChosenMode] = useState<MapMode | null>(props.openReports ? "live" : null);
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
  /*
   * The dam's whole report can be asked for from the home screen (the owner, 13 Oct: the card
   * there carries a button into the map). It is the opening selection rather than something set
   * in an effect, so the report is on screen in the first paint instead of flashing the area
   * card first.
   */
  const asked = props.openDam ?? null;
  const [picked, setPicked] = useState<MapSelection | null>(
    asked ? { kind: "dam", code: asked } : null,
  );
  const [touched, setTouched] = useState(asked !== null);
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
   * Safe places are drawn only when asked for (the owner, 12 Oct 2026): there are thousands, and
   * all of them at once bury the map. The switch sits right under the map and says how many.
   */
  const [showPlaces, setShowPlaces] = useState(false);
  // The flood-risk areas start on (the owner, 12 Oct 2026) and can be switched off to read the
  // ground underneath; the basemap is the person's choice for as long as this page is open. It
  // opens on the terrain (the owner, 13 Oct 2026): where the hills are says most about where
  // water goes.
  const [showHazard, setShowHazard] = useState(true);
  const [basemap, setBasemapChoice] = useState<Basemap>("terrain");
  /*
   * A box the map has been asked to fly to, and a count so that asking for the same box twice
   * still moves it (the owner, 12 Oct: opening the dam's figures should show the dam and the
   * person's own places together, so the distance between them is something they can see).
   */
  const [focus, setFocus] = useState<{
    box: [number, number, number, number];
    key: number;
  } | null>(null);
  /*
   * The pins take their light colours once the app has turned dark for the night (the owner,
   * 10 Oct: their own pin was too dark to see on the night map). `now` moves on every 30 s, so
   * the colours change over with the theme; on the server it is 0 and the day colours are used,
   * which is what the first paint in the browser draws too.
   */
  const dark = props.now > 0 && darkNow();

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
                color: homeColor(dark),
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
            color: mineColor(index, dark),
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

  /*
   * The quiet dam notice goes only to someone whose own area or watched place is on the river
   * below the dam (spec section 15). Everyone else can read every figure by tapping the dam;
   * they are simply not told water is heading their way, because it is not.
   */
  const myTambons = [
    ...(props.area ? [props.area.code] : []),
    ...(props.me?.signedIn && props.me.home ? [props.me.home.code] : []),
    ...(props.me?.signedIn
      ? props.me.places.map((place) => place.area?.code).filter((c): c is string => !!c)
      : []),
  ];
  const damsOnMyPath = dams
    .map((dam) => ({ dam, hit: onPath(dam, myTambons) }))
    .filter((x): x is { dam: Dam; hit: NonNullable<ReturnType<typeof onPath>> } => x.hit !== null);

  const pending: MapLayer[] = [
    ...(layers.includes("hazard") && !props.hazardTiles ? (["hazard"] as const) : []),
    ...(layers.includes("alerts") && status && !status.inService ? (["alerts"] as const) : []),
    ...(layers.includes("places") && data && data.places.length === 0 ? (["places"] as const) : []),
    ...(layers.includes("reports") && data && data.reports.length === 0
      ? (["reports"] as const)
      : []),
    ...(layers.includes("gauges") && data && data.gauges.length === 0 ? (["gauges"] as const) : []),
  ];
  const placesOnOffer = layers.includes("places") && !!data && data.places.length > 0;
  const hazardOnOffer = layers.includes("hazard") && !!props.hazardTiles;
  // The map is dark at night except on the satellite picture; the legend shows the shades in use.
  const nightMap = dark && basemap !== "satellite";
  // The newest gauge reading, for the legend's "live" line.
  const newestGauge = (data?.gauges ?? []).reduce<string | null>(
    (best, g) => (g.observedAt && (!best || g.observedAt > best) ? g.observedAt : best),
    null,
  );
  const mapLayers = layers.filter(
    (l) => (l !== "places" || showPlaces) && (l !== "hazard" || showHazard || !hazardOnOffer),
  );
  const drawn = mapLayers.filter((l) => l !== "alerts" && !pending.includes(l));

  /*
   * Where the map looks: close around the person's own area while that is what is chosen, the
   * whole province once they pick one from the list, and all four when they clear it. The box is
   * about 22 by 17 km, which holds a tambon and its neighbours.
   */
  const mapBounds: [number, number, number, number] | undefined =
    chosenProvince === null && props.area
      ? [props.area.lon - 0.1, props.area.lat - 0.08, props.area.lon + 0.1, props.area.lat + 0.08]
      : PROVINCE_BOUNDS[province];

  /*
   * ...and the map travels to it, the same view the legend's button gives. Only the dam and its
   * reservoir: the numbers then never change again, so panning away and toggling anything else
   * cannot pull the map back (MapView refits on the figures, not on the array).
   */
  const askedDam = asked ? dams.find((d) => d.code === asked) : undefined;
  const askedBox: [number, number, number, number] | null = askedDam
    ? (boundsAround(damFrame(askedDam)) ?? null)
    : props.openReports
      ? [
          props.openReports.lon - 0.06,
          props.openReports.lat - 0.05,
          props.openReports.lon + 0.06,
          props.openReports.lat + 0.05,
        ]
      : null;

  let selected: React.ReactNode = null;
  if (selection?.kind === "tambon" && layers.includes("alerts")) {
    selected = (
      <AlertHero
        status={heroStatusFor(status, selection.code, fresh)}
        area={<p className="font-bold">{pickName(locale, selection.nameTh, selection.nameEn)}</p>}
        areaName={tambonInWords(locale, selection)}
        now={now}
      />
    );
  } else if (selection?.kind === "place") {
    const place = data?.places.find((p) => p.id === selection.id);
    selected = place ? <SafePlaceCard place={place} userAgent={props.userAgent} /> : null;
  } else if (selection?.kind === "hazard") {
    const key = hazardKey(selection.value);
    selected = key ? (
      <section className={card} data-selected="hazard">
        <p className="flex items-center gap-2 font-bold">
          <span
            aria-hidden="true"
            className="size-5 shrink-0 rounded-[4px] border border-jaga-edge"
            style={{
              backgroundColor: hazardColor(
                HAZARD_CLASSES.find((c) => c.key === key)!,
                nightMap,
              ),
            }}
          />
          {t("risk.here", { level: t(`risk.level.${key}`) })}
        </p>
        <p className={hint}>{t("risk.note")}</p>
      </section>
    ) : null;
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
  } else if (selection?.kind === "dam") {
    const dam = dams.find((d) => d.code === selection.code);
    selected = dam ? (
      <DamCard
        dam={dam}
        now={now}
        tambonCode={props.area?.code ?? null}
        tambonName={props.area ? tambonName(props.area.code) : null}
      />
    ) : null;
  } else if (selection?.kind === "gauge") {
    const gauge = data?.gauges.find((g) => g.id === selection.id);
    selected = gauge ? (
      <section className={card} data-selected="gauge">
        <div className="flex items-center gap-2">
          <GaugeGlyph look={gaugeLook(gauge.status)} dark={nightMap} size={36} />
          <div>
            <p className="font-bold">{localName(gauge.name, locale)}</p>
            {gauge.code && <p className={hint}>{t("gauge.code", { code: gauge.code })}</p>}
          </div>
        </div>
        <p className="font-medium" data-gauge-state={gauge.status}>
          {t(`gauge.${gauge.status}`)}
        </p>
        {gauge.value !== null && <p>{t("gauge.level", { value: gauge.value.toFixed(2) })}</p>}
        {gauge.status !== "no_recent_data" &&
          gauge.value !== null &&
          gauge.bank != null &&
          (gauge.value >= gauge.bank ? (
            <p>{t("gauge.overBank", { value: (gauge.value - gauge.bank).toFixed(2) })}</p>
          ) : (
            <p>{t("gauge.belowBank", { value: (gauge.bank - gauge.value).toFixed(2) })}</p>
          ))}
        {gauge.bank != null && (
          <p className={hint}>{t("gauge.bank", { value: gauge.bank.toFixed(2) })}</p>
        )}
        {gauge.status !== "no_recent_data" && gauge.rise3h != null && (
          <p data-gauge-trend={trendOf(gauge.rise3h, gaugeLook(gauge.status))}>
            {t(`gauge.rise.${trendOf(gauge.rise3h, gaugeLook(gauge.status))}`, {
              value: Math.abs(gauge.rise3h).toFixed(2),
            })}
          </p>
        )}
        {gauge.observedAt && (
          <p className={hint}>{t("gauge.at", { time: time(gauge.observedAt) })}</p>
        )}
        <p className={hint}>{t("gauge.notAlert")}</p>
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

              {damsOnMyPath.map(({ dam, hit }) => (
                <DamNotice
                  key={dam.code}
                  dam={dam}
                  via={hit.via}
                  tambonCode={hit.code}
                  tambonName={tambonName(hit.code)}
                  now={now}
                  gatesOpenAt={damReleaseAt(status, dam.code, hit.code)}
                />
              ))}

              {/*
               * What residents have reported in the person's own tambons and districts, and in
               * the tambon they came here to look at (the owner, 13 Oct). Only in the current
               * situation: the hexagons it speaks of are drawn in that view. Counts only, and
               * the panel says it is neighbours speaking, not Jaga.
               */}
              {mode === "live" && props.reports && (
                <>
                  <ReportsNear
                    title={tNear("mapTitle")}
                    link={false}
                    near={reportsNearMe(props.reports, [
                      ...myTambons,
                      ...(props.openReports ? [props.openReports.tambon] : []),
                    ])}
                  />
                  {props.openReports &&
                    !props.reports.some((r) => r.tambon === props.openReports!.tambon) && (
                      <p className={hint} data-reports-none="true">
                        {tNear("none")}
                      </p>
                    )}
                </>
              )}

              {/*
               * The map opens close around the person's own area; this button pulls back to all
               * four provinces in one tap (the owner, 13 Oct). It sits on the map, at the start
               * of its top edge, opposite the zoom buttons.
               */}
              <div className="relative">
                <button
                  type="button"
                  data-zoom-all="true"
                  onClick={() =>
                    setFocus((was) => ({ box: SERVICE_BOUNDS, key: (was?.key ?? 0) + 1 }))
                  }
                  className="absolute start-2 top-2 z-10 inline-flex min-h-tap items-center gap-2 rounded-lg border border-jaga-line bg-jaga-surface px-3 text-small font-bold text-jaga-ink shadow-sm"
                >
                  <ZoomOutIcon />
                  {t("zoomAll")}
                </button>
                <MapView
                  layers={mapLayers}
                  status={fresh ? status : null}
                  data={data}
                  now={now}
                  bounds={focus?.box ?? askedBox ?? mapBounds}
                  boundsKey={focus?.key ?? (askedBox ? 1 : 0)}
                  onSelect={setSelection}
                  text={{ loading: t("loading"), failed: t("failed") }}
                  gaugeWords={{ near: t("gauge.nearShort"), over: t("gauge.overShort") }}
                  mine={mine}
                  showMine={showMine}
                  dams={dams}
                  hazardUrl={props.hazardTiles ?? null}
                  satellite={
                    props.satelliteDays && props.satellite?.days === props.satelliteDays
                      ? props.satellite.features
                      : null
                  }
                  basemap={basemap}
                  damText={{
                    spillway: tDam("mark.spillway"),
                    outlet: tDam("mark.outlet"),
                    locale,
                  }}
                />
              </div>
              <fieldset className="flex flex-col gap-1" data-basemap={basemap}>
                <legend className="font-medium">{t("basemap.title")}</legend>
                <div className="flex flex-wrap gap-2">
                  {BASEMAPS.map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      data-basemap-choice={kind}
                      aria-pressed={basemap === kind}
                      onClick={() => setBasemapChoice(kind)}
                      className={`min-h-tap rounded-full border-2 px-4 font-bold ${
                        basemap === kind
                          ? "border-jaga-edge bg-jaga-slate text-white"
                          : "border-jaga-line bg-jaga-surface"
                      }`}
                    >
                      {t(`basemap.${kind}`)}
                    </button>
                  ))}
                </div>
                {basemap === "satellite" && <p className={hint}>{t("basemap.satelliteNote")}</p>}
              </fieldset>
              {hazardOnOffer && (
                <label
                  data-hazard-toggle="true"
                  className={`${checkRow} items-center rounded-xl border-2 border-jaga-edge bg-jaga-surface px-3 font-bold`}
                >
                  <input
                    type="checkbox"
                    className={`${checkBox} mt-0`}
                    checked={showHazard}
                    onChange={(event) => setShowHazard(event.target.checked)}
                  />
                  <span aria-hidden="true" className="flex shrink-0 overflow-hidden rounded-[4px]">
                    {[...HAZARD_CLASSES].reverse().map((c) => (
                      <span
                        key={c.key}
                        className="h-5 w-2.5"
                        style={{ backgroundColor: hazardColor(c, nightMap) }}
                      />
                    ))}
                  </span>
                  <span>{t("risk.toggle")}</span>
                </label>
              )}
              {props.onSatelliteDays && (
                <SatelliteFloodPanel
                  days={props.satelliteDays ?? null}
                  onDays={props.onSatelliteDays}
                  flood={props.satellite ?? null}
                  load={props.satelliteLoad ?? "loading"}
                  dark={nightMap}
                />
              )}
              {placesOnOffer && (
                <label
                  data-places-toggle="true"
                  className={`${checkRow} items-center rounded-xl border-2 border-jaga-edge bg-jaga-surface px-3 font-bold`}
                >
                  <input
                    type="checkbox"
                    className={`${checkBox} mt-0`}
                    checked={showPlaces}
                    onChange={(event) => setShowPlaces(event.target.checked)}
                  />
                  <PlaceMark size={26} />
                  <span>{t("places.toggle", { count: data ? data.places.length : 0 })}</span>
                </label>
              )}
              {showPlaces && placesOnOffer && <p className={hint}>{t("places.hint")}</p>}
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
                    {drawn.map((layer) =>
                      layer === "hazard" ? (
                        <li key={layer} className="flex flex-col gap-1" data-layer={layer}>
                          <span className="font-medium">{t("layers.hazard")}</span>
                          <ul className="flex flex-wrap gap-x-4 gap-y-1">
                            {HAZARD_CLASSES.map((c) => (
                              <li
                                key={c.key}
                                className="flex items-center gap-2"
                                data-hazard-class={c.key}
                              >
                                <span
                                  aria-hidden="true"
                                  className="size-4 shrink-0 rounded-[3px] border border-jaga-edge"
                                  style={{ backgroundColor: hazardColor(c, nightMap) }}
                                />
                                {t(`risk.level.${c.key}`)}
                              </li>
                            ))}
                          </ul>
                          <span className={hint} data-hazard-note="true">
                            {t("risk.note")}
                          </span>
                        </li>
                      ) : layer === "gauges" ? (
                        <li key={layer} className="flex flex-col gap-1" data-layer={layer}>
                          <span className="flex flex-wrap items-center gap-2 font-medium">
                            {t("layers.gauges")}
                            <span
                              className="inline-flex items-center gap-1 text-small font-bold uppercase tracking-wide"
                              data-gauges-live="true"
                            >
                              <LiveDot dark={nightMap} />
                              {t("gauge.live")}
                            </span>
                          </span>
                          <ul className="flex flex-col gap-1">
                            {(
                              [
                                ["over", "above_warning"],
                                ["near", "above_watch"],
                                ["normal", "normal"],
                                ["quiet", "no_recent_data"],
                              ] as const
                            ).map(([look, status]) => (
                              <li
                                key={look}
                                className="flex items-center gap-2"
                                data-gauge-legend={look}
                              >
                                <GaugeGlyph look={look} dark={nightMap} />
                                {t(`gauge.${status}`)}
                              </li>
                            ))}
                          </ul>
                          <span className={hint}>{t("gauge.legendFull")}</span>
                          <span className={hint}>{t("gauge.legendTrend")}</span>
                          {newestGauge && (
                            <span className={hint} data-gauges-updated="true">
                              {t("gauge.updated", { time: time(newestGauge) })}
                            </span>
                          )}
                        </li>
                      ) : (
                        <li key={layer} className="flex items-center gap-2" data-layer={layer}>
                          {layer === "places" ? (
                            <PlaceMark size={18} />
                          ) : (
                            <span
                              aria-hidden="true"
                              className={
                                layer === "reports"
                                  ? "size-4 shrink-0 border-2 border-jaga-edge bg-jaga-slate/40"
                                  : "size-4 shrink-0 rounded-full border-2 border-white bg-jaga-slate"
                              }
                            />
                          )}
                          {t(`layers.${layer}`)}
                        </li>
                      ),
                    )}
                  </ul>
                )}
                {dams.length > 0 && (
                  <div className="flex flex-col gap-1" data-dam-legend="true">
                    <p className="font-medium">{tDam("path.title")}</p>
                    <ul className="flex flex-col gap-1">
                      {dams.map((dam) => (
                        <DamLegend key={dam.code} dam={dam} />
                      ))}
                    </ul>
                    <p className={hint}>{tDam("path.limits")}</p>
                    {/*
                     * The way in that needs no aim at all. The card otherwise opens only by
                     * tapping the dam itself, and a river is a thin thing to hit: 4 taps in 665
                     * found it on the live map, and the owner could not find the card at all.
                     * The legend names the dam anyway, so it is the natural button.
                     */}
                    {dams.map((dam) => (
                      <button
                        key={dam.code}
                        type="button"
                        data-open-dam={dam.code}
                        onClick={() => {
                          setSelection({ kind: "dam", code: dam.code });
                          /*
                           * The dam, and the places this person saved, in one view. Their own
                           * pins come along only while they are shown: framing a map around
                           * something invisible would read as a wrong zoom.
                           */
                          const box = boundsAround([...damFrame(dam), ...(showMine ? mine : [])]);
                          if (box) setFocus((was) => ({ box, key: (was?.key ?? 0) + 1 }));
                        }}
                        className={`${buttonQuiet} self-start`}
                      >
                        <WaveIcon size={20} aria-hidden="true" />
                        {tDam("legend.open", { dam: localName(dam.name, locale) })}
                      </button>
                    ))}
                  </div>
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
