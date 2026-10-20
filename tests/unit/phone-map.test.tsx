import { fireEvent, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

/*
 * The map itself is stood in for: what matters here is which gestures it is handed, and the
 * real one neither draws nor measures anything in jsdom.
 */
vi.mock("@/components/map/MapView", () => ({
  MapView: ({ cooperative = false }: { cooperative?: boolean }) => (
    <div data-map="true" data-cooperative={cooperative ? "yes" : "no"} />
  ),
}));
import { BackToMap } from "@/components/map/BackToMap";
import { DashboardView, type DashboardViewProps } from "@/components/map/DashboardView";
import th from "@/messages/th.json";
import { renderWithIntl } from "./render";
import {
  BANA,
  EXAMPLE_DIRECTORY,
  EXAMPLE_HAZARDS,
  EXAMPLE_MAP,
  EXAMPLE_NOW,
  exampleAlert,
  exampleStatus,
} from "@/lib/dev-examples";

/*
 * Risk & Live Map on a phone (the owner, 20 Oct 2026, after a tester said it was hard to see and
 * hard to use: "phone map C").
 *
 * What is held here is what the reader gets, not how it is drawn: the page keeps every control
 * and every explanation it had, the choosers wait behind two pills, and the blocks that stood
 * 1,708 px tall under the map are folded. The order itself is CSS and is held by the rules read
 * out of app/globals.css at the end - jsdom has no layout, so there is nothing else to ask it.
 *
 * In these tests `window.matchMedia` answers false to everything, which is jsdom's own default
 * and is what a phone answers to the console's query. The laptop cases live in map.test.tsx.
 */
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

describe("the phone's two pills", () => {
  it("stand between the title and the map, and open one chooser at a time", () => {
    const c = dashboard();
    const root = c.querySelector("[data-map-phone]") as HTMLElement;
    const place = c.querySelector('[data-phone-pill="place"]') as HTMLElement;
    const layers = c.querySelector('[data-phone-pill="layers"]') as HTMLElement;
    expect(root.dataset.phonePanel).toBeUndefined();
    expect(place.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(place);
    expect(root.dataset.phonePanel).toBe("place");
    expect(place.getAttribute("aria-expanded")).toBe("true");

    // One at a time: the second pill takes the first one's place rather than adding to it.
    fireEvent.click(layers);
    expect(root.dataset.phonePanel).toBe("layers");
    expect(place.getAttribute("aria-expanded")).toBe("false");
    expect(layers.getAttribute("aria-expanded")).toBe("true");

    // And a second press puts it away.
    fireEvent.click(layers);
    expect(root.dataset.phonePanel).toBeUndefined();
  });

  it("say what the map is showing, so nothing is hidden by being folded", () => {
    const c = dashboard();
    const place = c.querySelector('[data-phone-pill="place"]') as HTMLElement;
    // The hazard and the area the page is narrowed to, in words, on the pill itself.
    expect(place.textContent).toContain(th.map.province.all);
    // ...and a name for anyone who cannot see it.
    expect(place.textContent).toContain(th.map.phone.placeLabel);
  });

  it("counts the layers that are drawn, and the count follows a layer being switched off", () => {
    const c = dashboard();
    const layers = c.querySelector('[data-phone-pill="layers"]') as HTMLElement;
    const was = Number(layers.textContent!.replace(/\D+/g, ""));
    expect(was).toBeGreaterThan(0);
    fireEvent.click(layers);
    // Any one of the six chips: switching it off takes one off the pill.
    fireEvent.click(c.querySelector("[data-map-chip]")!);
    expect(Number(layers.textContent!.replace(/\D+/g, ""))).toBe(was - 1);
  });

  it("never hides that four hazards are still to come (safety rule 10)", () => {
    const c = dashboard();
    fireEvent.click(c.querySelector('[data-phone-pill="place"]')!);
    const soon = [...c.querySelectorAll("[data-hazard-status]")].filter(
      (el) => el.getAttribute("data-hazard-status") !== "active",
    );
    expect(soon.length).toBeGreaterThan(0);
    // The chooser is open, so the words are in the page, not only the colour of a chip.
    fireEvent.click(c.querySelector("[data-more-hazards]")!);
    expect(c.textContent).toContain(th.map.hazard.comingSoon);
  });
});

describe("what explains the map is folded under it, never cut", () => {
  it("the key and the reservoir's path are details on a phone, with everything still in them", () => {
    const c = dashboard();
    const legend = c.querySelector("[data-legend]") as HTMLElement;
    expect(legend.tagName).toBe("DETAILS");
    expect(legend.querySelector("summary")?.textContent).toContain(th.map.layers.title);
    // Folded, not emptied: the alert levels are still written inside it, in words.
    expect(legend.querySelector("h2")).not.toBeNull();
    expect(legend.textContent).toContain(th.map.layers.alerts);
  });

  it("the card a tap opens keeps its own way out", () => {
    const c = dashboard();
    fireEvent.click(c.querySelector("[data-open-sea]")!);
    const panel = c.querySelector("[data-selected-panel]") as HTMLElement;
    expect(panel).not.toBeNull();
    /*
     * The card is drawn under the map on a phone and the map makes room for it, so it can be
     * long: its own "close" is what gets the reader out of it, whatever they scrolled past.
     */
    expect(panel.textContent).toContain(th.map.close);
  });
});

describe("one finger scrolls the page, two move the map", () => {
  /*
   * The owner, 20 Oct: scrolling past the map on a phone "just move the map instead of
   * scrolling pass it". MapLibre's cooperative gestures hand `touch-action: pan-x pan-y` back
   * to the browser, so the page scrolls under a one finger - and full screen, one tap away,
   * gives the map every gesture again, because a map you cannot push with one finger is not a
   * map you can read.
   */
  it("the map in the page gives one finger to the page; full screen takes it back", () => {
    const c = dashboard();
    const map = () => c.querySelector("[data-map]")?.getAttribute("data-cooperative");
    const root = c.querySelector("[data-map-phone]") as HTMLElement;
    expect(map()).toBe("yes");

    fireEvent.click(c.querySelector('[data-map-full-toggle="open"]')!);
    expect(root.dataset.mapFull).toBe("true");
    expect(map()).toBe("no");

    fireEvent.click(c.querySelector('[data-map-full-toggle="close"]')!);
    expect(root.dataset.mapFull).toBeUndefined();
    expect(map()).toBe("yes");
  });

  it("says what to do instead, in the reader's own words, and names the way out", () => {
    // Never MapLibre's own English: the three strings are ours, in all three languages.
    expect(th.map.phone.twoFingers).toContain("สองนิ้ว");
    expect(th.map.phone.twoFingers).toContain(th.map.full.open);
    expect(th.map.phone.zoomCtrl).toContain("Ctrl");
    expect(th.map.phone.fullExit.length).toBeGreaterThan(0);
  });
});

describe("back to the map", () => {
  it("is drawn only once the map has left the top of the screen", async () => {
    const frame = document.createElement("div");
    frame.setAttribute("data-map-frame", "true");
    document.body.append(frame);
    let bottom = 400;
    frame.getBoundingClientRect = () => ({ bottom, top: 0, height: 400 }) as DOMRect;
    try {
      renderWithIntl(<BackToMap />);
      // The map is on the screen: nothing is offered.
      await waitFor(() => expect(document.querySelector("[data-back-to-map]")).toBeNull(), {
        timeout: 4000,
      });
      bottom = -200;
      window.dispatchEvent(new Event("scroll"));
      // It answers on an animation frame, which a loaded machine can be slow to give.
      await waitFor(
        () => expect(screen.getByRole("button", { name: th.map.phone.back })).toBeTruthy(),
        { timeout: 4000 },
      );
    } finally {
      frame.remove();
    }
  });
});

describe("the phone's arrangement in app/globals.css", () => {
  const css = readFileSync("app/globals.css", "utf8");

  it("asks the exact complement of the console's own question, and only once", () => {
    const phone = css.match(/@media \(max-width: 1023\.98px\), \(pointer: coarse\)/g) ?? [];
    expect(phone.length).toBe(1);
    // ...and the console's half is untouched: the variant and its plain-CSS twin.
    const console_ = css.match(/@media \(min-width: 1024px\) and \(pointer: fine\)/g) ?? [];
    expect(console_.length).toBe(2);
  });

  it("gives the map the room the header and the hotline bar leave, and no more", () => {
    const block = css.slice(css.indexOf("@media (max-width: 1023.98px), (pointer: coarse)"));
    expect(block).toContain("--jaga-header");
    expect(block).toContain("--jaga-hotlines");
    // Nothing is ever drawn over the four numbers (safety rule 4).
    expect(block).toMatch(/\[data-back-to-map\][\s\S]*?var\(--jaga-hotlines/);
  });

  it("never boxes what a tap answers with, and lets the map shrink for it", () => {
    const block = css.slice(css.indexOf("@media (max-width: 1023.98px), (pointer: coarse)"));
    const panel = block.slice(block.indexOf("[data-map-phone] [data-selected-panel] {"));
    const rule = panel.slice(0, panel.indexOf("}"));
    /*
     * The owner, 20 Oct, after using it: the reservoir's card is 3,961 px and was being shown
     * through a 169 px window. It takes the height it needs now and the page scrolls.
     */
    expect(rule).not.toContain("max-height");
    expect(rule).not.toContain("overflow-y");
    // ...and the map's 320 px floor is lifted, or none of the heights below it could apply.
    expect(block).toMatch(/\[data-map-phone\] \[data-map\] \{[^}]*min-height: 0/);
    expect(block).toContain("[data-map-phone]:has([data-selected-panel]) [data-map]");
  });

  it("holds the way out of a long card under the header", () => {
    const block = css.slice(css.indexOf("@media (max-width: 1023.98px), (pointer: coarse)"));
    const close = block.slice(block.indexOf("[data-map-phone] [data-selected-panel] > button:last-child"));
    const rule = close.slice(0, close.indexOf("}"));
    expect(rule).toContain("position: sticky");
    // Under the measured header, not a guessed one, and above the card it scrolls over.
    expect(rule).toContain("var(--jaga-header");
    expect(rule).toContain("order: -1");
  });

  it("keeps the full-screen map clear of the hotlines (safety rule 4)", () => {
    const block = css.slice(css.indexOf("@media (max-width: 1023.98px), (pointer: coarse)"));
    const full = block.slice(block.indexOf("[data-map-phone][data-map-full] [data-map-frame]"));
    expect(full.slice(0, full.indexOf("}"))).toContain("var(--jaga-hotlines");
    // ...and the map is sized against the window, not a wrapper that has no height of its own.
    expect(block).toMatch(/\[data-map-phone\]\[data-map-full\] \[data-map\] \{[^}]*100dvh/);
  });

  it("orders the blocks through the wrappers, which are display: contents", () => {
    const block = css.slice(css.indexOf("@media (max-width: 1023.98px), (pointer: coarse)"));
    // A child combinator would walk past every block the page writes inside an area wrapper.
    expect(block).toContain("[data-map-phone] > [data-console-area] > *");
    expect(block).toContain("[data-map-phone] [data-map-frame]");
  });
});
