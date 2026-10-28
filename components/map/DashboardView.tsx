"use client";

import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { PanelIcon } from "@/components/icons";
import { areaLabels } from "@/lib/area-labels";
import { AlertBadge } from "@/components/alerts/AlertBadge";
import { AlertStatus } from "@/components/alerts/AlertStatus";
import { AlertHero } from "@/components/home/AlertHero";
import { heroStatusFor, NORMAL_NEEDS_CHECK_WITHIN_MS } from "@/components/home/HomeView";
import { PlaceStatus } from "@/components/home/WatchedPlaces";
import { SafePlaceCard } from "@/components/places/SafePlaceCard";
import { HAZARD_CLASSES, hazardColor, hazardKey } from "@/lib/hazard-layer";
import { riverColor } from "@/lib/river-layer";
import {
  BASEMAPS,
  isPhotoBasemap,
  SCENE_EXAGGERATION,
  satelliteProvider,
  subscribeSatellite,
  type Basemap,
} from "@/lib/map";
import { HOUSE } from "@/lib/place-icons";
import {
  BackIcon,
  CrossIcon,
  DropIcon,
  FullScreenIcon,
  HouseIcon,
  LayersIcon,
  PhoneIcon,
  PinIcon,
  WaveIcon,
} from "@/components/icons";
import { BackToMap } from "@/components/map/BackToMap";
import { ProvinceSelect } from "@/components/ProvinceSelect";
import { LAPTOP_QUERY, useConsoleView, useLaptopView } from "@/lib/console-view";
import { useStored, writeStored } from "@/lib/phone-store";
import { DamMetersPanel, MeterIcon } from "@/components/map/DamMeters";
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
import { handBack, reveal } from "@/lib/reveal";
import { damFrame, onPath, type Dam } from "@/lib/dam";
import { damRainCode, reservoirCentre } from "@/lib/dam-map";
import { ReportsNear } from "@/components/reports/ReportsNear";
import { reportsNearMe, type TambonReports } from "@/lib/flood-reports";
import { layersFor, type Hazard, type MapLayer, type MapMode } from "@/lib/hazards";
import {
  boundsAround,
  COVERAGE_COLOR,
  nightNow,
  PROVINCE_BOUNDS,
  provincesBox,
  SERVICE_BOUNDS,
} from "@/lib/map";
import type { MapData } from "@/lib/map-data";
import type { MyPlaces } from "@/lib/me";
import { homeColor, mineColor } from "@/lib/mine-colors";
import {
  damRun,
  damsLit,
  gaugeRun,
  gaugesLit,
  levelTally,
  type DamContext,
} from "@/lib/map-console";
import { localName } from "@/lib/places";
import { isAdminRoleName } from "@/lib/roles";
import { damReleaseAt, hasActiveAlerts, type PublicStatus } from "@/lib/public-status";
import { BANGKOK_DATE_TIME } from "@/lib/time";
import { buttonQuiet, buttonSecondary, card, hint, notice } from "@/lib/ui";
import type { LoadState } from "@/lib/use-public";
import { ConsoleSky, ConsoleWeather } from "./ConsoleSky";
import { ConsoleTiles } from "./ConsoleTiles";
import { OrbitGlobe } from "./OrbitGlobe";
import { HazardPlaceholder } from "./HazardPlaceholder";
import { SatelliteFloodPanel } from "./SatelliteFlood";
import { isGap, type CoverageRow } from "@/lib/coverage";
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
  type CoastId,
  type SeaData,
} from "@/lib/sea";
import { MineGlyph } from "./MineGlyph";
import { GaugeGlyph, LiveDot } from "./GaugeGlyph";
import { MapFeatureChips } from "./MapFeatures";
import { InstallCard } from "@/components/InstallCard";
import { TeamEntryChip } from "@/components/authority/TeamEntry";
import { MapJoin } from "@/components/map/MapJoin";
import { CardSteps } from "./CardSteps";
import { MapMethod } from "./MapMethod";
import {
  GAUGE_SPAN,
  MAIN_DAM,
  mainDam,
  reservoirBox,
  reservoirFrame,
  RESERVOIR_MARGIN,
  RESERVOIR_SPAN,
  satelliteBox,
  zoneFrame,
  type MapFocus,
} from "@/lib/map-focus";
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
  /** The `pmtiles://` address of the river body (pipeline/rivers); null while there is none. */
  riverTiles?: string | null;
  /**
   * The responsibility map (spec 2, 9): per-tambon team coverage, the same rows the authority
   * console reads. Given only when the viewer is a verified authority or admin (safety rule 5);
   * null or empty means no switch is shown, so visitors and ordinary users never see it.
   */
  coverage?: CoverageRow[] | null;
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

