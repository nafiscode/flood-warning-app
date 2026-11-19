import { describe, expect, it } from "vitest";
import { FloodPlace } from "@/components/flood/FloodPlace";
import type { PlaceGauge, PlaceView } from "@/lib/flood-places";
import { renderWithIntl } from "./render";

/*
 * The flood page that a search lands on. Two promises are held here:
 *   - the live pulse sits on every gauge whose reading is current and on none whose reading is
 *     not, because a dot that beats beside a stopped feed says "live" about nothing;
 *   - a count that is zero is never printed, so the strip never reads as calm (safety rule 10).
 */

const NOW = new Date().toISOString();

const gauge = (code: string, over: Partial<PlaceGauge> = {}): PlaceGauge => ({
  code,
  name: { th: `สถานี ${code}`, en: `Station ${code}` },
  basin: null,
  value: 3.2,
  observedAt: NOW,
  rise3h: 0.2,
  bank: 5,
  status: "normal",
  ...over,
});

const view = (gauges: PlaceGauge[]): PlaceView => ({
  slug: "pattani",
  code: "94",
  kind: "province",
  status: { generatedAt: NOW, inService: true, alerts: [] },
  alerts: [],
  tally: [],
  summary: { tambons: 115, gauges, tambonList: null, places: { total: 80, verified: 0 } },
});

const page = (gauges: PlaceGauge[]) =>
  renderWithIntl(
    <FloodPlace
      view={view(gauges)}
      name="จ.ปัตตานี"
      province={null}
      siblings={[]}
      districts={[]}
    />,
  );

describe("the place page's gauges", () => {
  it("pulse on each current reading and on no silent one", () => {
    const { container } = page([
      gauge("a"),
      gauge("b", { status: "above_warning" }),
      gauge("c", { status: "no_recent_data", value: null, observedAt: null, rise3h: null }),
    ]);
    const cards = [...container.querySelectorAll("li[data-gauge-live]")];
    expect(cards).toHaveLength(3);
    const pulsing = cards.map((card) => card.querySelector("[data-live-pulse]") !== null);
    // Nearest the bank first: b, a, then the silent c.
    expect(pulsing).toEqual([true, true, false]);
  });

  it("say the rise, the bank margin and that it is a reading, in words", () => {
    const { container } = page([gauge("a", { status: "above_warning" })]);
    const text = container.textContent ?? "";
    expect(text).toContain("สูงขึ้น 0.20 ม.");
    expect(text).toContain("ต่ำกว่าตลิ่ง 1.80 ม.");
    expect(text).toContain("ไม่ใช่ประกาศเตือนภัย");
    expect(container.querySelector("[data-gauge-trend]")?.getAttribute("data-gauge-trend")).toBe(
      "up",
    );
  });

  it("show the live strip only while some reading is current", () => {
    expect(page([gauge("a")]).container.querySelector("[data-place-live]")).not.toBeNull();
    const silent = page([gauge("c", { status: "no_recent_data", value: null })]);
    expect(silent.container.querySelector("[data-place-live]")).toBeNull();
    expect(silent.container.querySelector("[data-live-pulse]")).toBeNull();
  });

  it("print no fact line when nothing is near the bank or rising", () => {
    const { container } = page([gauge("a", { rise3h: 0 })]);
    expect(container.querySelector("[data-gauge-facts]")).toBeNull();
    const busy = page([gauge("a", { status: "above_evacuate", rise3h: 0.3 })]).container;
    expect(busy.querySelector("[data-gauge-facts]")?.querySelectorAll("li")).toHaveLength(2);
  });

  it("offer the map, and keep the SOS first among the actions", () => {
    const { container } = page([gauge("a")]);
    expect(container.querySelector("[data-place-more] a[href$='/map']")).not.toBeNull();
    expect(container.querySelector("a[href$='/sos']")).not.toBeNull();
  });
});

/**
 * The link graph, held in both directions (19 Nov 2026).
 *
 * Until now it ran one way: a district pointed up at its province, and a province pointed only
 * sideways at the other three. /flood/sadao was therefore reachable from the hub and one sibling
 * district and from nowhere else, and Search Console's validation for "crawled, currently not
 * indexed" failed on it. A province that does not name its own districts is the kind of gap no
 * one notices by reading the page, so it is a test.
 */
describe("a province page reaches the districts inside it", () => {
  const districts = [
    { slug: "hat-yai", name: "อ.หาดใหญ่" },
    { slug: "sadao", name: "อ.สะเดา" },
  ];

  it("links every district it was given", () => {
    const { container } = renderWithIntl(
      <FloodPlace
        view={view([])}
        name="จ.สงขลา"
        province={null}
        siblings={[]}
        districts={districts}
      />,
    );
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href") ?? "");
    for (const { slug } of districts) {
      expect(hrefs.some((h) => h.endsWith(`/flood/${slug}`)), slug).toBe(true);
    }
  });

  it("says nothing at all when a place has no districts under it", () => {
    const { container } = renderWithIntl(
      <FloodPlace view={view([])} name="จ.สงขลา" province={null} siblings={[]} districts={[]} />,
    );
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href") ?? "");
    expect(hrefs.some((h) => h.includes("/flood/"))).toBe(false);
  });
});
