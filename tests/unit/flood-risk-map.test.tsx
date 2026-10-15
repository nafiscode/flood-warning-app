import { afterEach, describe, expect, it, vi } from "vitest";
import { HomeView, type HomeViewProps } from "@/components/home/HomeView";
import { TambonRiskView } from "@/components/home/TambonRisk";
import { MapFeatureChips, MapFeatureTiles } from "@/components/map/MapFeatures";
import type { Dam } from "@/lib/dam";
import { EXAMPLE_NOW, EXAMPLE_PLACES, homeExample, type HomeScenario } from "@/lib/dev-examples";
import { focusHref, mainDam, MAP_FOCUSES, readFocus, zoneFrame } from "@/lib/map-focus";
import { lineSignInHref, signInHref } from "@/lib/sign-in-link";
import { riskHeadline, roundShare, toTambonRisk } from "@/lib/tambon-risk";
import { nudgeDue, NUDGE_REST_MS } from "@/components/notices/LineNudge";
import en from "@/messages/en.json";
import ms from "@/messages/ms.json";
import th from "@/messages/th.json";
import { renderWithIntl } from "./render";

/**
 * The owner, 15 Oct: "Map" is the Flood Risk Map, more people should open it and see what it can
 * do, and more people should sign in because they can see what an account gives them. None of it
 * may stand between anyone and an SOS, an alert or a hotline (safety rule 1), and the risk shown
 * on the home screen must never read as an alert or as "no risk" (safety rules 2 and 10).
 */

const SESSION = "sb-test-auth-token";
afterEach(() => {
  document.cookie = `${SESSION}=; path=/; max-age=0`;
  window.localStorage.clear();
  vi.doUnmock("@/i18n/navigation");
  vi.resetModules();
});

const ALERT_CLASSES = /bg-alert-|text-alert-|border-alert-|bg-sos/;

describe("the new name", () => {
  it("is the Flood Risk Map in the header, on the page and on the home button, in every language", () => {
    expect(th.nav.map).toBe("แผนที่เสี่ยงน้ำท่วม");
    expect(en.nav.map).toBe("Flood Risk Map");
    expect(ms.nav.map).toBe("Peta Risiko Banjir");
    for (const m of [th, ms, en]) {
      expect(m.map.title).toBe(m.nav.map);
      expect(m.home.mapLink).toContain(m.nav.map);
    }
  });
});

describe("the way back after signing in", () => {
  it("comes back to the page the person was on, with the locale prefix the routes expect", () => {
    expect(signInHref("th", "/map")).toBe("/sign-in?next=%2Fmap");
    expect(signInHref("en", "/map")).toBe("/en/sign-in?next=%2Fen%2Fmap");
    expect(signInHref("ms", "/")).toBe("/ms/sign-in?next=%2Fms");
    expect(lineSignInHref("en", "/")).toBe("/api/auth/line?locale=en&next=%2Fen");
  });

  it("never sends anyone off the site, and does not loop back to the sign-in page", () => {
    expect(signInHref("th", "//evil.example")).toBe("/sign-in?next=%2F");
    expect(signInHref("th", "https://evil.example")).toBe("/sign-in?next=%2F");
    expect(signInHref("th", null)).toBe("/sign-in?next=%2F");
    expect(signInHref("en", "/sign-in")).toBe("/en/sign-in");
  });
});

describe("the header's last link", () => {
  async function show(path: string, withSession: boolean) {
    if (withSession) document.cookie = `${SESSION}=present; path=/`;
    vi.doMock("@/i18n/navigation", () => ({
      Link: ({ href, children, ...rest }: Record<string, unknown> & { children?: unknown }) => (
        <a href={String(href)} {...rest}>
          {children as never}
        </a>
      ),
      usePathname: () => path,
    }));
    const { AccountLink } = await import("@/components/AccountLink");
    return renderWithIntl(<AccountLink />).container;
  }

  it("invites a visitor to sign in, and brings them back to the same page", async () => {
    const c = await show("/map", false);
    const link = c.querySelector("[data-account-link]")!;
    expect(link.getAttribute("data-account-link")).toBe("sign-in");
    expect(link.textContent).toBe(th.nav.signIn);
    expect(link.getAttribute("href")).toBe("/sign-in?next=%2Fmap");
  });

  it("is Account for someone signed in", async () => {
    const c = await show("/", true);
    const link = c.querySelector("[data-account-link]")!;
    expect(link.getAttribute("data-account-link")).toBe("account");
    expect(link.textContent).toBe(th.nav.account);
  });

  it("asks nothing of someone sending an SOS or asking for supplies (safety rule 1)", async () => {
    for (const path of ["/sos", "/sos/abc", "/supplies"]) {
      const c = await show(path, false);
      expect(c.querySelector("[data-account-link]")!.getAttribute("data-account-link"), path).toBe(
        "account",
      );
      vi.resetModules();
    }
  });
});

