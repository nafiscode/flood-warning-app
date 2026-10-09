"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import type { GeoJSONSource, ImageSource, Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { mapHalo, mapInk } from "@/lib/map";
import type { MinePlace } from "@/components/map/MapView";
import { minePlaceFeature } from "@/lib/mine-label";
import {
  fieldPixels,
  GRIDS,
  gridPoints,
  valueAt,
  windArrow,
  windDirAt,
  type WeatherField,
  type WeatherGrid,
} from "@/lib/weather-grid";
import { coverCamera, createWeatherMap } from "@/lib/weather-map";

const FIELD = "jaga-wx-field";
const WIND = "jaga-wx-wind";
const MINE = "jaga-wx-mine";
const MINE_LABEL = "jaga-wx-mine-label";

type Props = {
  grid: WeatherGrid | null;
  field: WeatherField;
  /** Which hour of the grid is drawn: 0 is now. */
  hour: number;
  /** The person's own places, drawn on top; nothing personal ever leaves their browser. */
  places: MinePlace[];
  /** Where to open before the first grid arrives. */
  centre: { lat: number; lon: number } | null;
  /** Told the width in degrees of what is on screen, so a wider grid can be asked for. */
  onViewSpan: (span: number) => void;
  text: { loading: string; failed: string };
};

type Collection = GeoJSON.FeatureCollection;
const collection = (features: GeoJSON.Feature[]): Collection => ({
  type: "FeatureCollection",
  features,
});

/**
 * The field as a picture: the values between the model's points are filled in (bilinear) and
 * the browser smooths what is left, which is how a weather app's map looks. The numbers behind
 * it are unchanged — the model still only knows the weather about 17 km apart, which is why
 * the map says so underneath and why each place's value is written out as a number too.
 */
const PAINT = 192;

function fieldImage(grid: WeatherGrid, field: WeatherField, hour: number): string | null {
  const canvas = document.createElement("canvas");
  canvas.width = PAINT;
  canvas.height = PAINT;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const image = context.createImageData(PAINT, PAINT);
  image.data.set(fieldPixels(grid, field, hour, PAINT));
  context.putImageData(image, 0, 0);
  return canvas.toDataURL("image/png");
}

/** The ground the picture is laid on: the corners of the grid, clockwise from the north-west. */
function cornerCoordinates(
  grid: WeatherGrid,
): [[number, number], [number, number], [number, number], [number, number]] {
  const half = grid.span / 2;
  const west = grid.lon - half;
  const east = grid.lon + half;
  const south = grid.lat - half;
  const north = grid.lat + half;
  return [
    [west, north],
    [east, north],
    [east, south],
    [west, south],
  ];
}

/** Arrows showing where the wind is going, one per grid point. */
function winds(grid: WeatherGrid | null, field: WeatherField, hour: number): Collection {
  if (!grid || field !== "wind") return collection([]);
  const points = gridPoints({ lat: grid.lat, lon: grid.lon }, { span: grid.span, n: grid.n });
  const features: GeoJSON.Feature[] = [];
  points.forEach((point, index) => {
    const direction = windDirAt(grid, index, hour);
    const speed = valueAt(grid, "wind", index, hour);
    if (direction === null || speed === null || speed < 1) return;
    features.push({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: windArrow(point.lat, point.lon, direction, grid.step),
      },
      properties: { speed },
    });
  });
  return collection(features);
}

/**
 * The weather map itself: a grid of coloured cells under the person's own places. Everything it
 * draws is forecast from a model — the page around it says so, names the hour and the source,
 * and no alert colour is used anywhere (lib/weather-grid.ts).
 */
