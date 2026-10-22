import { fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HotlineBar } from "@/components/HotlineBar";
import th from "@/messages/th.json";
import { renderWithIntl } from "./render";

/**
 * The phone's tab bar and menu (Apple's HIG for iPhone, 23 Oct 2026): the top-level places at
 * the foot, each an icon with a word and the current one marked in more than colour; SOS one tap
 * from every page except the SOS screens themselves, where nothing leads away; the header's
 * languages, colours and reading pages behind one button that never covers the hotlines.
 */

async function show(
  name: "PhoneTabs" | "PhoneMenu",
  pathname: string,
  props: Record<string, unknown> = {},
) {
  vi.doMock("@/i18n/navigation", () => ({
    Link: ({ href, children, ...rest }: Record<string, unknown> & { children?: unknown }) => (
      <a href={String(href)} {...rest}>
        {children as never}
      </a>
    ),
    usePathname: () => pathname,
  }));
  const mod = name === "PhoneTabs" ? await import("@/components/PhoneTabs") : await import("@/components/PhoneMenu");
  const Component = (mod as unknown as Record<string, React.ComponentType<Record<string, unknown>>>)[name]!;
  return renderWithIntl(<Component {...props} />).container;
}

afterEach(() => {
  vi.doUnmock("@/i18n/navigation");
  vi.resetModules();
});

describe("the phone's tab bar", () => {
  it("has Home, Map, SOS and Account, each with an icon and a word", async () => {
    const c = await show("PhoneTabs", "/map");
    const tabs = [...c.querySelectorAll("[data-phone-tab]")];
    expect(tabs.map((t) => t.getAttribute("data-phone-tab"))).toEqual(["home", "map", "sos", "account"]);
    for (const tab of tabs) {
      expect(tab.querySelector("svg"), tab.textContent ?? "").not.toBe(null);
      expect((tab.textContent ?? "").trim().length).toBeGreaterThan(0);
    }
    expect(tabs[2]!.textContent).toContain(th.nav.sos);
    expect(tabs[2]!.getAttribute("href")).toBe("/sos");
  });

  it("marks the current place with aria-current, not only with a colour", async () => {
    const c = await show("PhoneTabs", "/map");
    const current = [...c.querySelectorAll('[aria-current="page"]')];
    expect(current.map((t) => t.getAttribute("data-phone-tab"))).toEqual(["map"]);
  });

  it("is not drawn where someone is asking for help: nothing there leads away from it", async () => {
    for (const path of ["/sos", "/sos/case", "/supplies"]) {
      const c = await show("PhoneTabs", path);
      expect(c.querySelector("[data-phone-tabs]"), path).toBe(null);
    }
  });

  it("is a phone's alone: a tablet has the links in the header again", async () => {
    const c = await show("PhoneTabs", "/");
    expect(c.querySelector("[data-phone-tabs]")!.className).toContain("sm:hidden");
  });
});

describe("the phone's menu", () => {
  it("is closed until it is asked for, and opens the languages, the colours and About", async () => {
    const c = await show("PhoneMenu", "/", { hasAbout: true });
    expect(c.querySelector("[data-phone-menu]")).toBe(null);
    const button = c.querySelector<HTMLButtonElement>("[data-phone-menu-button]")!;
    expect(button.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    const menu = c.querySelector("[data-phone-menu]")!;
    expect(menu.querySelectorAll("nav a").length).toBe(3);
    expect(menu.querySelector("[data-theme-switch]")).not.toBe(null);
    expect(menu.querySelector("[data-about-nav]")).not.toBe(null);
  });

  it("closes on Escape", async () => {
    const c = await show("PhoneMenu", "/", { hasAbout: false });
    fireEvent.click(c.querySelector("[data-phone-menu-button]")!);
    expect(c.querySelector("[data-phone-menu]")).not.toBe(null);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(c.querySelector("[data-phone-menu]")).toBe(null);
  });
});

describe("the hotline bar on a phone", () => {
  it("shows one short word under each number, and still names the line in full for a screen reader", () => {
    const { container } = renderWithIntl(<HotlineBar />);
    const first = container.querySelector("a")!;
    expect(first.textContent).toContain(th.hotlines.ddpmShort);
    expect(first.getAttribute("aria-label")).toContain(th.hotlines.ddpm);
  });
});