describe("the six features", () => {
  it("are read from the address and nothing else", () => {
    expect(MAP_FOCUSES).toEqual(["risk", "places", "damzone", "gauges", "dam", "sea"]);
    expect(readFocus("gauges")).toBe("gauges");
    expect(readFocus("hazard")).toBeNull();
    expect(readFocus(null)).toBeNull();
    expect(focusHref("damzone")).toEqual({ pathname: "/map", query: { focus: "damzone" } });
  });

  it("are tiles on the home screen, each opening the map on itself, then the map button", () => {
    const c = renderWithIntl(<MapFeatureTiles />).container;
    const tiles = [...c.querySelectorAll("[data-map-feature]")];
    expect(tiles.map((t) => t.getAttribute("data-map-feature"))).toEqual([...MAP_FOCUSES]);
    for (const tile of tiles) {
      expect(tile.getAttribute("href")).toContain(`focus=${tile.getAttribute("data-map-feature")}`);
    }
    expect(c.querySelector("[data-map-link]")?.textContent).toContain(th.home.mapLink);
    // The two that change while someone looks say so.
    expect(c.querySelector("[data-map-feature='gauges']")?.textContent).toContain(
      th.mapFeatures.live,
    );
    expect(c.querySelector("[data-map-feature='risk']")?.textContent).not.toContain(
      th.mapFeatures.live,
    );
    expect(c.innerHTML).not.toMatch(ALERT_CLASSES);
  });

  it("are buttons above the map that say which one was asked for", () => {
    const picked: string[] = [];
    const c = renderWithIntl(
      <MapFeatureChips active="dam" onPick={(f) => picked.push(f)} />,
    ).container;
    const chips = [...c.querySelectorAll<HTMLButtonElement>("[data-map-chip]")];
    expect(chips).toHaveLength(6);
    expect(c.querySelector("[data-map-chip='dam']")?.getAttribute("aria-pressed")).toBe("true");
    chips[2]!.click();
    expect(picked).toEqual(["damzone"]);
  });

  it("frame the land below the dam from its zone, else its river, and pick the dam that has one", () => {
    const base = {
      code: "x",
      reaches: [] as Dam["reaches"],
      storageMaxMcm: 10,
      point: { type: "Point", coordinates: [101, 6] },
    };
    const small = { ...base, code: "small" } as unknown as Dam;
    const zoned = {
      ...base,
      code: "bang_lang",
      storageMaxMcm: 1589,
      zones: [
        {
          dam: "bang_lang",
          band: "zone",
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [101.2, 6.1],
                [101.3, 6.9],
                [101.25, 6.5],
                [101.2, 6.1],
              ],
            ],
          },
        },
      ],
    } as unknown as Dam;
    expect(mainDam([small, zoned])?.code).toBe("bang_lang");
    expect(zoneFrame(zoned)).toEqual([
      { lon: 101.2, lat: 6.1 },
      { lon: 101.3, lat: 6.9 },
    ]);
    expect(zoneFrame(small)).toEqual([{ lon: 101, lat: 6 }]);
  });
});

