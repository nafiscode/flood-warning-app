import { attention, type Dam, type DamAttention } from "@/lib/dam";
import { reportsNearMe, type TambonReports } from "@/lib/flood-reports";
import {
  ageMinutes,
  damTally,
  gaugeTally,
  reportTally,
  type DamTally,
  type GaugeTally,
} from "@/lib/map-console";
import type { GaugeReading } from "@/lib/map-data";
import type { LoadState } from "@/lib/use-public";
import { DRY_MM, isStale, isWet, type WeatherGroup } from "@/lib/weather";

/**
 * "What the monitoring shows now" (the owner, 17 Oct 2026): the live measurements behind the one
 * block on the home screen and above the map that answers "how are things right now?".
 *
 * Nothing here is a level and nothing here suggests one. `weight` is a sort key, never a severity,
 * and is never rendered. There is deliberately **no** field summarising the whole picture, because
 * such a field would be a computed level in all but name, and only a person issues a level
 * (safety rule 2). The level a reader sees is the published one, from `areaStatus`, and this
 * module never touches it.
 *
 * The absence of an observation is never "fine" (safety rule 10). Every feed answers in one of
 * three states, never two: a feed that could not be read says so (`"unknown"`), and a feed that
 * could be read and had nothing in it says what was measured, where and when (`"quiet"`) rather
 * than that all is well. A quiet note is a measurement with a scope and a time; it is not an
 * all-clear, and the words in the component are written so it cannot be read as one.
 *
 * Pure: no clock of its own, no network, no database. Every figure arrives with its own time,
 * because the feeds lag by hours and a stale reading must never pass for the river as it is now
 * (safety rules 3 and 8).
 */

/** A feed as a screen got it. `state: "ok"` with null data is impossible by construction. */
export type Feed<T> = { state: LoadState; data: T | null };

/**
 * What a note can say. Three states, never two: "could not be read" is not "nothing to report",
 * and neither of them is ever an all-clear.
 */
export type NoteSay = "active" | "quiet" | "unknown";

/** How far a note reaches, as a token. The words are the component's; it has the locale. */
export type NoteScope = "nearMe" | "myAreas" | "province" | "fourProvinces" | "myPlace";

export type NoteKind = "gauges" | "dam" | "reports" | "rain";

/** The fixed order a full tie falls back to, so the list never shuffles between renders. */
const KIND_ORDER: NoteKind[] = ["gauges", "dam", "reports", "rain"];

type Base = {
  kind: NoteKind;
  say: NoteSay;
  /** Ordering only. Never a level, never shown, never coloured. */
  weight: 0 | 1 | 2;
  scope: NoteScope;
  /** The measurement's own time, ISO, or null when the feed has none. */
  at: string | null;
  /** Whole minutes between `at` and `now`; null when there is no `at` or no clock yet. */
  ageMin: number | null;
};

export type GaugeNote = Base & {
  kind: "gauges";
  over: number;
  near: number;
  reporting: number;
  silent: number;
  total: number;
};

export type DamNote = Base & {
  kind: "dam";
  damCode: string | null;
  /**
   * `attention()` verbatim, never `damLevel()`: `damLevel` is the vocabulary docs/brand.md lets
   * the dam's own chip wear in alert hues, and this section wears none.
   */
  attention: DamAttention;
  percentFull: number | null;
  outflowCms: number | null;
  spilledCms: number | null;
  /** The reservoir is past the share it is normally held at. */
  pastNormal: boolean;
  /** The feed has not been updated. The figures keep their meaning and gain their age (rule 3). */
  stale: boolean;
  /** The person's own area or a watched place is on this dam's river. */
  onMyRiver: boolean;
  /**
   * Why there are no figures, when there are none (the owner, 18 Oct 2026): `feed` is the request
   * itself not answering, and `reading` is the request answering while the station has published
   * nothing for this moment - two different sentences, because the second one is the station being
   * quiet and not Jaga being unable to read. Null whenever there are figures.
   */
  noFigures: "feed" | "reading" | null;
};

export type ReportNote = Base & {
  kind: "reports";
  reports: number;
  people: number;
  tambons: number;
  confirmed: number;
  /** Reports standing in a tambon that is the person's own. 0 when they saved no area. */
  here: number;
};

