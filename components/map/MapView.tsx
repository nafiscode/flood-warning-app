"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import type {
  GeoJSONSource,
  Map as MapLibreMap,
  PointLike,
  Popup,
  ExpressionSpecification,
} from "maplibre-gl";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { MapLayer } from "@/lib/hazards";
import { damLevel, type Dam, reachesInOrder } from "@/lib/dam";
import {
  byZoom,
  CASING_EXTRA,
  damMarks,
  damPaint,
  markColor,
  emphasis,
  MAIN_WIDTH,
  RESERVOIR_FILL_OPACITY,
  RESERVOIR_FLASH_MS,
  RESERVOIR_FLASH_OPACITY,
  RESERVOIR_FLASH_TIMES,
  RESERVOIR_FLASH_WIDTH,
  ZONE_HATCH_RATIO,
  zoneHatch,
  zoneHatchName,
  RESERVOIR_LINE_WIDTH,
  TRIBUTARY_DASH,
  TRIBUTARY_WIDTH,
} from "@/lib/dam-map";
import { mineLabel, minePlaceFeature } from "@/lib/mine-label";
import { PlaceRain } from "./PlaceRain";
import { cloudLift, type RainCloud, type RainKind } from "@/lib/place-rain";
import { HOME_TIP_DY, MINE_IMAGE_RATIO, mineImage, mineImageName } from "@/lib/mine-marks";
import {
  HAZARD_OPACITY,
  HAZARD_OPACITY_NIGHT,
  HAZARD_SOURCE_LAYER,
  hazardFillColor,
} from "@/lib/hazard-layer";
import { SEA_IMAGE_RATIO, SEA_RANK, seaImage, seaImageName, seaPaint } from "@/lib/sea-marks";
import type { SeaGrade } from "@/lib/sea";
import {
  SATELLITE_LINE_WIDTH,
  SATELLITE_OPACITY,
  satelliteColor,
  satelliteEdge,
  type SatelliteCell,
} from "@/lib/satellite-flood";
import { placeIcon, placeIconName, PLACE_ICON_RATIO } from "@/lib/place-icons";
import { localName } from "@/lib/places";
import {
  GAUGE_IMAGE_RATIO,
  gaugeImage,
  gaugeImageName,
  gaugeLabels,
  gaugeLook,
  gaugePaint,
  reducedMotion,
  trendOf,
  type GaugeLook,
  type Trend,
} from "@/lib/gauge-marks";
import { areaLabelFeatures, type AreaLabel } from "@/lib/area-labels";
import {
  AREA_LABEL_SOURCE,
  type Basemap,
  beforeBasemapLabels,
  createServiceAreaMap,
  type GestureText,
  CAPITAL_LAYER,
  DISTRICT_LABEL_LAYER,
  TAMBON_LABEL_LAYER,
  liftBasemapLabels,
  mapHalo,
  mapInk,
  mapIsDark,
  nightNow,
  photoNow,
  PROVINCE_LINE_LAYER,
  PROVINCE_SOURCE,
  provinceLinePaint,
  PROVINCES_URL,
  quietOverview,
  SERVICE_BOUNDS,
  setBasemap,
  setScene,
  TAMBON_FILL_LAYER,
  TAMBON_LINE_LAYER,
  TAMBON_SOURCE,
} from "@/lib/map";
import type { MapData } from "@/lib/map-data";
import { alertFillColor, STALE_COLOR, staleTambons } from "@/lib/map-style";
import type { PublicStatus } from "@/lib/public-status";

export type MapSelection =
  | { kind: "tambon"; code: string; nameTh: string; nameEn: string }
  | { kind: "place"; id: string }
  | { kind: "reports"; index: number }
  | { kind: "gauge"; id: string }
  | { kind: "mine"; id: string }
  | { kind: "dam"; code: string }
  | { kind: "hazard"; value: number }
  | { kind: "sea"; id: string }
  | { kind: "rain"; id: string; rain: RainKind };

/** What can say how it stands in a pop-up on the map itself (the owner, 14 Oct). */
export type PeekTarget = Extract<
  MapSelection,
  { kind: "gauge" | "place" | "dam" | "sea" | "rain" }
>;

/**
 * A place of the person's own: their home, or one they watch for someone (spec 4.9). It is
 * drawn only in their own browser, from their own session (/api/me/places); nothing personal
 * reaches the public map data (safety rule 6).
 */
export type MinePlace = {
  id: string;
  label: string;
  lat: number;
  lon: number;
  home: boolean;
  /** Its own colour, so ten pins can be told apart at a glance (lib/mine-colors.ts). */
  color: string;
  /**
   * What the pin says on hover (a laptop) or on tap (a phone or tablet): the name it was given,
   * the person there, and the tambon, district and province. Already in the person's language;
   * the map does no translating. Every line is put into the page as text, never as HTML: these
   * are words the person typed.
   */
  lines: string[];
  /**
   * The person at the place, when their number is stored: the label carries a button that dials
   * it, like every other call button in the app. It is the person's own note about their own
   * place, read with their own session and shown to nobody else; it is never written into the
   * phone's storage either (lib/me.ts, withoutPhones).
   */
  call: { tel: string; label: string } | null;
};

/** A point off the coast as the map draws it; the words are already in the person's language. */
export type SeaMark = {
  id: string;
  lat: number;
  lon: number;
  grade: SeaGrade;
  /** Where the waves travel to, degrees clockwise from north. */
  bearing: number;
  /** Written far out (empty for a calm sea), and close in. */
  short: string;
  long: string;
};

type Props = {
  /** What may be drawn. Empty: nothing of ours but the tambon outlines. */
  layers: MapLayer[];
  /**
   * The dam's own marks - reservoir, river path and the dam itself - and the land its release can
   * reach, each switched by its chip above the map (the owner, 15 Oct). Both drawn when left out.
   */
  showDam?: boolean;
  showDamZone?: boolean;
  /** The `pmtiles://` address of the flood-hazard classes; null until the manifest names one. */
  hazardUrl?: string | null;
  /** The basemap under our layers (lib/map.ts). */
  basemap?: Basemap;
  /** 3D: the ground raised and the map tilted (lib/map.ts, setScene). 2D when left out. */
  scene?: boolean;
  /**
   * The map fills the height it is given instead of taking 60% of the screen. Only the laptop
   * console asks for this (app/globals.css, the console block), and only there does it change
   * anything: every other width, and every picker that borrows this map, keeps the fixed height.
   */
  fill?: boolean;
  /**
   * Hexagons where a satellite pass saw flood water (lib/satellite-flood.ts); null or empty
   * draws nothing. The caller says in words what an empty map means.
   */
  satellite?: SatelliteCell[] | null;
  /**
   * The sea off the coast (lib/sea.ts): one mark per point, its waves rolling the way the model's
   * waves travel (lib/sea-marks.ts), with the note's words beside any that is not calm. Null or
   * empty draws nothing.
   */
  sea?: SeaMark[] | null;
  /**
   * Show where something is: it lights up three times (the owner, 18 Oct 2026) - reservoirs by
   * their dams' codes, river gauges or a point off the coast by their ids. The `key` changes each
   * time somebody asks, so asking for the same one twice lights it twice.
   *
   * Several at once since 20 Oct 2026: a press on a readout lights every river near its bank, or
   * every reservoir doing something, not only the one whose card opened (lib/map-console.ts).
   */
  flashDam?: {
    kind: "reservoir" | "gauge" | "sea";
    codes: string[];
    key: number;
    /** Where it is, for bringing it into the frame when it is not already in it. */
    at?: { lon: number; lat: number } | null;
  } | null;
  /**
   * Show what the satellite saw: the hexagons blink three times when somebody switches the layer
   * on (the owner, 20 Oct 2026). The number changes each time somebody asks; 0 is "never asked".
   */
  flashSatellite?: number;
  /**
   * Where the map is looking now, told after every move the reader or the app makes. The caller
   * uses it to come back to a view later (closing the satellite layer returns to the frame the
   * reader had before it); nothing on this map depends on it.
   */
  onView?: (box: [number, number, number, number]) => void;
  /** The person's own places, drawn on top of everything when they ask for them. */
  mine?: MinePlace[];
  showMine?: boolean;
  /**
   * The dams, their reservoirs and the path released water takes. Always drawn, in every view
   * and whatever the dam is doing (the owner's request of 10 Oct): where the river runs does not
   * depend on today's weather, and someone who lives along it should be able to find it.
   */
  dams?: Dam[];
  /**
   * The words on the dam's other two marks, and the language to name the dam itself in. The
   * dam's own mark is labelled with its name alone: prefixing it with the word "dam" wrote the
   * name twice on the map.
   */
  damText?: { spillway: string; outlet: string; locale: string };
  /**
   * The map is inside a page that scrolls, so one finger scrolls the page and two move the map
   * (the owner, 20 Oct). False where the map has the screen to itself.
   */
  cooperative?: boolean;
  /** What to say when a gesture is held back; read once, when the map is made. */
  gestureText?: GestureText;
  /**
   * The names of the districts and tambons, which appear as the reader zooms in (lib/map.ts,
   * quietOverview). Left out, the map carries only the basemap's own names.
   */
  areaNames?: AreaLabel[] | null;
  status: PublicStatus | null;
  data: MapData | null;
  now: number;
  /** Where to look: the service area, or one province. */
  bounds?: [number, number, number, number];
  /**
   * Changes when the caller asks for the same box again - tapping "see the dam's figures" twice
   * after panning away should bring the map back, and the box itself has not changed.
   */
  boundsKey?: number;
  onSelect: (selection: MapSelection) => void;
  text: { loading: string; failed: string };
  /** The words written beside a gauge near or over its bank (lib/gauge-marks.ts). */
  gaugeWords?: { near: string; over: string };
  /**
   * The compact pop-up for a reservoir, a gauge or a safe place, drawn by the caller (it holds
   * the figures and the words). Without it only the person's own places have a pop-up.
   */
  peek?: (target: PeekTarget) => ReactNode;
};

