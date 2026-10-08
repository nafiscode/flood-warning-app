import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DashboardView, type DashboardViewProps } from "@/components/map/DashboardView";
import { ProvinceSelect } from "@/components/ProvinceSelect";
import { alert as alertColors } from "@/lib/brand/tokens";
import {
  BANA,
  EXAMPLE_DIRECTORY,
  EXAMPLE_HAZARDS,
  EXAMPLE_MAP,
  EXAMPLE_NOW,
  exampleAlert,
  exampleStatus,
} from "@/lib/dev-examples";
import { layersFor } from "@/lib/hazards";
import { alertFillColor, staleTambons } from "@/lib/map-style";
import th from "@/messages/th.json";
import { renderWithIntl } from "./render";

// The real map needs WebGL; here it reports which layers it was asked to draw.
vi.mock("@/components/map/MapView", () => ({
  MapView: ({ layers }: { layers: string[] }) => <div data-map="true">{layers.join(",")}</div>,
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
    expect(alertColors.normal.bg).toBe("#2F7A25");
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
