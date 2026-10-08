import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DashboardView, type DashboardViewProps } from "@/components/map/DashboardView";
import { ProvinceSelect } from "@/components/ProvinceSelect";
import { alert as alertColors_ } from "@/lib/brand/tokens";
import { MINE_COLORS, mineColor } from "@/lib/mine-colors";
import { mineLabel, minePlaceFeature } from "@/lib/mine-label";
import {
  BANA,
  EXAMPLE_DIRECTORY,
  EXAMPLE_HAZARDS,
  EXAMPLE_MAP,
  EXAMPLE_ME,
  EXAMPLE_NOW,
  exampleAlert,
  exampleStatus,
} from "@/lib/dev-examples";
import { layersFor } from "@/lib/hazards";
import { alertFillColor, staleTambons } from "@/lib/map-style";
import th from "@/messages/th.json";
import { renderWithIntl } from "./render";

// The real map needs WebGL; here it reports which layers and which of the person's own places
// it was asked to draw.
vi.mock("@/components/map/MapView", () => ({
  MapView: ({
    layers,
    mine = [],
    showMine = false,
    onSelect,
    bounds,
  }: {
    onSelect?: (s: { kind: "mine"; id: string }) => void;
    bounds?: [number, number, number, number];
    layers: string[];
    mine?: {
      id: string;
      label: string;
      home: boolean;
      color: string;
      lines: string[];
      call: { tel: string; label: string } | null;
    }[];
    showMine?: boolean;
  }) => (
    <div
      data-map="true"
      data-mine={showMine ? mine.map((p) => p.id).join(",") : ""}
      data-mine-count={mine.length}
      data-mine-colors={mine.map((p) => p.color).join(",")}
      data-mine-labels={mine.map((p) => [p.label, ...p.lines].join(" | ")).join(" / ")}
      data-mine-calls={mine.map((p) => `${p.id}:${p.call ? p.call.tel : "-"}`).join(",")}
      data-bounds={bounds ? bounds.map((n) => n.toFixed(2)).join(",") : ""}
    >
      {layers.join(",")}
      {/* Stands in for tapping the first pin, which the real map answers with onSelect. */}
      {mine[0] && (
        <button
          type="button"
          data-select-mine="true"
          onClick={() => onSelect?.({ kind: "mine", id: mine[0]!.id })}
        />
      )}
    </div>
  ),
}));

function dashboard(more: Partial<DashboardViewProps> = {}) {
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
      {...more}
    />,
  ).container;
}

const green = /47, ?122, ?37/; // --alert-normal as rgb

describe("a placeholder hazard never draws a layer or a normal state (safety rule 10)", () => {
  it("layersFor gives no layers for a hazard that is not active", () => {
    expect(layersFor({ status: "coming_soon" }, "risk")).toEqual([]);
    expect(layersFor({ status: "coming_soon" }, "live")).toEqual([]);
    expect(layersFor(null, "live")).toEqual([]);
    expect(layersFor({ status: "active" }, "live")).toContain("alerts");
  });

  it("choosing a coming-soon hazard removes the map and shows the card with SOS and its hotline", () => {
    const c = dashboard();
    expect(c.querySelector("[data-map]")).not.toBeNull();
    fireEvent.click(c.querySelector('[data-hazard="fire"]')!);
    expect(c.querySelector("[data-map]")).toBeNull();
    expect(c.querySelector("[data-level]")).toBeNull();
    expect(c.querySelector("[data-legend]")).toBeNull();
    expect(c.querySelector("[data-alerts-list]")).toBeNull();
    const card = c.querySelector('[data-hazard-placeholder="fire"]')!;
    expect(card.textContent).toContain("ไม่ได้แปลว่าไม่มีความเสี่ยง");
    expect(card.textContent).toContain(th.map.hazard.comingSoon);
    expect(card.querySelector('a[href="/sos"]')).not.toBeNull();
    expect(card.querySelector('a[href="tel:199"]')).not.toBeNull();
    expect(c.innerHTML).not.toMatch(/alert-normal/);
  });
});

