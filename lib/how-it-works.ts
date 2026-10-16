/**
 * "How Jaga works" (A18, the owner's request of 15 Oct 2026): two public pages for readers who
 * want to judge the work rather than use the app - academics, partner agencies, students, and the
 * people who build such things.
 *
 * Pure data, so a test can hold every part to a line in all three languages, every source to a
 * credit, and the system page to its rule: **it never names a vendor or a product**
 * (`FORBIDDEN_VENDOR_WORDS`). The pages say enough to understand and to judge each layer - the
 * concept, what it can and cannot tell, how it was checked - and not enough to reproduce it: no
 * parameter values, no thresholds, no step order. The methods notes in each module's METHODS.md in `pipeline/`
 * are where that lives, for anyone who asks.
 */

export type HowIcon =
  | "wave"
  | "map"
  | "gauge"
  | "bell"
  | "drop"
  | "house"
  | "clock"
  | "cloud"
  | "wind"
  | "message"
  | "list"
  | "shield"
  | "sos"
  | "megaphone"
  | "retry"
  | "check"
  | "parcel";

/** The drawings on these pages (components/how/Figures.tsx). */
export type HowFigure = "radar" | "height" | "gauge" | "river" | "system" | "sos";

export type SciencePart = {
  /** Message key under `howItWorks.science.parts.<key>`. */
  key: string;
  icon: HowIcon;
  figure?: HowFigure;
  /** Credits the part rests on, as ids of `CREDITS`. */
  sources: string[];
  /** The part has a "how it was checked" line. */
  checked: boolean;
};

/**
 * The parts of Jaga that come out of analysis, in the order a reader meets them in the app: the
 * map first, then the river, then what is done with both. Every one carries what it cannot tell,
 * because that is the part a reader needs most (safety rule 8).
 */
export const SCIENCE_PARTS: SciencePart[] = [
  {
    key: "radar",
    icon: "wave",
    figure: "radar",
    sources: ["sentinel1", "jrcwater", "meritHydro", "earthEngine"],
    checked: true,
  },
  {
    key: "classes",
    icon: "map",
    figure: "height",
    sources: ["fabdem", "sentinel1", "gistda", "openBuildings", "osm"],
    checked: true,
  },
  { key: "gauges", icon: "gauge", figure: "gauge", sources: ["thaiwater", "rid", "gsmap"], checked: true },
  { key: "alarm", icon: "bell", sources: ["thaiwater"], checked: true },
  { key: "dam", icon: "drop", figure: "river", sources: ["thaiwater", "egat", "fabdem", "osm"], checked: true },
  {
    key: "places",
    icon: "house",
    sources: ["osm", "fabdem", "openBuildings", "sentinel1"],
    checked: false,
  },
  { key: "return", icon: "clock", sources: ["thaiwater", "rid"], checked: true },
  { key: "outlook", icon: "cloud", sources: ["chirps", "era5land", "noaa"], checked: true },
  { key: "sea", icon: "wind", sources: ["openMeteo", "tmd"], checked: true },
  { key: "reports", icon: "message", sources: [], checked: false },
];

export type SystemPart = {
  /** Message key under `howItWorks.system.parts.<key>`. */
  key: string;
  icon: HowIcon;
  figure?: HowFigure;
  /** How many numbered lines the part has under `.points.<n>`. */
  points: number;
};

/**
 * The system, in general terms only. Each part is the concept and the reason, never the product:
 * a reader learns how it behaves and what that costs, and nothing that ties Jaga to a supplier.
 */
export const SYSTEM_PARTS: SystemPart[] = [
  { key: "shape", icon: "map", figure: "system", points: 3 },
  { key: "rules", icon: "shield", points: 4 },
  { key: "privacy", icon: "list", points: 4 },
  { key: "sos", icon: "sos", figure: "sos", points: 5 },
  { key: "alerts", icon: "megaphone", points: 4 },
  { key: "fails", icon: "retry", points: 4 },
  { key: "built", icon: "check", points: 4 },
  { key: "cost", icon: "parcel", points: 3 },
];

/**
 * The system page may not name a supplier, a product or a brand (A18 acceptance). Checked against
 * every line of that page in all three languages by `tests/unit/how-it-works.test.ts`, so a later
 * edit cannot quietly turn the page into an advert - or tell an attacker what to attack.
 *
 * Jaga's own name, the hotline numbers and the agencies that issue warnings are not vendors and
 * are allowed; the science page is not covered, because a data source must be credited by name.
 */
