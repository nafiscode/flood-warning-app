import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import { FAQ_KEYS, FloodHub } from "@/components/flood/FloodHub";
import en from "@/messages/en.json";
import ms from "@/messages/ms.json";
import th from "@/messages/th.json";
import { INDEXED_PATHS } from "@/lib/seo";

/**
 * The hub at /flood (10 Nov 2026): the page a search for a flood app lands on.
 *
 * Most of what is checked here is not layout but claim. The page exists to be found by somebody
 * who does not know Jaga, which is exactly the reader safety rule 10 is about: it must say which
 * provinces it covers and what to call from anywhere else, and it must never state a forecast as
 * a certainty. Those sentences are the reason the page is allowed to chase a search at all, so
 * they are held by a test rather than by whoever edits the copy next.
 */

const PROVINCES = [
  { slug: "pattani", name: "จ.ปัตตานี" },
  { slug: "yala", name: "จ.ยะลา" },
  { slug: "narathiwat", name: "จ.นราธิวาส" },
  { slug: "songkhla", name: "จ.สงขลา" },
];
const DISTRICTS = [
  { slug: "hat-yai", name: "อ.หาดใหญ่" },
  { slug: "betong", name: "อ.เบตง" },
];

function show(locale: "th" | "ms" | "en") {
  const messages = { th, ms, en }[locale];
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <FloodHub provinces={PROVINCES} districts={DISTRICTS} />
    </NextIntlClientProvider>,
  );
}

describe("the /flood hub", () => {
  it("is offered for crawling, so the page a general search lands on is in the sitemap", () => {
    expect(INDEXED_PATHS).toContain("/flood");
  });

  it("asks for help before anything else, and behind nothing (safety rule 1)", () => {
    show("th");
    const links = screen.getAllByRole("link");
    const sos = links.findIndex((a) => a.getAttribute("href")?.endsWith("/sos"));
    expect(sos).toBeGreaterThanOrEqual(0);
    // Every link above it must not be a step a person has to take first.
    expect(links.slice(0, sos).every((a) => !a.getAttribute("href")?.includes("sign-in"))).toBe(
      true,
    );
  });

  it("names the four provinces and what to call from anywhere else (safety rule 10)", () => {
    show("th");
    for (const { name } of PROVINCES) expect(screen.getByText(name)).toBeTruthy();
    // The coverage sentence is the place page's, word for word, and carries both hotlines.
    // 1784 is on the page twice over: in the coverage sentence and as a hotline to tap.
    expect(screen.getAllByText(/1784/).length).toBeGreaterThan(0);
    expect(screen.getByText(th.province.coverage)).toBeTruthy();
  });

  it("keeps the hotlines one tap away (safety rule 4)", () => {
    show("th");
    for (const number of ["1784", "1669", "191", "199"]) {
      expect(
        screen.getAllByRole("link").some((a) => a.getAttribute("href") === `tel:${number}`),
      ).toBe(true);
    }
  });

  it("links every place page, so a crawler reaches all fifteen from one address", () => {
    show("th");
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href") ?? "");
    for (const { slug } of [...PROVINCES, ...DISTRICTS]) {
      expect(hrefs.some((h) => h.endsWith(`/flood/${slug}`))).toBe(true);
    }
  });

  it.each(["th", "ms", "en"] as const)("never calls a forecast certain, in %s", (locale) => {
    const messages = { th, ms, en }[locale];
    const answer = messages.floodHub.faq.forecastA;
    // The claim the rule actually makes: an estimate, said so in the page's own words.
    expect(answer.length).toBeGreaterThan(0);
    const hedged = /ไม่ใช่ความแน่นอน|never a certainty|bukan kepastian/.test(answer);
    expect(hedged, `${locale} must say a forecast is not a certainty`).toBe(true);
  });

  it.each(["th", "ms", "en"] as const)("asks and answers every question in %s", (locale) => {
    const messages = { th, ms, en }[locale];
    for (const key of FAQ_KEYS) {
      const q = messages.floodHub.faq[`${key}Q` as keyof typeof messages.floodHub.faq];
      const a = messages.floodHub.faq[`${key}A` as keyof typeof messages.floodHub.faq];
      expect(typeof q === "string" && q.length > 0, `${locale} ${key}Q`).toBe(true);
      expect(typeof a === "string" && a.length > 0, `${locale} ${key}A`).toBe(true);
    }
  });

  it("says in Thai what a Thai search actually asks for", () => {
    // Not keyword counting: these are the words that decide whether the page can be found at all,
    // and each one is a true statement about Jaga (it is an app; it covers these four).
    const text = [th.floodHub.title, th.floodHub.lead, th.floodHub.description].join(" ");
    for (const word of ["แอป", "น้ำท่วม", "ชายแดนภาคใต้", "สงขลา"]) {
      expect(text, `the Thai hub copy must contain ${word}`).toContain(word);
    }
  });

  it("gives the home page a title that says what Jaga is and where", () => {
    // It was "Jaga – เตือนภัยน้ำท่วมและขอความช่วยเหลือ": no แอป, no province, nothing for a search to match.
    expect(th.app.seoTitle).toContain("แอป");
    expect(th.app.seoTitle).toContain("น้ำท่วม");
    // The installed app's name stays short and separate.
    expect(th.app.pwaName).not.toBe(th.app.seoTitle);
  });
});