/** The mark on a pill that opens a chooser under it: pointing down shut, up while it is open. */
function ChevronDown({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      className={`size-5 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
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
  );
}

/**
 * A block that explains the map: a plain card on the console, where there is room for it beside
 * the map, and a folded one on a phone, where the same two blocks stood 1,708 px tall under it
 * (the owner, 20 Oct, option C). Folded, never cut: everything inside is one tap away, which is
 * what safety rule 3 asks of anything a colour means.
 */
function Fold({
  fold,
  title,
  heading = false,
  mark,
  children,
}: {
  fold: boolean;
  title: ReactNode;
  /** The map's key is a section of the page and keeps its heading; the dam's is a caption. */
  heading?: boolean;
  mark: Record<string, string>;
  children: ReactNode;
}) {
  const words = heading ? "text-body font-bold" : "font-medium";
  const Title = heading ? "h2" : "p";
  if (!fold) {
    return (
      <section className={card} {...mark}>
        <Title className={words}>{title}</Title>
        {children}
      </section>
    );
  }
  return (
    <details className={card} {...mark}>
      <summary className="flex min-h-tap cursor-pointer items-center">
        <Title className={words}>{title}</Title>
      </summary>
      {children}
    </details>
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
  /*
   * The names of the districts and tambons for the map itself (the owner, 18 Oct): built from the
   * area list the page already fetched for the province picker, so a named map costs no request.
   */
  const areaNames = useMemo(
    () => (directory ? areaLabels(directory.tambons, locale) : null),
    [directory, locale],
  );
  const format = useFormatter();
  const time = (iso: string) => format.dateTime(new Date(iso), BANGKOK_DATE_TIME);

  /*
   * A laptop console, or a phone? The CSS decides what the page looks like; this is for the few
   * things CSS alone cannot do - which panels start folded, and whether a card has to be
   * scrolled to. False until the page has hydrated, so the server's markup is the phone's.
   */
  const onConsole = useConsoleView();

  const [tab, setTab] = useState<"map" | "transparency">("map");
  const [hazardCode, setHazardCode] = useState("flood");
  /*
   * The phone's way through the controls (the owner, 20 Oct, option C): the hazard and the
   * province, and the layer switches, each wait behind a pill above the map instead of standing
   * between the reader and it. One at a time, and nothing is remembered: a chooser is something
   * you open, use and leave.
   */
  const [phonePanel, setPhonePanel] = useState<"place" | "layers" | null>(null);
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
    // Something was asked about: the answer is in the right panel, so bring it back and leave it.
    if (next) setSideOpen(true);
  };
  // The reader's own pins - home and the watch places - are always drawn and cannot be switched
  // off (the owner, 28 Oct 2026: "turned on by default, cannot turn off"). There is no toggle for
  // them any more, so this is a constant rather than state.
  const showMine = true;
  /*
   * The right panel folded away, so the map has the room (the owner, 18 Oct 2026). Open when the
   * page opens: what the panel holds is what a tap on the map answers with, and someone who has
   * not folded it away yet should not have to find it. Resting the pointer on the folded strip
   * brings it back for a moment (app/globals.css); a tap on the map opens it for good, below.
   */
  const [sideOpen, setSideOpen] = useState(true);
  /*
   * Whether resting the pointer on the folded strip brings the panel back. It is off from the
   * moment the panel is folded until the pointer has left it once: the button that folds it is
   * the strip, so without this, folding the panel left it standing open under the pointer and
   * looked as though the button had done nothing.
   */
  const [sidePeek, setSidePeek] = useState(true);
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
  // The river body (pipeline/rivers) starts off: it is context, "where water normally sits", and
  // the map should open calm. The owner can turn it on from its chip, and a home tile that opens
  // "?focus=river" turns it on. Offered only once the tiles are published (riverOnOffer).
  const [showRiver, setShowRiver] = useState(props.openFocus === "river");
  // The sea's waves along the coast start on (the owner, 15 Oct 2026), and can be switched off.
  const [showSea, setShowSea] = useState(true);
  /*
   * The background follows the time of day (the owner, 15 Oct): Satellite + terrain by day,
   * Terrain at night. A background the person picks stays until day turns to night or back; the
   * picture then changes with it.
   *
   * The time of day, and nothing else (the owner, 20 Oct 2026): somebody who picks the dark
   * theme at noon reads a dark app over their district in daylight, and the map turns to the
   * night terrain when the sun actually sets. `nightNow` is the sun, not the theme (lib/map.ts).
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
   * The pins take their light colours once the sun is down (the owner, 10 Oct: their own pin was
   * too dark to see on the night map). `now` moves on every 30 s, so the colours change over
   * with the background; on the server it is 0 and the day colours are used, which is what the
   * first paint in the browser draws too.
   */
  const dark = props.now > 0 && nightNow();
  const basemap: Basemap =
    basemapChoice && basemapChoice.night === dark
      ? basemapChoice.kind
      : dark
        ? "terrain"
        : "satelliteTerrain";
  const setBasemapChoice = (kind: Basemap) => setBasemapPicked({ kind, night: dark });
  /** The choice of basemap, written once: the panel shows it, and so does the map's own picker. */
  const basemapButtons = (
    <div className="flex flex-wrap gap-2">
      {BASEMAPS.map((kind) => (
        <button
          key={kind}
          type="button"
          data-basemap-choice={kind}
          aria-pressed={basemap === kind}
          onClick={() => {
            setBasemapChoice(kind);
            setBasemapOpen(false);
          }}
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
  );

  /*
   * The person's own places on the map (spec 4.9, the owner's request on 8 Oct): their home and
   * the places they watch. This comes from their own session and is drawn only in their browser;
   * it is in no public answer. A place pinned outside the covered tambons has no area and is
   * left out, because the map covers only the four provinces.
   */
  const saved: MinePlace[] = !props.me?.signedIn
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
  /*
   * The place chosen on this device (the home screen's box, the list or the GPS) gets its pin too
   * (the owner, 25 Oct 2026: a university found by name left no pin for someone without a saved
   * place). It is kept on the phone, so it needs no account; a saved place at the same spot
   * already has its own pin and is not doubled.
   */
  const chosenArea = props.area;
  const mine: MinePlace[] =
    chosenArea &&
    !saved.some(
      (p) => Math.abs(p.lat - chosenArea.lat) < 0.0005 && Math.abs(p.lon - chosenArea.lon) < 0.0005,
    )
      ? [
          ...saved,
          {
            id: "chosen",
            label: t("mine.chosen"),
            lat: chosenArea.lat,
            lon: chosenArea.lon,
            home: true,
            color: homeColor(dark),
            lines: [areaName(locale, chosenArea)],
            call: null,
          },
        ]
      : saved;

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
  // The river body is a context layer on its own chip, not tied to the view's layers: it is on
  // offer whenever its tiles are published, and the chip is hidden until then.
  const riverOnOffer = !!props.riverTiles;
  // The map is dark at night except on the satellite picture; the legend shows the shades in use.
  const nightMap = dark && !isPhotoBasemap(basemap);
  // The newest gauge reading, for the legend's "live" line.
  const newestGauge = (data?.gauges ?? []).reduce<string | null>(
    (best, g) => (g.observedAt && (!best || g.observedAt > best) ? g.observedAt : best),
    null,
  );
  const mapLayers: MapLayer[] = [
    ...layers.filter(
      (l) =>
        (l !== "places" || showPlaces) &&
        (l !== "gauges" || showGauges) &&
        (l !== "hazard" || showHazard || !hazardOnOffer),
    ),
    // The river body rides on its own chip, the same in either view, so it is added here rather
    // than coming from layersFor.
    ...(showRiver && riverOnOffer ? (["river"] as const) : []),
  ];
  const drawn = mapLayers.filter((l) => l !== "alerts" && !pending.includes(l));

  /*
   * The responsibility map (spec 2, 9): the tambons a verified team covers, on its own switch,
   * off to begin with. Offered only when the server returned coverage, which it does only for a
   * verified authority or admin (safety rule 5), so the switch is simply absent for everyone else.
   */
  const [coverageOn, setCoverageOn] = useState(false);
  const coverageOffered = (props.coverage?.length ?? 0) > 0;
  const coverageCovered = useMemo(
    () => (props.coverage ?? []).filter((r) => !isGap(r)).map((r) => r.tambon),
    [props.coverage],
  );
  const coverageGaps = useMemo(
    () => (props.coverage ?? []).filter(isGap).map((r) => r.tambon),
    [props.coverage],
  );
  const coverageMine = useMemo(
    () => (props.coverage ?? []).filter((r) => r.mine).map((r) => r.tambon),
    [props.coverage],
  );

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
  /*
   * Bring the selected card into the frame. The how of it - the frozen header's own height, a
   * rail that scrolls by itself on the console, and holding the card in place while it fills -
   * lives in lib/reveal.ts, because the live monitoring's detail needs exactly the same thing
   * (the owner, 17 Oct) and two copies of it would drift apart.
   */
  const revealPanel = () => {
    /*
     * On a phone the card opens under the map, which gives up height for it, so the thing to
     * bring back is the map and not the card: putting the card's own top under the header -
     * what every other caller of reveal wants - would push the 215 px of map above it clean off
     * the screen, to show a card that was already on it. The card still takes the keyboard, so
     * a screen reader is moved to the answer either way.
     */
    if (!onConsole) {
      reveal(() => document.querySelector<HTMLElement>("[data-map-frame]"), {
        mark: false,
        focus: false,
      });
      // After the card has been drawn: this runs from the press that asks for it.
      window.setTimeout(
        () =>
          document
            .querySelector<HTMLElement>("[data-selected-panel]")
            ?.focus({ preventScroll: true }),
        0,
      );
      return;
    }
    reveal(() => document.querySelector<HTMLElement>("[data-selected-panel]"));
  };
  /*
   * The buttons that open each reservoir's figures (the owner, 18 Oct 2026): pressing the one in
   * the live monitoring brings the panel to them, rather than leaving the reader to hunt for the
   * row they were just reading about.
   */
  const revealDamButtons = () =>
    reveal(() => document.querySelector<HTMLElement>("[data-dam-legend]"));
  /*
   * Where the map was before a readout moved it, so closing the card it opened puts the map back
   * (the owner, 20 Oct 2026: "like the GISTDA details, when clicked on close button should bring
   * the map to the default extent"). The same arrangement the satellite layer has: the frame
   * remembered is the one actually on the screen, and only the first move remembers it, so
   * stepping through three stations still comes back to where the reader started.
   */
  const focusBack = useRef<[number, number, number, number] | null>(null);
  /*
   * The right panel's scrollbar gutter, measured and written to --side-gutter, so the fold button
   * in its corner can be pulled flush over it (the owner, 29 Oct 2026: "merge boundary with the
   * larger right panel"). A thin scrollbar is a different width on each browser, and zero where
   * scrollbars overlay, so this is measured rather than guessed; it is re-measured whenever the
   * panel resizes. On a phone the panel is `display: contents` and has no gutter, which reads as 0.
   */
  const sideRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sideRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const gutter = el.offsetWidth - el.clientWidth;
      el.style.setProperty("--side-gutter", `${gutter}px`);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  /** Where the map is looking now, told by MapView after every move the reader or the app makes. */
  const viewBox = useRef<[number, number, number, number] | null>(null);
  const rememberView = (box: [number, number, number, number]) => {
    viewBox.current = box;
  };
  const rememberFrame = () => {
    if (!focusBack.current) {
      focusBack.current = viewBox.current ?? focus?.box ?? askedBox ?? mapBounds ?? SERVICE_BOUNDS;
    }
  };
  /*
   * Closing a card that moved the map puts the map back where it was, and closing one that did
   * not leaves it alone - a reader who tapped a tambon is not sent travelling by a close button.
   */
  const closeSelected = () => {
    setSelection(null);
    const back = focusBack.current;
    focusBack.current = null;
    if (back) setFocus((was) => ({ box: back, key: (was?.key ?? 0) + 1 }));
  };
  /** What the map is lighting up - reservoirs or gauges - and how often it has been asked. */
  const [flashDam, setFlashDam] = useState<{
    kind: "reservoir" | "gauge" | "sea";
    codes: string[];
    key: number;
    at?: { lon: number; lat: number } | null;
  } | null>(null);
  /*
   * The order both readouts walk through, and the marks a press on one lights (lib/map-console.ts).
   *
   * Their own places first for the rivers: the places they watch, or the area chosen on this
   * device for somebody who watches none. It only breaks a tie now - since 20 Oct a river at or
   * near its bank comes first however far away it is, because that is what the readout counts.
   */
  /*
   * "My places" as points (the owner, 14 Oct): the person's home and the places they watch, or,
   * for someone with neither, the area chosen on this device. The map frames these for "my
   * places", and the rivers' readout reads them to break a tie between two stations.
   */
  const myPoints = [
    ...mine.map((place) => ({ lat: place.lat, lon: place.lon })),
    ...(mine.length === 0 && props.area ? [{ lat: props.area.lat, lon: props.area.lon }] : []),
  ];
  const gaugeOrder = gaugeRun(data?.gauges ?? [], myPoints);
  /*
   * Which reservoirs are theirs: the ones whose release path reaches their own area or a place
   * they watch (the same test the quiet dam notice uses). The reservoirs' readout names one only
   * when it is theirs and doing something, and opens theirs first (the owner, 23 Oct 2026); and,
   * with nothing wrong, lists them nearest first, or the largest first for someone who has
   * chosen no place.
   */
  const damContext: DamContext = {
    onPath: new Set(damsOnMyPath.map((x) => x.dam.code)),
    places: myPoints,
  };
  const damOrder = damRun(dams, damContext);
  /*
   * Opening one or more reservoirs: the card with the first one's figures, the map framed on
   * every lake being pointed at - closer than the dam's own view, and with the water in the
   * middle - and those lakes lit three times, so it is clear which water is being talked about
   * (the owner, 18 Oct for one, 20 Oct for "the extents of the 3 not only one").
   */
  const lightDams = (open: Dam, lit: readonly Dam[], where: "panel" | "damButtons" | "stay") => {
    rememberFrame();
    setSelection({ kind: "dam", code: open.code });
    const box =
      lit.length === 1
        ? reservoirBox(lit[0]!)
        : boundsAround(
            lit.flatMap((dam) => reservoirFrame(dam)),
            { minSpan: RESERVOIR_SPAN, margin: RESERVOIR_MARGIN },
          );
    if (box) setFocus((was) => ({ box, key: (was?.key ?? 0) + 1 }));
    setFlashDam((was) => ({
      kind: "reservoir",
      codes: lit.map((dam) => dam.code),
      key: (was?.key ?? 0) + 1,
    }));
    if (where === "damButtons") revealDamButtons();
    else if (where === "panel") revealPanel();
  };
  /** One reservoir, from its own button in the legend or the live monitoring. */
  const openDam = (dam: Dam, where: "panel" | "damButtons" = "panel") =>
    lightDams(dam, [dam], where);
  /*
   * The dam readout opens what is worth watching, not only the dam it reports (the owner,
   * 20 Oct): every reservoir spilling or above the level it is normally held at, worst first and
   * at most three, and where none is, the one the readout names.
   */
  const openDams = () => {
    const lit = damsLit(damOrder);
    if (lit.length > 0) lightDams(lit[0]!, lit, "panel");
  };
  /*
   * The war room's meters (the owner, 23 Oct 2026). Pinned, they stay on the map while a card
   * opens beside them; unpinned, a card takes their place - they are the same spot, so one of
   * the two has to give way, and the reader who wanted both pinned them. The pin is the reader's
   * own and is remembered; closing the meters is also letting go of the pin, because a panel
   * that comes back by itself after being closed is not closed.
   */
  const toggleMetersPin = () => {
    if (metersPinned) writeStored("map.meters.pinned", null);
    else {
      writeStored("map.meters.pinned", true);
      setMetersOpen(true);
    }
  };
  const closeMeters = () => {
    setMetersOpen(false);
    writeStored("map.meters.pinned", null);
  };
  const openFromMeter = (dam: Dam) => {
    if (!metersPinned) setMetersOpen(false);
    openDam(dam);
    revealPanel();
  };
  /*
   * The rivers' readout opens the stations that matter, the way the reservoirs' card opens (the
   * owner, 18 Oct: "apply for river gauges as well"; 20 Oct: the worst three together). Which
   * stations those are is worked out in lib/map-console.ts and is the same every time for the
   * same readings, so a second press never lands somewhere else. The stations are switched on if
   * they were off: opening the card for a mark that is not drawn would point at nothing.
   */
  const lightGauges = (
    open: { id: string },
    lit: readonly { id: string; lon: number; lat: number }[],
    where: "panel" | "stay",
  ) => {
    rememberFrame();
    setShowGauges(true);
    setSelection({ kind: "gauge", id: open.id });
    const box = boundsAround(
      lit.map((gauge) => ({ lon: gauge.lon, lat: gauge.lat })),
      { minSpan: GAUGE_SPAN, margin: RESERVOIR_MARGIN },
    );
    if (box) setFocus((was) => ({ box, key: (was?.key ?? 0) + 1 }));
    setFlashDam((was) => ({
      kind: "gauge",
      codes: lit.map((gauge) => gauge.id),
      key: (was?.key ?? 0) + 1,
      at: lit[0] ? { lon: lit[0].lon, lat: lit[0].lat } : null,
    }));
    if (where === "panel") revealPanel();
  };
  const openGauges = () => {
    const lit = gaugesLit(gaugeOrder);
    if (lit.length > 0) lightGauges(lit[0]!, lit, "panel");
  };
  /*
   * Previous and next, from inside the card that is already open (the owner, 20 Oct). One at a
   * time, framed and lit on its own: the reader has left the group they were shown and is now
   * reading stations one by one. The panel is not scrolled to again - they are looking at it.
   */
  const stepGauge = (id: string) => {
    const gauge = gaugeOrder.find((g) => g.id === id);
    if (gauge) lightGauges(gauge, [gauge], "stay");
  };
  const stepDam = (code: string) => {
    const dam = damOrder.find((d) => d.code === code);
    if (dam) lightDams(dam, [dam], "stay");
  };
  /*
   * Choosing a point off the coast (the owner, 18 Oct: clicking these "should highlight the
   * points of the tide measurement that was clicked"). The map lights that point the way it
   * lights a reservoir or a station, and brings it into the frame only if it is not already in
   * it - the reader is reading the card, not asking for the map to be moved.
   */
  const openSea = (id: CoastId) => {
    setSelection({ kind: "sea", id });
    const point = (props.sea?.points ?? []).find((p) => p.id === id);
    setFlashDam((was) => ({
      kind: "sea",
      codes: [id],
      key: (was?.key ?? 0) + 1,
      at: point ? { lon: point.lon, lat: point.lat } : null,
    }));
  };

  /*
   * The map on its own, filling the screen (the owner, 18 Oct 2026). Only on the laptop console:
   * a phone's map is already the width of the screen, and the console is the thing being stepped
   * out of. What is left is the map, the pickers for what is drawn on it, and the way back.
   *
   * The hotline bar is never covered, whatever this does - it stays above the map and keeps its
   * place at the foot of the screen (safety rule 4: the numbers are always one tap away).
   */
  const [full, setFull] = useState(false);
  const [basemapOpen, setBasemapOpen] = useState(false);
  /*
   * The reservoir meters, which only the full-screen laptop map has (the owner, 23 Oct 2026: "I
   * intend to make full screen as war room for users who use laptop"). `metersOpen` is for this
   * visit to full screen; the pin is the reader's own and is kept on the laptop, so a war room
   * that was pinned is a war room the next time full screen opens.
   */
  const laptop = useLaptopView();
  const [metersOpen, setMetersOpen] = useState(false);
  const [damChoice, setDamChoice] = useState(false);
  const metersPinned = useStored<boolean>("map.meters.pinned") === true;
  /*
   * Whether the laptop hazard-and-province pickers are open (the owner, 28 Oct 2026: "Always show
   * the summary cards but hide the province and Hazards button"). Unset means folded, so a laptop
   * opens with the two pickers away and the map larger; the summary strip is always shown, and the
   * pickers stay put everywhere else (full screen, tablet, phone). The choice is kept per browser.
   */
  const filtersOpen = useStored<boolean>("map.filters.open") === true;
  /*
   * The hazard-and-province fold switch, written once and placed by language (the owner, 28 Oct
   * 2026). In most languages it sits up on the head row, by the weather; in Malay the head is too
   * wide for it, so it sits at the left of the hazard bar and the pickers open to its right on the
   * same row ("for Malay ... bring the button to the left and when clicked, the hidden buttons
   * appear on the same row"). Laptop only; `extra` carries the placement classes.
   */
  const renderFoldSwitch = (extra: string) =>
    laptop ? (
      <button
        type="button"
        data-filters-toggle={filtersOpen ? "open" : "shut"}
        aria-expanded={filtersOpen}
        aria-controls="map-filters"
        onClick={() => writeStored("map.filters.open", !filtersOpen)}
        className={`${chipQuiet} ${chipOff} ${extra}`}
      >
        {t(filtersOpen ? "console.filtersHide" : "console.filtersShow")}
        <ChevronDown open={filtersOpen} />
      </button>
    ) : null;
  const leaveFull = () => {
    setFull(false);
    setMetersOpen(false);
    setDamChoice(false);
  };

  /*
   * Stepping in and out of the full-screen map. Three things have to happen, and none of them
   * can be said in CSS:
   *
   * - The map's box changes size, and MapLibre only notices when the window says so.
   * - The hotline bar is left above the map (safety rule 4), so the map is held clear of it by
   *   exactly its height, measured rather than guessed - it is two lines in Thai and one in
   *   English, and taller again if a phone's text is enlarged.
   * - Escape comes back out, as it does from anything that fills the screen.
   */
  useEffect(() => {
    const measure = () => {
      const bar = document.querySelector("footer")?.getBoundingClientRect().height ?? 0;
      document.documentElement.style.setProperty("--jaga-hotlines", `${Math.round(bar)}px`);
      /*
       * And the header, for the same reason and in the same breath (20 Oct): on a phone the
       * map is given exactly the room those two leave, and both are taller in Thai than in
       * English - 156 px and 93 px of a 640 px screen on the smallest phone we design for.
       */
      const top = document.querySelector("header")?.getBoundingClientRect().height ?? 0;
      document.documentElement.style.setProperty("--jaga-header", `${Math.round(top)}px`);
    };
    measure();
    const drawn = window.setTimeout(() => window.dispatchEvent(new Event("resize")), 60);
    if (!full) return () => window.clearTimeout(drawn);
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      /*
       * While the map is on its own, what a tap opened is a dialog over the map (app/globals.css),
       * so Escape shuts that first and only then leaves the full screen - the order anything
       * layered is expected to come apart in.
       */
      if (selection) {
        // The same two steps as the panel's own close button, written out so this effect does
        // not depend on a function that is new on every render.
        setSelection(null);
        const back = focusBack.current;
        focusBack.current = null;
        if (back) setFocus((was) => ({ box: back, key: (was?.key ?? 0) + 1 }));
        return;
      }
      setFull(false);
      setMetersOpen(false);
      setDamChoice(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", measure);
    return () => {
      window.clearTimeout(drawn);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", measure);
    };
  }, [full, selection]);
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

  /**
   * What a rain cloud stands over: one of the person's own places, or a dam's reservoir, whose
   * cloud carries the dam's code in its id (lib/dam-map.ts). The name is the one already shown
   * on the map, so the pop-up and the card say the same word as the label underneath.
   */
  const rainSpot = (
    id: string,
  ): { name: string; lat: number; lon: number; reservoir: boolean } | null => {
    const code = damRainCode(id);
    if (code !== null) {
      const dam = dams.find((d) => d.code === code);
      const at = dam ? reservoirCentre(dam.reservoir) : null;
      const point =
        at ??
        (dam?.point ? { lat: dam.point.coordinates[1], lon: dam.point.coordinates[0] } : null);
      return dam && point
        ? { name: localName(dam.name, locale), lat: point.lat, lon: point.lon, reservoir: true }
        : null;
    }
    const place = mine.find((m) => m.id === id);
    return place ? { name: place.label, lat: place.lat, lon: place.lon, reservoir: false } : null;
  };

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
      const spot = rainSpot(target.id);
      return spot ? (
        <RainPeek name={spot.name} kind={target.rain} reservoir={spot.reservoir} onMore={more} />
      ) : null;
    }
    const dam = dams.find((d) => d.code === target.code);
    return dam ? <DamPeek dam={dam} time={time} onMore={more} /> : null;
  };

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
   * What the satellite saw, switched on and off (the owner, 20 Oct 2026). Asking for it is four
   * things, not one:
   *
   *   - the flood-risk classes come off, because the hexagons are drawn over them and two sets
   *     of coloured areas on top of each other cannot both be read;
   *   - the map travels to the hexagons, which may be anywhere in the four provinces - a layer
   *     switched on off the edge of the screen looks like a layer that did nothing;
   *   - they blink three times, so it is clear which shapes have just appeared (MapView);
   *   - and closing it puts both back: the frame the reader was looking at before they asked,
   *     and the risk classes if they were on.
   *
   * None of this changes what the layer says. It is a reading of satellite passes either way,
   * and the panel's own words carry that (safety rules 8 and 10).
   */
  const satelliteBack = useRef<{
    box: [number, number, number, number];
    hazard: boolean;
  } | null>(null);
  const [flashSatellite, setFlashSatellite] = useState(0);
  /** Which answer the map has already been brought to, so it travels once per answer. */
  const [framedAnswer, setFramedAnswer] = useState<string | null>(null);
  const restoreFromSatellite = () => {
    const back = satelliteBack.current;
    satelliteBack.current = null;
    setFramedAnswer(null);
    if (!back) return;
    setShowHazard(back.hazard);
    setFocus((was) => ({ box: back.box, key: (was?.key ?? 0) + 1 }));
  };
  /*
   * The switch, the window buttons and the panel's own close button all come through here. The
   * frame to come back to is the one the map is actually showing - the reader may have panned
   * since anything last framed it - and only the first switching-on remembers it, so changing
   * the window from 7 days to 30 does not overwrite where they started.
   */
  const onSatelliteDays = (days: SatelliteWindow | null) => {
    if (days !== null && (props.satelliteDays ?? null) === null) {
      satelliteBack.current = {
        box: viewBox.current ?? focus?.box ?? askedBox ?? mapBounds ?? SERVICE_BOUNDS,
        hazard: showHazard,
      };
    }
    if (days === null) restoreFromSatellite();
    props.onSatelliteDays?.(days);
  };
  /*
   * The answer arrives from GISTDA a moment after the switch, so the map is brought to it here
   * rather than in the handler. An answer with nothing in it moves nothing and hides nothing:
   * there is no flood on the map to look at, and the panel says in words that this is not an
   * all-clear.
   */
  const satelliteAnswer =
    props.satelliteDays &&
    props.satelliteLoad === "ok" &&
    props.satellite?.days === props.satelliteDays
      ? `${props.satellite.days}|${props.satellite.fetchedAt}`
      : null;
  const satelliteCells = props.satellite?.features;
  if (satelliteAnswer && framedAnswer !== satelliteAnswer) {
    /*
     * Done while rendering, not in an effect: this is React's own way of taking in something
     * that has changed outside (its "adjusting state when a prop changes"), and the map then
     * travels in the same paint as the hexagons appear in rather than one frame later.
     */
    setFramedAnswer(satelliteAnswer);
    const box = satelliteBox(satelliteCells);
    if (box) {
      setShowHazard(false);
      setFocus((was) => ({ box, key: (was?.key ?? 0) + 1 }));
      setFlashSatellite((was) => was + 1);
    }
  }
  /*
   * ...and the reader is brought to the map, unless they are already looking at it (the owner,
   * 22 Oct 2026, asking for the switch to move to the left: "it should bring the view to the map
   * for ipad").
   *
   * Only on a laptop is the switch beside the map: there the rail is the left-hand column and
   * both are on the screen together, so moving the window would be moving it for nothing. On a
   * tablet held sideways the rail is a full-width row **under** the map, and on a phone the
   * switch is among the explainers under it - so on both of those the map travels to the
   * hexagons and blinks three times somewhere the reader cannot see, which is the very thing the
   * travelling was added to prevent. The scroll is in an effect rather than in the render above
   * because it reads the laid-out page.
   */
  useEffect(() => {
    if (!flashSatellite) return;
    // Guarded the way lib/console-view guards it: jsdom has no matchMedia, and where the bands
    // cannot be told apart there is no laid-out page to scroll either.
    if (!window.matchMedia || window.matchMedia(LAPTOP_QUERY).matches) return;
    reveal(() => document.querySelector<HTMLElement>("[data-map-frame]"), {
      mark: false,
      focus: false,
    });
  }, [flashSatellite]);

  /*
   * "Back to the start" (the owner, 20 Oct 2026): the view the map opens on, and everything that
   * is drawn on it as it opens - the risk classes, the stations, the dam and its land, the sea;
   * the thousands of safe places off; what the satellite saw off; flat, not tilted; and the
   * background back to whatever the time of day says it should be. Nothing is remembered, so
   * this is the same map a reader would get by opening the page again.
   */
  const resetMap = () => {
    setShowHazard(true);
    setShowGauges(true);
    setShowDam(true);
    setShowDamZone(true);
    setShowSea(true);
    setShowPlaces(false);
    setScene(false);
    setBasemapPicked(null);
    setTourAt(null);
    setSelection(null);
    satelliteBack.current = null;
    focusBack.current = null;
    setFramedAnswer(null);
    if ((props.satelliteDays ?? null) !== null) props.onSatelliteDays?.(null);
    setFocus((was) => ({ box: mapBounds ?? SERVICE_BOUNDS, key: (was?.key ?? 0) + 1 }));
  };

  /*
   * The chips above the map (the owner, 15 Oct): switches, several on at once, and none moves the
   * map. The dam's chip, when it is switched on, also opens the dam's report below the map and
   * brings the page to it, as it always has.
   */
  const featuresOn: Record<MapFocus, boolean> = {
    risk: showHazard,
    river: showRiver,
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
    } else if (f === "river") {
      setShowRiver(next);
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
    // The pin is where the owner wanted the ask (20 Oct), so the card behind a pin asks and
    // the home screen's list does not.
    selected = place ? <SafePlaceCard place={place} userAgent={props.userAgent} canCheck /> : null;
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
      selection.id === "chosen"
        ? (props.area ?? null)
        : selection.id === "home"
          ? props.me?.signedIn
            ? props.me.home
            : null
          : ((props.me?.signedIn
              ? props.me.places.find((p) => p.id === selection.id)?.area
              : null) ?? null);
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
        steps={
          <CardSteps
            items={damOrder.map((d) => ({ id: d.code, name: localName(d.name, locale) }))}
            currentId={dam.code}
            onPick={stepDam}
            label={t("steps.dams")}
          />
        }
      />
    ) : null;
  } else if (selection?.kind === "rain") {
    /*
     * The rain over one of the person's own places, opened from its cloud's pop-up (15 Oct), or
     * over a dam's reservoir (21 Oct), where the same forecast answers a different question:
     * what is falling into the lake.
     */
    const spot = rainSpot(selection.id);
    selected = spot ? (
      <RainSection
        name={spot.name}
        lat={spot.lat}
        lon={spot.lon}
        kind={selection.rain}
        reservoir={spot.reservoir}
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
        onPoint={openSea}
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
        {/*
         * Through the other stations, in the order the readout opened on (the owner, 20 Oct).
         */}
        <CardSteps
          items={gaugeOrder.map((g) => ({ id: g.id, name: localName(g.name, locale) }))}
          currentId={gauge.id}
          onPick={stepGauge}
          label={t("steps.gauges")}
        />
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
        {gauge.sea && (
          <div data-gauge-sea={gauge.sea.state}>
            <p className="font-medium">
              {t(`gauge.sea.${gauge.sea.state}`, {
                from: gauge.sea.shutFrom ? time(gauge.sea.shutFrom) : "",
              })}
            </p>
            {gauge.sea.issuedAt && (
              <p className={hint}>{t("gauge.sea.at", { time: time(gauge.sea.issuedAt) })}</p>
            )}
            <p className={hint}>{t("gauge.sea.caveat")}</p>
          </div>
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
   * The same page below that breakpoint (the owner, 20 Oct: "phone map C"). A tester found the
   * map hard to see and hard to use, and the measurements agreed: 7.3 screens of page, the map
   * 384 px of it and not reached until 1.8 screens down, because the laptop console of 16 Oct
   * has nowhere to go on a phone but one block on top of another. So on a phone the map goes
   * first, the choosers wait behind two pills above it, and everything that explains the map
   * folds shut under it. Nothing is taken away; app/globals.css does the arranging.
   */
  const phoneMap = consoleOn && !onConsole;
  /** How many of the six layers are drawn, for the phone's layers pill. */
  const layersOn = Object.values(featuresOn).filter(Boolean).length;

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
  /*
   * Shutting it from inside the detail (the owner, 17 Oct 2026: the button in the card "should hide
   * the detail, and bring the view back to the main Dashboard view up at the top"). The detail is
   * a screenful or two by the time the charts have drawn, so closing it from down there would
   * otherwise leave the reader looking at whatever happened to be below the band.
   */
  const hideMonitoring = () => {
    setMonitoringOpen(false);
    handBack("[data-monitoring-open]");
    reveal(() => document.querySelector<HTMLElement>("[data-map-console]"), {
      mark: false,
      focus: false,
    });
  };
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
      onHide={hideMonitoring}
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
            onClick={() => openDam(summaryDam, "damButtons")}
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
      data-map-phone={consoleOn ? "true" : undefined}
      data-phone-panel={phonePanel ?? undefined}
      data-map-full={consoleOn && full ? "true" : undefined}
      // While a place tour is open its control bar runs the full width of the map; in full screen
      // that puts its reset button under the floating readouts, so they step down below the bar
      // (the owner, 28 Oct 2026). app/globals.css does the moving.
      data-map-tour={consoleOn && tourIndex !== null ? "on" : undefined}
      // The hazard and province pickers fold away on a laptop so the map is larger, while the
      // summary strip is always shown (the owner, 28 Oct 2026). Only here: a phone and a tablet
      // keep the pickers, and in full screen the whole bar is hidden. app/globals.css hides the
      // pickers and lets the map row grow.
      data-filters={consoleOn && laptop && !full ? (filtersOpen ? "open" : "shut") : undefined}
      data-meters={consoleOn && full && laptop && (metersOpen || metersPinned) ? "on" : undefined}
      data-side={consoleOn ? (sideOpen ? "open" : "closed") : undefined}
      data-side-peek={consoleOn && !sideOpen ? (sidePeek ? "on" : "off") : undefined}
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
        {/*
         * The title and the small turning Earth (components/map/OrbitGlobe) share one line: on a
         * phone or tablet the globe sits at its end, and on the console the wrapper steps aside so
         * both are items of the head row.
         */}
        <div className="flex items-center justify-between gap-3 console:contents">
          <h1 className="text-h3 font-bold text-jaga-ink">{t("title")}</h1>
          {consoleOn && <OrbitGlobe />}
        </div>
        {/* Who the console is for and what it may show: public, aggregated answers, the same
            ones the phone gets, and never an exact point (safety rule 6). */}
        <p className="hidden text-small text-jaga-text-2 console:block" data-console-note="true">
          {t("console.note")}
        </p>
        {/* Only for an approved team: one pill back to its board, up where the page starts (24 Oct). */}
        <TeamEntryChip />
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
        {/*
         * The fold switch on the head row, right next to the team pill (the owner, 28 Oct 2026:
         * "make the 2 buttons next to each other, no ... space in between"). No `ms-auto`, so it
         * sits beside the pill rather than away by the weather; `self-start` top-aligns it with the
         * pill, which the baseline-aligned head row would otherwise drop. For every language but
         * Malay, whose wider text pushes it to the hazard bar instead (below). Folded, the whole
         * hazard bar is hidden, so the map keeps its line.
         */}
        {locale !== "ms" && renderFoldSwitch("self-start")}
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
          {/*
           * The phone's two pills (the owner, 20 Oct, option C). They stand between the title
           * and the map and say what the map is showing; pressing one opens its chooser just
           * below, above the map, and pressing it again puts it away. `console:hidden` keeps
           * them off the laptop entirely, where the same controls are the left rail.
           *
           * They are written here, before the choosers they open, so a screen reader meets the
           * page in the order the eye does.
           */}
          <div
            className="flex flex-wrap gap-2 console:hidden"
            data-phone-bar="true"
            role="group"
            aria-label={t("phone.barLabel")}
          >
            <button
              type="button"
              data-phone-pill="place"
              aria-expanded={phonePanel === "place"}
              onClick={() => setPhonePanel((was) => (was === "place" ? null : "place"))}
              className={`${chipQuiet} ${phonePanel === "place" ? chipOn : chipOff} gap-1`}
            >
              <span className="sr-only">{t("phone.placeLabel")}</span>
              <span aria-hidden="true">
                {localName(hazard.name, locale)} · {scopeWord ?? t("province.all")}
              </span>
              <ChevronDown open={phonePanel === "place"} />
            </button>
            <button
              type="button"
              data-phone-pill="layers"
              aria-expanded={phonePanel === "layers"}
              onClick={() => setPhonePanel((was) => (was === "layers" ? null : "layers"))}
              className={`${chipQuiet} ${phonePanel === "layers" ? chipOn : chipOff} gap-1`}
            >
              {t("phone.layers", { count: layersOn })}
              <ChevronDown open={phonePanel === "layers"} />
            </button>
          </div>

          <div className="flex flex-col gap-1" data-console-area="hazard">
            {/*
             * In Malay the fold switch sits here, at the left of the bar, because the head row is
             * too wide to hold it; the pickers open to its right on the same row (the owner, 28 Oct
             * 2026). In every other language the switch is up on the head row and the whole bar
             * folds away. A phone and a tablet keep the bar laid out as before either way.
             */}
            {locale === "ms" && renderFoldSwitch("")}
            {/*
             * The hazard buttons and the province, wrapped so the fold can hide just them in Malay,
             * where the switch stays in this bar. `contents` leaves the phone and tablet layout
             * exactly as it was; app/globals.css folds this (whole bar elsewhere, this alone in ms).
             */}
            <div data-hazard-fields="true" id="map-filters" className="contents">
            <p className="font-medium" id="hazard-label">
              {t("hazard.label")}
            </p>
            <ul aria-labelledby="hazard-label" className="flex flex-wrap gap-2">
              {hazards.map((h) => (
                <li
                  key={h.code}
                  /*
                   * `max-lg:hidden` is the phone band's half of this; the attribute is the
                   * tablet's, because the tablet band starts at the same 1,024 px that `lg:`
                   * does and so cannot be told apart from a laptop by a breakpoint alone
                   * (app/globals.css, the tablet block).
                   */
                  data-hazard-extra={h.code === hazard.code || moreHazards ? undefined : "true"}
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
                <li data-hazard-more="true" className="lg:hidden">
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
                onOpenDam={openDams}
                damContext={damContext}
                damLit={damsLit(damOrder).length}
                onOpenGauges={openGauges}
                onToggleMonitoring={() => {
                  /*
                   * The band opens under the whole dashboard, which is below the fold on every
                   * screen, so opening it without going to it looks as though nothing happened -
                   * the same trap the reservoir's own card fell into on 14 Oct.
                   *
                   * The readouts stand beside the map in full screen since 23 Oct, and the band
                   * is not drawn there at all: so this leaves full screen on the way, rather
                   * than being a button that does nothing (which is how the owner found this
                   * same card on 21 Oct).
                   */
                  if (!monitoringOpen) {
                    leaveFull();
                    reveal(() => document.getElementById("monitoring-detail-console"));
                  }
                  setMonitoringOpen((was) => !was);
                }}
              />

              {/* The hazard comes first, then the province, then what the map shows for it (owner,
                  15 Oct). On the console the same four are the left rail. */}
              <div className="contents" data-console-area="rail" data-console-rail="true">
                {/*
                 * The way out, while the map fills the screen (the owner, 18 Oct): back to the
                 * console, or out to the home screen. Hidden until then - app/globals.css draws
                 * it - so nothing changes for a phone or for the console itself.
                 */}
                <div data-map-fulltools="true" className="hidden flex-wrap gap-2">
                  <button
                    type="button"
                    data-map-full-exit="true"
                    onClick={leaveFull}
                    className={`${buttonSecondary} gap-2`}
                  >
                    <BackIcon size={20} />
                    {t("full.exit")}
                  </button>
                  <Link href="/" prefetch={false} className={`${buttonQuiet} gap-2`}>
                    <HouseIcon size={20} />
                    {t("full.home")}
                  </Link>
                </div>
                {/*
                 * The reader's own pins - home and the watch places - are always drawn now (the
                 * owner, 28 Oct 2026: "turned on by default, cannot turn off"), so the switch that
                 * used to stand first in the rail is gone. Their legend is in the right-hand panel.
                 */}
                {/* The sea's own report, for fishermen, right under the chips while the sea is
                    shown (the owner, 15 Oct: the switches under the map are gone, the chips do
                    that). */}
                <MapFeatureChips
                  on={featuresOn}
                  onToggle={toggleFeature}
                  omit={riverOnOffer ? undefined : ["river"]}
                  after={
                    (onConsole && dams.length > 0) || showSea ? (
                      <>
                        {/*
                         * How the reservoirs stand, in the rail (the owner, 23 Oct 2026: "in the
                         * full screen map on the laptop add on the left button to see Reservoir
                         * Situation just on top of 'see the sea and coast, for fishermen'"). Full
                         * screen hides the readout strip, so this is the only way into the
                         * reservoirs' figures there; it opens what the readout opens - the worst
                         * reservoir, or the largest when all of them are normal - and the card's
                         * own Next and Back walk through the others.
                         *
                         * The console's bands only: on a phone the rail is the column below the
                         * map, where the dam legend already names every reservoir with a button.
                         */}
                        {onConsole && dams.length > 0 && (
                          <>
                            <button
                              type="button"
                              data-open-dams="true"
                              aria-expanded={full && laptop ? damChoice : undefined}
                              onClick={() => {
                                /*
                                 * In the laptop's full screen there are two ways to look (the
                                 * owner, 23 Oct 2026): the meters, or the full details this
                                 * button has always opened. Anywhere else there is only the one.
                                 */
                                if (full && laptop) {
                                  setDamChoice((was) => !was);
                                  return;
                                }
                                openDams();
                                revealPanel();
                              }}
                              className={`${buttonQuiet} justify-between self-start text-start`}
                            >
                              <DropIcon size={24} />
                              {t("console.dam.situation")}
                              <span aria-hidden="true">{full && laptop ? "▾" : "→"}</span>
                            </button>
                            {full && laptop && damChoice && (
                              <div
                                role="group"
                                aria-label={t("meters.choose")}
                                data-dam-choice="true"
                                className="flex flex-col gap-2 ps-4"
                              >
                                <button
                                  type="button"
                                  data-dam-choice-meters="true"
                                  onClick={() => {
                                    setDamChoice(false);
                                    setMetersOpen(true);
                                  }}
                                  className={`${buttonQuiet} justify-start self-start text-start`}
                                >
                                  <MeterIcon />
                                  {t("meters.asMeters")}
                                </button>
                                <button
                                  type="button"
                                  data-dam-choice-details="true"
                                  onClick={() => {
                                    setDamChoice(false);
                                    if (!metersPinned) setMetersOpen(false);
                                    openDams();
                                    revealPanel();
                                  }}
                                  className={`${buttonQuiet} justify-start self-start text-start`}
                                >
                                  <DropIcon size={24} />
                                  {t("meters.asDetails")}
                                </button>
                              </div>
                            )}
                          </>
                        )}
                        {showSea ? (
                          <button
                            type="button"
                            data-open-sea="true"
                            onClick={() => {
                              openSea(nearestCoast(props.area));
                              revealPanel();
                            }}
                            className={`${buttonQuiet} justify-between self-start text-start`}
                          >
                            <SeaGradeIcon grade="calm" size={24} />
                            {tSea("open")}
                            <span aria-hidden="true">→</span>
                          </button>
                        ) : null}
                      </>
                    ) : undefined
                  }
                />
                {/*
                 * What the satellite saw, under the safe places (the owner, 23 Oct 2026: "Move
                 * the Show flood seen by satellite (GISTDA) to be under Safe places"). Safe
                 * places is the last of the chips above, so under it means under the list.
                 *
                 * It was above the chips from 22 Oct, for a reason that still holds and that the
                 * owner has now decided against: on a laptop the rail is a column 324 px tall
                 * holding more than twice that, so below the chips this switch is off the bottom
                 * of the window until the rail is scrolled. On a tablet, where the rail is a
                 * full-width row of columns, it is beside them and in plain sight either way.
                 *
                 * On a phone nothing moves: the phone band gives every explainer below the map
                 * `order: 4`, and a child of the rail catches that rule wherever in the rail it
                 * is written - so it sits where it always sat, below the map.
                 */}
                {props.onSatelliteDays && (
                  <SatelliteFloodPanel
                    days={props.satelliteDays ?? null}
                    onDays={onSatelliteDays}
                    flood={props.satellite ?? null}
                    load={props.satelliteLoad ?? "loading"}
                    dark={nightMap}
                  />
                )}
                {/*
                 * The responsibility map (spec 2, 9): per-tambon team coverage, drawn the same way
                 * as the authority console's map - teal where a rescue team covers, the map ink for
                 * a gap, a teal outline on the viewer's own tambons (never an alert colour, brand.md).
                 * Offered only to verified authorities and admins (the server returns no coverage to
                 * anyone else, safety rule 5), off to begin with.
                 */}
                {coverageOffered && (
                  <div className="flex flex-col gap-1" data-coverage-switch="true">
                    <button
                      type="button"
                      aria-pressed={coverageOn}
                      data-coverage-toggle={coverageOn ? "on" : "off"}
                      onClick={() => setCoverageOn((on) => !on)}
                      className={`${chip} ${coverageOn ? chipOn : chipOff} items-center gap-2`}
                    >
                      <span
                        aria-hidden="true"
                        className="size-4 shrink-0 rounded-sm border border-white"
                        style={{ backgroundColor: COVERAGE_COLOR }}
                      />
                      {t("coverage.show")}
                    </button>
                    <span className={hint}>
                      {t("coverage.note", {
                        covered: coverageCovered.length,
                        gaps: coverageGaps.length,
                      })}
                    </span>
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2" data-mode-row="true">
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
                <MapMethod />
              </div>

              {/*
               * The map, with the notices that belong to the person's own area above it: on the
               * console this is the middle column, and the map takes whatever height is left.
               */}
              <div className="contents" data-console-area="map">
                {/* The war room's meters, over the map where a reservoir's own card opens. */}
                {consoleOn && full && laptop && (metersOpen || metersPinned) && (
                  <div data-dam-meters-host="true">
                    <DamMetersPanel
                      dams={damOrder}
                      locale={locale}
                      time={time}
                      pinned={metersPinned}
                      onPin={toggleMetersPin}
                      onClose={closeMeters}
                      onOpenDam={openFromMeter}
                    />
                  </div>
                )}
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
                    <div
                      data-map-tools="true"
                      className="absolute start-2 top-2 z-10 flex flex-wrap gap-2 pe-12"
                    >
                      <button
                        type="button"
                        data-zoom-all="true"
                        onClick={() =>
                          setFocus((was) => ({ box: SERVICE_BOUNDS, key: (was?.key ?? 0) + 1 }))
                        }
                        className={mapButton}
                      >
                        <ZoomOutIcon />
                        {/*
                         * The words are read out but not drawn on a phone (20 Oct): three
                         * labelled buttons wrapped onto two lines and took 180 px off a 375 px
                         * map - half of what the reader came for, covered by its own controls.
                         */}
                        <span className="sr-only sm:not-sr-only">{t("zoomAll")}</span>
                      </button>
                      <button
                        type="button"
                        data-map-reset="true"
                        title={t("resetLabel")}
                        onClick={resetMap}
                        className={mapButton}
                      >
                        <ResetIcon />
                        <span className="sr-only sm:not-sr-only">{t("reset")}</span>
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
                            setFocus((was) => ({ box: myBox, key: (was?.key ?? 0) + 1 }));
                          }}
                          className={mapButton}
                        >
                          <HomePinIcon />
                          <span className="sr-only sm:not-sr-only">{t("zoomMine")}</span>
                        </button>
                      )}
                      {/*
                       * The map on its own (the owner, 18 Oct for the console; 20 Oct for the
                       * phone, where it is now the way to a map that takes one finger - in the
                       * page the map leaves one-finger drags to the page, so that scrolling
                       * past it works, and this is where you go to move it freely).
                       *
                       * On the way in only: once the map fills the screen the way back is the
                       * button below, and on the console the panel beside it.
                       */}
                      {!full && (
                        <button
                          type="button"
                          data-map-full-toggle="open"
                          onClick={() => setFull(true)}
                          className={mapButton}
                        >
                          <FullScreenIcon />
                          <span className="sr-only sm:not-sr-only">{t("full.open")}</span>
                        </button>
                      )}
                      {/* The way back out, drawn on the map itself where there is no panel. */}
                      {full && (
                        <span className="contents console:hidden">
                          <button
                            type="button"
                            data-map-full-toggle="close"
                            onClick={leaveFull}
                            className={mapButton}
                          >
                            <BackIcon size={20} />
                            {t("phone.fullExit")}
                          </button>
                        </span>
                      )}
                    </div>
                  )}
                  {/*
                   * The basemap, picked on the map itself (the owner, 18 Oct, "similar to google
                   * map when switching the basemap"; and 28 Oct, "bring the buttons of the basemap
                   * ... inside the map itself" on the laptop too, not only full screen). The button
                   * opens the options over the map; it is the same ground full screen uses, so the
                   * side rail no longer carries a copy on the console - app/globals.css hides it and
                   * the "what's on the map" panel rises to fill the gap. The phone keeps its own, so
                   * this renders on the console only (`onConsole`), not hidden in the phone's DOM.
                   */}
                  {onConsole && (
                    <div
                      data-map-basemap-picker={basemapOpen ? "open" : "shut"}
                      className="absolute bottom-16 start-2 z-10 hidden flex-col items-start gap-2 console:flex"
                    >
                      {basemapOpen && (
                        <div
                          className="flex max-w-72 flex-col gap-2 rounded-xl border border-jaga-line bg-jaga-surface p-3 shadow-lg"
                          data-basemap={basemap}
                        >
                          <p className="font-medium">{t("basemap.title")}</p>
                          {basemapButtons}
                          {/* The 3D and satellite notes travel with the buttons, so moving the
                              picker onto the map does not drop the caveats (safety rule 8). */}
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
                        </div>
                      )}
                      <button
                        type="button"
                        data-basemap-open={basemapOpen}
                        aria-expanded={basemapOpen}
                        onClick={() => setBasemapOpen((was) => !was)}
                        className={mapButton}
                      >
                        <LayersIcon />
                        {t("full.basemap")}
                      </button>
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
                    /*
                     * Inside a page that scrolls, one finger scrolls and two move the map (the
                     * owner, 20 Oct). Not while the map fills the screen, where it is the page.
                     */
                    cooperative={phoneMap && !full}
                    gestureText={{
                      twoFingers: t("phone.twoFingers"),
                      zoomCtrl: t("phone.zoomCtrl"),
                      zoomCmd: t("phone.zoomCmd"),
                    }}
                    gaugeWords={{
                      near: t("gauge.nearShort"),
                      over: t("gauge.overShort"),
                      seaShut: t("gauge.seaShort"),
                    }}
                    peek={renderPeek}
                    mine={mine}
                    showMine={showMine}
                    dams={dams}
                    hazardUrl={props.hazardTiles ?? null}
                    riverUrl={props.riverTiles ?? null}
                    coverageCovered={coverageCovered}
                    coverageGaps={coverageGaps}
                    coverageMine={coverageMine}
                    showCoverage={coverageOffered && coverageOn}
                    sea={seaMarks}
                    satellite={
                      props.satelliteDays && props.satellite?.days === props.satelliteDays
                        ? props.satellite.features
                        : null
                    }
                    areaNames={areaNames}
                    flashDam={flashDam}
                    flashSatellite={flashSatellite}
                    onView={rememberView}
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
              <div
                ref={sideRef}
                className="contents"
                data-console-area="side"
                data-console-rail="true"
                onPointerLeave={() => setSidePeek(true)}
              >
                {/*
                 * Folding the panel away and bringing it back (the owner, 18 Oct). Only on the
                 * console: a phone has no side panel to fold, and `contents` keeps this out of
                 * its way entirely.
                 */}
                <span className="hidden console:contents">
                  <div data-side-bar="true">
                    <button
                      type="button"
                      data-side-toggle={sideOpen ? "open" : "closed"}
                      aria-expanded={sideOpen}
                      onClick={() => {
                        setSideOpen((was) => !was);
                        setSidePeek(false);
                      }}
                      className="inline-flex min-h-tap min-w-tap items-center justify-center rounded-lg border border-jaga-line bg-jaga-surface text-jaga-ink"
                    >
                      <PanelIcon open={sideOpen} aria-hidden="true" />
                      <span className="sr-only">
                        {t(sideOpen ? "console.panelHide" : "console.panelShow")}
                      </span>
                    </button>
                  </div>
                </span>
                <fieldset
                  className="flex flex-col gap-1"
                  data-basemap={basemap}
                  data-basemap-panel="true"
                >
                  <legend className="font-medium">{t("basemap.title")}</legend>
                  {basemapButtons}
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
                {/*
                 * What is drawn on the map: the safe places and the reader's own pins (the owner,
                 * 18 Oct, so that the full-screen panel can hold them with the other layer
                 * pickers). `contents` means this wrapper is nothing at all until then.
                 *
                 * What the satellite saw used to be here too. It moved to the left rail on
                 * 22 Oct, where the other "what to draw on the map" switches are.
                 */}
                <div className="contents" data-map-layers="true">
                  {placesOnOffer && (
                    <label
                      data-places-toggle="true"
                      data-side-first="true"
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
                  {/* The legend for the two pin shapes. It stays here when the switch above it
                      does not (the console hides that one - the chip in the left rail is the one
                      control), because what a square with a house means is a legend, and the
                      legend is what this panel is for. */}
                  {showPlaces && placesOnOffer && (
                    <p className={hint} data-places-hint="true">
                      {t("places.hint")}
                    </p>
                  )}
                </div>
                {/*
                 * The three things the map asks for, in a card that can be seen (the owner,
                 * 23 Oct 2026). They were two dashed grey footnotes here: pin your places, and
                 * teams can register. The install card below carries the steps for each kind of
                 * device, and the row in the card above only points at it, so nothing is said
                 * twice.
                 */}
                <MapJoin />
                <InstallCard place="home" />
                <p className={hint} data-side-first="true">
                  {t("tapHint")}
                </p>
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
                      onClick={closeSelected}
                      className="inline-flex min-h-tap items-center gap-1.5 self-start underline"
                    >
                      <CrossIcon size={20} />
                      {t("close")}
                    </button>
                  </div>
                )}

                {/*
                 * The key to the map, and under it the reservoir's, folded on a phone and open
                 * on the console (the owner, 20 Oct, option C). Between them they were 1,708 px
                 * of the 2,142 px that stood below the map; folded they are two lines. They are
                 * never further than one tap from the map, which is what safety rule 3 asks of
                 * anything a colour means: the alert levels keep their icons and their words
                 * inside, and the map's own badges say the level wherever they are drawn.
                 */}
                <Fold
                  fold={phoneMap}
                  heading
                  title={t("layers.title")}
                  mark={{ "data-legend": mode }}
                >
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
                                  ["over", "above_evacuate"],
                                  ["near", "above_warning"],
                                  ["high", "above_watch"],
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
                            ) : layer === "river" ? (
                              <span
                                aria-hidden="true"
                                className="size-4 shrink-0 rounded-[3px] border border-jaga-edge"
                                style={{ backgroundColor: riverColor(nightMap) }}
                                data-river-swatch="true"
                              />
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
                </Fold>

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
                  <Fold
                    fold={phoneMap}
                    title={tDam("path.title")}
                    mark={{ "data-dam-legend": "true" }}
                  >
                    {/* The marks mean the same on every reservoir, so they are explained once. */}
                    <ul className="flex flex-col gap-1">
                      <DamLegendKeys />
                    </ul>
                    <p className={hint}>{tDam("path.limits")}</p>
                    {/*
                     * The way in that needs no aim at all. The card otherwise opens only by
                     * tapping the dam itself, and a river is a thin thing to hit: 4 taps in 665
                     * found it on the live map, and the owner could not find the card at all.
                     * The legend names the dam anyway, so it is the natural button. It is the list the
                     * readout opens (the owner, 23 Oct 2026: "open up the all dam list, sort by the
                     * most relevant dam to the user selected area, otherwise ... largest capacity"),
                     * so it is in the readout's own order.
                     */}
                    {damOrder.map((dam) => (
                      <button
                        key={dam.code}
                        type="button"
                        data-open-dam={dam.code}
                        onClick={() => openDam(dam)}
                        className={`${buttonQuiet} w-full justify-between text-start`}
                      >
                        <DamLegendRow dam={dam} />
                        <WaveIcon size={20} aria-hidden="true" />
                        <span className="sr-only">
                          {tDam("legend.open", { dam: localName(dam.name, locale) })}
                        </span>
                      </button>
                    ))}
                  </Fold>
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

              {/* Back to the map, while the map is off the top of a phone's screen. */}
              {phoneMap && <BackToMap />}

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
                  id="monitoring-detail-console"
                  tabIndex={-1}
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
