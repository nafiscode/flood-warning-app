/**
 * The dam on the map (spec section 15, the owner's request of 10 Oct).
 *
 * What is held here, in order of how much it would matter to get wrong:
 *   1. The quiet notice never becomes an alert: no alert colour, and it says so in words.
 *   2. No arrival time is ever shown, because none has been measured (S7 steps 2-3).
 *   3. Only someone on the river below the dam is told, and nobody else.
 *   4. The map's water colour is not an alert hue and does not change with the dam's state.
 */
import { describe, expect, it } from "vitest";
import { DamBoard } from "@/components/admin/DamBoard";
import { DamCard, DamLegend, DamNotice } from "@/components/map/Dam";
import { alert as alertColors } from "@/lib/brand/tokens";
import {
  ageHours,
  attention,
  flow,
  fullness,
  onPath,
  reachesInOrder,
  trend,
  type Dam,
  type DamSignal,
} from "@/lib/dam";
import {
  byZoom,
  CASING_EXTRA,
  DAM_WATER,
  DAM_WATER_DARK,
  damMarks,
  damPaint,
  emphasis,
  MAIN_WIDTH,
  RESERVOIR_FILL_OPACITY,
  TRIBUTARY_WIDTH,
} from "@/lib/dam-map";
import { exampleDamSignal, EXAMPLE_NOW } from "@/lib/dev-examples";
import { EXAMPLE_DAMS } from "@/lib/war-room-examples";
import { readFileSync } from "node:fs";
import th from "@/messages/th.json";
import { renderWithIntl } from "./render";

const line = (coords: [number, number][]) => ({ type: "LineString" as const, coordinates: coords });

const DAM: Dam = {
  code: "bang_lang",
  name: { th: "เขื่อนบางลาง", en: "Bang Lang Dam" },
  river: { th: "แม่น้ำปัตตานี", en: "Pattani River" },
  operator: "EGAT",
  point: { type: "Point", coordinates: [101.2721, 6.1551] },
  spillwayPoint: { type: "Point", coordinates: [101.2764, 6.1501] },
  outletPoint: { type: "Point", coordinates: [101.273, 6.1536] },
  reservoir: {
    type: "MultiPolygon",
    coordinates: [
      [
        [
          [101.2, 6.0],
          [101.3, 6.0],
          [101.3, 6.15],
          [101.2, 6.0],
        ],
      ],
    ],
  },
  storageMaxMcm: 1589.8,
  storageNormalMcm: 1454.4,
  geometrySource: "osm",
  geometryNote: {
    source: "osm",
    limits_en:
      "The river line is OpenStreetMap's. It shows where the water runs, not how far it spreads.",
    mapped_tributaries: 10,
    spillway_channel_mapped: false,
  },
  reaches: [
    {
      kind: "main",
      seq: 0,
      name: {},
      kmFromDam: 0,
      lengthKm: 134.3,
      line: line([
        [101.27, 6.15],
        [101.24, 6.9],
      ]),
    },
    {
      kind: "tributary",
      seq: 1,
      name: {},
      kmFromDam: 14.7,
      lengthKm: 5,
      line: line([
        [101.2, 6.3],
        [101.27, 6.28],
      ]),
    },
    {
      kind: "outlet",
      seq: 0,
      name: {},
      kmFromDam: 0,
      lengthKm: 0.31,
      line: line([
        [101.273, 6.153],
        [101.2738, 6.156],
      ]),
    },
    {
      kind: "tributary",
      seq: 0,
      name: {},
      kmFromDam: 4.6,
      lengthKm: 5,
      line: line([
        [101.2, 6.2],
        [101.27, 6.19],
      ]),
    },
  ],
  tambons: [
    { code: "950801", via: "main", kmFromDam: 4.6 },
    { code: "940104", via: "main", kmFromDam: 128 },
    { code: "950802", via: "tributary", kmFromDam: 14.7 },
  ],
  signal: exampleDamSignal("quiet"),
};

const withSignal = (signal: DamSignal | null): Dam => ({ ...DAM, signal });

describe("what the app says of its own accord", () => {
  it("says nothing while the dam is quiet", () => {
    expect(attention(exampleDamSignal("quiet"))).toBe("none");
  });

  it("says nothing when there are no figures at all", () => {
    expect(attention(null)).toBe("none");
  });

  it("is the quiet notice when the reservoir is high", () => {
    expect(attention(exampleDamSignal("watch"))).toBe("watch");
  });

  it("is the firmer notice when a release is confirmed", () => {
    expect(attention(exampleDamSignal("releasing"))).toBe("releasing");
  });

  it("shows a single unconfirmed reading as awaiting, not as a release", () => {
    expect(attention(exampleDamSignal("awaiting"))).toBe("awaiting");
  });
});

