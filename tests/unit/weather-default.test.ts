import { describe, expect, it } from "vitest";
import { EXAMPLE_ME } from "@/lib/dev-examples";
import type { MyPlaces } from "@/lib/me";
import { defaultWeatherArea } from "@/lib/use-weather";

const watched = EXAMPLE_ME.signedIn ? EXAMPLE_ME.places : [];
const first = watched.find((p) => p.area !== null)!;
const area = first.area!;
const other = { ...area, code: "999999", nameEn: "Elsewhere" };

describe("where the weather starts when nothing was picked for it (owner, 13 Oct)", () => {
  it("is the person's own location first: the account's home, else this phone's area", () => {
    const me: MyPlaces = { signedIn: true, home: other, places: watched };
    expect(defaultWeatherArea(me, area)).toEqual({ area: other, label: null });
    expect(defaultWeatherArea({ signedIn: true, home: null, places: watched }, other)).toEqual({
      area: other,
      label: null,
    });
    expect(defaultWeatherArea(null, other)).toEqual({ area: other, label: null });
  });

  it("is the first watched place for someone with no location of their own", () => {
    const me: MyPlaces = { signedIn: true, home: null, places: watched };
    expect(defaultWeatherArea(me, null)).toEqual({ area, label: first.label });
    // A watched place outside the tambons Jaga covers has no area: the next one is taken.
    const outside = { ...first, id: "x", label: "Abroad", area: null };
    expect(
      defaultWeatherArea({ signedIn: true, home: null, places: [outside, first] }, null),
    ).toEqual({ area, label: first.label });
  });

  it("is nothing when there is nothing to go by, and never a visitor's leftover places", () => {
    expect(defaultWeatherArea(null, null)).toBeNull();
    expect(defaultWeatherArea({ signedIn: false }, null)).toBeNull();
    expect(defaultWeatherArea({ signedIn: true, home: null, places: [] }, null)).toBeNull();
  });
});
