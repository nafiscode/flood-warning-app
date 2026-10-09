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

const hexParts = (hex: string): [number, number, number] => [
  Number.parseInt(hex.slice(1, 3), 16),
  Number.parseInt(hex.slice(3, 5), 16),
  Number.parseInt(hex.slice(5, 7), 16),
];

/**
 * The colour for a value, blended between the scale's stops rather than stepped (the owner,
 * 10 Oct: the map should look like a weather app's, not like a chessboard).
 *
 * The numbers behind it do not change: the forecast is still only known at points about 17 km
 * apart, which is why every map says so and why the value at a place is also written out.
 */
export function rampAt(
  field: WeatherField,
  value: number | null,
): [number, number, number, number] {
  const stops = RAMPS[field];
  const first = stops[0]!;
  const last = stops[stops.length - 1]!;
  /*
   * A see-through pixel still carries the colour of the scale, never black. The map blends
   * neighbouring pixels as it stretches the picture over the ground, and transparent black
   * drags a dirty edge into everything beside it — which is what the first rain map did
   * around every dry patch.
   */
  const clear = (): [number, number, number, number] => {
    const [r, g, b] = hexParts(first[1]);
    return [r, g, b, 0];
  };
  if (value === null || !Number.isFinite(value)) return clear();
  if (value <= first[0]) {
    /*
     * Rain starts from nothing, and it has to start smoothly: a step from see-through to a
     * colour draws a hard line around every dry patch, which looked like a shape on the map
     * rather than like weather. Below the first drop the colour fades in from nothing.
     */
    if (field === "rain") {
      const [r, g, b] = hexParts(first[1]);
      return [r, g, b, Math.round(Math.max(0, Math.min(1, value / first[0])) * 60)];
    }
    const [r, g, b] = hexParts(first[1]);
    return [r, g, b, 255];
  }
  if (value >= last[0]) {
    const [r, g, b] = hexParts(last[1]);
    return [r, g, b, 255];
  }
  for (let i = 0; i < stops.length - 1; i += 1) {
    const [from, fromHex] = stops[i]!;
    const [to, toHex] = stops[i + 1]!;
    if (value >= from && value <= to) {
      const t = to === from ? 0 : (value - from) / (to - from);
      const a = hexParts(fromHex);
      const b = hexParts(toHex);
      const mix = (i2: number) => Math.round(a[i2]! + (b[i2]! - a[i2]!) * t);
      // The lightest rain keeps fading in across the first band, from where it started.
      const alpha = field === "rain" && i === 0 ? Math.round(60 + 195 * t) : 255;
      return [mix(0), mix(1), mix(2), alpha];
    }
  }
  return clear();
}

/**
 * The value between the grid's points, weighted by how near each of the four around it is
 * (bilinear). A point the model has nothing for is left out of the weighting, so one gap does
 * not punch a hole in the picture.
 */
export function bilinear(
  grid: WeatherGrid,
  field: WeatherField,
  hour: number,
  col: number,
  row: number,
): number | null {
  const last = grid.n - 1;
  const c = Math.min(last, Math.max(0, col));
  const r = Math.min(last, Math.max(0, row));
  const c0 = Math.min(last, Math.floor(c));
  const r0 = Math.min(last, Math.floor(r));
  const c1 = Math.min(last, c0 + 1);
  const r1 = Math.min(last, r0 + 1);
  /*
   * Hermite easing on the way between two points, not a straight line: a straight blend leaves
   * a crease along every row and column of the grid, which showed up as faint diamonds across
   * the map. The values at the points themselves are untouched.
   */
  const ease = (t: number) => t * t * (3 - 2 * t);
  const fc = ease(c - c0);
  const fr = ease(r - r0);
  let sum = 0;
  let weight = 0;
  for (const [cc, rr, w] of [
    [c0, r0, (1 - fc) * (1 - fr)],
    [c1, r0, fc * (1 - fr)],
    [c0, r1, (1 - fc) * fr],
    [c1, r1, fc * fr],
  ] as const) {
    if (w <= 0) continue;
    const value = valueAt(grid, field, rr * grid.n + cc, hour);
    if (value === null) continue;
    sum += value * w;
    weight += w;
  }
  return weight === 0 ? null : sum / weight;
}

/**
 * The whole field as pixels, for the image laid over the map: row 0 is the top (north), as a
 * picture is drawn, where the grid counts rows from the south.
 */
export function fieldPixels(
  grid: WeatherGrid,
  field: WeatherField,
  hour: number,
  size: number,
): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(size * size * 4);
  const last = grid.n - 1;
  for (let y = 0; y < size; y += 1) {
    // Half a pixel in, so the edge of the image sits on the outermost points.
    const row = last * (1 - (y + 0.5) / size);
    for (let x = 0; x < size; x += 1) {
      const col = last * ((x + 0.5) / size);
      const [r, g, b, a] = rampAt(field, bilinear(grid, field, hour, col, row));
      const at = (y * size + x) * 4;
      pixels[at] = r;
      pixels[at + 1] = g;
      pixels[at + 2] = b;
      pixels[at + 3] = a;
    }
  }
  return pixels;
}