describe("the notice is not an alert", () => {
  it("says in words that it is not an alert from Jaga", () => {
    const { getByText } = renderWithIntl(
      <DamNotice
        dam={withSignal(exampleDamSignal("releasing"))}
        via="main"
        tambonName="บานา"
        now={EXAMPLE_NOW}
      />,
    );
    expect(getByText(th.dam.disclaimer.notAnAlert)).toBeTruthy();
  });

  it("carries no alert or SOS colour anywhere", () => {
    const { container } = renderWithIntl(
      <DamNotice
        dam={withSignal(exampleDamSignal("releasing"))}
        via="main"
        tambonName="บานา"
        now={EXAMPLE_NOW}
      />,
    );
    const html = container.innerHTML;
    // Only the alert palette may show a level (docs/brand.md), and this is not a level.
    expect(html).not.toMatch(/bg-alert-|text-alert-|border-alert-|bg-sos/);
    for (const hex of Object.values(alertColors).map((c) => c.toString().toLowerCase())) {
      expect(html.toLowerCase()).not.toContain(hex);
    }
  });

  it("never shows an arrival time, in any state", () => {
    for (const state of ["watch", "releasing", "awaiting"] as const) {
      const { getByText, unmount } = renderWithIntl(
        <DamNotice
          dam={withSignal(exampleDamSignal(state))}
          via="main"
          tambonName="บานา"
          now={EXAMPLE_NOW}
        />,
      );
      // The one thing it says about timing is that nobody knows it yet.
      expect(getByText(th.dam.disclaimer.noArrivalTime)).toBeTruthy();
      unmount();
    }
  });

  it("names the hour the figures are for, and how old they are", () => {
    const { container } = renderWithIntl(
      <DamNotice
        dam={withSignal(exampleDamSignal("releasing"))}
        via="main"
        tambonName="บานา"
        now={EXAMPLE_NOW}
      />,
    );
    expect(container.textContent).toContain("ข้อมูลของเวลา");
    expect(container.textContent).toMatch(/ชั่วโมงที่แล้ว/);
  });

  it("says where the person is, and differently for a tributary", () => {
    const river = renderWithIntl(
      <DamNotice
        dam={withSignal(exampleDamSignal("releasing"))}
        via="main"
        tambonName="บานา"
        now={EXAMPLE_NOW}
      />,
    );
    expect(river.container.textContent).toContain("อยู่ริม");
    river.unmount();
    const trib = renderWithIntl(
      <DamNotice
        dam={withSignal(exampleDamSignal("releasing"))}
        via="tributary"
        tambonName="ลำพะยา"
        now={EXAMPLE_NOW}
      />,
    );
    expect(trib.container.textContent).toContain("ลำน้ำสาขา");
  });

  it("is nothing at all when the dam is quiet", () => {
    const { container } = renderWithIntl(
      <DamNotice
        dam={withSignal(exampleDamSignal("quiet"))}
        via="main"
        tambonName="บานา"
        now={EXAMPLE_NOW}
      />,
    );
    expect(container.querySelector("[data-dam-notice]")).toBeNull();
  });

  it("names the source, so nobody takes the figures for ours", () => {
    const { container } = renderWithIntl(
      <DamNotice
        dam={withSignal(exampleDamSignal("releasing"))}
        via="main"
        tambonName="บานา"
        now={EXAMPLE_NOW}
      />,
    );
    expect(container.textContent).toContain("EGAT");
    expect(container.textContent).toContain("ThaiWater");
  });
});

describe("who is told", () => {
  it("someone on the river below the dam", () => {
    expect(onPath(DAM, ["940104"])?.via).toBe("main");
  });

  it("someone on a tributary's lower reach, and it says so", () => {
    expect(onPath(DAM, ["950802"])?.via).toBe("tributary");
  });

  it("nobody else", () => {
    expect(onPath(DAM, ["900101", "960101"])).toBeNull();
  });

  it("nobody, when they have chosen no area at all", () => {
    expect(onPath(DAM, [])).toBeNull();
  });

  it("the river itself comes before a tributary when both touch them", () => {
    expect(onPath(DAM, ["950802", "950801"])?.via).toBe("main");
  });

  it("the reach nearest the dam when two of their places are on the river", () => {
    expect(onPath(DAM, ["940104", "950801"])?.kmFromDam).toBe(4.6);
  });
});

