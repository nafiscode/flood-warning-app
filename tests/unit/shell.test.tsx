import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { markSrc } from "@/components/brand/Logo";
import { HotlineBar } from "@/components/HotlineBar";
import * as icons from "@/components/icons";
import { SOSButton } from "@/components/sos/SOSButton";
import en from "@/messages/en.json";
import ms from "@/messages/ms.json";
import th from "@/messages/th.json";
import { renderWithIntl } from "./render";

function keys(obj: object, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

describe("messages", () => {
  it("th, ms and en have exactly the same keys", () => {
    const thKeys = keys(th).sort();
    expect(keys(ms).sort()).toEqual(thKeys);
    expect(keys(en).sort()).toEqual(thKeys);
  });
});

describe("HotlineBar (safety rule 4)", () => {
  it("links all four official hotlines with the number visible", () => {
    const { container } = renderWithIntl(<HotlineBar />);
    const links = [...container.querySelectorAll("a")];
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "tel:1784",
      "tel:1669",
      "tel:191",
      "tel:199",
    ]);
    for (const a of links) expect(a.textContent).toContain(a.getAttribute("href")!.slice(4));
  });
});

describe("SOS button", () => {
  it("always shows the SOS label, the action and an icon", () => {
    const { container } = renderWithIntl(<SOSButton href="/sos" />);
    const a = container.querySelector("a")!;
    expect(a.textContent).toContain("SOS");
    expect(a.textContent).toContain(th.sos.action);
    expect(a.querySelector("svg")).not.toBeNull();
  });
});

describe("no eye icons outside the logo (docs/brand.md)", () => {
  it("the icon set has no eye icon", () => {
    expect(Object.keys(icons).filter((name) => /eye|view|watch/i.test(name))).toEqual([]);
    expect(readFileSync("components/icons/index.tsx", "utf8")).not.toMatch(/\bEye\w*Icon\b/);
  });
});

describe("Logo", () => {
  it("uses the simplified mark below 64 px, and the reverse file on dark backgrounds", () => {
    expect(markSrc(96, "light")).toBe("/brand/jaga-mark.svg");
    expect(markSrc(64, "light")).toBe("/brand/jaga-mark.svg");
    expect(markSrc(63, "light")).toBe("/brand/jaga-mark-small.svg");
    expect(markSrc(40, "reverse")).toBe("/brand/jaga-mark-small-reverse.svg");
  });
});
