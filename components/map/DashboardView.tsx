"use client";

import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useEffect, useState, useSyncExternalStore } from "react";
import { AlertBadge } from "@/components/alerts/AlertBadge";
import { AlertStatus } from "@/components/alerts/AlertStatus";
import { AlertHero } from "@/components/home/AlertHero";
import { heroStatusFor, NORMAL_NEEDS_CHECK_WITHIN_MS } from "@/components/home/HomeView";
import { PlaceStatus } from "@/components/home/WatchedPlaces";
import { SafePlaceCard } from "@/components/places/SafePlaceCard";
import { HAZARD_CLASSES, hazardColor, hazardKey } from "@/lib/hazard-layer";
import {
  BASEMAPS,
  isPhotoBasemap,
  SCENE_EXAGGERATION,
  satelliteProvider,
  subscribeSatellite,
  type Basemap,
} from "@/lib/map";
import { HOUSE } from "@/lib/place-icons";
import { CrossIcon, PhoneIcon, PinIcon, WaveIcon } from "@/components/icons";
import { ProvinceSelect } from "@/components/ProvinceSelect";
import {
  areaName,
  pickName,
  tambonName as tambonInWords,
  type Area,
  type AreaDirectory,
} from "@/lib/area";
import { ALERT_LEVELS } from "@/lib/brand/tokens";
import { DamCard, DamLegendKeys, DamLegendRow, DamNotice } from "@/components/map/Dam";
import { MonitoringCard } from "@/components/monitoring/MonitoringCard";
import { MonitoringDetail } from "@/components/monitoring/MonitoringDetail";
import { monitoring } from "@/lib/monitoring";
import { useKeptRain } from "@/lib/use-rain";
import { damFrame, onPath, type Dam } from "@/lib/dam";
import { ReportsNear } from "@/components/reports/ReportsNear";
import { reportsNearMe, type TambonReports } from "@/lib/flood-reports";
import { layersFor, type Hazard, type MapLayer, type MapMode } from "@/lib/hazards";
import { boundsAround, darkNow, PROVINCE_BOUNDS, provincesBox, SERVICE_BOUNDS } from "@/lib/map";
import type { MapData } from "@/lib/map-data";
import type { MyPlaces } from "@/lib/me";
import { homeColor, mineColor } from "@/lib/mine-colors";
import { gaugeTally, levelTally, reportTally } from "@/lib/map-console";
import { localName } from "@/lib/places";
import { isAdminRoleName } from "@/lib/roles";
import { damReleaseAt, hasActiveAlerts, type PublicStatus } from "@/lib/public-status";
import { BANGKOK_DATE_TIME } from "@/lib/time";
import { buttonQuiet, buttonSecondary, card, hint, notice } from "@/lib/ui";
import type { LoadState } from "@/lib/use-public";
import { ConsoleSky, ConsoleWeather } from "./ConsoleSky";
import { ConsoleTiles } from "./ConsoleTiles";
import { HazardPlaceholder } from "./HazardPlaceholder";
import { SatelliteFloodPanel } from "./SatelliteFlood";
import type { SatelliteFlood, SatelliteWindow } from "@/lib/satellite-flood";
import { Link } from "@/i18n/navigation";
import { checkBox, checkRow } from "@/lib/ui";
import { DamPeek, GaugePeek, PlacePeek } from "./MapPeek";
import {
  MapView,
  type MapSelection,
  type MinePlace,
  type PeekTarget,
  type SeaMark,
} from "./MapView";
import { SeaGradeIcon, SeaPeek, SeaSection } from "./Sea";
import { RainPeek, RainSection } from "./RainCard";
import {
  coastBox,
  withCoast,
  hourNow,
  isCoastId,
  nearestCoast,
  outlook,
  travelBearing,
  waveRange,
  type SeaData,
} from "@/lib/sea";
import { MineGlyph } from "./MineGlyph";
import { GaugeGlyph, LiveDot } from "./GaugeGlyph";
import { MapFeatureChips } from "./MapFeatures";
import { SignInHint } from "@/components/account/SignInOffer";
import { MapMethod } from "./MapMethod";
import { MAIN_DAM, mainDam, zoneFrame, type MapFocus } from "@/lib/map-focus";
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
  /** When the server made the map's data (its Date header); offline, the kept copy's age. */
  dataServedAt?: number | null;
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
  /** One of the map's six features, asked for from a tile on the home screen (?focus=). */
  openFocus?: MapFocus | null;
  /** The sea off the coast (lib/sea.ts), and how asking for it went. */
  sea?: SeaData | null;
  seaLoad?: LoadState;
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

/** The two buttons on the map's top edge: all four provinces, and the person's own places. */
const mapButton =
  "inline-flex min-h-tap items-center gap-2 rounded-lg border border-jaga-line bg-jaga-surface px-3 text-small font-bold text-jaga-ink shadow-sm";

/** A map pin, for "My places". */
function HomePinIcon() {
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
      <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </svg>
  );
}

/** A chevron for "previous" (back) or "next"; mirrored in a right-to-left layout. */
function ChevronIcon({ next }: { next: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="rtl:-scale-x-100"
    >
      <path d={next ? "M9 5l7 7-7 7" : "M15 5l-7 7 7 7"} />
    </svg>
  );
}

/** A round arrow: "back to how it was". */
function ResetIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
}

