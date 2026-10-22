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
  renderWithIntl(<FloodPlace view={view(gauges)} name="จ.ปัตตานี" province={null} siblings={[]} />);

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
