/**
 * The weather maps: rain, temperature, humidity and wind drawn as a grid of cells around the
 * place someone is looking at (owner's request, 9 Oct 2026).
 *
 * There is no tile service behind this and no key: Jaga asks Open-Meteo for a square grid of
 * points in one request and colours a cell per point. That is also the honest picture — the
 * model has a resolution of about 11 km, and square cells show it, where a smooth image would
 * promise detail the forecast does not have (safety rule 8). Every map carries its hour, its
 * units and its source.
 *
 * None of the colours is an alert hue (docs/brand.md): the alert palette belongs to alert levels
 * alone, and a weather map must never be read as a warning.
 */

/** The fields a map can show. */
export const WEATHER_FIELDS = ["rain", "temp", "humidity", "wind"] as const;
export type WeatherField = (typeof WEATHER_FIELDS)[number];

/**
 * Two grids: one around the place, one for when someone zooms out. Both are asked for whole
 * degrees of span so that the answer can be shared by everyone nearby.
 */
export const GRIDS = [
  { span: 1.2, n: 9 }, // about 130 km across, a point every 15 km
  { span: 3.6, n: 13 }, // about 400 km across, a point every 30 km
] as const;
export type GridSize = { span: number; n: number };

/** Hours of forecast each grid carries; the map's slider steps through them. */
export const GRID_HOURS = 24;

export function gridFor(span: number): GridSize {
  return GRIDS.find((g) => g.span === span) ?? GRIDS[0];
}

/**
 * The centre of a grid, snapped to a lattice of whole steps. Everyone within the same cell of
 * the lattice asks for the identical grid, so the edge cache answers almost everyone and
 * Open-Meteo sees one request (and nobody's exact position is in the address).
 */
export function snapCentre(lat: number, lon: number, span: number): { lat: number; lon: number } {
  const step = span / 4;
  const snap = (v: number) => Math.round(v / step) * step;
  return { lat: round(snap(lat), 4), lon: round(snap(lon), 4) };
}

function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/** The points of a grid, row by row from south to north, west to east inside each row. */
export function gridPoints(
  centre: { lat: number; lon: number },
  { span, n }: GridSize,
): { lat: number; lon: number }[] {
  const step = span / (n - 1);
  const south = centre.lat - span / 2;
  const west = centre.lon - span / 2;
  const points: { lat: number; lon: number }[] = [];
  for (let row = 0; row < n; row += 1) {
    for (let col = 0; col < n; col += 1) {
      // Latitude is clamped: a grid is never asked for past the poles.
      points.push({
        lat: round(Math.max(-89.5, Math.min(89.5, south + row * step)), 4),
        lon: round(wrapLon(west + col * step), 4),
      });
    }
  }
  return points;
}

/** Longitude back into -180..180, so a grid across the date line is still asked for correctly. */
export function wrapLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/**
 * What /api/public/weather/grid answers. The values are flat arrays, point by point and hour by
 * hour inside each point (`point * hours + hour`): a phone on slow 3G downloads a few kB
 * instead of thousands of little objects.
 */
export type WeatherGrid = {
  lat: number;
  lon: number;
  span: number;
  n: number;
  step: number;
  timezone: string;
  /** UTC instants, one per hour of the forecast. */
  hours: string[];
  temp: (number | null)[];
  humidity: (number | null)[];
  rain: (number | null)[];
  wind: (number | null)[];
  windDir: (number | null)[];
};

/** The value of one field at one grid point and hour, or null where the model has none. */
export function valueAt(
  grid: WeatherGrid,
  field: WeatherField,
  point: number,
  hour: number,
): number | null {
  const series = grid[field === "temp" ? "temp" : field === "humidity" ? "humidity" : field];
  return series[point * grid.hours.length + hour] ?? null;
}

export function windDirAt(grid: WeatherGrid, point: number, hour: number): number | null {
  return grid.windDir[point * grid.hours.length + hour] ?? null;
}