/**
 * How close the map comes to one of the person's own places on the "My places" tour: about
 * 5.5 by 4.4 km, so the place and the streets and fields around it are both readable.
 */
const TOUR_HALF = { lon: 0.025, lat: 0.02 };

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
  const tMonitoring = useTranslations("monitoring");
  const tSea = useTranslations("sea");
  const tNear = useTranslations("reportsNear");
  const locale = useLocale();
  const format = useFormatter();
  const time = (iso: string) => format.dateTime(new Date(iso), BANGKOK_DATE_TIME);

  const [tab, setTab] = useState<"map" | "transparency">("map");
  const [hazardCode, setHazardCode] = useState("flood");
  // Phones and tablets show only the chosen hazard until this is opened (the owner, 16 Oct).
  const [moreHazards, setMoreHazards] = useState(false);
  // Someone who came to see reports wants the current situation, not the long-term risk.
  const [chosenMode, setChosenMode] = useState<MapMode | null>(
    props.openReports ? "live" : props.openFocus === "risk" ? "risk" : null,
  );
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
  const asked = props.openDam ?? (props.openFocus === "dam" ? MAIN_DAM : null);
  // "?focus=sea" opens the Sea and coast section on the point off the person's own coast.
  const askedSea = props.openFocus === "sea" ? nearestCoast(props.area) : null;
  const [picked, setPicked] = useState<MapSelection | null>(
    asked ? { kind: "dam", code: asked } : askedSea ? { kind: "sea", id: askedSea } : null,
  );
  const [touched, setTouched] = useState(asked !== null || askedSea !== null);
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
   * "My places" as a tour (the owner, 15 Oct): the map visits the person's home and each place
   * they watch in turn, with previous / next and a list to jump to one, and Reset to go back to the
   * map's first view. Null while no tour is open.
   */
  const [tourAt, setTourAt] = useState<number | null>(null);
  /*
   * Safe places are drawn only when asked for (the owner, 12 Oct 2026): there are thousands, and
   * all of them at once bury the map. The switch sits right under the map and says how many.
   */
  const [showPlaces, setShowPlaces] = useState(props.openFocus === "places");
  // The river gauges, the dam and the land its release can reach: each on its chip above the map
  // (the owner, 15 Oct), all on to start with, as the map has always drawn them.
  const [showGauges, setShowGauges] = useState(true);
  const [showDam, setShowDam] = useState(true);
  const [showDamZone, setShowDamZone] = useState(true);
  // The flood-risk areas start on (the owner, 12 Oct 2026) and can be switched off to read the
  // ground underneath; the basemap is the person's choice for as long as this page is open. It
  // opens on the satellite picture with the hills shaded over it (the owner, 15 Oct 2026, after
  // the terrain from 13 Oct): the real ground people recognise, and where the hills are, which
  // says most about where water goes.
  const [showHazard, setShowHazard] = useState(true);
  // The sea's waves along the coast start on (the owner, 15 Oct 2026), and can be switched off.
  const [showSea, setShowSea] = useState(true);
  /*
   * The background follows the time of day (the owner, 15 Oct): Satellite + terrain by day,
   * Terrain at night. A background the person picks stays until day turns to night or back; the
   * picture then changes with it.
   */
  const [basemapChoice, setBasemapPicked] = useState<{ kind: Basemap; night: boolean } | null>(
    null,
  );
  // 2D or 3D (the owner, 15 Oct): flat by default; the switch sits on the map itself.
  const [scene, setScene] = useState(false);
  // Esri's picture, or EOX's once Esri stops answering (lib/map.ts): the note says which.
  const satellite = useSyncExternalStore(subscribeSatellite, satelliteProvider, satelliteProvider);
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
  const basemap: Basemap =
    basemapChoice && basemapChoice.night === dark
      ? basemapChoice.kind
      : dark
        ? "terrain"
        : "satelliteTerrain";
  const setBasemapChoice = (kind: Basemap) => setBasemapPicked({ kind, night: dark });

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
  /*
   * The forecast model's rain for the summary's monitoring section, from the reading this
   * device already keeps for the header's chip: nothing is asked for here (lib/use-rain).
   */
  const rain = useKeptRain();
  /*
   * Whether the monitoring detail is open. One state for both places it can be drawn: the
   * band under the console, and the card under the legend on a phone and a tablet.
   */
  const [monitoringOpen, setMonitoringOpen] = useState(false);
  const hazard = hazards.find((h) => h.code === hazardCode) ?? hazards[0]!;
  // Pre-season the risk view opens first; with any alert in force, the live view (spec 4.2).
  const mode: MapMode = chosenMode ?? (hasActiveAlerts(status) ? "live" : "risk");
  const layers = layersFor(hazard, mode);
  const fresh = checkedAt !== null && now - checkedAt < NORMAL_NEEDS_CHECK_WITHIN_MS;
  const kept = [checkedAt, props.dataServedAt ?? null].filter((x): x is number => x !== null);
  const savedAt = kept.length > 0 ? Math.min(...kept) : null;

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
  const nightMap = dark && !isPhotoBasemap(basemap);
  // The newest gauge reading, for the legend's "live" line.
  const newestGauge = (data?.gauges ?? []).reduce<string | null>(
    (best, g) => (g.observedAt && (!best || g.observedAt > best) ? g.observedAt : best),
    null,
  );
  const mapLayers = layers.filter(
    (l) =>
      (l !== "places" || showPlaces) &&
      (l !== "gauges" || showGauges) &&
      (l !== "hazard" || showHazard || !hazardOnOffer),
  );
  const drawn = mapLayers.filter((l) => l !== "alerts" && !pending.includes(l));

  /*
   * Where the map looks: the whole province of the person's chosen area, together with the
   * provinces of their home and of every place they watch (the owner, 15 Oct: someone in Pattani
   * who watches a place in Narathiwat opens on both provinces in full); the one province once
   * they pick one from the list; and all four when they clear it or have no place yet.
   */
  const myCodes = [
    props.area?.code,
    ...(props.me?.signedIn
      ? [props.me.home?.code, ...props.me.places.map((place) => place.area?.code)]
      : []),
  ];
  const openProvinces =
    chosenProvince === null
      ? [...new Set(myCodes.map((code) => code?.slice(0, 2) ?? "").filter(Boolean))]
      : [province];
  const provinceBox: [number, number, number, number] | undefined =
    chosenProvince === null ? provincesBox(myCodes) : PROVINCE_BOUNDS[province];
  // ...and the wave points off those provinces' own coast (the owner, 15 Oct).
  const mapBounds = provinceBox ? withCoast(provinceBox, openProvinces) : undefined;

  /*
   * ...and the map travels to it, the same view the legend's button gives. Only the dam and its
   * reservoir: the numbers then never change again, so panning away and toggling anything else
   * cannot pull the map back (MapView refits on the figures, not on the array).
   */
  const askedDam = asked ? dams.find((d) => d.code === asked) : undefined;
  const zoneDam = props.openFocus === "damzone" ? mainDam(dams) : undefined;
  const askedBox: [number, number, number, number] | null = askedDam
    ? (boundsAround(damFrame(askedDam)) ?? null)
    : zoneDam
      ? (boundsAround(zoneFrame(zoneDam)) ?? null)
      : props.openFocus === "gauges"
        ? SERVICE_BOUNDS
        : props.openFocus === "sea"
          ? coastBox()
          : props.openReports
            ? [
                props.openReports.lon - 0.06,
                props.openReports.lat - 0.05,
                props.openReports.lon + 0.06,
                props.openReports.lat + 0.05,
              ]
            : null;

  /*
   * The pop-ups on the map itself (the owner, 14 Oct): a reservoir, a gauge or a safe place says
   * how it stands where it is drawn. "All details" opens the card under the map and scrolls to it.
   */
  /*
   * Opening a card has to take the eye to it. The panel sits under the map and above the legend,
   * so a button in the legend - and a reservoir's own button is a long way down it on a laptop -
   * opened the card off the top of the screen and nothing seemed to happen (the owner, 14 Oct).
   * Everything that opens a card now scrolls the panel into the frame, hands it the keyboard and
   * marks it for a moment, so the eye lands on what was asked for.
   */
  const revealPanel = () => {
    const reduce = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    /*
     * The header is frozen at the top of the page and is taller than the page's own scroll
     * padding on a phone (155 px against 112 px), so scrollIntoView alone slides the first lines
     * of the card under it. The header's own height is measured instead.
     */
    const bring = (behavior: ScrollBehavior) => {
      const panel = document.querySelector<HTMLElement>("[data-selected-panel]");
      if (!panel) return null;
      /*
       * On the laptop console the card sits in a rail that scrolls on its own, so moving the
       * window would do nothing: the rail is scrolled instead. Everywhere else that wrapper is
       * `display: contents` and has no scrolling of its own, which is what this asks it.
       */
      const rail = panel.closest<HTMLElement>("[data-console-rail]");
      if (rail && window.getComputedStyle(rail).overflowY === "auto") {
        const off = panel.getBoundingClientRect().top - rail.getBoundingClientRect().top - 12;
        if (Math.abs(off) > 4) {
          rail.scrollTo({ top: Math.max(0, rail.scrollTop + off), behavior });
        }
        return panel;
      }
      // The frozen row of chips sits under the header once the page has scrolled past it.
      const header =
        (document.querySelector("header")?.getBoundingClientRect().height ?? 0) +
        (document.querySelector("[data-map-chips-float]")?.getBoundingClientRect().height ?? 0);
      const gap = panel.getBoundingClientRect().top - header - 12;
      if (Math.abs(gap) > 4) window.scrollTo({ top: Math.max(0, window.scrollY + gap), behavior });
      return panel;
    };
    window.setTimeout(() => {
      const panel = bring(reduce() ? "auto" : "smooth");
      if (!panel) return;
      panel.focus({ preventScroll: true });
      panel.dataset.justOpened = "true";
      /*
       * The card settles as it fills - the drawing, the charts, the map's own move and whatever
       * above it is still loading all change where it sits - so for a few seconds after the
       * scroll it is put back under the header without another animation. Checked once at 700 ms
       * it still ended up below the bottom of a phone screen (CI, 15 Oct). The person's own
       * scroll or touch ends it at once.
       */
      let hold = 0;
      const stop = () => {
        window.clearInterval(hold);
        for (const kind of ["wheel", "touchstart", "keydown"] as const)
          window.removeEventListener(kind, stop);
      };
      window.setTimeout(() => {
        bring("auto");
        hold = window.setInterval(() => bring("auto"), 150);
        window.setTimeout(stop, 2500);
      }, 700);
      for (const kind of ["wheel", "touchstart", "keydown"] as const)
        window.addEventListener(kind, stop, { passive: true });
      window.setTimeout(() => {
        delete panel.dataset.justOpened;
      }, 1800);
    }, 60);
  };
  /*
   * A card asked for in the address (?dam=, ?focus=dam, ?focus=sea) is already open when the page
   * arrives, and on the console it opens in the right-hand rail, under the map's own switches -
   * out of sight. The rail is scrolled to it once, on arrival.
   *
   * Only the rail. Where the card is not in a rail that scrolls - every phone and every tablet -
   * nothing moves: a page that scrolls itself the moment it opens is worse than a card the
   * person scrolls to.
   */
  useEffect(() => {
    if (!asked && !askedSea) return;
    const id = window.setTimeout(() => {
      const panel = document.querySelector<HTMLElement>("[data-selected-panel]");
      const rail = panel?.closest<HTMLElement>("[data-console-rail]");
      if (!panel || !rail || window.getComputedStyle(rail).overflowY !== "auto") return;
      const off = panel.getBoundingClientRect().top - rail.getBoundingClientRect().top - 12;
      if (Math.abs(off) > 4) rail.scrollTo({ top: Math.max(0, rail.scrollTop + off) });
    }, 900);
    return () => window.clearTimeout(id);
    // Once, on arrival: later openings scroll the rail through revealPanel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const peekMore = (target: PeekTarget) => {
    setSelection(target);
    revealPanel();
  };
  const renderPeek = (target: PeekTarget): React.ReactNode => {
    const more = () => peekMore(target);
    if (target.kind === "gauge") {
      const gauge = data?.gauges.find((g) => g.id === target.id);
      return gauge ? <GaugePeek gauge={gauge} dark={nightMap} time={time} onMore={more} /> : null;
    }
    if (target.kind === "place") {
      const place = data?.places.find((x) => x.id === target.id);
      return place ? <PlacePeek place={place} userAgent={props.userAgent} onMore={more} /> : null;
    }
    if (target.kind === "sea") {
      const point = props.sea?.points.find((p) => p.id === target.id);
      return point ? <SeaPeek point={point} now={now} onMore={more} /> : null;
    }
    if (target.kind === "rain") {
      const place = mine.find((m) => m.id === target.id);
      return place ? <RainPeek name={place.label} kind={target.rain} onMore={more} /> : null;
    }
    const dam = dams.find((d) => d.code === target.code);
    return dam ? <DamPeek dam={dam} time={time} onMore={more} /> : null;
  };

  /*
   * "My places" (the owner, 14 Oct): the map frames the person's home and the places they watch,
   * or, for someone with neither, the area chosen on this phone.
   */
  const myPoints = [
    ...mine.map((m) => ({ lon: m.lon, lat: m.lat })),
    ...(mine.length === 0 && props.area ? [{ lon: props.area.lon, lat: props.area.lat }] : []),
  ];
  const myBox = myPoints.length > 0 ? boundsAround(myPoints) : null;

  /*
   * The tour. The place shown is the one whose card is open when that is one of theirs (they may
   * have tapped a pin meanwhile), else the one the tour last went to.
   */
  const tourIndex =
    tourAt === null
      ? null
      : selection?.kind === "mine" && mine.some((p) => p.id === selection.id)
        ? mine.findIndex((p) => p.id === selection.id)
        : Math.min(tourAt, mine.length - 1);
  const tourTo = (index: number) => {
    const count = mine.length;
    if (count === 0) return;
    const at = ((index % count) + count) % count;
    const place = mine[at]!;
    setTourAt(at);
    setShowMine(true);
    setSelection({ kind: "mine", id: place.id });
    setFocus((was) => ({
      box: [
        place.lon - TOUR_HALF.lon,
        place.lat - TOUR_HALF.lat,
        place.lon + TOUR_HALF.lon,
        place.lat + TOUR_HALF.lat,
      ],
      key: (was?.key ?? 0) + 1,
    }));
  };
  // Back to the view the map opened on, with no card open.
  const tourReset = () => {
    setTourAt(null);
    setSelection(null);
    setFocus((was) => ({ box: mapBounds ?? SERVICE_BOUNDS, key: (was?.key ?? 0) + 1 }));
  };

  /*
   * The chips above the map (the owner, 15 Oct): switches, several on at once, and none moves the
   * map. The dam's chip, when it is switched on, also opens the dam's report below the map and
   * brings the page to it, as it always has.
   */
  const featuresOn: Record<MapFocus, boolean> = {
    risk: showHazard,
    gauges: showGauges,
    sea: showSea,
    dam: showDam,
    damzone: showDamZone,
    places: showPlaces,
  };
  const toggleFeature = (f: MapFocus) => {
    const next = !featuresOn[f];
    if (f === "risk") {
      // The flood-risk areas are drawn in the risk view: switching them on goes there.
      if (next) setChosenMode("risk");
      setShowHazard(next);
    } else if (f === "gauges") {
      setShowGauges(next);
    } else if (f === "sea") {
      setShowSea(next);
      if (!next && selection?.kind === "sea") setSelection(null);
    } else if (f === "damzone") {
      setShowDamZone(next);
    } else if (f === "places") {
      setShowPlaces(next);
    } else {
      setShowDam(next);
      const dam = mainDam(dams);
      if (next && dam) {
        setSelection({ kind: "dam", code: dam.code });
        revealPanel();
      } else if (!next && selection?.kind === "dam") {
        setSelection(null);
      }
    }
  };

  /*
   * The sea's marks (lib/sea-marks.ts): each point's grade for the next day, its waves heading
   * where the model's waves travel now, and the words beside it - the grade far out for any sea
   * that is not calm, the waves' range close in.
   */
  const seaMarks: SeaMark[] | null =
    showSea && props.sea
      ? props.sea.points.map((point) => {
          const view = outlook(point, now);
          const word = view.grade === "calm" ? "" : tSea(`grade.${view.grade}.short`);
          const range =
            view.grade === "unknown"
              ? tSea("grade.unknown.short")
              : tSea("mark", { range: waveRange(view.waveMin, view.waveMax) });
          return {
            id: point.id,
            lat: point.lat,
            lon: point.lon,
            grade: view.grade,
            bearing: travelBearing(hourNow(point, now)?.waveFrom ?? null),
            short: word,
            long: [tSea(`points.${point.id}`), range, word].filter(Boolean).join(" · "),
          };
        })
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
        <Link
          href="/account/places"
          prefetch={false}
          className="inline-flex min-h-tap items-center gap-1.5 self-start underline"
        >
          <PinIcon size={20} />
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
  } else if (selection?.kind === "rain") {
    // The rain over one of the person's own places, opened from its cloud's pop-up (15 Oct).
    const place = mine.find((m) => m.id === selection.id);
    selected = place ? (
      <RainSection
        name={place.label}
        lat={place.lat}
        lon={place.lon}
        kind={selection.rain}
        now={now}
      />
    ) : null;
  } else if (selection?.kind === "sea") {
    selected = (
      <SeaSection
        data={props.sea ?? null}
        state={props.seaLoad ?? "loading"}
        now={now}
        pointId={isCoastId(selection.id) ? selection.id : null}
        onPoint={(id) => setSelection({ kind: "sea", id })}
      />
    );
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

  const others = hazards.filter((h) => h.code !== hazard.code);
  const othersSoon = others.every((h) => h.status !== "active");

  /*
   * The laptop console (the owner, 16 Oct 2026): "people who view this page from a laptop are
   * usually GIS, or work for an authority or in an office, and are familiar with a dashboard".
   * The arrangement is marked here and done entirely in CSS (the console block in
   * app/globals.css), so a phone and a tablet are left exactly as they were.
   *
   * It is marked only where the dashboard has all of its parts: not on the transparency tab, and
   * not for a hazard that is still to come, whose screen is a placeholder that must not be
   * dressed up as a console with nothing in it (safety rule 10).
   */
  const consoleOn = tab === "map" && hazard.status === "active";

  /*
   * How far the alert and report figures reach, in words: the province the page is narrowed to,
   * or null for all four. The river gauges and the dam are stations, not areas, so their tiles
   * say "all four provinces" for themselves - a readout that does not say what it covers is a
   * readout waiting to be misread.
   */
  const provinceEntry = directory?.provinces.find((p) => p.code === province);
  const scopeWord =
    chosenProvince === null || !provinceEntry
      ? null
      : pickName(locale, provinceEntry.nameTh, provinceEntry.nameEn);

  /*
   * The live monitoring (the owner, 17 Oct 2026). One status, drawn in two places and never in
   * the left rail: as the fifth readout across the top of the console, whose band opens under
   * the dashboard, and as a card under the map legend on a phone and a tablet. Both read the
   * same `summary` and share one open/shut state, so they can never disagree.
   */
  const myTambon = props.area?.code ?? (props.me?.signedIn ? props.me.home?.code : null) ?? null;
  /** Opens a subdistrict in the map's own panel, named as the panel needs it. */
  const openTambon = (code: string) => {
    const entry = directory?.tambons.find((x) => x.code === code);
    setSelection({
      kind: "tambon",
      code,
      nameTh: entry?.nameTh ?? code,
      nameEn: entry?.nameEn ?? code,
    });
    revealPanel();
  };
  const summaryDam = damsOnMyPath[0]?.dam ?? mainDam(dams) ?? null;
  const monitoringSummary = monitoring({
    now,
    myCodes: myTambons,
    myPoint: props.area ? { lat: props.area.lat, lon: props.area.lon } : null,
    narrowed: chosenProvince !== null,
    // The map holds the whole station list already; the card costs no extra request.
    gauges: { state: data?.gauges ? "ok" : props.dataState, data: data?.gauges ?? null },
    dam: { state: props.dams ? "ok" : "loading", data: summaryDam },
    onMyRiver: damsOnMyPath.length > 0,
    reports: { state: props.reports ? "ok" : "loading", data: props.reports ?? null },
    rain: { state: rain.state, data: rain.data },
  });
  const monitoringDetail = (
    <MonitoringDetail
      summary={monitoringSummary}
      scopeWords={{ province: scopeWord, myPlace: rain.place?.name ?? null }}
      damName={summaryDam ? localName(summaryDam.name, locale) : null}
      damTambon={damsOnMyPath[0] ? tambonName(damsOnMyPath[0].hit.code) : null}
      rainPlace={rain.place?.name ?? null}
      time={time}
      place="map"
      now={now}
      area={
        myTambon
          ? {
              hero: heroStatusFor(status, myTambon, fresh),
              code: myTambon,
              name: tambonName(myTambon),
            }
          : null
      }
      province={{
        levels: levelTally(alerts.map(({ alert }) => alert)),
        statusKnown: !!status && !(failed && !fresh),
        inService: status?.inService ?? false,
        scope: scopeWord ?? t("console.scope.all"),
      }}
      gauges={data?.gauges ?? null}
      gaugeScope={props.area ? tMonitoring("scope.nearMe") : tMonitoring("scope.fourProvinces")}
      weather={rain.weather}
      dam={summaryDam}
      damLink={
        summaryDam ? (
          <button
            type="button"
            data-open-dam-from-monitoring={summaryDam.code}
            onClick={() => {
              setSelection({ kind: "dam", code: summaryDam.code });
              revealPanel();
            }}
            className={`${buttonQuiet} w-full justify-between text-start`}
          >
            {tDam("legend.open", { dam: localName(summaryDam.name, locale) })}
            <WaveIcon size={20} aria-hidden="true" />
          </button>
        ) : null
      }
    />
  );

  return (
    <div
      className="flex flex-col gap-4"
      data-map-console={consoleOn ? "true" : undefined}
      data-console-page={consoleOn ? "map" : undefined}
    >
      {/*
       * The blocks below carry `data-console-area`, and on a laptop the console block in
       * app/globals.css lays them out as a dashboard: a rail of controls, the map at the full
       * height left over, and a rail of readouts. Everywhere else - every phone and every tablet,
       * which the owner asked to leave alone - the wrappers are `display: contents` and this is
       * the same single column it has always been.
       *
       * The page's order of blocks is also the console's reading order, column by column, so no
       * wrapper reorders anything and a keyboard meets the page as the eye does.
       */}
      {/* The weather behind the console, and nothing at all on a phone (components/map/ConsoleSky). */}
      {consoleOn && <ConsoleSky />}

      <div className="contents" data-console-area="head">
        <h1 className="text-h3 font-bold text-jaga-ink">{t("title")}</h1>
        {/* Who the console is for and what it may show: public, aggregated answers, the same
            ones the phone gets, and never an exact point (safety rule 6). */}
        <p className="hidden text-small text-jaga-text-2 console:block" data-console-note="true">
          {t("console.note")}
        </p>
        {/*
         * Without signal the map draws what this phone kept (A9: every saved thing says how old
         * it is). The time given is the older of the alert status and the map's own data.
         */}
        {failed && (
          <p className={notice} role="status" data-map-saved={savedAt !== null ? "time" : "old"}>
            {savedAt !== null
              ? t("savedAt", { time: format.dateTime(new Date(savedAt), BANGKOK_DATE_TIME) })
              : t("savedOld")}
          </p>
        )}
        {/* The weather in words, in the empty half of this line (the owner, 16 Oct). */}
        {consoleOn && <ConsoleWeather />}
      </div>

      {props.transparency && (
        <div
          role="tablist"
          aria-label={t("tabs.label")}
          className="flex gap-2"
          data-console-area="tabs"
        >
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
          <div className="flex flex-col gap-1" data-console-area="hazard">
            <p className="font-medium" id="hazard-label">
              {t("hazard.label")}
            </p>
            <ul aria-labelledby="hazard-label" className="flex flex-wrap gap-2">
              {hazards.map((h) => (
                <li
                  key={h.code}
                  className={h.code === hazard.code || moreHazards ? undefined : "max-lg:hidden"}
                >
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
              {/*
               * Only flood is live for now, so on a phone or tablet the other four wait behind
               * one button that says what they are (the owner, 16 Oct); a laptop has the room
               * to show them all.
               */}
              {others.length > 0 && (
                <li className="lg:hidden">
                  <button
                    type="button"
                    aria-expanded={moreHazards}
                    data-more-hazards="true"
                    onClick={() => setMoreHazards((open) => !open)}
                    className={`${chipQuiet} ${chipOff} gap-1`}
                  >
                    {t(othersSoon ? "hazard.moreSoon" : "hazard.more", { count: others.length })}
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 20 20"
                      className={`size-5 transition-transform motion-reduce:transition-none ${moreHazards ? "rotate-180" : ""}`}
                    >
                      <path
                        d="M5 8l5 5 5-5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                </li>
              )}
            </ul>
            {props.hazardsState === "unavailable" && <p className={hint}>{t("hazard.failed")}</p>}
            {/*
             * The province goes on the hazard line (the owner, 16 Oct), which on the console is
             * inside the weather bar. It shares the row with the hazard buttons and wraps under
             * them when they leave no room - which they do in every language - so it comes to
             * rest at the start of its own line, directly under the word Hazard (the owner's
             * second note: same row level, aligned left).
             *
             * It stays here, in the page's own order, so a phone and a tablet see it exactly where
             * they saw it: straight after the hazard buttons. `mt-3` makes up the difference
             * between this row's gap and the gap it used to have as the next block down.
             */}
            {hazard.status === "active" && (
              <div data-console-province="true" className="mt-3 console:mt-0">
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
              </div>
            )}
          </div>

          {hazard.status !== "active" ? (
            <HazardPlaceholder hazard={hazard} />
          ) : (
            <>
              {/* The four readouts across the top of the console; nothing at all on a phone. */}
              <ConsoleTiles
                status={status}
                alerts={alerts.map(({ alert }) => alert)}
                fresh={fresh}
                failed={failed}
                gauges={data?.gauges ?? null}
                dams={dams}
                reports={props.reports ?? null}
                scope={scopeWord}
                now={now}
                time={time}
                locale={locale}
                admin={isAdminRoleName(props.me?.signedIn ? props.me.role : null)}
                monitoring={monitoringSummary}
                monitoringOpen={monitoringOpen}
                onToggleMonitoring={() => setMonitoringOpen((was) => !was)}
              />

              {/* The hazard comes first, then the province, then what the map shows for it (owner,
                  15 Oct). On the console the same four are the left rail. */}
              <div className="contents" data-console-area="rail" data-console-rail="true">
                {/* The sea's own report, for fishermen, right under the chips while the sea is
                    shown (the owner, 15 Oct: the switches under the map are gone, the chips do
                    that). */}
                <MapFeatureChips
                  on={featuresOn}
                  onToggle={toggleFeature}
                  after={
                    showSea ? (
                      <button
                        type="button"
                        data-open-sea="true"
                        onClick={() => {
                          setSelection({ kind: "sea", id: nearestCoast(props.area) });
                          revealPanel();
                        }}
                        className={`${buttonQuiet} justify-between self-start text-start`}
                      >
                        <SeaGradeIcon grade="calm" size={24} />
                        {tSea("open")}
                        <span aria-hidden="true">→</span>
                      </button>
                    ) : undefined
                  }
                />
                <MapMethod />
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
              </div>

              {/*
               * The map, with the notices that belong to the person's own area above it: on the
               * console this is the middle column, and the map takes whatever height is left.
               */}
              <div className="contents" data-console-area="map">
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
                <div
                  className={`relative isolate ${tourIndex !== null ? "[&_.maplibregl-ctrl-top-right]:top-16!" : ""}`}
                  data-map-frame="true"
                >
                  {tourIndex !== null && mine.length > 0 ? (
                    <div
                      role="group"
                      aria-label={t("zoomMine")}
                      data-tour={mine[tourIndex]!.id}
                      className="absolute inset-x-2 top-2 z-10 flex items-center gap-1 rounded-lg border border-jaga-line bg-jaga-surface p-1 shadow-sm"
                    >
                      <button
                        type="button"
                        data-tour-step="back"
                        aria-label={t("tour.prev")}
                        onClick={() => tourTo(tourIndex - 1)}
                        className="grid min-h-tap min-w-12 shrink-0 place-items-center rounded-md text-jaga-ink"
                      >
                        <ChevronIcon next={false} />
                      </button>
                      <select
                        data-tour-pick="true"
                        aria-label={t("tour.pick")}
                        value={tourIndex}
                        onChange={(event) => tourTo(Number(event.target.value))}
                        className="min-h-tap min-w-0 flex-1 truncate rounded-md border border-jaga-line bg-jaga-surface px-2 text-small font-bold text-jaga-ink"
                      >
                        {mine.map((place, index) => (
                          <option key={place.id} value={index}>
                            {t("tour.option", {
                              n: index + 1,
                              total: mine.length,
                              name: place.label,
                            })}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        data-tour-step="next"
                        aria-label={t("tour.next")}
                        onClick={() => tourTo(tourIndex + 1)}
                        className="grid min-h-tap min-w-12 shrink-0 place-items-center rounded-md text-jaga-ink"
                      >
                        <ChevronIcon next />
                      </button>
                      <button
                        type="button"
                        data-tour-reset="true"
                        aria-label={t("tour.resetLabel")}
                        title={t("tour.resetLabel")}
                        onClick={tourReset}
                        className="inline-flex min-h-tap min-w-12 shrink-0 items-center justify-center gap-1 rounded-md px-2 text-small font-bold text-jaga-ink"
                      >
                        <ResetIcon />
                        <span className="hidden sm:inline">{t("tour.reset")}</span>
                      </button>
                    </div>
                  ) : (
                    <div className="absolute start-2 top-2 z-10 flex flex-wrap gap-2 pe-12">
                      <button
                        type="button"
                        data-zoom-all="true"
                        onClick={() =>
                          setFocus((was) => ({ box: SERVICE_BOUNDS, key: (was?.key ?? 0) + 1 }))
                        }
                        className={mapButton}
                      >
                        <ZoomOutIcon />
                        {t("zoomAll")}
                      </button>
                      {myBox && (
                        <button
                          type="button"
                          data-zoom-mine="true"
                          onClick={() => {
                            // A tour of their own places; with none saved, the chosen area as before.
                            if (mine.length > 0) {
                              tourTo(0);
                              return;
                            }
                            setShowMine(true);
                            setFocus((was) => ({ box: myBox, key: (was?.key ?? 0) + 1 }));
                          }}
                          className={mapButton}
                        >
                          <HomePinIcon />
                          {t("zoomMine")}
                        </button>
                      )}
                    </div>
                  )}
                  {/*
                   * 2D or 3D, on the map itself (the owner, 15 Oct): at the start of its bottom
                   * edge, clear of the zoom buttons and the credits.
                   */}
                  <div
                    role="group"
                    aria-label={t("scene.label")}
                    data-scene-switch={scene ? "3d" : "2d"}
                    className="absolute bottom-2 start-2 z-10 flex overflow-hidden rounded-lg border border-jaga-line bg-jaga-surface shadow-sm"
                  >
                    {([false, true] as const).map((on) => (
                      <button
                        key={String(on)}
                        type="button"
                        data-scene-choice={on ? "3d" : "2d"}
                        aria-pressed={scene === on}
                        onClick={() => setScene(on)}
                        className={`min-h-tap min-w-12 px-3 text-small font-bold ${
                          scene === on ? "bg-jaga-slate text-white" : "text-jaga-ink"
                        }`}
                      >
                        {t(on ? "scene.threeD" : "scene.flat")}
                      </button>
                    ))}
                  </div>
                  <MapView
                    layers={mapLayers}
                    showDam={showDam}
                    showDamZone={showDamZone}
                    status={fresh ? status : null}
                    data={data}
                    now={now}
                    bounds={focus?.box ?? askedBox ?? mapBounds}
                    boundsKey={focus?.key ?? (askedBox ? 1 : 0)}
                    onSelect={setSelection}
                    text={{ loading: t("loading"), failed: t("failed") }}
                    gaugeWords={{ near: t("gauge.nearShort"), over: t("gauge.overShort") }}
                    peek={renderPeek}
                    mine={mine}
                    showMine={showMine}
                    dams={dams}
                    hazardUrl={props.hazardTiles ?? null}
                    sea={seaMarks}
                    satellite={
                      props.satelliteDays && props.satellite?.days === props.satelliteDays
                        ? props.satellite.features
                        : null
                    }
                    basemap={basemap}
                    scene={scene}
                    fill
                    damText={{
                      spillway: tDam("mark.spillway"),
                      outlet: tDam("mark.outlet"),
                      locale,
                    }}
                  />
                </div>
              </div>

              {/*
               * Everything from here down is the console's right-hand rail, in the order the page
               * has always had it: what is drawn on the map, then what a tap selected, then the
               * legend and the alerts in force.
               *
               * The switches sit at the top of the rail rather than on a shelf under the map. A
               * shelf cost the map 140 px, and a laptop screen is only about 790 px tall inside
               * the browser - the map is the one thing here that must not be squeezed.
               */}
              <div className="contents" data-console-area="side" data-console-rail="true">
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
                  {scene && (
                    <p className={hint} data-scene-note="true">
                      {t("scene.note", { times: SCENE_EXAGGERATION })}
                    </p>
                  )}
                  {isPhotoBasemap(basemap) && (
                    <p className={hint} data-satellite-note={satellite}>
                      {t(
                        satellite === "esri"
                          ? "basemap.satelliteNoteEsri"
                          : "basemap.satelliteNote",
                      )}
                    </p>
                  )}
                </fieldset>
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
                {/* A visitor learns their family's places could be pinned here (the owner, 15 Oct). */}
                {!props.me?.signedIn && <SignInHint what="mapPlaces" />}
                <p className={hint}>{t("tapHint")}</p>
                {props.dataState === "unavailable" && (
                  <p role="status" className={notice}>
                    {t("dataFailed")}
                  </p>
                )}

                {/* A tap on the map is answered here: revealPanel scrolls the rail to the card. */}
                {selected && (
                  <div
                    className="flex flex-col gap-2 outline-none"
                    data-selected-panel="true"
                    tabIndex={-1}
                  >
                    {selected}
                    <button
                      type="button"
                      onClick={() => setSelection(null)}
                      className="inline-flex min-h-tap items-center gap-1.5 self-start underline"
                    >
                      <CrossIcon size={20} />
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
                            <MineGlyph home={place.home} color={place.color} />
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

                {/*
                 * The live monitoring, under the map legend on a phone and a tablet (the owner,
                 * 17 Oct 2026). On a laptop the same status is the console's fifth readout and
                 * its detail opens in the band under the dashboard, so this copy is hidden
                 * there - the pattern the dam's figures on the home screen already use, because
                 * one element cannot be in two columns of a grid at once.
                 */}
                <div className="contents console:hidden" data-monitoring-here="side">
                  <MonitoringCard
                    summary={monitoringSummary}
                    time={time}
                    open={monitoringOpen}
                    onToggle={() => setMonitoringOpen((was) => !was)}
                    detail={monitoringDetail}
                    place="map"
                  />
                </div>

                {dams.length > 0 && (
                  <section className={card} data-dam-legend="true">
                    <p className="font-medium">{tDam("path.title")}</p>
                    {/* The marks mean the same on every reservoir, so they are explained once. */}
                    <ul className="flex flex-col gap-1">
                      <DamLegendKeys />
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
                          // The card opens above the legend, so the page has to go to it.
                          revealPanel();
                        }}
                        className={`${buttonQuiet} w-full justify-between text-start`}
                      >
                        <DamLegendRow dam={dam} />
                        <WaveIcon size={20} aria-hidden="true" />
                        <span className="sr-only">
                          {tDam("legend.open", { dam: localName(dam.name, locale) })}
                        </span>
                      </button>
                    ))}
                  </section>
                )}

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
              </div>

              {/*
               * The band under the dashboard (the owner, 17 Oct 2026: the fifth readout "should
               * open up the lower section under the Dashboard to show the details"). A laptop
               * only: below the breakpoint the card under the legend holds the same detail, and
               * this copy is not drawn at all.
               *
               * It is the last row of the console's grid and spans every column, so opening it
               * lets the page grow and scroll rather than taking the height off the map.
               */}
              {monitoringOpen && (
                <div
                  className="hidden console:block"
                  data-console-area="detail"
                  id="monitoring-detail-map"
                >
                  <div className={`${card} console:max-w-none`}>{monitoringDetail}</div>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