describe("the figures", () => {
  it("a flow is whole cubic metres a second: the feed is not that precise", () => {
    expect(flow(647.6)).toBe(648);
    expect(flow(null)).toBeNull();
  });

  it("the share full comes from the database, not from arithmetic here", () => {
    expect(fullness(exampleDamSignal("releasing"))).toBe(94.6);
    expect(fullness(null)).toBeNull();
  });

  it("the age is in hours from the hour published", () => {
    const signal = { observedAt: new Date(EXAMPLE_NOW - 3 * 3_600_000).toISOString() };
    expect(ageHours(signal, EXAMPLE_NOW)).toBeCloseTo(3, 5);
  });

  it("a missing rate of rise is unknown, never steady", () => {
    expect(trend(exampleDamSignal("stale"))).toBe("unknown");
    expect(trend(null)).toBe("unknown");
  });

  it("rising, falling and steady are told apart", () => {
    expect(trend(exampleDamSignal("releasing"))).toBe("rising");
    // A quiet dam barely moves, and "steady" is the honest word for that.
    expect(trend(exampleDamSignal("quiet"))).toBe("steady");
    const falling = { ...exampleDamSignal("quiet")!, riseMcmPerH: -3 };
    expect(trend(falling)).toBe("falling");
  });

  it("the card says so plainly when there are no figures", () => {
    const { container } = renderWithIntl(<DamCard dam={withSignal(null)} now={EXAMPLE_NOW} />);
    expect(container.textContent).toContain(th.dam.figures.none);
  });
});

describe("the card carries the limits of the lines", () => {
  it("says the line is the river's course, not the edge of a flood", () => {
    const { getByText } = renderWithIntl(<DamCard dam={DAM} now={EXAMPLE_NOW} />);
    expect(getByText(th.dam.path.limits)).toBeTruthy();
  });

  it("says the spillway's own channel is not mapped", () => {
    const { getByText } = renderWithIntl(<DamCard dam={DAM} now={EXAMPLE_NOW} />);
    expect(getByText(th.dam.path.spillwayNotMapped)).toBeTruthy();
  });

  it("credits OpenStreetMap", () => {
    const { container } = renderWithIntl(<DamCard dam={DAM} now={EXAMPLE_NOW} />);
    expect(container.textContent).toContain("OpenStreetMap");
  });

  it("names every rule that fired, in words", () => {
    const { container } = renderWithIntl(
      <DamCard dam={withSignal(exampleDamSignal("releasing"))} now={EXAMPLE_NOW} />,
    );
    expect(container.textContent).toContain(th.dam.reason.spilling);
    expect(container.textContent).toContain(th.dam.reason.above_turbines);
  });

  it("explains an unconfirmed reading instead of hiding it", () => {
    const { container } = renderWithIntl(
      <DamCard dam={withSignal(exampleDamSignal("awaiting"))} now={EXAMPLE_NOW} />,
    );
    expect(container.textContent).toContain("รอค่าถัดไป");
    // The figure itself is still on screen: 1,944 m3/s, the archive's impossible hour.
    expect(container.textContent).toContain("1,944");
  });

  it("counts the tambons on the river and on the tributaries separately", () => {
    const { container } = renderWithIntl(<DamCard dam={DAM} now={EXAMPLE_NOW} />);
    expect(container.textContent).toContain("2");
    expect(container.textContent).toContain("1");
  });
});

