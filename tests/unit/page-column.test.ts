import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formColumn } from "@/lib/ui";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const css = read("app/globals.css");

/**
 * Apple's Human Interface Guidelines, applied to every page but the map (the owner, 24 Oct 2026).
 * Measured on an iPad held sideways, the single-purpose pages ran the whole 1,152 px that `#main`
 * opens to - the Sign-in button was 1,060 px wide and the SOS phone-number field as wide as the
 * screen - and paragraphs ran 118-123 characters a line.
 */
describe("the column a single-purpose page sits in", () => {
  it("is Apple's readable width, and only from 1024 px up", () => {
    // 42rem is Tailwind's 2xl: 672 px, the guidelines' readable width on an iPad. Below 1024 px
    // `#main` is already 640 px, so a phone and an upright tablet are not touched.
    expect(formColumn).toBe("lg:mx-auto lg:max-w-2xl");
  });

  // Every page that is one thing to read and one thing to press. The SOS ones are on the list on
  // purpose: the page a person uses in distress should not ask the eye to cross a whole screen.
  const PAGES: Array<[string, number]> = [
    ["app/[locale]/sign-in/page.tsx", 1],
    ["app/[locale]/requests/page.tsx", 1],
    ["app/[locale]/offline/page.tsx", 1],
    ["app/[locale]/report/page.tsx", 1],
    ["app/[locale]/authority/register/page.tsx", 1],
    ["app/[locale]/authority/join/page.tsx", 1],
    ["app/[locale]/account/setup/page.tsx", 1],
    ["app/[locale]/account/places/page.tsx", 1],
    ["components/sos/NotYet.tsx", 1],
    ["components/sos/SendSOS.tsx", 2],
    ["components/sos/SendSupplies.tsx", 2],
    ["components/sos/CaseStatus.tsx", 2],
    ["components/report/ReportForm.tsx", 2],
  ];
  it.each(PAGES)("%s puts its root in the column", (file, roots) => {
    const source = read(file);
    expect(source).toMatch(/from "@\/lib\/ui"/);
    expect(source).toContain("formColumn");
    // Once for the import, once for each root the page can return.
    expect(source.match(/\$\{formColumn\}/g)?.length).toBe(roots);
  });
});

describe("the measure and the controls, held in the stylesheet", () => {
  it("caps a paragraph at 42rem from 1024 px up, in the base layer so a page's own max-w wins", () => {
    const at = css.indexOf("@layer base {");
    expect(at).toBeGreaterThan(0);
    const block = css.slice(at, css.indexOf("\n}\n", css.indexOf("max-width: 42rem", at)) + 3);
    expect(block).toContain("@media (min-width: 1024px)");
    expect(block).toMatch(
      /#main:not\(:has\(\[data-console-page\]\)\) p:not\(\[class\*="flex"\], \[class\*="grid"\]\)\s*\{\s*max-width: 42rem/,
    );
    // A paragraph that is a flex or grid row is a layout, and capping it would pull its two ends
    // together - which is what keeps this from reaching the cards and dashboards.
    expect(block).toContain('[class*="flex"]');
  });

  it("never reaches a page built on the console", () => {
    // The console's head note is one line by design - the head must stay under 60 px so the map
    // keeps its room - and capped at 42rem it wrapped to two and the head grew to 61.6 px. Every
    // rule that caps a measure must stand aside for `data-console-page`, the paragraph rule, its
    // centring and the bullet-row rule alike.
    const at = css.indexOf("@layer base {");
    const block = css.slice(
      at,
      css.indexOf("max-width: 42rem;", css.indexOf('li[class~="items-start"]', at)) + 20,
    );
    const selectors = block.match(/#main[^{]*\{/g) ?? [];
    expect(selectors.length).toBeGreaterThanOrEqual(3);
    for (const selector of selectors) {
      expect(selector).toContain(":not(:has([data-console-page]))");
    }
  });

  it("caps a bullet row, but never a card or a justified row", () => {
    const at = css.indexOf('li[class~="items-start"]');
    expect(at).toBeGreaterThan(0);
    const rule = css.slice(at, css.indexOf("max-width: 42rem", at));
    for (const guard of [
      '[class*="rounded"]',
      '[class*="border"]',
      '[class*="bg-"]',
      '[class*="justify-between"]',
    ]) {
      expect(rule).toContain(guard);
    }
  });

  it("sizes every MapLibre control for a finger, by its own class and not by the container's", () => {
    const at = css.indexOf("@media (pointer: coarse) {\n  div.maplibregl-ctrl-group > button");
    expect(at).toBeGreaterThan(0);
    const block = css.slice(at, css.indexOf("\n}\n", at) + 3);
    expect(block).toContain("width: 2.75rem");
    expect(block).toContain("height: 2.75rem");
    expect(block).toContain(".maplibregl-ctrl-attrib .maplibregl-ctrl-attrib-button");
    // A button bigger than its icon tiles it: the icons are background images.
    expect(block).toContain("background-repeat: no-repeat");
    // React owns a map container's class attribute, so the library's class on it cannot be relied
    // on - the first version of this rule did, and missed the weather and dam maps.
    expect(block).not.toContain(".maplibregl-map");
  });
});