export type RainNote = Base & {
  kind: "rain";
  group: WeatherGroup | null;
  rainMm: number | null;
  wet: boolean;
  stale: boolean;
};

export type Note = GaugeNote | DamNote | ReportNote | RainNote;

export type Monitoring = {
  /** Ordered; every kind the screen has a feed for is present, including the unknown ones. */
  notes: Note[];
  anyUnknown: boolean;
  /** Every note is unknown: the section then says only that, and no quiet sentence at all. */
  allUnknown: boolean;
  /** The newest `at` of any note, for the "newest measurement" line. */
  newestAt: string | null;
};

/** One reading of the forecast model, as the device already keeps it for the header's pill. */
export type RainReading = { group: WeatherGroup; rainMm: number; at: string };

/** A point to measure distance from: the person's own area. */
export type Point = { lat: number; lon: number };

export type MonitoringInput = {
  now: number;
  /** The person's own tambon codes (own area and watched places); [] for a visitor. */
  myCodes: readonly string[];
  /** The person's own area, for the gauges' distance filter. Null when none is saved. */
  myPoint: Point | null;
  /** The screen is narrowed to one province: used only for the reports' scope token. */
  narrowed: boolean;
  /** The stations as the public feed gives them, points and all. */
  gauges: Feed<readonly GaugeReading[]>;
  /** The one dam the screen already picked; this module never picks. */
  dam: Feed<Dam>;
  onMyRiver: boolean;
  reports: Feed<readonly TambonReports[]>;
  /** Left out where the device knows no weather place at all: there is then no rain note. */
  rain?: Feed<RainReading>;
};

/**
 * How far from the person's own area a river gauge still counts as one of "their" rivers.
 *
 * It is a distance and not a province on purpose. The public gauge feed carries a point but no
 * tambon or province, and the four provinces' bounding boxes overlap, so counting gauges by box
 * would put a station in two provinces at once. A distance is the honest answer to a question
 * about points, and it reads the way a person means it.
 */
export const GAUGES_NEAR_KM = 50;

const EARTH_KM_PER_DEG = 111.32;

/**
 * The gauges within `km` of a point. The same small-angle approximation lib/sea.ts and
 * lib/weather-grid.ts already use: at this latitude and over these distances it is well inside
 * the error of the question being asked.
 */
export function gaugesNear<T extends GaugeReading>(
  gauges: readonly T[],
  point: Point,
  km = GAUGES_NEAR_KM,
): T[] {
  const scale = Math.cos((point.lat * Math.PI) / 180);
  const limit = (km / EARTH_KM_PER_DEG) ** 2;
  return gauges.filter((g) => {
    const dy = g.lat - point.lat;
    const dx = (g.lon - point.lon) * scale;
    return dy * dy + dx * dx <= limit;
  });
}

/**
 * A reading's age, or nothing at all before the page has a clock. `useNow()` is 0 in the server's
 * HTML, and `ageMinutes` would floor that to "0 minutes ago" - which reads as "just now" for a
 * reading that may be hours old. No age is the honest answer until the clock arrives.
 */
function ageOf(at: string | null, now: number): number | null {
  return now > 0 ? ageMinutes(at, now) : null;
}

type Said = { say: NoteSay; weight: 0 | 1 | 2 };

const unknownSaid: Said = { say: "unknown", weight: 0 };
const quietSaid: Said = { say: "quiet", weight: 0 };
const activeSaid = (weight: 1 | 2): Said => ({ say: "active", weight });

/**
 * What the river gauges read.
 *
 * The rule that matters most here is the third one: a feed that answered while **no** gauge is
 * reporting is `unknown`, not quiet. "Every gauge is silent" and "every river is below its bank"
 * are opposite facts, and only the first one is true in that case.
 */
function gaugeSay(tally: GaugeTally, state: LoadState): Said {
  if (state !== "ok" || tally.total === 0) return unknownSaid;
  if (tally.reporting === 0) return unknownSaid;
  if (tally.over > 0) return activeSaid(2);
  if (tally.near > 0) return activeSaid(1);
  return quietSaid;
}

