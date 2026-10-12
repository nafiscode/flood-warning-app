import { describe, expect, it } from "vitest";
import { SafePlaceCard } from "@/components/places/SafePlaceCard";
import { EXAMPLE_PLACES } from "@/lib/dev-examples";
import { navigateChoices } from "@/lib/places";
import th from "@/messages/th.json";
import { renderWithIntl } from "./render";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 13; SM-A135F) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36";
const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0";

const apps = (ua: string) => navigateChoices(6.87, 101.25, ua).map((c) => c.app);

describe("the apps offered for directions (owner, 13 Oct)", () => {
  it("an iPhone is offered Google Maps first, then Waze, then Apple Maps", () => {
    expect(apps(IPHONE)).toEqual(["google", "waze", "apple"]);
  });

  it("an Android phone also gets the system's own list of every app that can navigate", () => {
    expect(apps(ANDROID)).toEqual(["google", "waze", "other"]);
    const other = navigateChoices(6.87, 101.25, ANDROID).at(-1)!;
    expect(other.href).toBe("geo:6.870000,101.250000?q=6.870000,101.250000");
  });

  it("a laptop, or a phone not yet known, is offered the two that also work as web pages", () => {
    expect(apps(WINDOWS)).toEqual(["google", "waze"]);
    expect(apps("")).toEqual(["google", "waze"]);
  });

  it("every link carries the place's own coordinates", () => {
    for (const { href } of navigateChoices(6.5, 101.28, IPHONE)) {
      expect(href).toContain("6.500000,101.280000");
    }
  });
});

describe("Navigate on a safe place", () => {
  const place = EXAMPLE_PLACES.people[0]!;

  it("opens nothing by itself: the apps wait behind the button", () => {
    const { container } = renderWithIntl(<SafePlaceCard place={place} userAgent={IPHONE} />);
    const ask = container.querySelector<HTMLDetailsElement>("details[data-navigate-place]")!;
    expect(ask.open).toBe(false);
    expect(ask.querySelector("summary")!.textContent).toContain(th.places.navigate);
    // The button itself is not a link any more.
    expect(container.querySelector("summary a")).toBeNull();
    expect(
      [...ask.querySelectorAll("[data-navigate-app]")].map((a) =>
        a.getAttribute("data-navigate-app"),
      ),
    ).toEqual(["google", "waze", "apple"]);
    expect(ask.textContent).toContain(th.places.navigateWith);
  });

  it("says that a map app does not know which roads are flooded", () => {
    const { container } = renderWithIntl(<SafePlaceCard place={place} userAgent={ANDROID} />);
    expect(container.textContent).toContain(th.places.navigateNote);
    // The phone's own chooser is handed the point in this tab, not in a new one.
    const other = container.querySelector("[data-navigate-app='other']")!;
    expect(other.getAttribute("target")).toBeNull();
    expect(other.textContent).toBe(th.places.navigateApp.other);
  });
});