describe("a coming-soon province never gets a normal state (safety rule 10)", () => {
  it("is listed disabled, with the note and the numbers to call", () => {
    const { container: c } = renderWithIntl(
      <ProvinceSelect
        id="p"
        provinces={EXAMPLE_DIRECTORY.provinces}
        value=""
        onChange={() => {}}
        emptyLabel="all"
      />,
    );
    const soon = [...c.querySelectorAll<HTMLOptionElement>("option[data-coming-soon]")];
    expect(soon.map((o) => o.value)).toEqual(["10"]);
    expect(soon.every((o) => o.disabled)).toBe(true);
    expect(c.querySelectorAll("option:not([disabled])")).toHaveLength(5);
    expect(c.querySelector("[data-not-covered-note]")?.textContent).toMatch(/1784.*1669/);
    expect(c.querySelector("[data-level]")).toBeNull();
    expect(c.innerHTML).not.toMatch(/alert-normal/);
  });
});

describe("tambon colors on the map", () => {
  it("before launch a tambon without an alert gets no color at all", () => {
    expect(alertFillColor(exampleStatus([], false))).toBe("rgba(0, 0, 0, 0)");
    expect(alertFillColor(null)).toBe("rgba(0, 0, 0, 0)");
    const withAlert = JSON.stringify(
      alertFillColor(exampleStatus([exampleAlert("evacuate", [BANA.code])], false)),
    );
    expect(withAlert).not.toMatch(green);
    expect(withAlert).toContain("198, 40, 40");
    expect(alertColors_.normal.bg).toBe("#2F7A25");
  });

  it("in service, a tambon without an alert is light green and one with an alert has its level's color", () => {
    const fill = alertFillColor(exampleStatus([exampleAlert("watch", [BANA.code])]));
    expect(JSON.stringify(fill)).toMatch(green);
    expect(JSON.stringify(fill)).toContain(BANA.code);
  });

  it("the newest alert wins for a tambon, and a late one is outlined, not recolored", () => {
    const late = exampleAlert("warning", [BANA.code], {
      nextUpdateAt: new Date(EXAMPLE_NOW - 60_000).toISOString(),
    });
    expect(staleTambons(exampleStatus([late]), EXAMPLE_NOW)).toEqual([BANA.code]);
    const fill = alertFillColor(exampleStatus([late, exampleAlert("watch", [BANA.code])]));
    expect(JSON.stringify(fill)).toContain("240, 127, 26");
    expect(JSON.stringify(fill)).not.toContain("242, 194, 48");
  });
});

describe("map dashboard (spec 4.2)", () => {
  it("opens on the live view when an alert is in force, and on the risk view when none is", () => {
    expect(dashboard().querySelector("[data-map]")?.textContent).toContain("alerts");
    const quiet = dashboard({ status: exampleStatus([]) });
    expect(quiet.querySelector("[data-map]")?.textContent).toBe("hazard,places");
    expect(quiet.querySelector('[data-pending-layer="hazard"]')).not.toBeNull();
  });

  it("the list of alerts keeps a stale alert's level and adds the marker", () => {
    const c = dashboard({
      status: exampleStatus([
        exampleAlert("warning", [BANA.code], {
          nextUpdateAt: new Date(EXAMPLE_NOW - 60_000).toISOString(),
        }),
      ]),
    });
    const list = c.querySelector("[data-alerts-list]")!;
    expect(list.querySelector('[data-level="warning"]')).not.toBeNull();
    expect(list.querySelector("[data-stale]")).not.toBeNull();
    expect(list.textContent).toContain("บานา");
  });

  it("before launch the legend has no Normal and says why", () => {
    const c = dashboard({ status: exampleStatus([exampleAlert("watch", [BANA.code])], false) });
    expect(c.querySelector('[data-legend] [data-level="normal"]')).toBeNull();
    expect(c.querySelector('[data-pending-layer="alerts"]')).not.toBeNull();
  });

  it("has no Transparency tab while donations are off, and Map opens first when they are on", () => {
    expect(dashboard().querySelector('[role="tablist"]')).toBeNull();
    const c = dashboard({ transparency: true });
    const tabs = [...c.querySelectorAll('[role="tab"]')];
    expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual(["true", "false"]);
    expect(c.querySelector("[data-map]")).not.toBeNull();
  });
});

