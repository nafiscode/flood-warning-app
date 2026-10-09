import { afterEach, describe, expect, it, vi } from "vitest";
import th from "@/messages/th.json";
import { renderWithIntl } from "./render";

/**
 * The Admin link in the header (the owner's request, 10 Oct). It is drawn in the browser from
 * the role kept on the phone, so these tests seed that and render. The link only decides what is
 * shown: the admin pages and row-level security turn away anyone who isn't an admin, whatever
 * this says (safety rule 5).
 */

/** A cookie shaped like Supabase's session cookie: without one the link forgets the role. */
const SESSION = "sb-test-auth-token";
const signedIn = () => {
  document.cookie = `${SESSION}=present; path=/`;
};
const signedOut = () => {
  document.cookie = `${SESSION}=; path=/; max-age=0`;
};

afterEach(() => {
  signedOut();
  window.localStorage.clear();
  vi.doUnmock("@/i18n/navigation");
  vi.resetModules();
});

async function show(role: string | null, locale: "th" | "en" = "th", withSession = true) {
  if (withSession) signedIn();
  else signedOut();
  if (role !== null) window.localStorage.setItem("jaga.role", JSON.stringify(role));
  vi.doMock("@/i18n/navigation", () => ({
    Link: ({ href, children, ...rest }: Record<string, unknown> & { children?: unknown }) => (
      <a href={String(href)} {...rest}>
        {children as never}
      </a>
    ),
    usePathname: () => "/",
  }));
  const { AdminLink } = await import("@/components/AdminLink");
  return renderWithIntl(<AdminLink />, locale).container;
}

describe("the Admin link in the header", () => {
  it("is there for an admin and a super admin, and goes to the console", async () => {
    for (const role of ["admin", "super_admin"]) {
      const c = await show(role);
      const link = c.querySelector("[data-admin-link]");
      expect(link, role).not.toBe(null);
      expect(link!.getAttribute("href")).toBe("/admin");
      expect(link!.textContent).toBe(th.nav.admin);
      window.localStorage.clear();
      vi.resetModules();
    }
  });

  it("is not there for anyone else", async () => {
    for (const role of ["user", "authority", null]) {
      const c = await show(role);
      expect(c.querySelector("[data-admin-link]"), String(role)).toBe(null);
      window.localStorage.clear();
      vi.resetModules();
    }
  });

  it("forgets the role as soon as nobody is signed in", async () => {
    const c = await show("admin", "th", false);
    expect(c.querySelector("[data-admin-link]")).toBe(null);
    expect(window.localStorage.getItem("jaga.role")).toBe(null);
  });

  it("reads the same as the other links in the bar", async () => {
    const c = await show("admin");
    const link = c.querySelector("[data-admin-link]")!;
    // The same shape as Home, Map and Account: a tappable white underlined word.
    for (const part of ["min-h-tap", "text-white", "underline"]) {
      expect(link.getAttribute("class"), part).toContain(part);
    }
  });
});
