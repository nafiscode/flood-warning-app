import { describe, expect, it } from "vitest";
import { TwoForecastsView } from "@/components/weather/TwoForecasts";
import { renderWithIntl } from "./render";

/**
 * What the two-model card says.
 *
 * The rule it exists to keep is safety rule 8: never present a forecast as certain. So the card
 * must always show both figures, must name which model each belongs to, and when they disagree
 * must point at the higher number - being ready for rain that does not come costs less than being
 * caught by rain that does.
 */
describe("the two-forecast card", () => {
  it("shows both models' figures, each named", () => {
    const { container, getByText } = renderWithIntl(
      <TwoForecastsView openMeteoMm={22} tmdMm={48} />,
      "en",
    );
    expect(container.querySelector('[data-model="openMeteo"]')?.textContent).toContain("22");
    expect(container.querySelector('[data-model="tmd"]')?.textContent).toContain("48");
    expect(getByText(/Open-Meteo \(global model\)/)).toBeTruthy();
    expect(getByText(/TMD \(3 km\)/)).toBeTruthy();
  });

  it("says a forecast is never certain, and is not a Jaga alert", () => {
    const { getByText } = renderWithIntl(<TwoForecastsView openMeteoMm={22} tmdMm={25} />, "en");
    expect(getByText(/never certain/)).toBeTruthy();
    expect(getByText(/not a Jaga alert/)).toBeTruthy();
  });

  it("says so plainly when the two agree", () => {
    const { container, getByText } = renderWithIntl(
      <TwoForecastsView openMeteoMm={40} tmdMm={45} />,
      "en",
    );
    expect(getByText(/broadly agree/)).toBeTruthy();
    expect(
      container.querySelector("[data-two-forecasts]")?.getAttribute("data-two-forecasts"),
    ).toBe("agree");
  });

  it("points at the higher figure when they disagree", () => {
    const { getByText } = renderWithIntl(<TwoForecastsView openMeteoMm={20} tmdMm={45} />, "en");
    expect(getByText("The two models disagree. Plan for 45 mm.")).toBeTruthy();
  });

  it("says a wide gap is wide, and to check again", () => {
    const { getByText, container } = renderWithIntl(
      <TwoForecastsView openMeteoMm={15} tmdMm={90} />,
      "en",
    );
    expect(getByText(/far apart/)).toBeTruthy();
    expect(getByText(/90 mm/)).toBeTruthy();
    expect(getByText(/check again later/)).toBeTruthy();
    expect(container.querySelector("[data-verdict]")?.getAttribute("data-verdict")).toBe(
      "farApart",
    );
  });

  it("points at the higher figure whichever model holds it", () => {
    // The card must not quietly prefer one model's number.
    const { getByText } = renderWithIntl(<TwoForecastsView openMeteoMm={90} tmdMm={15} />, "en");
    expect(getByText(/90 mm/)).toBeTruthy();
  });

  it("carries no alert colour and no level", () => {
    const { container } = renderWithIntl(<TwoForecastsView openMeteoMm={15} tmdMm={90} />);
    for (const alertClass of ["jaga-watch", "jaga-warning", "jaga-evacuate", "jaga-normal"]) {
      expect(container.innerHTML).not.toContain(alertClass);
    }
    expect(container.querySelector("[data-level]")).toBeNull();
  });

  it("is drawn in Thai too, with both figures", () => {
    const { container } = renderWithIntl(<TwoForecastsView openMeteoMm={22} tmdMm={48} />);
    expect(container.textContent).toContain("22");
    expect(container.textContent).toContain("48");
    expect(container.textContent).toContain("มม.");
  });
});