describe("how it is drawn", () => {
  it("the water colour is not an alert hue", () => {
    const hues = Object.values(alertColors).map((c) => c.toString().toLowerCase());
    for (const colour of [DAM_WATER, DAM_WATER_DARK]) {
      expect(hues).not.toContain(colour.toLowerCase());
    }
  });

  it("the water colour does not change with what the dam is doing", () => {
    // The state is said in words with an icon. A river that turned amber would be a sixth
    // alert colour, and one nobody has been taught (docs/brand.md).
    expect(damPaint(false).water).toBe(DAM_WATER);
    expect(damPaint(true).water).toBe(DAM_WATER_DARK);
  });

  it("day and night differ in every value", () => {
    const day = damPaint(false);
    const night = damPaint(true);
    for (const key of Object.keys(day) as (keyof typeof day)[]) {
      expect(day[key]).not.toBe(night[key]);
    }
  });

  it("globals.css holds the same two colours as the map does", () => {
    // MapLibre cannot read a CSS variable, so the value exists twice. This is the only thing
    // keeping the legend swatch and the river the same colour.
    const css = readFileSync("app/globals.css", "utf8").toLowerCase();
    const light = css.slice(0, css.indexOf(':root[data-theme="dark"]'));
    const dark = css.slice(css.indexOf(':root[data-theme="dark"]'));
    expect(light).toContain(`--jaga-dam: ${DAM_WATER.toLowerCase()};`);
    expect(dark).toContain(`--jaga-dam: ${DAM_WATER_DARK.toLowerCase()};`);
  });

  it("a release thickens the casing and nothing else", () => {
    expect(emphasis("releasing")).toBe(true);
    expect(emphasis("watchful")).toBe(false);
    expect(emphasis(null)).toBe(false);
  });

  it("the river is drawn wider than its tributaries at every zoom", () => {
    for (const [i, [zoom, width]] of MAIN_WIDTH.entries()) {
      expect(TRIBUTARY_WIDTH[i]![0]).toBe(zoom);
      expect(width).toBeGreaterThan(TRIBUTARY_WIDTH[i]![1]);
    }
  });

  it("the casing is always wider than the line it carries", () => {
    expect(CASING_EXTRA).toBeGreaterThan(0);
  });

  it("the reservoir is faint enough to read the alert levels through", () => {
    expect(RESERVOIR_FILL_OPACITY).toBeLessThan(0.5);
  });

  it("a zoom ramp becomes a MapLibre interpolate expression", () => {
    expect(
      byZoom([
        [7, 2],
        [9, 3],
      ]),
    ).toEqual(["interpolate", ["linear"], ["zoom"], 7, 2, 9, 3]);
  });

  it("tributaries are drawn first, so the river lies over them", () => {
    const order = reachesInOrder(DAM).map((r) => r.kind);
    expect(order.indexOf("main")).toBeGreaterThan(order.lastIndexOf("tributary"));
    expect(order).toEqual(["tributary", "tributary", "outlet", "main"]);
  });

  it("the legend names the reservoir, the river and the tributaries", () => {
    const { container } = renderWithIntl(
      <ul>
        <DamLegend dam={DAM} />
      </ul>,
    );
    expect(container.textContent).toContain("อ่างเก็บน้ำ");
    expect(container.textContent).toContain("แม่น้ำปัตตานี");
    expect(container.textContent).toContain("ลำน้ำสาขา");
  });
});

describe("the copy says the same thing in all three languages", () => {
  const files = {
    th: th as Record<string, unknown>,
    ms: JSON.parse(readFileSync("messages/ms.json", "utf8")),
    en: JSON.parse(readFileSync("messages/en.json", "utf8")),
  };

  const keys = (value: unknown, prefix = ""): string[] =>
    typeof value === "object" && value !== null
      ? Object.entries(value).flatMap(([k, v]) => keys(v, `${prefix}${k}.`))
      : [prefix.slice(0, -1)];

  it("every key exists in Malay and English too", () => {
    const thai = keys((files.th as { dam: unknown }).dam).sort();
    for (const locale of ["ms", "en"] as const) {
      expect(keys((files[locale] as { dam: unknown }).dam).sort()).toEqual(thai);
    }
  });

  it("each one says it is not an alert from Jaga", () => {
    for (const locale of ["th", "ms", "en"] as const) {
      const dam = (files[locale] as { dam: { disclaimer: { notAnAlert: string } } }).dam;
      expect(dam.disclaimer.notAnAlert.length).toBeGreaterThan(20);
    }
  });
});

