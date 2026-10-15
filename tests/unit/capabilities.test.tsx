import { existsSync } from "node:fs";
import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Capabilities } from "@/components/capabilities/Capabilities";
import { Scene } from "@/components/capabilities/Scene";
import {
  CAPABILITIES,
  CAPABILITY_ROLES,
  COMING_HAZARDS,
  pathOf,
  RESIDENT_EXTRAS,
  roleFromHash,
  SCENES,
} from "@/lib/capabilities";
import { HOTLINES } from "@/lib/hotlines";
import en from "@/messages/en.json";
import ms from "@/messages/ms.json";
import th from "@/messages/th.json";
import { renderWithIntl } from "./render";

const ALL = { th, ms, en } as const;
type Tree = { [key: string]: string | Tree };
const read = (tree: Tree, path: string) =>
  path
    .split(".")
    .reduce<string | Tree | undefined>(
      (node, key) => (typeof node === "object" ? node[key] : undefined),
      tree,
    );

/** The page file behind an app route, e.g. "/map" -> app/[locale]/map/page.tsx. */
const pageFile = (route: string) => `app/[locale]${route === "/" ? "" : route}/page.tsx`;

describe("what Jaga can do: the list", () => {
  it("has the four roles the prompt names, residents first", () => {
    expect([...CAPABILITY_ROLES]).toEqual(["resident", "team", "supplies", "admin"]);
  });

  it("opens only pages that exist in the app", () => {
    const hrefs = [
      ...Object.values(CAPABILITIES).flatMap((items) => items.map((i) => i.href)),
      ...RESIDENT_EXTRAS.map((e) => e.href),
    ];
    for (const href of hrefs) {
      expect(existsSync(pageFile(pathOf(href))), href).toBe(true);
    }
  });

  it("has every line in Thai, Malay and English", () => {
    const keys = [
      ...CAPABILITY_ROLES.flatMap((r) => ["name", "who", "intro"].map((k) => `roles.${r}.${k}`)),
      ...Object.values(CAPABILITIES).flatMap((items) =>
        items.flatMap((i) => ["title", "text", "where"].map((k) => `items.${i.key}.${k}`)),
      ),
      ...RESIDENT_EXTRAS.flatMap((e) => [`extras.${e.key}.title`, `extras.${e.key}.text`]),
    ];
    for (const [locale, messages] of Object.entries(ALL)) {
      const root = (messages as unknown as Tree).capabilities as Tree;
      for (const key of keys) expect(typeof read(root, key), `${locale} ${key}`).toBe("string");
    }
  });

  it("asks for no donation anywhere on the page (safety rule 9)", () => {
    for (const messages of Object.values(ALL)) {
      expect(JSON.stringify(messages.capabilities)).not.toMatch(/donat|บริจาค|derma|PromptPay/i);
    }
  });

  it("names a real hotline for every hazard still to come (rule 10)", () => {
    const numbers = HOTLINES.map((h) => h.number);
    for (const hazard of COMING_HAZARDS) expect(numbers).toContain(hazard.hotline);
    expect(COMING_HAZARDS.find((h) => h.key === "fire")?.hotline).toBe("199");
  });

  it("opens on the role a link names, and on residents otherwise", () => {
    expect(roleFromHash("#team")).toBe("team");
    expect(roleFromHash("admin")).toBe("admin");
    expect(roleFromHash("#elsewhere")).toBe("resident");
    expect(roleFromHash("")).toBe("resident");
  });
});

describe("what Jaga can do: the page", () => {
  it("puts SOS near the top, before the roles", () => {
    const { container } = renderWithIntl(<Capabilities />);
    const sos = container.querySelector("[data-capabilities-sos] a");
    expect(sos?.getAttribute("href")).toBe("/sos");
    const picker = container.querySelector("[data-role-picker]")!;
    expect(sos!.compareDocumentPosition(picker) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows one role at a time, and switches when another is chosen", () => {
    const { container } = renderWithIntl(<Capabilities />, "en");
    const panel = (role: string) => container.querySelector(`[data-role-panel="${role}"]`)!;
    expect(panel("resident").hasAttribute("hidden")).toBe(false);
    expect(panel("team").hasAttribute("hidden")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: /Rescue teams/ }));
    expect(panel("team").hasAttribute("hidden")).toBe(false);
    expect(panel("resident").hasAttribute("hidden")).toBe(true);
    expect(window.location.hash).toBe("#team");
    expect(within(panel("team") as HTMLElement).getByText("Finish with a photo")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Residents and visitors/ }));
    expect(window.location.hash).toBe("");
  });

  it("says where each thing is and gives a button to it", () => {
    const { container } = renderWithIntl(<Capabilities />, "en");
    const card = container.querySelector('[data-capability="watch"]')!;
    expect(card.querySelector("[data-capability-where]")?.textContent).toContain("Places I watch");
    expect(card.querySelector("a")?.getAttribute("href")).toBe("/en/account/places");
  });

  it("keeps hazards still to come grey, with no alert colour and no data", () => {
    const { container } = renderWithIntl(<Capabilities />);
    const soon = container.querySelectorAll("[data-coming-hazard]");
    expect(soon).toHaveLength(COMING_HAZARDS.length);
    for (const item of soon) {
      expect(item.outerHTML).not.toMatch(/alert-|bg-sos/);
      expect(item.querySelector("a")?.getAttribute("href")).toMatch(/^tel:\d+$/);
    }
  });

  it("draws every scene, hidden from screen readers", () => {
    for (const name of SCENES) {
      const { container, unmount } = renderWithIntl(<Scene name={name} />);
      const frame = container.querySelector(`[data-scene="${name}"]`)!;
      expect(frame.getAttribute("aria-hidden")).toBe("true");
      expect(frame.childElementCount).toBeGreaterThan(0);
      unmount();
    }
  });
});
