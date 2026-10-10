"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import type { GeoJSONSource, Map as MapLibreMap, Popup } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import type { MapLayer } from "@/lib/hazards";
import { type Dam, reachesInOrder } from "@/lib/dam";
import {
  byZoom,
  CASING_EXTRA,
  damMarks,
  damPaint,
  emphasis,
  MAIN_WIDTH,
  RESERVOIR_FILL_OPACITY,
  RESERVOIR_LINE_WIDTH,
  TRIBUTARY_DASH,
  TRIBUTARY_WIDTH,
} from "@/lib/dam-map";
import { mineLabel, minePlaceFeature } from "@/lib/mine-label";
import { localName } from "@/lib/places";
import {
  createServiceAreaMap,
  darkNow,
  mapHalo,
  mapInk,
  SERVICE_BOUNDS,
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
  | { kind: "dam"; code: string };

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

type Props = {
  /** What may be drawn. Empty: nothing of ours but the tambon outlines. */
  layers: MapLayer[];
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
  status: PublicStatus | null;
  data: MapData | null;
  now: number;
  /** Where to look: the service area, or one province. */
  bounds?: [number, number, number, number];
  onSelect: (selection: MapSelection) => void;
  text: { loading: string; failed: string };
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
const GAUGES = "jaga-gauges";
const MINE = "jaga-mine";
const MINE_LABEL = "jaga-mine-label";
const DAM_WATER_SOURCE = "jaga-dam-water";
const DAM_REACHES = "jaga-dam-reaches";
const DAM_POINTS = "jaga-dam-points";
const DAM_RESERVOIR_FILL = "jaga-dam-reservoir-fill";
const DAM_RESERVOIR_LINE = "jaga-dam-reservoir-line";
const DAM_TRIBUTARY = "jaga-dam-tributary";
const DAM_CASING = "jaga-dam-casing";
const DAM_MAIN = "jaga-dam-main";
const DAM_MARKS = "jaga-dam-marks";
const DAM_LABELS = "jaga-dam-labels";

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
  for (const dam of dams) {
    const name = localName(dam.name, text.locale) || dam.code;
    if (dam.reservoir) {
      water.push({
        type: "Feature",
        geometry: dam.reservoir,
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
        properties: { code: dam.code, kind, label },
      });
    }
  }
  return {
    [DAM_WATER_SOURCE]: collection(water),
    [DAM_REACHES]: collection(reaches),
    [DAM_POINTS]: collection(marks),
  };
}

function toCollections(
  data: MapData | null,
  mine: MinePlace[],
  dams: Dam[],
  damText: { spillway: string; outlet: string; locale: string },
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
        properties: { id: place.id },
      })),
    ),
    [GAUGES]: collection(
      (data?.gauges ?? []).map((gauge) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [gauge.lon, gauge.lat] },
        properties: { id: gauge.id },
      })),
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
  status,
  data,
  now,
  bounds,
  onSelect,
  text,
  mine = [],
  showMine = false,
  dams = [],
  damText = { spillway: "", outlet: "", locale: "th" },
}: Props) {
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
  const select = useRef(onSelect);
  const draw = useRef<() => void>(() => {});
  // The places as the handlers below need them, without rebuilding the map when they change.
  const minePlaces = useRef<MinePlace[]>(mine);
  const popup = useRef<Popup | null>(null);
  // When a label was opened by a tap. Phones send a mouse move of their own right after a tap,
  // which would otherwise close the label in the same instant it appeared.
  const tappedAt = useRef(0);

  useEffect(() => {
    select.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    minePlaces.current = mine;
  }, [mine]);

  useEffect(() => {
    const collections = toCollections(data, mine, dams, {
      spillway: spillwayLabel,
      outlet: outletLabel,
      locale: damLocale,
    });
    const show = (layer: MapLayer) => (layers.includes(layer) ? "visible" : "none");
    const paint = damPaint(darkNow());
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
         * The dam, its reservoir and the path released water takes (spec section 15). Drawn
         * above the alert fill, so the river can be followed across coloured tambons, and below
         * the safe places and the person's own pins, which are what they came to tap.
         */
        if (!m.getLayer(DAM_RESERVOIR_FILL)) {
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
              "circle-color": paint.mark,
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
        if (!m.getLayer(PLACES)) {
          m.addLayer({
            id: PLACES,
            type: "circle",
            source: PLACES,
            paint: {
              "circle-radius": 7,
              "circle-color": ink(),
              "circle-stroke-color": halo(),
              "circle-stroke-width": 2,
            },
          });
        }
        if (!m.getLayer(GAUGES)) {
          m.addLayer({
            id: GAUGES,
            type: "circle",
            source: GAUGES,
            paint: {
              "circle-radius": 6,
              "circle-color": halo(),
              "circle-stroke-color": ink(),
              "circle-stroke-width": 3,
            },
          });
        }
        if (!m.getLayer(MINE)) {
          // On top of the public layers: these few points are what the person came to find.
          m.addLayer({
            id: MINE,
            type: "circle",
            source: MINE,
            paint: {
              "circle-radius": ["case", ["==", ["get", "home"], 1], 10, 8],
              "circle-color": ["get", "color"],
              // A white ring keeps every shade readable on the basemap and on a coloured tambon.
              "circle-stroke-color": "#ffffff",
              "circle-stroke-width": 3,
            },
          });
        }
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
              "text-offset": [0, 0.8],
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
         * The dam follows the theme while the page is open: the daytime water colour vanishes
         * into the dark basemap after sunset, and the page turns itself dark at sunset without
         * reloading (components/DaylightTheme.tsx).
         */
        for (const [layer, property, value] of [
          [DAM_RESERVOIR_FILL, "fill-color", paint.water],
          [DAM_RESERVOIR_LINE, "line-color", paint.water],
          [DAM_TRIBUTARY, "line-color", paint.water],
          [DAM_CASING, "line-color", paint.casing],
          [DAM_MAIN, "line-color", paint.water],
          [DAM_MARKS, "circle-color", paint.mark],
          [DAM_MARKS, "circle-stroke-color", paint.halo],
          [DAM_LABELS, "text-color", paint.label],
          [DAM_LABELS, "text-halo-color", paint.halo],
        ] as const) {
          m.setPaintProperty(layer, property, value);
        }
        // Always on, in every view: the river does not stop running through someone's tambon
        // because they switched to the risk map (the owner, 10 Oct).
        const damOn = dams.length > 0 ? "visible" : "none";
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
        const mineOn = showMine && mine.length > 0 ? "visible" : "none";
        m.setLayoutProperty(MINE, "visibility", mineOn);
        m.setLayoutProperty(MINE_LABEL, "visibility", mineOn);
      } catch {
        // The style is being replaced: the next "styledata" or "idle" draws again.
      }
    };
    draw.current();
  }, [layers, status, data, now, mine, showMine, dams, spillwayLabel, outletLabel, damLocale]);

  useEffect(() => {
    if (!container.current) return;
    let cancelled = false;
    createServiceAreaMap(container.current)
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
        });
        // After the basemap replaces the style, sources may hold their first data again.
        created.on("style.load", () => held.current.clear());
        created.on("styledata", redraw);
        created.on("idle", redraw);
        /*
         * The label of one of the person's own places: on hover with a mouse, and on tap on a
         * phone or tablet, where the tap also opens the card below the map. MapLibre is already
         * loaded by now, so this import is the cached module.
         */
        const showLabel = (place: MinePlace) => {
          void import("maplibre-gl").then(({ Popup }) => {
            if (map.current !== created) return;
            popup.current?.remove();
            popup.current = new Popup({ closeButton: false, offset: 14, maxWidth: "260px" })
              .setLngLat([place.lon, place.lat])
              .setDOMContent(mineLabel(place))
              .addTo(created);
          });
        };
        const hideLabel = () => {
          if (Date.now() - tappedAt.current < 600) return;
          popup.current?.remove();
          popup.current = null;
        };
        const placeAt = (point: Parameters<typeof created.queryRenderedFeatures>[0]) => {
          if (!created.getLayer(MINE)) return null;
          const hit = created.queryRenderedFeatures(point, { layers: [MINE] })[0];
          const id = hit?.properties?.id;
          return id ? (minePlaces.current.find((p) => p.id === String(id)) ?? null) : null;
        };
        created.on("mousemove", (event) => {
          const place = placeAt(event.point);
          created.getCanvas().style.cursor = place ? "pointer" : "";
          if (place) showLabel(place);
          else hideLabel();
        });
        created.on("mouseout", hideLabel);

        created.on("click", (event) => {
          const own = placeAt(event.point);
          if (own) {
            tappedAt.current = Date.now();
            showLabel(own);
          }
          const ids = [
            MINE,
            GAUGES,
            PLACES,
            DAM_MARKS,
            REPORTS,
            DAM_MAIN,
            DAM_TRIBUTARY,
            DAM_RESERVOIR_FILL,
            TAMBON_FILL_LAYER,
          ].filter((id) => created.getLayer(id));
          const hit = created.queryRenderedFeatures(event.point, { layers: ids })[0];
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
          else if (hit.layer.id === PLACES) select.current({ kind: "place", id: String(p.id) });
          else if (hit.layer.id === REPORTS) {
            select.current({ kind: "reports", index: Number(p.index) });
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
    map.current?.fitBounds(
      [
        [west, south],
        [east, north],
      ],
      { padding: 8, duration: 0 },
    );
  }, [state, west, south, east, north]);

  if (state === "failed") {
    return (
      <p role="alert" className="rounded-xl border border-jaga-line bg-jaga-surface px-4 py-3">
        {text.failed}
      </p>
    );
  }
  return (
    <div className="relative">
      <div
        ref={container}
        data-map="true"
        data-map-ready={state === "ready"}
        className="h-[60vh] min-h-80 w-full overflow-hidden rounded-xl border border-jaga-line"
      />
      {state === "loading" && (
        <p className="absolute inset-x-0 top-3 text-center text-small text-jaga-text-2">
          {text.loading}
        </p>
      )}
    </div>
  );
}