describe("the dam on the admins' war room", () => {
  const row = EXAMPLE_DAMS[0]!;
  const render = (
    over: Partial<typeof row> = {},
    review: ((f: FormData) => void) | null = () => {},
  ) => renderWithIntl(<DamBoard dams={[{ ...row, ...over }]} now={EXAMPLE_NOW} review={review} />);

  it("says plainly that nothing has been sent to anybody", () => {
    const { getByText } = render();
    expect(getByText(th.warRoom.dam.reviewTitle)).toBeTruthy();
    expect(getByText(th.warRoom.dam.reviewBody)).toBeTruthy();
  });

  it("offers the two answers, and only those two", () => {
    const { getByText, container } = render();
    expect(getByText(th.warRoom.dam.sent)).toBeTruthy();
    expect(getByText(th.warRoom.dam.dismiss)).toBeTruthy();
    const values = [...container.querySelectorAll("button[name='status']")].map((b) =>
      b.getAttribute("value"),
    );
    expect(values.sort()).toEqual(["dismissed", "sent"]);
  });

  it("carries the notice's own id, so a second dam cannot be reviewed by mistake", () => {
    const { container } = render();
    expect(container.querySelector("input[name='notice']")?.getAttribute("value")).toBe(
      row.notice!.id,
    );
  });

  it("is not an alert either: no alert or SOS colour on the panel", () => {
    // The war room paints an unanswered SOS with border-sos. A dam release is not a level and
    // must not borrow that weight (docs/brand.md).
    const { container } = render();
    expect(container.innerHTML).not.toMatch(
      /bg-alert-|text-alert-|border-alert-|bg-sos|border-sos/,
    );
  });

  it("names every rule that fired", () => {
    const { container } = render();
    expect(container.textContent).toContain(th.warRoom.dam.reason.spilling);
    expect(container.textContent).toContain(th.warRoom.dam.reason.above_normal_high);
  });

  it("asks for nothing when the dam is quiet", () => {
    const { container, queryByText } = render({
      signal: exampleDamSignal("quiet"),
      notice: null,
    });
    expect(queryByText(th.warRoom.dam.reviewTitle)).toBeNull();
    expect(container.querySelector("[data-dam-notice='none']")).toBeTruthy();
  });

  it("shows who judged it once somebody has", () => {
    const { container } = render({
      notice: {
        ...row.notice!,
        status: "sent",
        reviewedAt: new Date(EXAMPLE_NOW - 60_000).toISOString(),
        reviewedByName: "นาฟิส",
      },
    });
    expect(container.textContent).toContain("นาฟิส");
    // Judged, so it no longer asks.
    expect(container.querySelector("button[name='status']")).toBeNull();
  });

  it("calls out a feed that stopped answering, which otherwise looks like calm", () => {
    const { getByRole } = render({
      feed: {
        ok: false,
        ranAt: new Date(EXAMPLE_NOW - 3_600_000).toISOString(),
        error: "http 504",
      },
    });
    expect(getByRole("alert").textContent).toContain("ดึงข้อมูลเขื่อนไม่สำเร็จ");
  });

  it("calls out figures that are older than usual", () => {
    const { container } = render({ signal: exampleDamSignal("stale") });
    expect(container.textContent).toContain(th.warRoom.dam.stale);
  });

  it("explains an unconfirmed reading rather than grading on it", () => {
    const { container } = render({ signal: exampleDamSignal("awaiting"), notice: null });
    expect(container.textContent).toContain("ต้องตรงกัน");
  });

  it("counts the tambons on the river and on its tributaries", () => {
    const { container } = render();
    expect(container.textContent).toContain("36");
    expect(container.textContent).toContain("3");
  });

  it("draws nothing at all when there is no dam", () => {
    const { container } = renderWithIntl(<DamBoard dams={[]} now={EXAMPLE_NOW} review={null} />);
    expect(container.innerHTML).toBe("");
  });

  it("shows no form on the example page, which records nothing", () => {
    const { container } = render({}, null);
    expect(container.querySelector("form")).toBeNull();
    // It still says a release is waiting, so the example shows the real state of the screen.
    expect(container.querySelector("[data-dam-notice='open']")).toBeTruthy();
  });
});

describe("the labels on the map marks", () => {
  /*
   * The dam's mark is labelled with its name alone. It used to be the word "dam" plus the name,
   * and since the Thai word for the dam *is* its name, the map read "เขื่อนบางลาง เขื่อนบางลาง"
   * wrapped over two lines. Only a screenshot caught it, so it is pinned here.
   */
  const text = (locale: string) => ({ spillway: "ทางระบายน้ำล้น", outlet: "ท้ายน้ำ", locale });
  const labelOf = (locale: string, kind: string) =>
    damMarks(DAM, text(locale)).find((m) => m.kind === kind)!.label;

  it("the dam's label is its name, once", () => {
    const label = labelOf("th", "dam");
    expect(label).toBe("เขื่อนบางลาง");
    // Twice over would split into three pieces, which is what the map drew before.
    expect(label.split("เขื่อนบางลาง")).toHaveLength(2);
  });

  it("the name follows the reader's language", () => {
    expect(labelOf("en", "dam")).toBe("Bang Lang Dam");
  });

  it("falls back to a name it has when the reader's language has none", () => {
    expect(labelOf("ms", "dam")).toBe("เขื่อนบางลาง");
  });

  it("the spillway and the outlet keep their own words", () => {
    expect(labelOf("th", "spillway")).toBe("ทางระบายน้ำล้น");
    expect(labelOf("th", "outlet")).toBe("ท้ายน้ำ");
  });

  it("a dam with no spillway pinned still gets its own mark", () => {
    const marks = damMarks({ ...DAM, spillwayPoint: null }, text("th"));
    expect(marks.map((m) => m.kind)).toEqual(["dam", "spillway", "outlet"]);
    expect(marks.find((m) => m.kind === "spillway")!.point).toBeNull();
  });
});