export const FORBIDDEN_VENDOR_WORDS = [
  "supabase",
  "postgres",
  "postgis",
  "vercel",
  "cloudflare",
  "next.js",
  "nextjs",
  "react",
  "tailwind",
  "typescript",
  "javascript",
  "node.js",
  "maplibre",
  "mapbox",
  "openfreemap",
  "openmaptiles",
  "pmtiles",
  "serwist",
  "playwright",
  "github",
  "google",
  "aws",
  "amazon",
  "azure",
  "firebase",
  "twilio",
  "esri",
  "arcgis",
  "line",
  "whatsapp",
  "facebook",
  "telegram",
  "openai",
  "anthropic",
  "claude",
];

export type WorkflowRow = {
  /** Message key under `howItWorks.figures.workflow.rows.<key>`: method, product, app. */
  key: string;
  /** The open data it starts from, as ids of `CREDITS`. */
  sources: string[];
  /** Products of earlier rows that go into this one: the chains that join. */
  feeds?: string[];
  /** The part of the science page this chain is explained in. */
  part: string;
};

/**
 * The workflow, the way a GIS office would draw it: open data in, one analysis step, the product
 * it makes, and where that product is seen in the app. Eight chains, four of which feed each
 * other - the radar record and the height model both go into the classes, and the gauges go into
 * both the alarm and the safe-return window.
 *
 * It is a map of the work, not a recipe: no parameter, no threshold and no order of operations.
 */
export const WORKFLOW: WorkflowRow[] = [
  { key: "radar", sources: ["sentinel1", "jrcwater", "meritHydro"], part: "radar" },
  { key: "hand", sources: ["fabdem", "osm"], part: "classes" },
  { key: "classes", sources: ["openBuildings", "gistda"], feeds: ["radar", "hand"], part: "classes" },
  { key: "gauges", sources: ["thaiwater", "rid", "gsmap"], part: "gauges" },
  { key: "dam", sources: ["egat", "thaiwater"], feeds: ["hand"], part: "dam" },
  { key: "places", sources: ["osm", "openBuildings"], feeds: ["radar", "hand"], part: "places" },
  { key: "outlook", sources: ["chirps", "era5land", "noaa"], part: "outlook" },
  { key: "sea", sources: ["openMeteo", "tmd"], part: "sea" },
];

/** The four columns of the workflow, in the order the work runs. */
export const WORKFLOW_STAGES = ["data", "analysis", "product", "app"] as const;
export type WorkflowStage = (typeof WORKFLOW_STAGES)[number];

export type ArchTier = {
  /** Message key under `howItWorks.figures.architecture.tiers.<key>`: title, note. */
  key: string;
  /** The boxes in that band, as message keys under `...boxes.<key>`: title, text. */
  boxes: string[];
  /** The arrow under the band, as a message key under `...flows.<key>`; the last band has none. */
  flow?: string;
};

/**
 * The architecture, end to end (the owner's request, 16 Oct 2026): five bands, read downwards -
 * where the figures come from, what fetches them, the one place that holds everything and decides
 * who may read it, what delivers it, and the people at the end of it.
 *
 * In general terms only: no supplier, product or brand appears here, by the same rule as the rest
 * of the system page (`FORBIDDEN_VENDOR_WORDS`).
 */
export const ARCHITECTURE: ArchTier[] = [
  { key: "sources", boxes: ["agencies", "models", "layers"], flow: "fetch" },
  { key: "readers", boxes: ["schedule", "watch", "stamp"], flow: "write" },
  { key: "core", boxes: ["tables", "rules", "audit"], flow: "serve" },
  { key: "delivery", boxes: ["app", "notifier", "files"], flow: "reach" },
  { key: "people", boxes: ["residents", "teams", "admins"] },
];

export type CreditGroup = "satellites" | "agencies" | "models" | "maps";

export type Credit = {
  id: string;
  /** The organisation's own name, as it writes it: not translated. */
  name: string;
  /** The short name for a chip under a part: the dataset everyone calls it by. */
  short: string;
  /** The dataset or service, where the name alone is not enough. */
  dataset?: string;
  group: CreditGroup;
  href: string;
  /** Short licence or terms, as the licensor names them. */
  licence: string;
  /** The credit line the licence asks for, word for word. Shown where there is one. */
  credit?: string;
  /**
   * A logo file in `public/credits/`, when the organisation's brand terms allow it and the owner
   * has cleared it. Without one the card draws the initials in the brand colours, so the page is
   * complete either way (and costs nothing to download).
   */
  logo?: string;
};

/**
 * Everyone whose data or tools Jaga is built on (`docs/attributions.md` is the source of record).
 * The owner's rule of 8 Oct 2026: every organisation is credited. The thank-you on the page is
 * the owner's too - none of this exists without open data.
 */
