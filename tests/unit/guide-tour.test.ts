// @vitest-environment jsdom
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bare, GUIDE_TOURS, NO_TOUR, toursFor } from "@/lib/guide-tour";

const messages = (locale: string) =>
  JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")).guide as Record<string, unknown>;

// All the code that draws the pages, as one string, to look for the attributes the steps name.
const source = execSync("git ls-files app components", { encoding: "utf8" })
  .split("\n")
  .filter((f) => f.endsWith(".tsx"))
  .map((f) => readFileSync(f, "utf8"))
  .join("\n");

describe("the guide tour", () => {
  it("has words for every step in every language", () => {
    for (const locale of ["th", "ms", "en"]) {
      const guide = messages(locale);
      for (const word of ["show", "label", "progress", "close", "back", "next", "done"]) {
        expect(typeof guide[word], `${locale} ${word}`).toBe("string");
      }
      for (const tour of GUIDE_TOURS) {
        for (const step of tour.steps) {
          const entry = (guide[tour.id] as Record<string, { title: string; body: string }>)?.[
            step.id
          ];
          expect(entry?.title, `${locale} ${tour.id}.${step.id}.title`).toBeTruthy();
          expect(entry?.body, `${locale} ${tour.id}.${step.id}.body`).toBeTruthy();
        }
      }
    }
  });

  it("points only at attributes that a component still draws", () => {
    for (const tour of GUIDE_TOURS) {
      for (const step of tour.steps) {
        for (const [name] of step.target.matchAll(/data-[a-z-]+/g)) {
          expect(source, `${tour.id}.${step.id} -> ${name}`).toContain(name);
        }
      }
    }
  });

  it("has no admin tour and none for the SOS screens", () => {
    for (const tour of GUIDE_TOURS) expect(tour.path.test("/admin")).toBe(false);
    expect(toursFor("/th/sos")).toEqual([]);
    expect(NO_TOUR.test("/sos")).toBe(true);
    expect(NO_TOUR.test("/sos/abc")).toBe(true);
    expect(NO_TOUR.test("/supplies")).toBe(false);
  });

  it("keeps the screens for asking help to the button only", () => {
    for (const id of ["supplies", "report", "fieldRescue"]) {
      expect(GUIDE_TOURS.find((t) => t.id === id)?.manualOnly).toBe(true);
    }
  });

  it("finds a page's tours without its language", () => {
    expect(bare("/th")).toBe("/");
    expect(bare("/ms/map/")).toBe("/map");
    expect(toursFor("/en/authority").map((t) => t.id)).toEqual(["notVerified", "console"]);
    expect(toursFor("/th/authority/mine").map((t) => t.id)).toEqual(["mine"]);
  });
});

describe("what the guide remembers", () => {
  it("remembers steps one by one, so a button that appears later is still new", async () => {
    const { markSeen, readSeen, stepKey } = await import("@/lib/guide-tour");
    window.localStorage.clear();
    markSeen([stepKey("account", "setup"), stepKey("account", "requests")]);
    const seen = readSeen();
    expect(seen[stepKey("account", "setup")]).toBe(true);
    expect(seen[stepKey("account", "myCases")]).toBeUndefined();
  });
});