describe("the places I watch, on the map", () => {
  it("a visitor has none, and nothing personal is asked for", () => {
    const c = dashboard();
    expect(c.querySelector("[data-map]")?.getAttribute("data-mine-count")).toBe("0");
    expect(c.querySelector("[data-mine-toggle]")).toBeNull();
    expect(c.querySelector('[data-layer="mine"]')).toBeNull();
  });

  it("a signed-in person sees their own places, with a switch and a legend row", () => {
    const c = dashboard({ me: EXAMPLE_ME });
    const map = c.querySelector("[data-map]")!;
    // Both watched places of the example; a place pinned outside the covered tambons is left out.
    expect(map.getAttribute("data-mine")).toBe("w1,w2");
    expect(c.querySelector("[data-mine-toggle]")?.textContent).toContain("2");
    expect(c.querySelector('[data-layer="mine"]')?.textContent).toContain(th.map.layers.mine);
  });

  it("the switch takes them off the map again", () => {
    const c = dashboard({ me: EXAMPLE_ME });
    fireEvent.click(c.querySelector("[data-mine-toggle] input")!);
    expect(c.querySelector("[data-map]")?.getAttribute("data-mine")).toBe("");
    expect(c.querySelector('[data-layer="mine"]')).toBeNull();
  });

  it("a home saved in the account is one of them", () => {
    const withHome = EXAMPLE_ME.signedIn ? { ...EXAMPLE_ME, home: BANA } : EXAMPLE_ME;
    const c = dashboard({ me: withHome });
    expect(c.querySelector("[data-map]")?.getAttribute("data-mine")).toBe("home,w1,w2");
  });

  it("the places are never part of the public map data", () => {
    // What the map draws for everyone comes from /api/public/map (EXAMPLE_MAP); the person's own
    // places arrive separately, from their own session.
    expect(JSON.stringify(EXAMPLE_MAP)).not.toContain("w1");
    expect(JSON.stringify(EXAMPLE_MAP)).not.toContain("บ้านแม่");
  });
});

describe("telling the watched places apart", () => {
  it("every place has its own colour, none of them an alert colour", () => {
    const withHome = EXAMPLE_ME.signedIn ? { ...EXAMPLE_ME, home: BANA } : EXAMPLE_ME;
    const colors = dashboard({ me: withHome })
      .querySelector("[data-map]")!
      .getAttribute("data-mine-colors")!
      .split(",");
    expect(colors).toHaveLength(3);
    expect(new Set(colors).size).toBe(3);
    // The alert palette belongs to alert levels alone (docs/brand.md).
    const alertColors = Object.values(alertColors_).map((c) => c.bg.toLowerCase());
    for (const color of colors) expect(alertColors).not.toContain(color.toLowerCase());
  });

  it("the legend names each place beside its colour", () => {
    const c = dashboard({ me: EXAMPLE_ME });
    const rows = [...c.querySelectorAll("[data-mine-legend]")];
    expect(rows.map((r) => r.textContent)).toEqual(["บ้านแม่", "ร้านที่ตลาด"]);
    // The browser gives the colour back as rgb(), so compare it that way.
    const rgb = (hex: string) =>
      `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`;
    expect(c.querySelector('[data-mine-legend="w1"] span')?.getAttribute("style")).toContain(
      rgb(MINE_COLORS[0]),
    );
  });

  it("a pin's label carries the name, the person there and the address", () => {
    const labels = dashboard({ me: EXAMPLE_ME })
      .querySelector("[data-map]")!
      .getAttribute("data-mine-labels")!;
    // "Mum's house", the person there, then tambon, district and province in Thai.
    expect(labels).toContain("บ้านแม่");
    expect(labels).toContain("ติดต่อ: แม่");
    expect(labels).toContain("ต.ตะลุโบะ อ.เมืองปัตตานี จ.ปัตตานี");
    // A place with nobody stored shows only its name and address.
    expect(labels).toContain("ร้านที่ตลาด | ต.สะบารัง");
    // The address and the person are in the label; the number travels separately, as a button.
    expect(labels).not.toContain("0800000000");
  });

  it("ten places get ten different colours", () => {
    expect(new Set(MINE_COLORS).size).toBe(10);
    expect(MINE_COLORS.map((_, i) => mineColor(i))).toEqual([...MINE_COLORS]);
    // An eleventh would start again from the top rather than have no colour at all.
    expect(mineColor(10)).toBe(MINE_COLORS[0]);
  });
});