export const CREDITS: Credit[] = [
  {
    id: "sentinel1",
    short: "Sentinel-1",
    name: "European Space Agency, European Union",
    dataset: "Copernicus Sentinel-1",
    group: "satellites",
    href: "https://sentiwiki.copernicus.eu/web/s1-mission",
    licence: "Free, full and open; credit required",
    credit: "Contains modified Copernicus Sentinel data 2017-2026",
  },
  {
    id: "fabdem",
    short: "FABDEM",
    name: "University of Bristol, Fathom",
    dataset: "FABDEM V1-2",
    group: "satellites",
    href: "https://data.bris.ac.uk/data/dataset/25wfy0f9ukoge2gs7a5mqpq2j7",
    licence: "CC BY-NC-SA 4.0 (non-commercial, share alike)",
    credit:
      "FABDEM (Hawker et al. 2022), CC BY-NC-SA 4.0. Produced using Copernicus WorldDEM-30 (c) DLR e.V. 2010-2014 and (c) Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA",
  },
  {
    id: "jrcwater",
    short: "JRC Global Surface Water",
    name: "European Commission, Joint Research Centre",
    dataset: "Global Surface Water",
    group: "satellites",
    href: "https://global-surface-water.appspot.com/",
    licence: "Free with attribution",
    credit: "Pekel et al. 2016, Nature 540; source: EC JRC/Google",
  },
  {
    id: "meritHydro",
    short: "MERIT Hydro",
    name: "Yamazaki and colleagues",
    dataset: "MERIT Hydro",
    group: "satellites",
    href: "https://hydro.iis.u-tokyo.ac.jp/~yamadai/MERIT_Hydro/",
    licence: "CC BY-NC 4.0 / ODbL 1.0",
    credit: "Yamazaki et al. 2019, Water Resources Research",
  },
  {
    id: "openBuildings",
    short: "Open Buildings",
    name: "Google Research",
    dataset: "Open Buildings 2.5D Temporal",
    group: "satellites",
    href: "https://sites.research.google/gr/open-buildings/",
    licence: "CC BY 4.0",
    credit: "Open Buildings 2.5D Temporal Dataset, Google Research (Sirko et al. 2023)",
  },
  {
    id: "gsmap",
    logo: "gsmap.svg",
    short: "GSMaP",
    name: "JAXA",
    dataset: "GSMaP, and NASA's GPM IMERG as a check",
    group: "satellites",
    href: "https://sharaku.eorc.jaxa.jp/GSMaP/",
    licence: "Free for research and public use",
  },
  {
    id: "thaiwater",
    logo: "thaiwater.webp",
    short: "ThaiWater (HII)",
    name: "Hydro-Informatics Institute (HII)",
    dataset: "ThaiWater",
    group: "agencies",
    href: "https://www.thaiwater.net/",
    licence: "Public API",
    credit:
      "ข้อมูลจากคลังข้อมูลน้ำแห่งชาติ (ThaiWater) สถาบันสารสนเทศทรัพยากรน้ำ (สสน.)",
  },
  {
    id: "rid",
    logo: "rid.webp",
    short: "Royal Irrigation Department",
    name: "Royal Irrigation Department",
    group: "agencies",
    href: "https://www.rid.go.th/",
    licence: "Public reports and telemetry",
  },
  {
    id: "egat",
    logo: "egat.webp",
    short: "EGAT",
    name: "Electricity Generating Authority of Thailand",
    dataset: "Bang Lang dam, through ThaiWater",
    group: "agencies",
    href: "https://www.egat.co.th/",
    licence: "Public, through ThaiWater",
  },
  {
    id: "gistda",
    logo: "gistda.svg",
    short: "GISTDA",
    name: "GISTDA",
    dataset: "Repeated-flood and flood-extent maps",
    group: "agencies",
    href: "https://www.gistda.or.th/",
    licence: "Open data, free key",
    credit:
      "ข้อมูลพื้นที่น้ำท่ามจากสำนักงานพัฒนาเทคโนโลยีอวกาศและภูมิสารสนเทศ (GISTDA)",
  },
  {
    id: "tmd",
    logo: "tmd.webp",
    name: "Thai Meteorological Department",
    short: "TMD",
    dataset: "Sea and weather warnings",
    group: "agencies",
    href: "https://www.tmd.go.th/",
    licence: "Public warnings",
  },
  {
    id: "rtsd",
    short: "Admin boundaries",
    name: "Royal Thai Survey Department, through OCHA HDX",
    dataset: "Province, district and tambon boundaries",
    group: "agencies",
    href: "https://data.humdata.org/dataset/cod-ab-tha",
    licence: "CC BY-IGO",
  },
  {
    id: "openMeteo",
    short: "Open-Meteo",
    name: "Open-Meteo",
    dataset: "Weather, wave and river-discharge models",
    group: "models",
    href: "https://open-meteo.com/",
    licence: "Free for non-commercial use; data CC BY 4.0",
    credit: "Weather data by Open-Meteo.com",
  },
  {
    id: "chirps",
    logo: "chirps.svg",
    short: "CHIRPS",
    name: "Climate Hazards Center, UC Santa Barbara",
    dataset: "CHIRPS rainfall, 1981 onwards",
    group: "models",
    href: "https://www.chc.ucsb.edu/data/chirps",
    licence: "Public domain",
    credit: "Rainfall: CHIRPS (Funk et al. 2015), Climate Hazards Center, UC Santa Barbara",
  },
  {
    id: "era5land",
    short: "ERA5-Land",
    name: "ECMWF, Copernicus Climate Change Service",
    dataset: "ERA5-Land",
    group: "models",
    href: "https://cds.climate.copernicus.eu/",
    licence: "Copernicus licence; attribution required",
    credit: "Contains modified Copernicus Climate Change Service information 2026",
  },
  {
    id: "noaa",
    logo: "noaa.webp",
    short: "NOAA CPC",
    name: "NOAA Climate Prediction Center",
    dataset: "ENSO index and seasonal forecasts",
    group: "models",
    href: "https://www.cpc.ncep.noaa.gov/",
    licence: "Public domain",
  },
  {
    id: "osm",
    logo: "osm.svg",
    short: "OpenStreetMap",
    name: "OpenStreetMap contributors",
    dataset: "Rivers, roads, buildings, places and villages",
    group: "maps",
    href: "https://www.openstreetmap.org/copyright",
    licence: "ODbL 1.0",
    credit: "(c) OpenStreetMap contributors",
  },
  {
    id: "basemap",
    short: "OpenFreeMap",
    name: "OpenFreeMap, OpenMapTiles",
    dataset: "The map people see under the layers",
    group: "maps",
    href: "https://openfreemap.org/",
    licence: "Free; credit required",
    credit: "OpenFreeMap (c) OpenMapTiles, data from OpenStreetMap",
  },
  {
    id: "s2cloudless",
    short: "Sentinel-2 cloudless",
    name: "EOX IT Services",
    dataset: "Sentinel-2 cloudless",
    group: "maps",
    href: "https://s2maps.eu/",
    licence: "CC BY-NC-SA 4.0",
    credit:
      "Sentinel-2 cloudless - https://s2maps.eu by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2020)",
  },
  {
    id: "terrain",
    short: "Mapzen terrain",
    name: "Mapzen, AWS Open Data",
    dataset: "Terrain for the hill shading",
    group: "maps",
    href: "https://registry.opendata.aws/terrain-tiles/",
    licence: "Open data; credit the sources",
    credit: "Elevation: Mapzen terrain tiles (SRTM, GMTED2010 and others)",
  },
  {
    id: "esri",
    name: "Esri and the sources in its basemaps",
    short: "Esri basemaps",
    dataset: "World Imagery and terrain",
    group: "maps",
    href: "https://www.esri.com/",
    licence: "Free allowance, no pay-as-you-go",
    credit: "Powered by Esri; Esri, Maxar, Earthstar Geographics, TomTom, Garmin, FAO, NOAA, USGS and the GIS User Community",
  },
  {
    id: "earthEngine",
    short: "Earth Engine",
    name: "Google Earth Engine",
    dataset: "Where the satellite work was computed",
    group: "maps",
    href: "https://earthengine.google.com/",
    licence: "Non-commercial tier",
  },
  {
    id: "tools",
    short: "Open-source tools",
    name: "The open-source world",
    dataset: "WhiteboxTools, GDAL, rasterio, geopandas, and the rest",
    group: "maps",
    href: "https://www.whiteboxgeo.com/",
    licence: "Open source",
  },
];

export const CREDIT_GROUPS: CreditGroup[] = ["satellites", "agencies", "models", "maps"];

/** The credits of one group, in the order they are listed. */
export function creditsOf(group: CreditGroup): Credit[] {
  return CREDITS.filter((c) => c.group === group);
}

/** A credit by id, for the source chips under a part. */
export function creditById(id: string): Credit | undefined {
  return CREDITS.find((c) => c.id === id);
}

/**
 * The initials drawn when a credit has no logo file: two letters at most, from the words of the
 * name, skipping the small words that carry no sound of their own.
 */
export function initialsOf(name: string): string {
  const skip = new Set(["the", "of", "and", "for", "through", "a"]);
  const words = name
    .replace(/[(),]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !skip.has(w.toLowerCase()));
  return words
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}
