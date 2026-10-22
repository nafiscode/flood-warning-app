import { beforeEach, describe, expect, it, vi } from "vitest";
import { HomeView, type HomeViewProps } from "@/components/home/HomeView";
import { EXAMPLE_NOW, EXAMPLE_PLACES, homeExample, type HomeScenario } from "@/lib/dev-examples";
import en from "@/messages/en.json";
import ms from "@/messages/ms.json";
import th from "@/messages/th.json";
import { renderWithIntl } from "./render";

/*
 * The laptop's home screen, one thing at a time (the owner, 23 Oct 2026: options A and C). What
 * the screen knows about the browser comes from three hooks, so they are held here: the console
 * band (jsdom has no matchMedia), whether anyone is signed in, and whether Jaga could still be
 * installed. Everything else is the page as the other home tests draw it.
 */
const browser = { wide: true, signedIn: false, installPending: true };

vi.mock("@/lib/console-view", async (original) => ({
  ...(await original<typeof import("@/lib/console-view")>()),
  useConsoleView: () => browser.wide,
}));
vi.mock("@/lib/use-public", async (original) => ({
  ...(await original<typeof import("@/lib/use-public")>()),
  useSignedIn: () => browser.signedIn,
}));
vi.mock("@/components/InstallCard", async (original) => ({
  ...(await original<typeof import("@/components/InstallCard")>()),
  useInstallWanted: () => browser.installPending,
}));

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
      welcome={<div data-new-to-jaga="true" />}
      joinJaga={<div data-join-jaga="true" />}
      install={<div data-install="computer" />}
      {...more}
    />,
  ).container;
}

beforeEach(() => {
  browser.wide = true;
  browser.signedIn = false;
  browser.installPending = true;
});

const $ = (c: Element, selector: string) => c.querySelector(selector);

describe("a laptop visitor with no area", () => {
  it("is asked one question, with SOS beside it and nothing else asking for a tap", () => {
    const c = home("choose");
    expect($(c, "[data-home-first]")).toBeTruthy();
    expect($(c, "[data-hero='choose']")?.textContent).toContain(th.homeFlow.firstTitle);
    expect($(c, "a[href$='/sos']")).toBeTruthy();
    // The three quiet ways in, and no card for any of them.
    expect(
      [...c.querySelectorAll("[data-quiet-link]")].map((a) => a.getAttribute("data-quiet-link")),
    ).toEqual(["what", "map", "teams"]);
    expect($(c, "[data-quiet-link='teams']")?.getAttribute("href")).toContain(
      "/authority/register",
    );
    for (const gone of [
      "[data-setup-steps]",
      "[data-new-to-jaga]",
      "[data-join-jaga]",
      "[data-install]",
      "a[href$='/report']",
    ]) {
      expect($(c, gone), gone).toBeNull();
    }
  });

  it("says there is no status to show, and never draws an all-clear", () => {
    const c = home("choose");
    expect($(c, "[data-no-status]")?.textContent).toBe(th.homeFlow.firstEmpty);
    expect($(c, "[data-checklist]")).toBeNull();
    expect($(c, "[data-hero='normal']")).toBeNull();
  });

  it("keeps food and water under 'Other ways to ask for help', not in the open", () => {
    const c = home("choose");
    const other = $(c, "[data-other-help]")!;
    expect(other.querySelector("summary")?.textContent).toContain(th.homeFlow.otherHelp);
    expect(other.querySelector("[data-supplies-link]")).toBeTruthy();
  });

  it("still says Jaga is not in service before launch", () => {
    const c = home("choose", {
      status: homeExample("notInService").status,
    });
    expect($(c, "[data-not-in-service]")).toBeTruthy();
  });
});

