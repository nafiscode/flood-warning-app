import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DashboardView, type DashboardViewProps } from "@/components/map/DashboardView";
import { DamPeek, GaugePeek, PlacePeek } from "@/components/map/MapPeek";
import type { PeekTarget } from "@/components/map/MapView";
import {
  BANA,
  EXAMPLE_DIRECTORY,
  EXAMPLE_HAZARDS,
  EXAMPLE_MAP,
  EXAMPLE_ME,
  EXAMPLE_NOW,
  exampleAlert,
  exampleDamDaily,
  exampleDamDays,
  exampleDamSignal,
  exampleStatus,
} from "@/lib/dev-examples";
import type { Dam } from "@/lib/dam";
import { boundsAround } from "@/lib/map";
import en from "@/messages/en.json";
import th from "@/messages/th.json";
import { renderWithIntl } from "./render";

/*
 * The real map needs WebGL. This one shows where it was asked to look, and draws the pop-up the
 * page gives it for each kind of mark, as the real map does when one is hovered or tapped.
 */
vi.mock("@/components/map/MapView", () => ({
  MapView: ({
    bounds,
    showMine = false,
    peek,
  }: {
    bounds?: [number, number, number, number];
    showMine?: boolean;
    peek?: (target: PeekTarget) => React.ReactNode;
  }) => (
    <div
      data-map="true"
      data-show-mine={showMine ? "1" : "0"}
      data-bounds={bounds ? bounds.map((n) => n.toFixed(3)).join(",") : ""}
    >
      {peek && (
        <>
          <div data-test-peek="gauge">{peek({ kind: "gauge", id: "g1" })}</div>
          <div data-test-peek="place">{peek({ kind: "place", id: EXAMPLE_MAP.places[0]!.id })}</div>
          <div data-test-peek="dam">{peek({ kind: "dam", code: "bang_lang" })}</div>
          <div data-test-peek="none">{peek({ kind: "gauge", id: "nowhere" })}</div>
        </>
      )}
    </div>
  ),
}));

// Cast, not annotated: the dam type gains fields as more reservoirs arrive, and this is the least
// a dam needs for its pop-up.
const DAM = {
  code: "bang_lang",
  name: { th: "เขื่อนบางลาง", en: "Bang Lang Dam" },
  river: { th: "แม่น้ำปัตตานี", en: "Pattani River" },
  operator: "EGAT",
  feed: "hourly" as const,
  point: { type: "Point", coordinates: [101.2721, 6.1551] },
  spillwayPoint: null,
  outletPoint: null,
  reservoir: null,
  storageMaxMcm: 1589.8,
  storageNormalMcm: 1454.4,
  geometrySource: "osm",
  geometryNote: { source: "osm" },
  reaches: [],
  tambons: [],
  signal: exampleDamSignal("watch"),
  daily: exampleDamDaily("watch"),
  days: exampleDamDays("watch"),
  arrivals: [],
} as unknown as Dam;

function dashboard(more: Partial<DashboardViewProps> = {}, locale: "th" | "en" = "en") {
  return renderWithIntl(
    <DashboardView
      status={exampleStatus([exampleAlert("warning", [BANA.code])])}
      checkedAt={EXAMPLE_NOW - 60_000}
      failed={false}
      hazards={EXAMPLE_HAZARDS}
      hazardsState="ok"
      directory={EXAMPLE_DIRECTORY}
      directoryState="ok"
      data={EXAMPLE_MAP}
      dataState="ok"
      now={EXAMPLE_NOW}
      transparency={false}
      dams={[DAM]}
      {...more}
    />,
    locale,
  ).container;
}

const time = () => "14 Oct 09:00";

