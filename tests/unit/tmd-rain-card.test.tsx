import { describe, expect, it } from "vitest";
import { TmdRainView } from "@/components/weather/TmdRain";
import type { TmdStation } from "@/lib/tmd-stations";
import { renderWithIntl } from "./render";

/**
 * What the measured-rain card says.
 *
 * The point of these tests is the honesty of the card: it is a station's reading, at a stated
 * distance and a stated hour, and it never claims to be the reader's own rain. A zero must read
 * as zero and a missing reading must not.
 */

const station = (over: Partial<TmdStation> = {}): TmdStation => ({
  id: "48580",
  nameTh: "ปัตตานี",
  nameEn: "PATTANI AIRPORT",
  provinceTh: "ปัตตานี",
  lat: 6.78333,
  lon: 101.15,
  observedAt: "2026-11-18T15:00:00.000Z",
  rain24hMm: 11.2,
  tempC: 25.2,
  humidity: 95,
  distanceKm: 12.4,
  ...over,
});

describe("the measured-rain card", () => {
  it("says it is a measurement and not a forecast", () => {
    const { getByText } = renderWithIntl(
      <TmdRainView stations={[station()]} hasPlace={true} />,
      "en",
    );
    expect(getByText("Rain measured at TMD stations")).toBeTruthy();
    expect(getByText(/Not a forecast/)).toBeTruthy();
  });

  it("warns that the station's figure is not the reader's village", () => {
    // Rain here is local enough that this caveat is the difference between a useful number and a
    // misleading one (safety rule 8).
    const { getByText } = renderWithIntl(
      <TmdRainView stations={[station()]} hasPlace={true} />,
      "en",
    );
    expect(getByText(/not your village/)).toBeTruthy();
  });

  it("shows the figure, the distance and the hour in Bangkok time", () => {
    const { getByText, container } = renderWithIntl(
      <TmdRainView stations={[station()]} hasPlace={true} />,
      "en",
    );
    expect(container.querySelector("[data-tmd-rain-mm]")?.textContent).toContain("11.2");
    expect(getByText(/about 12 km away/)).toBeTruthy();
    // 15:00 UTC is 22:00 in Bangkok, the hour TMD printed.
    expect(getByText(/22:00/)).toBeTruthy();
  });

  it("shows a measured zero as zero", () => {
    // "0 mm" is a measurement. Blanking it would hide the fact that a station reported no rain.
    const { container } = renderWithIntl(
      <TmdRainView stations={[station({ rain24hMm: 0 })]} hasPlace={true} />,
      "en",
    );
    expect(container.querySelector("[data-tmd-rain-mm]")?.textContent).toContain("0");
  });

  it("shows a missing reading as a dash, not as zero", () => {
    const { container } = renderWithIntl(
      <TmdRainView stations={[station({ rain24hMm: null })]} hasPlace={true} />,
      "en",
    );
    const figure = container.querySelector("[data-tmd-rain-mm]")?.textContent ?? "";
    expect(figure).toContain("–");
    expect(figure).not.toMatch(/\b0\b/);
  });

  it("claims no distance when nobody has chosen a place", () => {
    const { queryByText } = renderWithIntl(
      <TmdRainView stations={[station({ distanceKm: undefined })]} hasPlace={false} />,
      "en",
    );
    expect(queryByText(/km away/)).toBeNull();
  });

  it("carries no alert colour", () => {
    const { container } = renderWithIntl(
      <TmdRainView stations={[station()]} hasPlace={true} />,
      "en",
    );
    for (const alertClass of ["jaga-watch", "jaga-warning", "jaga-evacuate", "jaga-normal"]) {
      expect(container.innerHTML).not.toContain(alertClass);
    }
  });

  it("draws nothing when no station reported", () => {
    const { container } = renderWithIntl(<TmdRainView stations={[]} hasPlace={true} />);
    expect(container.innerHTML).toBe("");
  });
});