/*
 * Brand slate by day (docs/brand.md): places, reports and gauges carry no status colour. After
 * sunset the same marks are drawn light, against the dark basemap (lib/map.ts).
 */
const ink = () => mapInk();
const halo = () => mapHalo();
const ALERT_FILL = "jaga-alert-fill";
const ALERT_STALE = "jaga-alert-stale";
const REPORTS = "jaga-reports";
const REPORTS_LINE = "jaga-reports-line";
const PLACES = "jaga-places";
const HAZARD = "jaga-hazard";
const HAZARD_FILL = "jaga-hazard-fill";
const SATELLITE = "jaga-satellite";
const SATELLITE_LINE = "jaga-satellite-line";
const SEA = "jaga-sea";
const SEA_LABEL = "jaga-sea-label";
const GAUGES = "jaga-gauges";
const GAUGE_LABEL = "jaga-gauge-label";
const MINE = "jaga-mine";
const MINE_LABEL = "jaga-mine-label";
/** How far from a tap a thin line or a small mark still counts, in pixels. */
const TAP_SLACK = 12;

/** What a pop-up gives up to the map's edges: the tip it points with, plus a little air. */
const POPUP_AIR = 32;
/** A pop-up is never squeezed below this, however short the map is; it scrolls instead. */
const POPUP_MIN_H = 140;

const DAM_WATER_SOURCE = "jaga-dam-water";
const DAM_REACHES = "jaga-dam-reaches";
const DAM_ZONE_SOURCE = "jaga-dam-zone";
const DAM_ZONE_FILL = "jaga-dam-zone-fill";
const DAM_ZONE_LINE = "jaga-dam-zone-line";
const DAM_ZONE_CASING = "jaga-dam-zone-casing";
const DAM_ZONE_OUTER = "jaga-dam-zone-outer";
const DAM_POINTS = "jaga-dam-points";
const DAM_RESERVOIR_FILL = "jaga-dam-reservoir-fill";
const DAM_RESERVOIR_LINE = "jaga-dam-reservoir-line";
const DAM_TRIBUTARY = "jaga-dam-tributary";
const DAM_CASING = "jaga-dam-casing";
const DAM_MAIN = "jaga-dam-main";
const DAM_MARKS = "jaga-dam-marks";
const DAM_LABELS = "jaga-dam-labels";
/** The reservoir lit up: its own layers, added over the others while it flashes, then removed. */
const DAM_FLASH_FILL = "jaga-dam-flash-fill";
const DAM_FLASH_LINE = "jaga-dam-flash-line";
/** The ring drawn around a gauge being pointed at: wide enough to clear the station's own mark. */
const GAUGE_FLASH_RADIUS = 24;
const GAUGE_FLASH_WIDTH = 5;

type Collection = GeoJSON.FeatureCollection;
const collection = (features: GeoJSON.Feature[]): Collection => ({
  type: "FeatureCollection",
  features,
});

/**
 * The dam's own features. The reservoir, the reaches and the three marks go into three sources
 * so each can be drawn its own way; a dam with no geometry yet simply contributes nothing.
 */
function damCollections(
  dams: Dam[],
  text: { spillway: string; outlet: string; locale: string },
): Record<string, Collection> {
  const water: GeoJSON.Feature[] = [];
  const reaches: GeoJSON.Feature[] = [];
  const marks: GeoJSON.Feature[] = [];
  const zones: GeoJSON.Feature[] = [];
  for (const dam of dams) {
    const name = localName(dam.name, text.locale) || dam.code;
    for (const zone of dam.zones ?? []) {
      zones.push({
        type: "Feature",
        geometry: zone.geometry as GeoJSON.Geometry,
        properties: { code: dam.code, band: zone.band },
      });
    }
    if (dam.reservoir) {
      water.push({
        type: "Feature",
        // Either a Polygon or a MultiPolygon, whichever PostGIS held (lib/dam.ts); MapLibre
        // draws both, and the narrower type is only a GeoJSON typing detail.
        geometry: dam.reservoir as GeoJSON.Geometry,
        properties: { code: dam.code, name },
      });
    }
    for (const reach of reachesInOrder(dam)) {
      reaches.push({
        type: "Feature",
        geometry: reach.line,
        properties: {
          code: dam.code,
          kind: reach.kind,
          // The river is emphasised while a release is confirmed. Never a different colour: the
          // words in the notice and the card say what is happening (lib/dam-map.ts).
          emphasis: emphasis(dam.signal?.grade) ? 1 : 0,
        },
      });
    }
    for (const { kind, point, label } of damMarks(dam, text)) {
      if (!point) continue;
      marks.push({
        type: "Feature",
        geometry: point,
        // The state travels with the mark, so the one layer paints it (the owner, 12 Oct).
        properties: { code: dam.code, kind, label, level: damLevel(dam.signal) },
      });
    }
  }
  return {
    [DAM_WATER_SOURCE]: collection(water),
    [DAM_REACHES]: collection(reaches),
    [DAM_POINTS]: collection(marks),
    [DAM_ZONE_SOURCE]: collection(zones),
  };
}

/** Which gauge is drawn on top where two overlap: the one nearest its bank. */
const GAUGE_RANK: Record<GaugeLook, number> = {
  over: 4,
  near: 3,
  normal: 2,
  nolevels: 1,
  quiet: 0,
};

function toCollections(
  data: MapData | null,
  mine: MinePlace[],
  dams: Dam[],
  damText: { spillway: string; outlet: string; locale: string },
  gaugeWords: { near: string; over: string },
): Record<string, Collection> {
  return {
    ...damCollections(dams, damText),
    [MINE]: collection(mine.map(minePlaceFeature)),
    [REPORTS]: collection(
      (data?.reports ?? []).map((bin, index) => ({
        type: "Feature",
        geometry: bin.hex,
        properties: { index, count: bin.count },
      })),
    ),
    [PLACES]: collection(
      (data?.places ?? []).map((place) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [place.lon, place.lat] },
        properties: { id: place.id, parking: place.type === "high_ground_parking" ? 1 : 0 },
      })),
    ),
    [GAUGES]: collection(
      (data?.gauges ?? []).map((gauge) => {
        const look = gaugeLook(gauge.status);
        return {
          type: "Feature",
          geometry: { type: "Point", coordinates: [gauge.lon, gauge.lat] },
          properties: {
            id: gauge.id,
            look,
            trend: trendOf(gauge.rise3h ?? null, look),
            rank: GAUGE_RANK[look],
            ...gaugeLabels(gauge, gaugeWords),
          },
        };
      }),
    ),
  };
}

/**
 * The public map (spec 4.2): tambons colored by alert level, flood reports as counts per
 * hexagon, safe places and river gauges. MapLibre is downloaded only when this is shown.
 * Drawing is repeated whenever the style changes (the street basemap arrives after our own
 * outlines), so every step here can run any number of times.
 */