describe("the pop-ups on the map", () => {
  it("a gauge says how it stands, when it was measured, and that it is not an alert", () => {
    const gauge = { ...EXAMPLE_MAP.gauges[0]!, bank: 4, rise3h: 0.3 };
    const c = renderWithIntl(
      <GaugePeek gauge={gauge} dark={false} time={time} onMore={() => {}} />,
      "en",
    ).container;
    expect(c.textContent).toContain("Example river gauge");
    expect(c.querySelector("[data-gauge-state]")?.textContent).toBe(en.map.gauge.above_watch);
    expect(c.textContent).toContain("Water level 3.42 m MSL · 0.58 m below the bank");
    expect(c.textContent).toContain("Rose 0.30 m in about 3 hours");
    expect(c.textContent).toContain("Measured 14 Oct 09:00");
    expect(c.textContent).toContain(en.map.gauge.notAlert);
  });

  it("a silent gauge says so and shows no level as if it were current", () => {
    const gauge = { ...EXAMPLE_MAP.gauges[0]!, status: "no_recent_data" as const, rise3h: 1 };
    const c = renderWithIntl(
      <GaugePeek gauge={gauge} dark={false} time={time} onMore={() => {}} />,
      "en",
    ).container;
    expect(c.textContent).toContain(en.map.gauge.no_recent_data);
    expect(c.textContent).not.toContain("Water level");
    expect(c.querySelector("[data-gauge-trend]")).toBeNull();
  });

  it("a reservoir shows its state, storage and outflow, and says it is not an alert", () => {
    const c = renderWithIntl(<DamPeek dam={DAM} time={time} onMore={() => {}} />, "en").container;
    expect(c.textContent).toContain("Bang Lang Dam");
    expect(c.querySelector("[data-dam-chip]")?.getAttribute("data-dam-chip")).toBe("watch");
    expect(c.textContent).toMatch(/Storage [\d,]+ million m³ \(\d+% of maximum capacity\)/);
    expect(c.textContent).toMatch(/Total outflow [\d,]+ m³\/s/);
    expect(c.textContent).toContain(en.dam.disclaimer.notAnAlert);
  });

  it("a reservoir with no figures says so", () => {
    const c = renderWithIntl(
      <DamPeek dam={{ ...DAM, signal: null }} time={time} onMore={() => {}} />,
      "en",
    ).container;
    expect(c.textContent).toContain(en.dam.figures.none);
  });

  it("a safe place has the same Navigate chooser as the home screen", () => {
    const place = EXAMPLE_MAP.places[0]!;
    const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)";
    const c = renderWithIntl(
      <PlacePeek place={place} userAgent={iphone} onMore={() => {}} />,
      "en",
    ).container;
    const chooser = c.querySelector(`[data-navigate-place="${place.id}"]`)!;
    expect(chooser.tagName).toBe("DETAILS");
    const apps = [...chooser.querySelectorAll("[data-navigate-app]")].map((a) =>
      a.getAttribute("data-navigate-app"),
    );
    expect(apps).toEqual(expect.arrayContaining(["google", "waze", "apple"]));
    const google = chooser.querySelector('[data-navigate-app="google"]')!.getAttribute("href")!;
    expect(google).toContain(String(place.lat));
  });

  it("every pop-up leads to the full card under the map", () => {
    let asked = 0;
    const c = renderWithIntl(
      <DamPeek dam={DAM} time={time} onMore={() => (asked += 1)} />,
      "en",
    ).container;
    const more = c.querySelector("[data-peek-more]") as HTMLButtonElement;
    expect(more.textContent).toBe(en.map.peek.more);
    fireEvent.click(more);
    expect(asked).toBe(1);
  });

  it("the map page draws one for a gauge, a safe place and a reservoir, and nothing for an unknown mark", () => {
    const c = dashboard();
    expect(c.querySelector('[data-test-peek="gauge"] [data-peek="gauge"]')).not.toBeNull();
    expect(c.querySelector('[data-test-peek="place"] [data-peek="place"]')).not.toBeNull();
    expect(c.querySelector('[data-test-peek="dam"] [data-peek="dam"]')).not.toBeNull();
    expect(c.querySelector('[data-test-peek="none"]')!.childElementCount).toBe(0);
  });

  it("'See all details' opens the card under the map", () => {
    const c = dashboard();
    expect(c.querySelector("[data-selected-panel]")).toBeNull();
    fireEvent.click(c.querySelector('[data-test-peek="gauge"] [data-peek-more]')!);
    expect(c.querySelector('[data-selected-panel] [data-selected="gauge"]')).not.toBeNull();
  });
});

describe("the My places button", () => {
  const bounds = (c: HTMLElement) => c.querySelector("[data-map]")!.getAttribute("data-bounds");

  it("frames the person's home and watched places, and shows their pins", () => {
    if (!EXAMPLE_ME.signedIn) throw new Error("the example person is signed in");
    const me = { ...EXAMPLE_ME, home: { ...BANA, from: "account" as const } };
    const c = dashboard({ me, area: BANA });
    const button = c.querySelector("[data-zoom-mine]") as HTMLButtonElement;
    expect(button.textContent).toBe(en.map.zoomMine);
    // Their pins were switched off; the button switches them back on.
    fireEvent.click(c.querySelector("[data-mine-toggle] input")!);
    expect(c.querySelector("[data-map]")!.getAttribute("data-show-mine")).toBe("0");
    fireEvent.click(button);
    expect(c.querySelector("[data-map]")!.getAttribute("data-show-mine")).toBe("1");
    const points = [
      { lon: BANA.lon, lat: BANA.lat },
      ...me.places.filter((p) => p.area).map((p) => ({ lon: p.area!.lon, lat: p.area!.lat })),
    ];
    expect(bounds(c)).toBe(
      boundsAround(points)!
        .map((n) => n.toFixed(3))
        .join(","),
    );
  });

  it("frames the chosen area for someone with no saved places", () => {
    const c = dashboard({ area: BANA, me: null });
    fireEvent.click(c.querySelector("[data-zoom-mine]")!);
    expect(bounds(c)).toBe(
      boundsAround([{ lon: BANA.lon, lat: BANA.lat }])!
        .map((n) => n.toFixed(3))
        .join(","),
    );
  });

  it("is not offered when there is nothing of theirs to show", () => {
    const c = dashboard({ me: null, area: null });
    expect(c.querySelector("[data-zoom-mine]")).toBeNull();
    expect(c.querySelector("[data-zoom-all]")).not.toBeNull();
  });

  it("has words in Thai", () => {
    const c = dashboard({ area: BANA, me: null }, "th");
    expect(c.querySelector("[data-zoom-mine]")!.textContent).toBe(th.map.zoomMine);
  });
});