function pastNormalOf(tally: DamTally): boolean {
  const { percentFull, normalMark } = tally;
  return percentFull !== null && normalMark !== null && percentFull / 100 > normalMark;
}

/** What the dam's own published figures say. A dam that has published nothing is never quiet. */
function damSay(tally: DamTally | null, state: LoadState): Said {
  if (state !== "ok" || !tally || !tally.dam.signal) return unknownSaid;
  const how = attention(tally.dam.signal);
  if (how === "releasing" || (tally.spilledCms ?? 0) > 0) return activeSaid(2);
  if (how === "watch" || how === "awaiting" || pastNormalOf(tally)) return activeSaid(1);
  return quietSaid;
}

/**
 * Whether the dam's figures are this reader's business at all (the owner, 18 Oct 2026: where
 * their places are not reached by a release or a rise, "hide the information on these, no need to
 * say, can't read the dam info").
 *
 * Two things are never hidden. **A dam that is doing something**: a release or water over the
 * spillway is an event, and silence about an event is not something this app does, whatever the
 * modelled reach of it says. And **a dam whose reach there is nothing to compare with**: a reader
 * who has saved no place at all is shown the whole four provinces everywhere else, so the dam
 * stays with them too. Hiding only ever means "this one is not about you", which can only be said
 * of somebody whose own places are known.
 */
function damConcerns(said: Said, onMyRiver: boolean, knowsPlaces: boolean): boolean {
  return said.say === "active" || onMyRiver || !knowsPlaces;
}

export function monitoring(input: MonitoringInput): Monitoring {
  const { now, myCodes, myPoint, narrowed } = input;
  const notes: Note[] = [];

  // Rivers. Scoped by distance when the person has an area, and said to be all four otherwise.
  const all = input.gauges.data ?? [];
  const mine = myPoint ? gaugesNear(all, myPoint) : all;
  const gTally = gaugeTally(mine);
  notes.push({
    kind: "gauges",
    ...gaugeSay(gTally, input.gauges.state),
    scope: myPoint ? "nearMe" : "fourProvinces",
    at: gTally.newestAt,
    ageMin: ageOf(gTally.newestAt, now),
    over: gTally.over,
    near: gTally.near,
    reporting: gTally.reporting,
    silent: gTally.silent,
    total: gTally.total,
  });

  // The dam's own figures, where the dam is anything to do with this reader.
  const dTally = damTally(input.dam.data ?? undefined);
  const dSaid = damSay(dTally, input.dam.state);
  if (damConcerns(dSaid, input.onMyRiver, myCodes.length > 0)) {
    notes.push({
      kind: "dam",
      ...dSaid,
      scope: input.onMyRiver ? "myAreas" : "fourProvinces",
      at: dTally?.observedAt ?? null,
      ageMin: ageOf(dTally?.observedAt ?? null, now),
      damCode: dTally?.dam.code ?? null,
      attention: attention(dTally?.dam.signal ?? null),
      percentFull: dTally?.percentFull ?? null,
      outflowCms: dTally?.outflowCms ?? null,
      spilledCms: dTally?.spilledCms ?? null,
      pastNormal: dTally ? pastNormalOf(dTally) : false,
      stale: dTally?.stale ?? false,
      onMyRiver: input.onMyRiver,
      noFigures:
        dSaid.say !== "unknown"
          ? null
          : input.dam.state === "ok"
            ? // The feed answered: the station itself has published nothing for this moment.
              "reading"
            : "feed",
    });
  }

  // What residents are reporting. A failed request is never an empty list (the route sees to it).
  const rows = input.reports.data ?? [];
  const rTally = reportTally(rows);
  const here = myCodes.length
    ? reportsNearMe([...rows], [...myCodes]).here.reduce((n, r) => n + r.reports, 0)
    : 0;
  const rSaid: Said =
    input.reports.state !== "ok"
      ? unknownSaid
      : rTally.reports === 0
        ? quietSaid
        : rTally.confirmed > 0 || here > 0
          ? activeSaid(2)
          : activeSaid(1);
  notes.push({
    kind: "reports",
    ...rSaid,
    scope: myCodes.length > 0 ? "myAreas" : narrowed ? "province" : "fourProvinces",
    at: rTally.latestAt,
    ageMin: ageOf(rTally.latestAt, now),
    reports: rTally.reports,
    people: rTally.people,
    tambons: rTally.tambons,
    confirmed: rTally.confirmed,
    here,
  });

  // The forecast model's rain, from the reading the device already keeps. No request is made.
  if (input.rain) {
    const reading = input.rain.data;
    const wet = reading ? isWet(reading.group) || reading.rainMm >= DRY_MM : false;
    const heavy =
      reading?.group === "rainHeavy" ||
      reading?.group === "showersHeavy" ||
      reading?.group === "thunder" ||
      reading?.group === "thunderHail";
    const wSaid: Said =
      input.rain.state !== "ok" || !reading
        ? unknownSaid
        : wet
          ? activeSaid(heavy ? 2 : 1)
          : quietSaid;
    notes.push({
      kind: "rain",
      ...wSaid,
      scope: "myPlace",
      at: reading?.at ?? null,
      ageMin: ageOf(reading?.at ?? null, now),
      group: reading?.group ?? null,
      rainMm: reading?.rainMm ?? null,
      wet,
      stale: reading ? isStale(reading.at, now) : false,
    });
  }

  /*
   * Worst first, and **unknown above quiet on purpose**: a fact Jaga could not read deserves a
   * reader's eye before a fact that is quiet.
   */
  const rank = (n: Note) => (n.say === "active" ? 10 + n.weight : n.say === "unknown" ? 5 : 0);
  const ordered = [...notes].sort(
    (a, b) =>
      rank(b) - rank(a) ||
      (b.at ?? "").localeCompare(a.at ?? "") ||
      KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind),
  );

  const unknowns = ordered.filter((n) => n.say === "unknown").length;
  return {
    notes: ordered,
    anyUnknown: unknowns > 0,
    allUnknown: ordered.length > 0 && unknowns === ordered.length,
    newestAt: ordered.reduce<string | null>(
      (best, n) => (n.at && (!best || n.at > best) ? n.at : best),
      null,
    ),
  };
}