export function MapView({
  layers,
  showDam = true,
  showDamZone = true,
  status,
  data,
  now,
  bounds,
  boundsKey = 0,
  onSelect,
  text,
  mine = [],
  showMine = false,
  dams = [],
  damText = { spillway: "", outlet: "", locale: "th" },
  cooperative = false,
  gestureText,
  hazardUrl = null,
  basemap = "streets",
  scene = false,
  fill = false,
  satellite = null,
  sea = null,
  areaNames = null,
  flashDam = null,
  flashSatellite = 0,
  onView,
  gaugeWords = { near: "", over: "" },
  peek,
}: Props) {
  const { near: nearWord, over: overWord } = gaugeWords;
  // One object for as long as the sea's marks are the same.
  const seaData = useMemo(
    () =>
      collection(
        (sea ?? []).map((s) => ({
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: [s.lon, s.lat] },
          properties: {
            id: s.id,
            grade: s.grade,
            bearing: s.bearing,
            short: s.short,
            long: s.long,
            rank: SEA_RANK[s.grade],
          },
        })) as GeoJSON.Feature[],
      ),
    [sea],
  );
  // The area names as GeoJSON: built once for a language, not on every draw (377 tambons).
  const areaNameData = useMemo(() => areaLabelFeatures(areaNames ?? []), [areaNames]);
  // One object for as long as the hexagons are the same, so they are sent to the map once.
  const satelliteData = useMemo(
    () => collection((satellite ?? []) as GeoJSON.Feature[]),
    [satellite],
  );
  /*
   * The three labels are taken apart here because the caller builds damText fresh on every
   * render: the object's identity would restart the drawing effect each time, while the
   * strings themselves hardly ever change.
   */
  const { spillway: spillwayLabel, outlet: outletLabel, locale: damLocale } = damText;
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  // Which data object each source holds, so data is sent again only when it changed.
  const held = useRef(new Map<string, Collection>());
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  // The map itself once it has loaded, for what is drawn over it in HTML (the rain clouds).
  const [loaded, setLoaded] = useState<MapLibreMap | null>(null);
  // The basemap the map was made with, and the one it shows now: changing it later swaps the
  // ground under our layers without making the map again (lib/map.ts, setBasemap).
  const basemapAtStart = useRef(basemap);
  const applied = useRef(basemap);
  // MapLibre reads the words for a held-back gesture once, when the map is made.
  const gestureAtStart = useRef(gestureText);
  /*
   * One finger scrolls the page and two move the map, wherever the map sits inside a page that
   * scrolls (the owner, 20 Oct). Switched rather than set once: the same map becomes the
   * console's and the full-screen one, and both of those want every gesture.
   */
  useEffect(() => {
    const m = map.current;
    if (!m || state !== "ready") return;
    if (cooperative) m.cooperativeGestures.enable();
    else m.cooperativeGestures.disable();
  }, [cooperative, state]);
  useEffect(() => {
    const m = map.current;
    if (!m || state !== "ready" || applied.current === basemap) return;
    applied.current = basemap;
    setBasemap(m, basemap);
  }, [basemap, state]);
  // 2D or 3D: the map is never made again for it, only raised or laid flat.
  const sceneApplied = useRef(false);
  useEffect(() => {
    const m = map.current;
    if (!m || state !== "ready" || sceneApplied.current === scene) return;
    sceneApplied.current = scene;
    setScene(m, scene);
  }, [scene, state]);
  /*
   * "Show me where it is": the reservoir lights up three times when somebody opens a dam from a
   * button (the owner, 18 Oct 2026). Only the dam that was asked for lights, which is why the
   * paint matches on the code each feature carries.
   *
   * Three pulses about one every 1.2s, far below the three flashes a second that can harm a
   * photosensitive reader; asked for less motion, it is held lit once for the same length of
   * time instead (lib/dam-map.ts). Nothing rests on it either way: the card with the figures is
   * what was opened, and this only says where to look.
   */
  const flashKey = flashDam?.key ?? 0;
  /** A stable string, so the effect does not run again for an array that reads the same. */
  const flashCodes = (flashDam?.codes ?? []).join(" ");
  const flashKind = flashDam?.kind ?? "reservoir";
  const flashLon = flashDam?.at?.lon ?? null;
  const flashLat = flashDam?.at?.lat ?? null;
  useEffect(() => {
    const m = map.current;
    if (!m || state !== "ready" || !flashCodes || flashKey === 0) return;
    const codes = flashCodes.split(" ");
    /*
     * A layer of its own, holding just this reservoir, switched on and off over the top of the
     * others. The obvious way - lifting the reservoir's own fill-opacity with an expression that
     * matches the code - is accepted by MapLibre and then draws nothing: fill-opacity takes no
     * per-feature value. Measured, not guessed: the frame's mean brightness was identical with
     * the paint set and without it.
     */
    const source =
      flashKind === "gauge" ? GAUGES : flashKind === "sea" ? SEA : DAM_WATER_SOURCE;
    const show = (on: boolean) => {
      if (!m.getSource(source)) return;
      try {
        if (on && !m.getLayer(DAM_FLASH_FILL)) {
          const water = damPaint(nightNow()).water;
          if (flashKind === "gauge" || flashKind === "sea") {
            const marks = flashKind === "gauge" ? GAUGES : SEA;
            /*
             * A ring around the station, or around the point off the coast, under its own
             * mark so the mark is still read. The gauge's colours say what it is doing
             * (lib/gauge-marks.ts), the sea's say what the waves are doing (lib/sea-marks.ts),
             * and this says nothing at all: it only points (safety rule 2).
             */
            m.addLayer(
              {
                id: DAM_FLASH_FILL,
                type: "circle",
                source: marks,
                filter: ["in", ["get", "id"], ["literal", codes]],
                paint: {
                  "circle-radius": GAUGE_FLASH_RADIUS,
                  "circle-color": "transparent",
                  /*
                   * The water colour, which is what the dam's own marks and the reservoir use.
                   * Not the page's ink: on the satellite picture that is slate on dark ground
                   * and could barely be seen (seen in the browser, 18 Oct). Never an alert
                   * colour - a station's reading is a measurement (safety rule 2).
                   */
                  "circle-stroke-color": water,
                  "circle-stroke-width": GAUGE_FLASH_WIDTH,
                  "circle-stroke-opacity": 1,
                },
              },
              m.getLayer(marks) ? marks : undefined,
            );
          } else {
            m.addLayer({
              id: DAM_FLASH_FILL,
              type: "fill",
              source: DAM_WATER_SOURCE,
              filter: ["in", ["get", "code"], ["literal", codes]],
              paint: { "fill-color": water, "fill-opacity": RESERVOIR_FLASH_OPACITY },
            });
            m.addLayer({
              id: DAM_FLASH_LINE,
              type: "line",
              source: DAM_WATER_SOURCE,
              filter: ["in", ["get", "code"], ["literal", codes]],
              paint: {
                "line-color": mapHalo(),
                "line-width": RESERVOIR_FLASH_WIDTH,
                "line-opacity": 0.9,
              },
            });
          }
        } else if (!on) {
          for (const id of [DAM_FLASH_LINE, DAM_FLASH_FILL]) {
            if (m.getLayer(id)) m.removeLayer(id);
          }
        }
      } catch {
        // The style is being replaced; the reservoir simply does not light this time.
        return;
      }
      /*
       * Written on the frame only once the lighting is actually drawn, so what a test watches is
       * the lighting itself and not merely the intention to light.
       */
      container.current?.setAttribute("data-map-lit", on ? flashCodes : "");
    };
    const timers: number[] = [];
    const whole = RESERVOIR_FLASH_TIMES * 2 * RESERVOIR_FLASH_MS;
    const pulse = () => {
      if (reducedMotion()) {
        show(true);
        timers.push(window.setTimeout(() => show(false), whole));
        return;
      }
      for (let i = 0; i < RESERVOIR_FLASH_TIMES; i += 1) {
        timers.push(window.setTimeout(() => show(true), i * 2 * RESERVOIR_FLASH_MS));
        timers.push(
          window.setTimeout(() => show(false), i * 2 * RESERVOIR_FLASH_MS + RESERVOIR_FLASH_MS),
        );
      }
    };
    /*
     * The data it lights is put on the map by the drawing effect, which may not have run yet -
     * a reservoir opened the moment the page is usable, or a station whose feed has only just
     * answered, would otherwise have been pointed at silently and never lit at all (the console
     * tests caught it, 18 Oct). So: light it now if the map already holds it, and otherwise
     * wait for the draw that brings it.
     */
    let begun = false;
    const begin = () => {
      if (begun || !m.getSource(source)) return;
      begun = true;
      m.off("idle", begin);
      /*
       * A mark lit off the edge of the screen is a mark nobody sees, so one that is not in the
       * frame is brought into it - the middle of the map, at the zoom the reader chose. One
       * already on the screen is left exactly where it is: moving the map under somebody who
       * can see the thing they asked about is a nuisance, not a help.
       */
      if (flashLon !== null && flashLat !== null && !m.getBounds().contains([flashLon, flashLat])) {
        m.easeTo({ center: [flashLon, flashLat], duration: reducedMotion() ? 0 : 700 });
      }
      pulse();
    };
    begin();
    if (!begun) m.on("idle", begin);
    return () => {
      m.off("idle", begin);
      for (const timer of timers) window.clearTimeout(timer);
      show(false);
    };
  }, [flashCodes, flashKey, flashKind, flashLat, flashLon, state]);
  /*
   * The same "show me where it is" for the flood a satellite saw (the owner, 20 Oct 2026): the
   * hexagons blink three times once the map has been brought to them, so it is clear which
   * shapes on the map have just appeared.
   *
   * Here it is the layers' own visibility that is switched, not a lit copy of one feature: what
   * is being pointed at is the whole layer, and there is nothing to tell apart inside it. For
   * anyone who asked for less motion nothing blinks - the hexagons are simply there, and the map
   * has already travelled to them.
   */
  useEffect(() => {
    const m = map.current;
    if (!m || state !== "ready" || flashSatellite === 0) return;
    const mark = (on: boolean) =>
      container.current?.setAttribute("data-satellite-lit", on ? "on" : "");
    const timers: number[] = [];
    const whole = RESERVOIR_FLASH_TIMES * 2 * RESERVOIR_FLASH_MS;
    const show = (on: boolean) => {
      try {
        for (const id of [SATELLITE, SATELLITE_LINE]) {
          if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", on ? "visible" : "none");
        }
      } catch {
        // The style is being replaced; the layer simply does not blink this time.
        return;
      }
      mark(on);
    };
    let begun = false;
    const begin = () => {
      if (begun || !m.getLayer(SATELLITE)) return;
      begun = true;
      m.off("idle", begin);
      if (reducedMotion()) {
        mark(true);
        timers.push(window.setTimeout(() => mark(false), whole));
        return;
      }
      for (let i = 0; i < RESERVOIR_FLASH_TIMES; i += 1) {
        timers.push(window.setTimeout(() => show(false), i * 2 * RESERVOIR_FLASH_MS));
        timers.push(
          window.setTimeout(() => show(true), i * 2 * RESERVOIR_FLASH_MS + RESERVOIR_FLASH_MS),
        );
      }
    };
    begin();
    // The hexagons arrive with the answer from GISTDA, which may be later than this effect.
    if (!begun) m.on("idle", begin);
    return () => {
      m.off("idle", begin);
      for (const timer of timers) window.clearTimeout(timer);
      show(true);
      mark(false);
    };
  }, [flashSatellite, state]);
  /*
   * Where the map is looking, told to the caller after each move so it can come back to this
   * view later. A ref, so a map that is being panned does not render the page on every frame.
   */
  const view = useRef(onView);
  useEffect(() => {
    view.current = onView;
  }, [onView]);
  useEffect(() => {
    const m = map.current;
    if (!m || state !== "ready") return;
    const moved = () => {
      const b = m.getBounds();
      const box: [number, number, number, number] = [
        b.getWest(),
        b.getSouth(),
        b.getEast(),
        b.getNorth(),
      ];
      /*
       * Also written onto the frame, so what the map is looking at can be read from outside it -
       * the e2e checks that closing the satellite layer puts the reader back where they were,
       * and a frame it cannot see is a frame it has to take on trust.
       */
      container.current?.setAttribute(
        "data-map-view",
        box.map((n) => n.toFixed(3)).join(","),
      );
      view.current?.(box);
    };
    m.on("moveend", moved);
    /*
     * And once now. The first fit often moves the camera nowhere at all - the map is made with
     * the same box it is then fitted to - so without this there would be no "where the map is
     * looking" until the reader moved it themselves, and nothing to come back to.
     */
    moved();
    return () => {
      m.off("moveend", moved);
    };
  }, [state]);
  const select = useRef(onSelect);
  const draw = useRef<() => void>(() => {});
  // The places as the handlers below need them, without rebuilding the map when they change.
  const minePlaces = useRef<MinePlace[]>(mine);
  const popup = useRef<Popup | null>(null);
  /*
   * One pop-up at a time, for the person's own places and (with `peek`) for a reservoir, a gauge
   * or a safe place. A mouse opens it on hover and it closes a moment after the pointer leaves -
   * unless the pointer went into the pop-up, so its buttons can be reached. A click or a tap
   * pins it: it then stays until a tap elsewhere on the map, Escape, or a change of layers.
   * Pinning also covers the phone's own mouse move right after a tap, which would otherwise
   * close the pop-up in the instant it appeared.
   */
  const [peekAt, setPeekAt] = useState<{ target: PeekTarget; node: HTMLElement } | null>(null);
  const hasPeek = useRef(false);
  const closePeek = useRef<() => void>(() => {});
  /*
   * The rain clouds are HTML markers over the map, not features in it, so the map cannot find
   * them under the pointer: they open their pop-up through these, and while the pointer is on a
   * cloud the map's own "nothing here" does not close it.
   */
  const peekCloud = useRef<(cloud: RainCloud, how: "hover" | "leave" | "tap") => void>(() => {});

  useEffect(() => {
    select.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    minePlaces.current = mine;
  }, [mine]);

  useEffect(() => {
    hasPeek.current = !!peek;
  }, [peek]);

  // A pop-up for something no longer drawn would point at nothing.
  const drawnKey = `${layers.join(",")}|${showMine}`;
  useEffect(() => {
    closePeek.current();
  }, [drawnKey]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closePeek.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const collections = {
      ...toCollections(
        data,
        mine,
        dams,
        {
          spillway: spillwayLabel,
          outlet: outletLabel,
          locale: damLocale,
        },
        { near: nearWord, over: overWord },
      ),
      [SATELLITE]: satelliteData,
      [SEA]: seaData,
      [AREA_LABEL_SOURCE]: areaNameData,
    };
    const show = (layer: MapLayer) => (layers.includes(layer) ? "visible" : "none");
    const dark = nightNow();
    const paint = damPaint(dark);
    /*
     * The dam's three marks take the state's colour (the owner, 12 Oct: normal green, attention
     * yellow, a release red). One layer, painted from the `level` each mark carries, so a dam
     * whose feed has gone quiet is grey rather than green (safety rule 10).
     */
    const markPaint = (night: boolean) =>
      [
        "match",
        ["get", "level"],
        "normal",
        markColor("normal", night),
        "watch",
        markColor("watch", night),
        "releasing",
        markColor("releasing", night),
        markColor("unknown", night),
      ] as unknown as string;
    draw.current = () => {
      const m = map.current;
      if (!m) return;
      try {
        for (const [id, value] of Object.entries(collections)) {
          const source = m.getSource(id) as GeoJSONSource | undefined;
          if (!source) m.addSource(id, { type: "geojson", data: value });
          else if (held.current.get(id) !== value) source.setData(value);
          held.current.set(id, value);
        }
        const above = m.getLayer(TAMBON_LINE_LAYER) ? TAMBON_LINE_LAYER : undefined;
        /*
         * The hazard classes, under everything else of ours: they are the ground the other layers
         * sit on. Their colours are the same by day and by night (lib/hazard-layer.ts).
         */
        if (hazardUrl && !m.getSource(HAZARD)) {
          m.addSource(HAZARD, { type: "vector", url: hazardUrl });
        }
        if (m.getSource(HAZARD) && !m.getLayer(HAZARD_FILL)) {
          m.addLayer(
            {
              id: HAZARD_FILL,
              type: "fill",
              source: HAZARD,
              "source-layer": HAZARD_SOURCE_LAYER,
              paint: {
                "fill-color": hazardFillColor() as never,
                "fill-opacity": HAZARD_OPACITY,
                "fill-antialias": false,
              },
            },
            above,
          );
        }
        if (m.getLayer(HAZARD_FILL)) {
          m.setLayoutProperty(HAZARD_FILL, "visibility", show("hazard"));
          // The shades follow the ground they are drawn on: lighter on the dark map (lib/hazard-layer.ts).
          m.setPaintProperty(HAZARD_FILL, "fill-color", hazardFillColor(mapIsDark()) as never);
          m.setPaintProperty(
            HAZARD_FILL,
            "fill-opacity",
            mapIsDark() ? HAZARD_OPACITY_NIGHT : HAZARD_OPACITY,
          );
        }
        /*
         * Flood seen by satellite: above the flood-prone areas, under the alert levels. Violet,
         * by day and by night, and never an alert colour; each hexagon is given an edge as well,
         * dark by day and pale at night, so one on its own still reads (lib/satellite-flood.ts).
         */
        if (!m.getLayer(SATELLITE)) {
          m.addLayer(
            {
              id: SATELLITE,
              type: "fill",
              source: SATELLITE,
              paint: { "fill-color": satelliteColor(false), "fill-opacity": SATELLITE_OPACITY },
            },
            above,
          );
          m.addLayer(
            {
              id: SATELLITE_LINE,
              type: "line",
              source: SATELLITE,
              paint: {
                "line-color": satelliteEdge(false),
                "line-width": SATELLITE_LINE_WIDTH,
              },
            },
            above,
          );
        }
        m.setPaintProperty(SATELLITE, "fill-color", satelliteColor(mapIsDark()));
        m.setPaintProperty(SATELLITE_LINE, "line-color", satelliteEdge(mapIsDark()));
        if (!m.getLayer(ALERT_FILL)) {
          m.addLayer({ id: ALERT_FILL, type: "fill", source: TAMBON_SOURCE, paint: {} }, above);
        }
        if (!m.getLayer(REPORTS)) {
          m.addLayer(
            {
              id: REPORTS,
              type: "fill",
              source: REPORTS,
              paint: {
                "fill-color": ink(),
                "fill-opacity": ["interpolate", ["linear"], ["get", "count"], 1, 0.3, 10, 0.7],
              },
            },
            above,
          );
          m.addLayer({
            id: REPORTS_LINE,
            type: "line",
            source: REPORTS,
            paint: { "line-color": ink(), "line-width": 1.5 },
          });
        }
        // The basemap's place names go above the fills just added, or the shading hides them.
        liftBasemapLabels(m);
        if (!m.getLayer(ALERT_STALE)) {
          m.addLayer({
            id: ALERT_STALE,
            type: "line",
            source: TAMBON_SOURCE,
            filter: ["in", ["get", "code"], ["literal", []]],
            paint: { "line-color": STALE_COLOR, "line-width": 3, "line-dasharray": [2, 2] },
          });
        }
        /*
         * The four provinces at a glance (the owner, 15 Oct): their outlines always, and their
         * capitals by name while the whole area is in view; the tambon outlines and the
         * basemap's own names wait until the reader zooms in (lib/map.ts, quietOverview).
         */
        if (!m.getSource(PROVINCE_SOURCE)) {
          m.addSource(PROVINCE_SOURCE, { type: "geojson", data: PROVINCES_URL });
        }
        if (!m.getLayer(PROVINCE_LINE_LAYER)) {
          m.addLayer({
            id: PROVINCE_LINE_LAYER,
            type: "line",
            source: PROVINCE_SOURCE,
            filter: ["==", ["get", "kind"], "province"],
            paint: provinceLinePaint(false, false),
          });
          m.addLayer({
            id: CAPITAL_LAYER,
            type: "symbol",
            source: PROVINCE_SOURCE,
            filter: ["==", ["get", "kind"], "capital"],
            layout: {
              "text-field": ["get", damLocale === "th" ? "name_th" : "name_en"],
              "text-font": ["Noto Sans Bold"],
              "text-size": 15,
              "text-allow-overlap": true,
            },
            paint: { "text-color": ink(), "text-halo-color": mapHalo(), "text-halo-width": 1.6 },
          });
        }
        for (const [key, value] of Object.entries(provinceLinePaint(mapIsDark(), photoNow()))) {
          m.setPaintProperty(PROVINCE_LINE_LAYER, key as "line-color", value as never);
        }
        m.setPaintProperty(CAPITAL_LAYER, "text-color", photoNow() ? "#ffffff" : ink());
        m.setPaintProperty(CAPITAL_LAYER, "text-halo-color", photoNow() ? "#1d3b53" : mapHalo());
        /*
         * The districts and then the tambons by name, as the reader zooms in (the owner,
         * 18 Oct). They belong above our fills, so the alert colours never cover a name, and
         * before the basemap's own names, which is what makes MapLibre keep a tambon name and
         * drop the village name that collides with it rather than the other way about
         * (lib/map.ts, beforeBasemapLabels). Nothing here is a status: they are the names of the
         * places, in the reader's language, and they say nothing about the water.
         */
        const sizeByZoom = (near: number, small: number, far: number, large: number) =>
          ["interpolate", ["linear"], ["zoom"], near, small, far, large] as unknown as number;
        if (!m.getLayer(DISTRICT_LABEL_LAYER)) {
          const under = beforeBasemapLabels(m.getStyle().layers);
          m.addLayer(
            {
              id: DISTRICT_LABEL_LAYER,
              type: "symbol",
              source: AREA_LABEL_SOURCE,
              filter: ["==", ["get", "kind"], "district"],
              layout: {
                "text-field": ["get", "label"],
                "text-font": ["Noto Sans Bold"],
                "text-size": sizeByZoom(8, 12, 13, 15),
                "text-letter-spacing": 0.04,
                "text-max-width": 8,
                "text-padding": 3,
              },
              paint: { "text-halo-width": 1.8 },
            },
            under,
          );
          m.addLayer(
            {
              id: TAMBON_LABEL_LAYER,
              type: "symbol",
              source: AREA_LABEL_SOURCE,
              filter: ["==", ["get", "kind"], "tambon"],
              layout: {
                "text-field": ["get", "label"],
                "text-font": ["Noto Sans Regular"],
                "text-size": sizeByZoom(10, 11, 14, 13),
                "text-max-width": 8,
                "text-padding": 2,
              },
              paint: { "text-halo-width": 1.6 },
            },
            under,
          );
        }
        /*
         * The basemap's own names may be lifted above ours after a change of ground; put ours back
         * under the first of them, so they keep their place in the queue.
         */
        const order = m.getStyle().layers.map((l) => l.id);
        const firstBasemapName = beforeBasemapLabels(m.getStyle().layers);
        if (
          firstBasemapName &&
          order.indexOf(DISTRICT_LABEL_LAYER) > order.indexOf(firstBasemapName)
        ) {
          m.moveLayer(DISTRICT_LABEL_LAYER, firstBasemapName);
          m.moveLayer(TAMBON_LABEL_LAYER, firstBasemapName);
        }
        for (const layer of [DISTRICT_LABEL_LAYER, TAMBON_LABEL_LAYER]) {
          m.setPaintProperty(layer, "text-color", photoNow() ? "#ffffff" : ink());
          m.setPaintProperty(layer, "text-halo-color", photoNow() ? "#1d3b53" : halo());
        }
        /*
         * The dam, its reservoir and the path released water takes (spec section 15). Drawn
         * above the alert fill, so the river can be followed across coloured tambons, and below
         * the safe places and the person's own pins, which are what they came to tap.
         */
        // The hatching is an image, and a change of basemap drops the map's images.
        const ensureHatch = () => {
          const name = zoneHatchName(paint.water);
          if (!m.hasImage(name)) {
            const picture = zoneHatch(paint.water);
            if (picture) m.addImage(name, picture, { pixelRatio: ZONE_HATCH_RATIO });
          }
        };
        if (!m.getLayer(DAM_RESERVOIR_FILL)) {
          /*
           * The land a rise in the river can reach (lib/dam.ts, DamZone). Hatched, with a cased
           * outline, and the outer band an outline only: it has to be seen over the flood-risk
           * classes without hiding them (lib/dam-map.ts, zoneHatch). It is not a flood extent and
           * the legend says so.
           */
          ensureHatch();
          m.addLayer(
            {
              id: DAM_ZONE_FILL,
              type: "fill",
              source: DAM_ZONE_SOURCE,
              filter: ["==", ["get", "band"], "zone"],
              paint: { "fill-pattern": zoneHatchName(paint.water), "fill-opacity": 0.85 },
            },
            above,
          );
          // A pale casing under the outline, so it carries over the flood-risk colours.
          m.addLayer(
            {
              id: DAM_ZONE_CASING,
              type: "line",
              source: DAM_ZONE_SOURCE,
              filter: ["==", ["get", "band"], "zone"],
              paint: { "line-color": paint.casing, "line-width": 4, "line-opacity": 0.85 },
            },
            above,
          );
          m.addLayer(
            {
              id: DAM_ZONE_LINE,
              type: "line",
              source: DAM_ZONE_SOURCE,
              filter: ["==", ["get", "band"], "zone"],
              paint: { "line-color": paint.water, "line-width": 2 },
            },
            above,
          );
          m.addLayer(
            {
              id: DAM_ZONE_OUTER,
              type: "line",
              source: DAM_ZONE_SOURCE,
              filter: ["==", ["get", "band"], "outer"],
              paint: {
                "line-color": paint.water,
                "line-width": 1.5,
                "line-opacity": 0.9,
                "line-dasharray": [3, 2],
              },
            },
            above,
          );
          m.addLayer(
            {
              id: DAM_RESERVOIR_FILL,
              type: "fill",
              source: DAM_WATER_SOURCE,
              // Faint on purpose: 43 km2 of solid colour would hide the alert levels under it.
              paint: { "fill-color": paint.water, "fill-opacity": RESERVOIR_FILL_OPACITY },
            },
            above,
          );
          m.addLayer(
            {
              id: DAM_RESERVOIR_LINE,
              type: "line",
              source: DAM_WATER_SOURCE,
              paint: { "line-color": paint.water, "line-width": RESERVOIR_LINE_WIDTH },
            },
            above,
          );
          // The lower reaches of the streams that join the river: dashed, so they are never
          // mistaken for the river itself.
          m.addLayer(
            {
              id: DAM_TRIBUTARY,
              type: "line",
              source: DAM_REACHES,
              filter: ["==", ["get", "kind"], "tributary"],
              paint: {
                "line-color": paint.water,
                "line-width": byZoom(TRIBUTARY_WIDTH) as never,
                "line-dasharray": TRIBUTARY_DASH,
                "line-opacity": 0.9,
              },
            },
            above,
          );
          // A casing under the river, so the line carries over a red or orange tambon.
          m.addLayer(
            {
              id: DAM_CASING,
              type: "line",
              source: DAM_REACHES,
              filter: ["!=", ["get", "kind"], "tributary"],
              layout: { "line-cap": "round", "line-join": "round" },
              paint: {
                "line-color": paint.casing,
                "line-width": [
                  "+",
                  byZoom(MAIN_WIDTH),
                  ["case", ["==", ["get", "emphasis"], 1], CASING_EXTRA * 2, CASING_EXTRA],
                ] as never,
                "line-opacity": 0.75,
              },
            },
            above,
          );
          m.addLayer(
            {
              id: DAM_MAIN,
              type: "line",
              source: DAM_REACHES,
              filter: ["!=", ["get", "kind"], "tributary"],
              layout: { "line-cap": "round", "line-join": "round" },
              paint: {
                "line-color": paint.water,
                "line-width": byZoom(MAIN_WIDTH) as never,
              },
            },
            above,
          );
        }
        if (!m.getLayer(DAM_MARKS)) {
          m.addLayer({
            id: DAM_MARKS,
            type: "circle",
            source: DAM_POINTS,
            paint: {
              "circle-radius": ["case", ["==", ["get", "kind"], "dam"], 8, 5.5],
              "circle-color": markPaint(dark),
              "circle-stroke-color": paint.halo,
              "circle-stroke-width": 2.5,
            },
          });
          /*
           * The labels are always on. They are how the dam is told apart from every other mark
           * on the map, which matters more than saving the space: a person looking for the dam
           * should not have to tap around to find which circle it is.
           */
          m.addLayer({
            id: DAM_LABELS,
            type: "symbol",
            source: DAM_POINTS,
            layout: {
              "text-field": ["get", "label"],
              "text-font": ["Noto Sans Regular"],
              "text-size": ["case", ["==", ["get", "kind"], "dam"], 13, 11],
              "text-anchor": "left",
              "text-offset": [0.8, 0],
              "text-max-width": 10,
              "text-allow-overlap": false,
              // The dam's own name wins against the basemap's village names.
              "text-ignore-placement": false,
              "symbol-sort-key": ["case", ["==", ["get", "kind"], "dam"], 0, 1],
            },
            paint: {
              "text-color": paint.label,
              "text-halo-color": paint.halo,
              "text-halo-width": 1.8,
            },
          });
        }
        /*
         * Safe places are squares with a small house or a P, never dots: the person's own pins are
         * round, and the two must not look alike (lib/place-icons.ts). The pictures are drawn here
         * and are lost whenever the basemap replaces the style, so they are put back on every draw.
         */
        const placeImage = placeIconName("place", ink());
        const parkingImage = placeIconName("parking", ink());
        for (const [name, kind] of [
          [placeImage, "place"],
          [parkingImage, "parking"],
        ] as const) {
          if (!m.hasImage(name)) {
            const picture = placeIcon(kind, ink(), halo());
            if (picture) m.addImage(name, picture, { pixelRatio: PLACE_ICON_RATIO });
          }
        }
        if (!m.getLayer(PLACES)) {
          m.addLayer({
            id: PLACES,
            type: "symbol",
            source: PLACES,
            layout: {
              "icon-image": placeImage,
              // Small while the whole province is in view (there are thousands), full size close in.
              "icon-size": ["interpolate", ["linear"], ["zoom"], 8, 0.5, 12, 1],
              "icon-allow-overlap": true,
              "icon-ignore-placement": true,
            },
          });
        }
        m.setLayoutProperty(PLACES, "icon-image", [
          "case",
          ["==", ["get", "parking"], 1],
          parkingImage,
          placeImage,
        ]);
        /*
         * The river gauges: a glass with water in it that sways, ripples near or over the bank,
         * a chevron for the last three hours (lib/gauge-marks.ts). Each picture redraws itself;
         * only the ones in use are made, and none moves for someone who asked for less motion.
         */
        const night = mapIsDark();
        const moving = !reducedMotion();
        const gaugeKinds = new Set(
          (data?.gauges ?? []).map((g) => {
            const look = gaugeLook(g.status);
            return `${look}|${trendOf(g.rise3h ?? null, look)}`;
          }),
        );
        for (const kind of gaugeKinds) {
          const [look, trend] = kind.split("|") as [GaugeLook, Trend];
          const name = gaugeImageName(look, trend, night);
          if (!m.hasImage(name)) {
            const picture = gaugeImage(look, trend, night, moving);
            if (picture) m.addImage(name, picture, { pixelRatio: GAUGE_IMAGE_RATIO });
          }
        }
        const gaugeIcon = [
          "concat",
          "jaga-gauge-",
          ["get", "look"],
          "-",
          ["get", "trend"],
          night ? "-night" : "-day",
        ] as unknown as string;
        if (m.getLayer(GAUGES) && m.getLayer(GAUGES)!.type !== "symbol") m.removeLayer(GAUGES);
        if (!m.getLayer(GAUGES)) {
          m.addLayer({
            id: GAUGES,
            type: "symbol",
            source: GAUGES,
            layout: {
              "icon-image": gaugeIcon,
              "icon-size": ["interpolate", ["linear"], ["zoom"], 7, 0.5, 9, 0.75, 12, 1.1],
              "icon-allow-overlap": true,
              "icon-ignore-placement": true,
              "symbol-sort-key": ["get", "rank"],
            },
          });
        }
        m.setLayoutProperty(GAUGES, "icon-image", gaugeIcon);
        if (!m.getLayer(GAUGE_LABEL)) {
          m.addLayer({
            id: GAUGE_LABEL,
            type: "symbol",
            source: GAUGES,
            layout: {
              // Far out only the gauges near or over their bank are named; close in, every level.
              "text-field": ["step", ["zoom"], ["get", "short"], 10, ["get", "long"]],
              "text-font": ["Noto Sans Regular"],
              "text-size": 12,
              "text-anchor": "left",
              "text-offset": [1.3, 0],
              "text-allow-overlap": true,
              "text-ignore-placement": true,
              "symbol-sort-key": ["get", "rank"],
            },
          });
        }
        const gp = gaugePaint(night);
        m.setPaintProperty(GAUGE_LABEL, "text-color", gp.rim);
        m.setPaintProperty(GAUGE_LABEL, "text-halo-color", gp.halo);
        m.setPaintProperty(GAUGE_LABEL, "text-halo-width", 1.8);
        /*
         * The sea off the coast: a patch of water whose crests roll the way the model's waves
         * travel, more and quicker the rougher the sea (lib/sea-marks.ts). Turned to the bearing
         * on the map itself, so it keeps pointing the right way when the map is turned.
         */
        for (const grade of new Set(seaData.features.map((f) => f.properties?.grade as SeaGrade))) {
          const name = seaImageName(grade, night);
          if (!m.hasImage(name)) {
            const picture = seaImage(grade, night, moving);
            if (picture) m.addImage(name, picture, { pixelRatio: SEA_IMAGE_RATIO });
          }
        }
        const seaIcon = [
          "concat",
          "jaga-sea-",
          ["get", "grade"],
          night ? "-night" : "-day",
        ] as unknown as string;
        if (!m.getLayer(SEA)) {
          m.addLayer({
            id: SEA,
            type: "symbol",
            source: SEA,
            layout: {
              "icon-image": seaIcon,
              "icon-size": ["interpolate", ["linear"], ["zoom"], 7, 0.65, 9, 0.9, 12, 1.2],
              "icon-rotate": ["get", "bearing"],
              "icon-rotation-alignment": "map",
              "icon-allow-overlap": true,
              "icon-ignore-placement": true,
              "symbol-sort-key": ["get", "rank"],
            },
          });
          m.addLayer({
            id: SEA_LABEL,
            type: "symbol",
            source: SEA,
            layout: {
              // Far out only a sea that is not calm is named; close in, every point's waves.
              "text-field": ["step", ["zoom"], ["get", "short"], 9, ["get", "long"]],
              "text-font": ["Noto Sans Regular"],
              "text-size": 12,
              "text-anchor": "left",
              "text-offset": [1.6, 0],
              "text-allow-overlap": true,
              "text-ignore-placement": true,
              "symbol-sort-key": ["get", "rank"],
            },
          });
        }
        m.setLayoutProperty(SEA, "icon-image", seaIcon);
        const sp = seaPaint(night);
        m.setPaintProperty(SEA_LABEL, "text-color", sp.water);
        m.setPaintProperty(SEA_LABEL, "text-halo-color", sp.halo);
        m.setPaintProperty(SEA_LABEL, "text-halo-width", 1.8);
        /*
         * The person's own places: a pin with a house for their home, and focus brackets around
         * a dot for each watched place, each moving slowly (lib/mine-marks.ts). Their own shapes,
         * so they are never mistaken for the round gauges. One picture per colour and theme.
         */
        for (const place of mine) {
          const kind = place.home ? "home" : "watch";
          const name = mineImageName(kind, place.color, night);
          if (!m.hasImage(name)) {
            const picture = mineImage(kind, place.color, night, moving);
            if (picture) m.addImage(name, picture, { pixelRatio: MINE_IMAGE_RATIO });
          }
        }
        const isHome: ExpressionSpecification = ["==", ["get", "home"], 1];
        const mineIcon = [
          "concat",
          "jaga-mine-",
          ["case", isHome, "home", "watch"],
          "-",
          ["get", "hex"],
          night ? "-night" : "-day",
        ] as unknown as string;
        if (m.getLayer(MINE) && m.getLayer(MINE)!.type !== "symbol") m.removeLayer(MINE);
        if (!m.getLayer(MINE)) {
          // On top of the public layers: these few points are what the person came to find.
          m.addLayer({
            id: MINE,
            type: "symbol",
            source: MINE,
            layout: {
              "icon-image": mineIcon,
              "icon-size": ["interpolate", ["linear"], ["zoom"], 7, 0.8, 12, 1],
              // The pin's tip, not its middle, stands on the home.
              "icon-offset": ["case", isHome, ["literal", [0, -HOME_TIP_DY]], ["literal", [0, 0]]],
              "icon-allow-overlap": true,
              "icon-ignore-placement": true,
              // The home on top of a watched place that shares its spot.
              "symbol-sort-key": ["case", isHome, 2, 1],
            },
          });
        }
        m.setLayoutProperty(MINE, "icon-image", mineIcon);
        if (!m.getLayer(MINE_LABEL)) {
          /*
           * The name of each place, written on the map itself, so they can be read at a glance
           * without pointing at every pin. Hover or tap still gives the person there and the
           * address. It needs the style's font server (lib/map.ts).
           */
          m.addLayer({
            id: MINE_LABEL,
            type: "symbol",
            source: MINE,
            layout: {
              "text-field": ["get", "label"],
              "text-font": ["Noto Sans Regular"],
              "text-size": 13,
              "text-anchor": "top",
              // Under the pin's tip for the home; clear of the brackets for a watched place.
              "text-offset": [
                "case",
                ["==", ["get", "home"], 1],
                ["literal", [0, 0.5]],
                ["literal", [0, 1.7]],
              ],
              "text-max-width": 9,
              /*
               * Always drawn. Our layer is added after the basemap's, so MapLibre would give the
               * basemap's own place names priority and hide these instead - and someone's own
               * places matter more to them than the name of a neighbouring village. A person has
               * at most ten, and they can zoom in if two sit on top of each other.
               */
              "text-allow-overlap": true,
              "text-ignore-placement": true,
            },
            paint: {
              "text-color": ink(),
              // A white outline keeps the name readable over the basemap and over a coloured
              // tambon, without a box that would cover the map.
              "text-halo-color": halo(),
              "text-halo-width": 1.8,
            },
          });
        }
        /*
         * At the four-province view the capitals' names sit over every mark, and the other names
         * (reservoirs, sea points, gauge words) wait for a closer look; the marks themselves and
         * the person's own place names stay (lib/map.ts, quietOverview).
         */
        if (m.getStyle().layers.at(-1)?.id !== CAPITAL_LAYER) m.moveLayer(CAPITAL_LAYER);
        quietOverview(m, [DAM_LABELS, SEA_LABEL, GAUGE_LABEL]);
        /*
         * The dam follows the theme while the page is open: the daytime water colour vanishes
         * into the dark basemap after sunset, and the page turns itself dark at sunset without
         * reloading (components/DaylightTheme.tsx).
         */
        ensureHatch();
        for (const [layer, property, value] of [
          [DAM_ZONE_FILL, "fill-pattern", zoneHatchName(paint.water)],
          [DAM_ZONE_CASING, "line-color", paint.casing],
          [DAM_ZONE_LINE, "line-color", paint.water],
          [DAM_ZONE_OUTER, "line-color", paint.water],
          [DAM_RESERVOIR_FILL, "fill-color", paint.water],
          [DAM_RESERVOIR_LINE, "line-color", paint.water],
          [DAM_TRIBUTARY, "line-color", paint.water],
          [DAM_CASING, "line-color", paint.casing],
          [DAM_MAIN, "line-color", paint.water],
          [DAM_MARKS, "circle-color", markPaint(dark)],
          [DAM_MARKS, "circle-stroke-color", paint.halo],
          [DAM_LABELS, "text-color", paint.label],
          [DAM_LABELS, "text-halo-color", paint.halo],
        ] as const) {
          m.setPaintProperty(layer, property, value);
        }
        // In every view: the river does not stop running through someone's tambon because they
        // switched to the risk map (the owner, 10 Oct).
        // Each half has its own chip above the map (15 Oct); both are on unless switched off.
        const damOn = dams.length > 0 && showDam ? "visible" : "none";
        const zoneOn = dams.length > 0 && showDamZone ? "visible" : "none";
        for (const layer of [DAM_ZONE_FILL, DAM_ZONE_CASING, DAM_ZONE_LINE, DAM_ZONE_OUTER]) {
          m.setLayoutProperty(layer, "visibility", zoneOn);
        }
        for (const layer of [
          DAM_RESERVOIR_FILL,
          DAM_RESERVOIR_LINE,
          DAM_TRIBUTARY,
          DAM_CASING,
          DAM_MAIN,
          DAM_MARKS,
          DAM_LABELS,
        ]) {
          m.setLayoutProperty(layer, "visibility", damOn);
        }
        m.setPaintProperty(ALERT_FILL, "fill-color", alertFillColor(status));
        m.setFilter(ALERT_STALE, ["in", ["get", "code"], ["literal", staleTambons(status, now)]]);
        m.setLayoutProperty(ALERT_FILL, "visibility", show("alerts"));
        m.setLayoutProperty(ALERT_STALE, "visibility", show("alerts"));
        m.setLayoutProperty(REPORTS, "visibility", show("reports"));
        m.setLayoutProperty(REPORTS_LINE, "visibility", show("reports"));
        m.setLayoutProperty(PLACES, "visibility", show("places"));
        m.setLayoutProperty(GAUGES, "visibility", show("gauges"));
        m.setLayoutProperty(GAUGE_LABEL, "visibility", show("gauges"));
        const mineOn = showMine && mine.length > 0 ? "visible" : "none";
        m.setLayoutProperty(MINE, "visibility", mineOn);
        m.setLayoutProperty(MINE_LABEL, "visibility", mineOn);
      } catch {
        // The style is being replaced: the next "styledata" or "idle" draws again.
      }
    };
    draw.current();
  }, [
    layers,
    showDam,
    showDamZone,
    status,
    data,
    now,
    mine,
    showMine,
    dams,
    spillwayLabel,
    outletLabel,
    damLocale,
    hazardUrl,
    satelliteData,
    seaData,
    areaNameData,
    nearWord,
    overWord,
  ]);

  useEffect(() => {
    if (!container.current) return;
    let cancelled = false;
    applied.current = basemapAtStart.current;
    // A new map starts flat; the scene effect raises it again if 3D is chosen.
    sceneApplied.current = false;
    createServiceAreaMap(container.current, basemapAtStart.current, gestureAtStart.current)
      .then((created) => {
        if (cancelled) {
          created.remove();
          return;
        }
        map.current = created;
        const redraw = () => draw.current();
        created.once("load", () => {
          redraw();
          setState("ready");
          setLoaded(created);
        });
        // After the basemap replaces the style, sources may hold their first data again.
        created.on("style.load", () => held.current.clear());
        created.on("styledata", redraw);
        created.on("idle", redraw);
        type Hit = {
          key: string;
          lngLat: [number, number];
          target: PeekTarget | null;
          own: MinePlace | null;
          /** How far above its point the pop-up opens: above a cloud, not over it. */
          offset?: number;
        };
        let openKey: string | null = null;
        let pinned = false;
        let overPopup = false;
        let hideTimer: number | undefined;
        let watchSize: ResizeObserver | null = null;
        let overCloud = false;
        /*
         * A pinned pop-up must be readable whole: the map is a frame that cuts off whatever
         * leaves it, and on a phone a gauge near the top edge lost half its figures. The map moves
         * just enough to bring the pop-up inside, again when it grows (Navigate opened). Never for
         * a hover, where moving the map under the pointer would be a nuisance.
         */
        /*
         * The box itself is never taller than the map: a pop-up that outgrows the frame cannot be
         * brought inside by moving the map, so the bottom of it was simply cut off (the owner saw
         * it on a gauge, 14 Oct). What does not fit scrolls inside the box (app/globals.css).
         */
        const capPopup = () => {
          const content = popup.current
            ?.getElement()
            .querySelector<HTMLElement>(".maplibregl-popup-content");
          if (!content) return;
          const frame = created.getContainer().getBoundingClientRect();
          const room = `${Math.max(POPUP_MIN_H, Math.round(frame.height - POPUP_AIR))}px`;
          if (content.style.maxHeight !== room) content.style.maxHeight = room;
        };
        const fitPopup = () => {
          capPopup();
          const element = popup.current?.getElement();
          if (!element || !pinned) return;
          const box = element.getBoundingClientRect();
          const frame = created.getContainer().getBoundingClientRect();
          const gap = 8;
          let dx = 0;
          let dy = 0;
          if (box.top < frame.top + gap || box.height > frame.height - 2 * gap) {
            dy = box.top - frame.top - gap;
          } else if (box.bottom > frame.bottom - gap) dy = box.bottom - frame.bottom + gap;
          if (box.left < frame.left + gap) dx = box.left - frame.left - gap;
          else if (box.right > frame.right - gap) dx = box.right - frame.right + gap;
          if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
          const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
          created.panBy([dx, dy], { duration: still ? 0 : 300 });
        };
        const close = () => {
          window.clearTimeout(hideTimer);
          watchSize?.disconnect();
          watchSize = null;
          popup.current?.remove();
          popup.current = null;
          openKey = null;
          pinned = false;
          overPopup = false;
          setPeekAt(null);
        };
        closePeek.current = close;
        const closeSoon = () => {
          if (pinned) return;
          window.clearTimeout(hideTimer);
          hideTimer = window.setTimeout(() => {
            if (!overPopup && !pinned) close();
          }, 300);
        };
        const show = (hit: Hit, pin: boolean) => {
          window.clearTimeout(hideTimer);
          if (pin) pinned = true;
          if (openKey === hit.key) {
            if (pin) requestAnimationFrame(fitPopup);
            return;
          }
          openKey = hit.key;
          // The person's own place is written as text nodes (lib/mine-label.ts); everything else
          // is drawn by the caller into this node, through a portal.
          const node = hit.own ? mineLabel(hit.own) : document.createElement("div");
          void import("maplibre-gl").then(({ Popup }) => {
            if (map.current !== created || openKey !== hit.key) return;
            popup.current?.remove();
            const opened = new Popup({
              closeButton: false,
              closeOnClick: false,
              /*
               * Above a raised mark (a cloud over its pin) the pop-up opens higher; when the map
               * edge turns it to open below or beside the point, it sits close as usual.
               */
              offset: hit.offset
                ? {
                    top: [0, 14],
                    "top-left": [0, 14],
                    "top-right": [0, 14],
                    bottom: [0, -hit.offset],
                    "bottom-left": [0, -hit.offset],
                    "bottom-right": [0, -hit.offset],
                    left: [14, -hit.offset / 2],
                    right: [-14, -hit.offset / 2],
                    center: [0, 0],
                  }
                : 14,
              maxWidth: "290px",
            })
              .setLngLat(hit.lngLat)
              .setDOMContent(node)
              .addTo(created);
            const element = opened.getElement();
            element.dataset.mapPeek = hit.key.split(":")[0];
            element.addEventListener("mouseenter", () => {
              overPopup = true;
              window.clearTimeout(hideTimer);
            });
            element.addEventListener("mouseleave", () => {
              overPopup = false;
              closeSoon();
            });
            popup.current = opened;
            capPopup();
            watchSize?.disconnect();
            watchSize =
              typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => fitPopup());
            watchSize?.observe(element);
            if (pinned) requestAnimationFrame(fitPopup);
            setPeekAt(hit.target ? { target: hit.target, node } : null);
          });
        };
        const hitAt = (where: Parameters<typeof created.queryRenderedFeatures>[0]): Hit | null => {
          const ids = [MINE, ...(hasPeek.current ? [GAUGES, SEA, PLACES, DAM_MARKS] : [])].filter(
            (id) => created.getLayer(id),
          );
          if (ids.length === 0) return null;
          const hit = created.queryRenderedFeatures(where, { layers: ids })[0];
          const p = hit?.properties;
          if (!hit || !p) return null;
          if (hit.layer.id === MINE) {
            const own = minePlaces.current.find((x) => x.id === String(p.id));
            return own
              ? { key: `mine:${own.id}`, lngLat: [own.lon, own.lat], target: null, own }
              : null;
          }
          if (hit.geometry.type !== "Point") return null;
          const [lon, lat] = hit.geometry.coordinates as [number, number];
          if (hit.layer.id === DAM_MARKS) {
            const code = String(p.code);
            return {
              key: `dam:${code}:${String(p.kind)}`,
              lngLat: [lon, lat],
              target: { kind: "dam", code },
              own: null,
            };
          }
          if (hit.layer.id === SEA) {
            const id = String(p.id);
            return {
              key: `sea:${id}`,
              lngLat: [lon, lat],
              target: { kind: "sea", id },
              own: null,
              offset: 22,
            };
          }
          const kind = hit.layer.id === GAUGES ? "gauge" : "place";
          const id = String(p.id);
          return { key: `${kind}:${id}`, lngLat: [lon, lat], target: { kind, id }, own: null };
        };
        peekCloud.current = (cloud, how) => {
          if (!hasPeek.current) return;
          if (how === "leave") {
            overCloud = false;
            closeSoon();
            return;
          }
          overCloud = how === "hover" || overCloud;
          show(
            {
              key: `rain:${cloud.id}`,
              lngLat: [cloud.lon, cloud.lat],
              target: { kind: "rain", id: cloud.id, rain: cloud.kind },
              own: null,
              // The cloud sits above the pin: the pop-up opens above the cloud.
              offset: cloudLift(cloud.home) + 34,
            },
            how === "tap",
          );
        };
        created.on("mousemove", (event) => {
          const hit = hitAt(event.point);
          created.getCanvas().style.cursor = hit ? "pointer" : "";
          if (pinned || overCloud) return;
          if (hit) show(hit, false);
          else closeSoon();
        });
        created.on("mouseout", closeSoon);

        created.on("click", (event) => {
          /*
           * A tap is a thumb, not a pixel. Measured on the same view, 665 taps 16 px apart
           * over the middle of Yala: the dam, its river and its reservoir answered 4 of them
           * when a tap had to land exactly on a 2 px line, and 29 once everything within
           * TAP_SLACK counts. The layer drawn on top still wins, so a safe place or a gauge
           * beside the river keeps its tap.
           */
          const at = event.point;
          const near: [PointLike, PointLike] = [
            [at.x - TAP_SLACK, at.y - TAP_SLACK],
            [at.x + TAP_SLACK, at.y + TAP_SLACK],
          ];
          // The mark under the finger first; the thumb-sized box only when nothing is exactly
          // there, so in a cluster the tap opens the mark it landed on, not its neighbour.
          const tapped = hitAt(at) ?? hitAt(near);
          if (tapped) show(tapped, true);
          else close();
          const ids = [
            MINE,
            GAUGES,
            SEA,
            PLACES,
            DAM_MARKS,
            REPORTS,
            DAM_MAIN,
            DAM_TRIBUTARY,
            DAM_RESERVOIR_FILL,
            HAZARD_FILL,
            TAMBON_FILL_LAYER,
          ].filter((id) => created.getLayer(id));
          // As for the pop-up: a mark exactly under the finger wins over one merely near it.
          const marks = ids.filter((id) => id !== TAMBON_FILL_LAYER && id !== HAZARD_FILL);
          let hit =
            (marks.length > 0
              ? created.queryRenderedFeatures(at, { layers: marks })[0]
              : undefined) ?? created.queryRenderedFeatures(near, { layers: ids })[0];
          /*
           * A tambon covers the whole map, so on the risk view it would answer every tap and the
           * hazard class under the finger would never be named. Where a class is drawn exactly
           * at the tap, and nothing more specific was hit, the class answers.
           */
          if ((!hit || hit.layer.id === TAMBON_FILL_LAYER) && created.getLayer(HAZARD_FILL)) {
            const under = created.queryRenderedFeatures(at, { layers: [HAZARD_FILL] })[0];
            if (under) hit = under;
          }
          const p = hit?.properties;
          if (!hit || !p) return;
          if (hit.layer.id === MINE) select.current({ kind: "mine", id: String(p.id) });
          else if (
            hit.layer.id === DAM_MARKS ||
            hit.layer.id === DAM_MAIN ||
            hit.layer.id === DAM_TRIBUTARY ||
            hit.layer.id === DAM_RESERVOIR_FILL
          ) {
            select.current({ kind: "dam", code: String(p.code) });
          } else if (hit.layer.id === GAUGES) select.current({ kind: "gauge", id: String(p.id) });
          else if (hit.layer.id === SEA) select.current({ kind: "sea", id: String(p.id) });
          else if (hit.layer.id === PLACES) select.current({ kind: "place", id: String(p.id) });
          else if (hit.layer.id === REPORTS) {
            select.current({ kind: "reports", index: Number(p.index) });
          } else if (hit.layer.id === HAZARD_FILL) {
            select.current({ kind: "hazard", value: Number(p.class) });
          } else {
            select.current({
              kind: "tambon",
              code: String(p.code),
              nameTh: String(p.name_th),
              nameEn: String(p.name_en),
            });
          }
        });
      })
      .catch(() => setState("failed"));
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
  }, []);

  const [west, south, east, north] = bounds ?? SERVICE_BOUNDS;
  useEffect(() => {
    if (state !== "ready") return;
    /*
     * The map has been sent somewhere else - a reservoir's button, "All 4 provinces", a province
     * - so a pinned pop-up would travel with its own mark and end up pointing off the edge of
     * the frame, and with it off the side of the page.
     */
    if (boundsKey > 0) closePeek.current();
    map.current?.fitBounds(
      [
        [west, south],
        [east, north],
      ],
      /*
       * A move the reader asked for is animated, so they see the map travel rather than find a
       * different picture; the first fit, and a change of province, are instant.
       */
      { padding: 8, duration: boundsKey > 0 ? 600 : 0 },
    );
  }, [state, west, south, east, north, boundsKey]);

  if (state === "failed") {
    return (
      <p role="alert" className="rounded-xl border border-jaga-line bg-jaga-surface px-4 py-3">
        {text.failed}
      </p>
    );
  }
  return (
    <div className={`relative${fill ? " console:h-full" : ""}`}>
      {peekAt && peek && createPortal(peek(peekAt.target), peekAt.node)}
      {/* Rain falling now over the person's own places (owner, 15 Oct), with the pins. */}
      {loaded && (
        <PlaceRain
          map={loaded}
          places={showMine ? mine : []}
          onCloud={peek ? (cloud, how) => peekCloud.current(cloud, how) : undefined}
        />
      )}
      <div
        ref={container}
        data-map="true"
        data-map-ready={state === "ready"}
        className={`h-[60vh] min-h-80 w-full overflow-hidden rounded-xl border border-jaga-line${
          fill ? " console:h-full console:min-h-0" : ""
        }`}
      />
      {state === "loading" && (
        <p className="absolute inset-x-0 top-3 text-center text-small text-jaga-text-2">
          {text.loading}
        </p>
      )}
    </div>
  );
}