describe("the tambon's flood risk on the home screen", () => {
  const row = {
    tambon_code: "940101",
    buildings: 2000,
    high_pct: 10,
    medium_pct: 30,
    low_pct: 20,
    minimal_pct: 40,
    buildings_medium_or_high_pct: 41.4,
  };

  it("is read from the table's row, with shares that fill the bar", () => {
    const risk = toTambonRisk(row)!;
    const sum = Object.values(risk.land).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(100, 6);
    expect(risk.buildingsAtRisk).toBeCloseTo(41.4);
    expect(toTambonRisk({ tambon_code: "abc" })).toBeNull();
    expect(roundShare(0.4)).toBe("<1");
    expect(roundShare(41.4)).toBe("41");
  });

  it("leads with the buildings, says it is long-term and not today's alert, and opens the map", () => {
    const c = renderWithIntl(<TambonRiskView risk={toTambonRisk(row)!} name="ต.สะเตง" />).container;
    expect(c.textContent).toContain(th.tambonRisk.eyebrow);
    expect(c.textContent).toContain(th.tambonRisk.headline.buildings.replace("{share}", "41"));
    expect(c.textContent).toContain(th.tambonRisk.note);
    expect(c.querySelector("[data-tambon-risk-map]")?.getAttribute("href")).toContain("focus=risk");
    // The map's pinks, never an alert colour, and every class named in words (safety rule 2).
    expect(c.innerHTML).not.toMatch(ALERT_CLASSES);
    for (const key of ["high", "medium", "low", "minimal"] as const) {
      expect(c.textContent).toContain(th.tambonRisk.class[key]);
    }
  });

  it("where little is marked, says that is not the same as no risk (safety rule 10)", () => {
    const quiet = toTambonRisk({
      ...row,
      high_pct: 0,
      medium_pct: 0.5,
      buildings_medium_or_high_pct: 0,
    })!;
    expect(riskHeadline(quiet)).toBe("little");
    const c = renderWithIntl(<TambonRiskView risk={quiet} name="ต.เบตง" />).container;
    expect(c.querySelector("[data-risk-headline]")?.textContent).toBe(
      th.tambonRisk.headline.little,
    );
    expect(c.textContent).not.toMatch(/\b0%/);
  });
});

describe("where the new cards sit on the home screen", () => {
  function home(scenario: HomeScenario, more: Partial<HomeViewProps> = {}) {
    const example = homeExample(scenario);
    return renderWithIntl(
      <HomeView
        ready
        status={example.status}
        checkedAt={example.status ? EXAMPLE_NOW - 60_000 : null}
        failed={example.failed}
        area={example.area}
        me={example.me}
        places={EXAMPLE_PLACES}
        placesState="ok"
        now={EXAMPLE_NOW}
        onChooseArea={() => {}}
        onRetry={() => {}}
        projectLine={null}
        tambonRisk={(code) => <div data-risk-slot={code} />}
        signInOffer={<div data-offer-slot="true" />}
        {...more}
      />,
    ).container;
  }
  const follows = (a: Element, b: Element) =>
    !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

  it("on an ordinary day the tambon's risk comes straight under the hero, before the checklist", () => {
    const c = home("normal", { me: { signedIn: false } });
    const slot = c.querySelector("[data-risk-slot]")!;
    expect(slot).toBeTruthy();
    expect(follows(slot, c.querySelector("[data-checklist]")!)).toBe(true);
    expect(c.querySelector("[data-offer-slot]")).toBeTruthy();
  });

  it("at Evacuate the SOS and the checklist come first, and the invitation to sign in is gone", () => {
    const c = home("evacuate", { me: { signedIn: false } });
    const slot = c.querySelector("[data-risk-slot]")!;
    expect(follows(c.querySelector("[data-checklist]")!, slot)).toBe(true);
    expect(follows(c.querySelector("[data-sos-button], a[href*='/sos']")!, slot)).toBe(true);
    expect(c.querySelector("[data-offer-slot]")).toBeNull();
  });

  it("someone signed in is not asked to sign in", () => {
    const c = home("watch", { me: homeExample("watched").me });
    expect(c.querySelector("[data-offer-slot]")).toBeNull();
  });
});

describe("the bell's word about LINE", () => {
  it("is for a visitor, after the page has woken, and rests a week after Not now", () => {
    expect(nudgeDue(false, 1000, null)).toBe(true);
    expect(nudgeDue(true, 1000, null)).toBe(false);
    expect(nudgeDue(false, 0, null)).toBe(false);
    expect(nudgeDue(false, 1000, 1000 + NUDGE_REST_MS)).toBe(false);
    expect(nudgeDue(false, 1000 + NUDGE_REST_MS, 1000 + NUDGE_REST_MS)).toBe(true);
  });
});