describe("a laptop visitor with an area, not signed in", () => {
  it("sees the status, then one setup card whose only open step is sign-in", () => {
    const c = home("normal");
    expect($(c, "[data-home-first]")).toBeNull();
    const steps = [...c.querySelectorAll("[data-setup-step]")].map(
      (li) => `${li.getAttribute("data-setup-step")}:${li.getAttribute("data-state")}`,
    );
    expect(steps).toEqual(["area:done", "signIn:open", "install:wait"]);
    expect($(c, "[data-setup-step='signIn'] [data-line-link]")).toBeTruthy();
    // Install waits behind sign-in: the card is not drawn yet.
    expect($(c, "[data-install]")).toBeNull();
  });

  it("offers the risk map by the place's name, and leaves the old cards out", () => {
    const c = home("normal");
    expect($(c, "[data-map-cta]")?.textContent).toContain("ต.บานา");
    expect($(c, "[data-new-to-jaga]")).toBeNull();
    expect($(c, "[data-join-jaga]")).toBeNull();
  });

  it("hides 'Report flood' and its lock note until sign-in", () => {
    const c = home("normal");
    expect($(c, "a[href$='/report']")).toBeNull();
    expect($(c, "[data-sign-in-hint]")).toBeNull();
    expect($(c, "[data-other-help] [data-supplies-link]")).toBeTruthy();
  });
});

describe("a signed-in laptop visitor", () => {
  it("gets the install card as the open step, and 'Report flood' appears", () => {
    browser.signedIn = true;
    const c = home("normal");
    const steps = [...c.querySelectorAll("[data-setup-step]")].map(
      (li) => `${li.getAttribute("data-setup-step")}:${li.getAttribute("data-state")}`,
    );
    expect(steps).toEqual(["area:done", "signIn:done", "install:open"]);
    expect($(c, "[data-setup-step='install'] [data-install]")).toBeTruthy();
    expect($(c, "a[href$='/report']")).toBeTruthy();
    expect($(c, "[data-other-help]")).toBeNull();
  });

  it("sees no setup card at all once install is out of the way", () => {
    browser.signedIn = true;
    browser.installPending = false;
    const c = home("normal");
    expect($(c, "[data-setup-steps]")).toBeNull();
    expect($(c, "a[href$='/report']")).toBeTruthy();
  });
});

describe("what never changes", () => {
  it.each(["warning", "evacuate"] as const)(
    "invites nobody to anything while the place is at %s",
    (scenario) => {
      const c = home(scenario);
      for (const gone of [
        "[data-setup-steps]",
        "[data-map-cta]",
        "[data-install]",
        "[data-home-first]",
      ]) {
        expect($(c, gone), gone).toBeNull();
      }
      expect($(c, "a[href$='/report']")).toBeTruthy();
      expect($(c, "a[href$='/sos']")).toBeTruthy();
    },
  );

  it("leaves a phone or an upright tablet exactly as it was", () => {
    browser.wide = false;
    for (const scenario of ["choose", "normal"] as const) {
      const c = home(scenario);
      for (const gone of [
        "[data-home-first]",
        "[data-setup-steps]",
        "[data-map-cta]",
        "[data-other-help]",
      ]) {
        expect($(c, gone), `${scenario} ${gone}`).toBeNull();
      }
      expect($(c, "[data-new-to-jaga]")).toBeTruthy();
      expect($(c, "[data-join-jaga]")).toBeTruthy();
      expect($(c, "a[href$='/report']")).toBeTruthy();
    }
  });
});

describe("the words", () => {
  const HOME_FLOW_KEYS = Object.keys(th.homeFlow).sort();
  it.each([
    ["en", en],
    ["ms", ms],
  ])("%s has every line Thai has, with the same placeholders", (_name, messages) => {
    expect(Object.keys(messages.homeFlow).sort()).toEqual(HOME_FLOW_KEYS);
    const placeholders = (s: unknown) =>
      JSON.stringify(s)
        .match(/\{\w+\}/g)
        ?.sort()
        .join(",") ?? "";
    expect(placeholders(messages.homeFlow)).toBe(placeholders(th.homeFlow));
  });
});