describe("the label on a pin", () => {
  const place = {
    id: "w1",
    label: "บ้านแม่",
    lat: 6.87,
    lon: 101.27,
    home: false,
    color: "#7FD1C9",
    lines: ["ติดต่อ: แม่", "ต.ตะลุโบะ อ.เมืองปัตตานี จ.ปัตตานี"],
    call: { tel: "0800000000", label: "โทรหา แม่" },
  };

  it("shows the name, the person there and the address", () => {
    const box = mineLabel(place);
    expect(box.querySelector("b")?.textContent).toBe("บ้านแม่");
    expect([...box.querySelectorAll("span")].map((s) => s.textContent)).toEqual([
      "ติดต่อ: แม่",
      "ต.ตะลุโบะ อ.เมืองปัตตานี จ.ปัตตานี",
    ]);
  });

  it("carries a button that dials the person there, with the number written out", () => {
    const call = mineLabel(place).querySelector("a")!;
    expect(call.getAttribute("href")).toBe("tel:0800000000");
    expect(call.textContent).toContain("โทรหา แม่");
    expect(call.textContent).toContain("0800000000");
    // Big enough to hit, like every other call button (CLAUDE.md).
    expect(call.className).toContain("min-h-tap");
  });

  it("a place with no number stored has no call button", () => {
    const box = mineLabel({ ...place, call: null, lines: ["ต.สะบารัง"] });
    expect(box.querySelector("a")).toBeNull();
  });

  it("the name travels with the feature, so the map can write it beside the pin", () => {
    const f = minePlaceFeature(place);
    expect(f.properties.label).toBe("บ้านแม่");
    expect(f.properties.color).toBe("#7FD1C9");
    expect(f.properties.home).toBe(0);
    expect(f.geometry.coordinates).toEqual([101.27, 6.87]);
    // The person, their number and the address stay off the map face itself: they are in the
    // label that hover or a tap opens.
    expect(JSON.stringify(f)).not.toContain("ติดต่อ");
    expect(JSON.stringify(f)).not.toContain("0800000000");
  });

  it("puts what the person typed on the map as text, never as HTML", () => {
    const box = mineLabel({
      ...place,
      label: "<img src=x onerror=alert(1)>",
      lines: ["<b>not bold</b>"],
      call: null,
    });
    expect(box.querySelector("img")).toBeNull();
    expect(box.querySelectorAll("b")).toHaveLength(1); // only the name's own <b>
    expect(box.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(box.textContent).toContain("<b>not bold</b>");
  });
});

describe("the hazard switcher on a small screen", () => {
  it("the chosen hazard keeps its size; the others are smaller until chosen", () => {
    const c = dashboard();
    const flood = c.querySelector('[data-hazard="flood"]')!;
    const fire = c.querySelector('[data-hazard="fire"]')!;
    expect(flood.getAttribute("aria-pressed")).toBe("true");
    expect(flood.className).toContain("min-h-tap");
    expect(fire.className).toContain("min-h-9");
    // Smaller to look at, but still a full 48 px target: the box after it makes up the rest.
    expect(fire.className).toContain("after:-inset-y-1.5");
    // On a laptop every chip keeps its usual size.
    expect(fire.className).toContain("lg:min-h-tap");
  });

  it("choosing one gives it the full size and shrinks the one left behind", () => {
    const c = dashboard();
    fireEvent.click(c.querySelector('[data-hazard="fire"]')!);
    const flood = c.querySelector('[data-hazard="flood"]')!;
    const fire = c.querySelector('[data-hazard="fire"]')!;
    expect(fire.className).toContain("min-h-tap");
    expect(fire.className).not.toContain("min-h-9");
    expect(flood.className).toContain("min-h-9");
  });

  it("a hazard that is still coming says so, chosen or not (safety rule 10)", () => {
    const c = dashboard();
    expect(c.querySelector('[data-hazard="fire"]')?.textContent).toContain(
      th.map.hazard.comingSoon,
    );
    fireEvent.click(c.querySelector('[data-hazard="fire"]')!);
    expect(c.querySelector('[data-hazard="fire"]')?.textContent).toContain(
      th.map.hazard.comingSoon,
    );
  });
});

describe("calling the person at a watched place, from the map", () => {
  it("a place with a number stored gets one to dial; one without does not", () => {
    // The owner asked for this on 9 Oct; before that the number was kept off the map entirely.
    const calls = dashboard({ me: EXAMPLE_ME })
      .querySelector("[data-map]")!
      .getAttribute("data-mine-calls");
    // บ้านแม่ has แม่ and her number; ร้านที่ตลาด has nobody stored.
    expect(calls).toBe("w1:0800000000,w2:-");
  });

  it("a home saved in the account has nobody to call", () => {
    const withHome = EXAMPLE_ME.signedIn ? { ...EXAMPLE_ME, home: BANA } : EXAMPLE_ME;
    const calls = dashboard({ me: withHome })
      .querySelector("[data-map]")!
      .getAttribute("data-mine-calls");
    expect(calls?.startsWith("home:-")).toBe(true);
  });

  it("the card under the map dials the same number", () => {
    const c = dashboard({ me: EXAMPLE_ME });
    fireEvent.click(c.querySelector("[data-select-mine]")!);
    const card = c.querySelector('[data-selected="mine"]')!;
    expect(card.textContent).toContain("บ้านแม่");
    const call = card.querySelector('a[href^="tel:"]')!;
    expect(call.getAttribute("href")).toBe("tel:0800000000");
    expect(call.textContent).toContain("โทรหา แม่");
  });
});

describe("the map opens where the person already is", () => {
  it("their area decides the province, where the map looks, and the alert shown first", () => {
    const c = dashboard({ area: BANA });
    // The province selector is already on theirs (Pattani, 94), not "all four".
    expect((c.querySelector("#map-province") as HTMLSelectElement).value).toBe("94");
    // The map looks at a box around their tambon, not the whole province.
    const bounds = c
      .querySelector("[data-map]")!
      .getAttribute("data-bounds")!
      .split(",")
      .map(Number);
    expect(bounds[0]).toBeCloseTo(BANA.lon - 0.1, 2);
    expect(bounds[3]).toBeCloseTo(BANA.lat + 0.08, 2);
    // And their tambon's alert is the one shown, without tapping anything.
    expect(c.querySelector("[data-selected-panel]")?.textContent).toContain("บานา");
  });

  it("a visitor with no area chosen still sees all four provinces", () => {
    const c = dashboard();
    expect((c.querySelector("#map-province") as HTMLSelectElement).value).toBe("");
    expect(c.querySelector("[data-map]")?.getAttribute("data-bounds")).toBe("");
    expect(c.querySelector("[data-selected-panel]")).toBeNull();
  });

  it("choosing another province takes over from the area", () => {
    const c = dashboard({ area: BANA });
    fireEvent.change(c.querySelector("#map-province")!, { target: { value: "95" } });
    expect((c.querySelector("#map-province") as HTMLSelectElement).value).toBe("95");
    // Now the whole of that province, not a box around the old tambon.
    expect(c.querySelector("[data-map]")?.getAttribute("data-bounds")).not.toBe("");
    expect(c.querySelector("[data-selected-panel]")).toBeNull();
  });

  it("closing the first card leaves it closed", () => {
    const c = dashboard({ area: BANA });
    expect(c.querySelector("[data-selected-panel]")).not.toBeNull();
    fireEvent.click(c.querySelector("[data-selected-panel] button")!);
    expect(c.querySelector("[data-selected-panel]")).toBeNull();
  });
});