/*
 * The one line the card shows before anything is opened (the owner, 17 Oct 2026: "just show the
 * status in text and small animated symbol").
 *
 * "inRange" says the **readings** are within their normal range - never that the situation is, or
 * that anyone is safe. That distinction is the whole reason this is allowed to be a single
 * reassuring line at all: it is a statement about instruments, with their count and their time
 * beside it, and the card it sits on says so (the owner chose this reading over a plain "the
 * situation is normal", 17 Oct). It is deliberately **not** called "normal": that word is an
 * alert level in this app, and the two must never be confused in the markup or in a test.
 */
export type StatusKind = "inRange" | "watching" | "incomplete" | "unknown";

export type MonitoringStatus = {
  kind: StatusKind;
  /** The note that earns "watching", already worst-first. Null in every other state. */
  lead: Note | null;
  /** How many of the rivers Jaga watches are reporting, for the line beneath. */
  reporting: number;
  total: number;
  /** How many feeds could not be read, when some could. */
  unknowns: number;
  newestAt: string | null;
};

export function monitoringStatus(summary: Monitoring): MonitoringStatus {
  const gauges = summary.notes.find((n): n is GaugeNote => n.kind === "gauges");
  const base = {
    reporting: gauges?.reporting ?? 0,
    total: gauges?.total ?? 0,
    unknowns: summary.notes.filter((n) => n.say === "unknown").length,
    newestAt: summary.newestAt,
  };
  if (summary.notes.length === 0 || summary.allUnknown) {
    return { kind: "unknown", lead: null, ...base };
  }
  /*
   * Something happening is the headline even when another feed also failed: the reader is told
   * about the failure underneath, but what is measurably going on comes first.
   */
  const lead = summary.notes.find((n) => n.say === "active") ?? null;
  if (lead) return { kind: "watching", lead, ...base };
  if (summary.anyUnknown) return { kind: "incomplete", lead: null, ...base };
  return { kind: "inRange", lead: null, ...base };
}