/** The grid point nearest a place, for reading its value off the map. */
export function nearestPoint(grid: WeatherGrid, lat: number, lon: number): number | null {
  const points = gridPoints({ lat: grid.lat, lon: grid.lon }, { span: grid.span, n: grid.n });
  let best: number | null = null;
  let bestDistance = Infinity;
  points.forEach((p, index) => {
    // Flat distance is plenty inside one grid; longitude narrows towards the poles.
    const dy = p.lat - lat;
    const dx = wrapLon(p.lon - lon) * Math.cos((lat * Math.PI) / 180);
    const d = dy * dy + dx * dx;
    if (d < bestDistance) {
      bestDistance = d;
      best = index;
    }
  });
  // Further than one cell away means the place is off this grid; its value would be a guess.
  const limit = (grid.span / (grid.n - 1)) * 1.5;
  return best !== null && bestDistance <= limit * limit ? best : null;
}

type Stop = [number, string];

/**
 * A colour per field, as steps rather than a smooth blend: a step says "between 2 and 5 mm",
 * which is what the model knows, and the legend can list exactly the same numbers.
 *
 * Checked against the alert palette (#2F7A25, #F2C230, #F07F1A, #C62828, #1F6FD1, #6B7780):
 * these are blues, violets and teals, no green, yellow, orange or red anywhere, so no cell can
 * be mistaken for an alert level. tests/unit/weather-map.test.ts keeps it that way.
 */
export const RAMPS: Record<WeatherField, Stop[]> = {
  // Rain in mm over the hour. Below 0.1 mm nothing is drawn at all.
  rain: [
    [0.1, "#CFE3EF"],
    [0.5, "#9FC8E2"],
    [2, "#5E9FD0"],
    [5, "#3A6FB8"],
    [10, "#274B96"],
    [20, "#1B2E6B"],
  ],
  // Temperature in °C, cool blue to warm violet. Hot is never red here: red is Evacuate.
  temp: [
    [-100, "#2E5E94"],
    [20, "#5B7FB4"],
    [24, "#8A87BC"],
    [28, "#AE82B4"],
    [32, "#8F5091"],
    [36, "#6A2F6E"],
  ],
  // Relative humidity in %.
  humidity: [
    [0, "#D7E4E2"],
    [50, "#A5CBC6"],
    [70, "#5FA8A6"],
    [85, "#2F7F8C"],
    [95, "#2A4F7A"],
  ],
  // Wind speed in km/h.
  wind: [
    [0, "#DCE3E8"],
    [10, "#B2C2CF"],
    [20, "#7E97AE"],
    [30, "#52708F"],
    [45, "#394B73"],
  ],
};

/** The colour for a value, or null where nothing should be drawn (dry hour, missing value). */
export function fieldColor(field: WeatherField, value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  const stops = RAMPS[field];
  if (value < stops[0]![0]) return null;
  let color = stops[0]![1];
  for (const [limit, hex] of stops) {
    if (value >= limit) color = hex;
  }
  return color;
}

/** How a field's number is written: the unit and how many decimals it deserves. */
export const FIELD_UNITS: Record<WeatherField, { unit: string; digits: number }> = {
  rain: { unit: "mm", digits: 1 },
  temp: { unit: "°C", digits: 0 },
  humidity: { unit: "%", digits: 0 },
  wind: { unit: "km/h", digits: 0 },
};

/** The square a grid point stands for, as a polygon ring. */
export function cellRing(lat: number, lon: number, step: number): [number, number][] {
  const h = step / 2;
  return [
    [lon - h, lat - h],
    [lon + h, lat - h],
    [lon + h, lat + h],
    [lon - h, lat + h],
    [lon - h, lat - h],
  ];
}

/**
 * An arrow for the wind at one point, pointing the way the wind is going (the model gives the
 * direction it comes from). Shaft plus two barbs, as one line.
 */
export function windArrow(
  lat: number,
  lon: number,
  fromDegrees: number,
  step: number,
): [number, number][] {
  // Towards, not from; then into map angles, where 0° is north and the y axis is latitude.
  const towards = ((fromDegrees + 180) % 360) * (Math.PI / 180);
  const length = step * 0.42;
  // Degrees of longitude are shorter than degrees of latitude away from the equator.
  const shrink = Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  const move = (from: [number, number], angle: number, distance: number): [number, number] => [
    from[0] + (Math.sin(angle) * distance) / shrink,
    from[1] + Math.cos(angle) * distance,
  ];
  const tail = move([lon, lat], towards + Math.PI, length / 2);
  const head = move([lon, lat], towards, length / 2);
  const barbLeft = move(head, towards + Math.PI * 0.8, length * 0.35);
  const barbRight = move(head, towards - Math.PI * 0.8, length * 0.35);
  return [tail, head, barbLeft, head, barbRight];
}