export function WeatherMapCanvas({ grid, field, hour, places, centre, onViewSpan, text }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const draw = useRef<() => void>(() => {});
  const span = useRef(onViewSpan);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  /** The grid the map was last fitted to, and whether the person has moved it since. */
  const fitted = useRef("");
  const moved = useRef(false);
  /** The square to fit, kept so a map that changes shape (phone to laptop) can fit it again. */
  const fitTo = useRef<(() => void) | null>(null);
  /** The pictures already painted, by place, field and hour, and the one on the map now. */
  const painted = useRef(new Map<string, string>());
  const shown = useRef("");

  useEffect(() => {
    span.current = onViewSpan;
  }, [onViewSpan]);

  // Redrawing is idempotent: the basemap replaces the style under us, and every "styledata"
  // and "idle" puts our sources and layers back exactly as they were (as the public map does).
  useEffect(() => {
    draw.current = () => {
      const m = map.current;
      if (!m || !m.isStyleLoaded()) return;
      try {
        const data: Record<string, Collection> = {
          [WIND]: winds(grid, field, hour),
          [MINE]: collection(places.map(minePlaceFeature)),
        };
        for (const [id, value] of Object.entries(data)) {
          const source = m.getSource(id) as GeoJSONSource | undefined;
          if (!source) m.addSource(id, { type: "geojson", data: value });
          else source.setData(value);
        }
        if (grid) {
          // The painted hours are kept: stepping through the day again costs nothing, and the
          // slider can run on its own without painting the same picture over and over.
          const key = `${grid.lat},${grid.lon},${grid.span},${field},${hour}`;
          let url = painted.current.get(key);
          if (url === undefined) {
            url = fieldImage(grid, field, hour) ?? "";
            if (painted.current.size > 120) painted.current.clear();
            painted.current.set(key, url);
          }
          const coordinates = cornerCoordinates(grid);
          const source = m.getSource(FIELD) as ImageSource | undefined;
          if (!source) m.addSource(FIELD, { type: "image", url, coordinates });
          else if (url !== shown.current) source.updateImage({ url, coordinates });
          shown.current = url;
        }
        if (!m.getLayer(FIELD) && m.getSource(FIELD)) {
          m.addLayer({
            id: FIELD,
            type: "raster",
            source: FIELD,
            paint: {
              // See-through, so the roads and rivers under the weather stay readable, and
              // smoothed between the model's points rather than drawn as boxes.
              "raster-opacity": 0.62,
              "raster-resampling": "linear",
              "raster-fade-duration": 0,
            },
          });
        }
        if (!m.getLayer(WIND)) {
          m.addLayer({
            id: WIND,
            type: "line",
            source: WIND,
            paint: {
              "line-color": mapInk(),
              "line-width": 1.6,
              "line-opacity": 0.85,
            },
          });
        }
        if (!m.getLayer(MINE)) {
          m.addLayer({
            id: MINE,
            type: "circle",
            source: MINE,
            paint: {
              "circle-radius": ["case", ["==", ["get", "home"], 1], 8, 6],
              // Home is a filled dot ringed with the background; a watched place is a ring
              // with the background inside it. Either way one of the two is the ground
              // colour, so a pin stands out by day and by night.
              "circle-color": ["case", ["==", ["get", "home"], 1], ["get", "color"], mapHalo()],
              "circle-stroke-color": [
                "case",
                ["==", ["get", "home"], 1],
                mapHalo(),
                ["get", "color"],
              ],
              "circle-stroke-width": 3,
            },
          });
          m.addLayer({
            id: MINE_LABEL,
            type: "symbol",
            source: MINE,
            layout: {
              "text-field": ["get", "label"],
              "text-font": ["Noto Sans Regular"],
              "text-size": 12,
              "text-offset": [0, 1.2],
              "text-anchor": "top",
              // The person's own places matter more than a neighbouring village's name.
              "text-allow-overlap": true,
              "text-ignore-placement": true,
            },
            paint: {
              "text-color": mapInk(),
              "text-halo-color": mapHalo(),
              "text-halo-width": 1.6,
            },
          });
        }
      } catch {
        // The style is being swapped: the next "styledata" or "idle" draws again.
      }
    };
    draw.current();
  }, [grid, field, hour, places]);

  useEffect(() => {
    if (!container.current) return;
    let cancelled = false;
    // The first box: the grid if it is already here, otherwise the square the first grid will
    // cover around the place, so the view does not jump when the numbers arrive.
    const here = grid ?? (centre ? { ...centre, span: GRIDS[0].span } : null);
    const box: [number, number, number, number] = here
      ? [
          here.lon - here.span / 2,
          here.lat - here.span / 2,
          here.lon + here.span / 2,
          here.lat + here.span / 2,
        ]
      : [99.95, 5.55, 102.25, 8.0];
    createWeatherMap(container.current, box)
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
        created.on("styledata", redraw);
        created.on("idle", redraw);
        // A move the person made themselves: from here on the map stays where they put it.
        created.on("movestart", (event) => {
          if ((event as { originalEvent?: unknown }).originalEvent) moved.current = true;
        });
        // The map changes shape between a phone's column and a laptop's two columns, and when
        // the window is resized; the grid should still fill it, unless the person has moved it.
        created.on("resize", () => {
          if (!moved.current) fitTo.current?.();
        });
        // Zoomed out past the grid: ask the page for a wider, coarser one.
        created.on("moveend", () => {
          if (!moved.current) return;
          const view = created.getBounds();
          span.current(Math.abs(view.getEast() - view.getWest()));
        });
      })
      .catch(() => setState("failed"));
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
    // Created once: the grid that arrives later only changes what is drawn, never the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /*
   * The map is built before the first grid arrives, so it opens on the service area; once the
   * grid is here, the view moves to the square it covers. A grid for another place does the
   * same, but a map the person has panned or zoomed themselves is left alone.
   */
  useEffect(() => {
    if (!grid || state !== "ready" || moved.current) return;
    const key = `${grid.lat},${grid.lon}`;
    if (fitted.current === key) return;
    fitted.current = key;
    const half = grid.span / 2;
    fitTo.current = () => {
      const m = map.current;
      if (!m) return;
      const canvas = m.getCanvas();
      // Cover, not contain: the weather fills the window and runs off the edges, instead of
      // sitting in the middle of it with dark bands on two sides.
      const camera = coverCamera(
        [grid.lon - half, grid.lat - half, grid.lon + half, grid.lat + half],
        canvas.clientWidth || 360,
        canvas.clientHeight || 300,
      );
      m.jumpTo({ center: camera.center, zoom: camera.zoom });
    };
    fitTo.current();
  }, [grid, state]);

  if (state === "failed") {
    return (
      <p role="alert" className="rounded-xl border border-jaga-line bg-jaga-surface px-4 py-3">
        {text.failed}
      </p>
    );
  }
  return (
    <div className="relative lg:h-full">
      <div
        ref={container}
        data-weather-map="true"
        data-map-ready={state === "ready"}
        className="h-[58vh] min-h-80 w-full overflow-hidden rounded-xl border border-jaga-line lg:h-full lg:min-h-[520px]"
      />
      {state === "loading" && (
        <p className="absolute inset-x-0 top-3 text-center text-small text-jaga-text-2">
          {text.loading}
        </p>
      )}
    </div>
  );
}
