import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentType } from "react";
import th from "@/messages/th.json";
import { renderWithIntl } from "./render";

/**
 * A15 (spec 17): the gates, in a browser rather than on paper.
 *
 * What is being held: "Rate Jaga" and the quiet ask never appear where somebody is asking for or
 * giving help, and never anywhere while a place of theirs is at Warning or Evacuate - while the
 * page itself stays reachable at its address throughout. These are the two mistakes that would
 * put an invitation between a person and help, so they are tested on the rendered markup and not
 * only on the pure rule in lib/feedback.ts.
 */

/** An alert status on the phone, as the home screen's own poll leaves it. */
function phoneAt(level: "normal" | "watch" | "warning" | "evacuate", tambon = "950101") {
  window.localStorage.setItem(
    "jaga.area",
    JSON.stringify({
      code: tambon,
      nameTh: "a",
      nameEn: "a",
      districtTh: "d",
      districtEn: "d",
      provinceTh: "p",
      provinceEn: "p",
      lat: 6.5,
      lon: 101.3,
      from: "list",
    }),
  );
  const alerts =
    level === "normal"
      ? []
      : [
          {
            id: "a1",
            hazard: "flood",
            level,
            reason: "r",
            messages: { th: "m" },
            issuedAt: new Date().toISOString(),
            nextUpdateAt: new Date(Date.now() + 3_600_000).toISOString(),
            onset: null,
            returnWindow: null,
            source: null,
            tambons: [tambon],
            release: null,
          },
        ];
  window.localStorage.setItem(
    "jaga.status",
    JSON.stringify({
      status: { generatedAt: new Date().toISOString(), inService: true, alerts },
      checkedAt: Date.now(),
    }),
  );
}

async function show(name: "FeaturesLink" | "RateLink", pathname: string, props = {}) {
  vi.doMock("@/i18n/navigation", () => ({
    Link: ({ href, children, ...rest }: Record<string, unknown> & { children?: unknown }) => (
      <a href={typeof href === "string" ? href : String((href as { pathname: string }).pathname)} {...rest}>
        {children as never}
      </a>
    ),
    usePathname: () => pathname,
  }));
  const mod =
    name === "FeaturesLink"
      ? await import("@/components/FeaturesLink")
      : await import("@/components/feedback/RateLink");
  const Component = (mod as unknown as Record<string, ComponentType<Record<string, unknown>>>)[
    name
  ]!;
  return renderWithIntl(<Component {...props} />).container;
}

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  vi.doUnmock("@/i18n/navigation");
  vi.resetModules();
  window.localStorage.clear();
});

describe("the line at the end of every page", () => {
  it("offers Rate Jaga on an ordinary page", async () => {
    phoneAt("normal");
    const c = await show("FeaturesLink", "/map");
    const link = c.querySelector("[data-feedback-link]");
    expect(link).not.toBeNull();
    expect(link!.querySelector("a")!.getAttribute("href")).toBe("/feedback");
    expect(c.textContent).toContain(th.feedback.link);
  });

  it("keeps it off the SOS, food-and-water and report screens", async () => {
    phoneAt("normal");
    for (const path of ["/sos", "/supplies", "/report"]) {
      const c = await show("FeaturesLink", path);
      // That whole block is already absent on those screens.
      expect(c.textContent, path).toBe("");
    }
  });

  it("keeps it off a place's page, where an alert is read, while the rest of the line stays", async () => {
    phoneAt("normal");
    const c = await show("FeaturesLink", "/flood/950101");
    expect(c.querySelector("[data-feedback-link]")).toBeNull();
    expect(c.querySelector("[data-features-link]")).not.toBeNull();
  });

  it("takes it away everywhere once a place of theirs is at Warning or Evacuate", async () => {
    for (const level of ["warning", "evacuate"] as const) {
      phoneAt(level);
      const c = await show("FeaturesLink", "/map");
      expect(c.querySelector("[data-feedback-link]"), level).toBeNull();
      // The other lines are not invitations and stay.
      expect(c.querySelector("[data-features-link]"), level).not.toBeNull();
      window.localStorage.clear();
    }
  });

  it("leaves it alone at Watch: a watch is not an emergency", async () => {
    phoneAt("watch");
    const c = await show("FeaturesLink", "/map");
    expect(c.querySelector("[data-feedback-link]")).not.toBeNull();
  });

  it("shows no link on the feedback page itself", async () => {
    phoneAt("normal");
    const c = await show("FeaturesLink", "/feedback");
    expect(c.querySelector("[data-feedback-link]")).toBeNull();
  });
});

describe("the button on Account and About", () => {
  it("is there on an ordinary page", async () => {
    phoneAt("normal");
    const c = await show("RateLink", "/account", { where: "account" });
    expect(c.querySelector('[data-feedback-link="account"]')).not.toBeNull();
  });

  it("goes while a place of theirs is at Evacuate", async () => {
    phoneAt("evacuate");
    const c = await show("RateLink", "/account", { where: "account" });
    expect(c.textContent).toBe("");
  });

  it("goes on a quiet screen even at Normal", async () => {
    phoneAt("normal");
    const c = await show("RateLink", "/sos", { where: "account" });
    expect(c.textContent).toBe("");
  });
});
