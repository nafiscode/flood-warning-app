import { fireEvent, waitFor } from "@testing-library/react";
import { existsSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShareApp, shareLink } from "@/components/ShareApp";
import { OG_LOCALE, SHARE_IMAGE, sharePath, siteUrl } from "@/lib/site";
import en from "@/messages/en.json";
import ms from "@/messages/ms.json";
import th from "@/messages/th.json";
import { renderWithIntl } from "./render";

const LINK = { title: "Jaga", text: "about", url: "https://example.org/" };

describe("what the share button does", () => {
  it("opens the phone's own share sheet where there is one", async () => {
    const share = vi.fn(async () => {});
    const copy = vi.fn(async () => {});
    expect(await shareLink(LINK, { share, copy })).toBe("shared");
    expect(share).toHaveBeenCalledWith(LINK);
    expect(copy).not.toHaveBeenCalled();
  });

  it("treats closing the sheet as a choice, not a failure", async () => {
    const share = vi.fn(async () => {
      throw Object.assign(new Error("closed"), { name: "AbortError" });
    });
    const copy = vi.fn(async () => {});
    expect(await shareLink(LINK, { share, copy })).toBe("dismissed");
    expect(copy).not.toHaveBeenCalled();
  });

  it("copies the link where there is no share sheet, or it will not open", async () => {
    const copy = vi.fn(async () => {});
    expect(await shareLink(LINK, { copy })).toBe("copied");
    expect(copy).toHaveBeenCalledWith(LINK.url);
    const broken = vi.fn(async () => {
      throw new Error("not allowed here");
    });
    expect(await shareLink(LINK, { share: broken, copy })).toBe("copied");
  });

  it("shows the link to copy by hand when nothing else works", async () => {
    expect(await shareLink(LINK, {})).toBe("manual");
    const refused = vi.fn(async () => {
      throw new Error("no clipboard");
    });
    expect(await shareLink(LINK, { copy: refused })).toBe("manual");
  });
});

describe("the share card", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shares the home page in the reader's language, never the page they are on", async () => {
    const share = vi.fn(async (data: typeof LINK) => void data);
    vi.stubGlobal("navigator", { share });
    window.history.replaceState(null, "", "/en/sos/some-private-case");
    const { container } = renderWithIntl(<ShareApp />, "en");
    fireEvent.click(container.querySelector("button")!);
    await waitFor(() => expect(share).toHaveBeenCalled());
    const sent = share.mock.calls[0]![0];
    expect(new URL(sent.url).pathname).toBe("/en");
    expect(sent.title).toBe(en.install.share.title);
    expect(sent.text).toBe(en.install.share.text);
  });

  it("says so when the link was copied, and shows it when it could not be", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const copied = renderWithIntl(<ShareApp />, "en");
    fireEvent.click(copied.container.querySelector("button")!);
    await waitFor(() =>
      expect(copied.container.querySelector("[role='status']")?.textContent).toContain(
        en.install.share.copied,
      ),
    );
    copied.unmount();

    vi.stubGlobal("navigator", {});
    const manual = renderWithIntl(<ShareApp />, "th");
    fireEvent.click(manual.container.querySelector("button")!);
    await waitFor(() => expect(manual.container.querySelector("input[readonly]")).not.toBeNull());
    expect(
      new URL(manual.container.querySelector<HTMLInputElement>("input[readonly]")!.value).pathname,
    ).toBe("/");
  });
});

describe("the address and the picture a shared link carries", () => {
  it("uses the project's own domain when set, else Vercel's live address, else localhost", () => {
    expect(siteUrl({ NEXT_PUBLIC_SITE_URL: "https://jagaapp.org/" })).toBe("https://jagaapp.org");
    expect(siteUrl({ VERCEL_PROJECT_PRODUCTION_URL: "jaga-neon.vercel.app" })).toBe(
      "https://jaga-neon.vercel.app",
    );
    expect(siteUrl({ NEXT_PUBLIC_SITE_URL: "not a url" })).toBe("http://localhost:3000");
    expect(siteUrl({})).toBe("http://localhost:3000");
  });

  it("gives each language its own address and Open Graph locale", () => {
    expect(sharePath("th")).toBe("/");
    expect(sharePath("ms")).toBe("/ms");
    expect(Object.keys(OG_LOCALE).sort()).toEqual(["en", "ms", "th"]);
  });

  it("points at a picture that exists, in the size chat apps expect", () => {
    const file = `public${SHARE_IMAGE.url}`;
    expect(existsSync(file)).toBe(true);
    // PNG: width and height are the two big-endian integers after the IHDR tag.
    const png = readFileSync(file);
    expect(png.readUInt32BE(16)).toBe(SHARE_IMAGE.width);
    expect(png.readUInt32BE(20)).toBe(SHARE_IMAGE.height);
    expect(SHARE_IMAGE.width / SHARE_IMAGE.height).toBeCloseTo(1.905, 2);
    // Under the size above which some chat apps give up on a picture.
    expect(png.length).toBeLessThan(1_000_000);
  });

  it("has its words in all three languages", () => {
    const keys = (o: object) => Object.keys(o).sort();
    expect(keys(ms.install.share)).toEqual(keys(th.install.share));
    expect(keys(en.install.share)).toEqual(keys(th.install.share));
  });
});
