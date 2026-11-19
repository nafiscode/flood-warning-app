import { describe, expect, it } from "vitest";
import { TmdWarningsView } from "@/components/weather/TmdWarnings";
import type { TmdWarning } from "@/lib/tmd";
import { renderWithIntl } from "./render";

/**
 * What the card says about the Thai Meteorological Department's warning.
 *
 * The things asserted here are the safety rules, not the styling: TMD is named as the issuer, the
 * notice says it is not a Jaga alert, its times are shown in Bangkok time, its Thai is quoted
 * untranslated and marked as Thai, and the card carries no alert level or alert colour.
 */

const warning = (over: Partial<TmdWarning> = {}): TmdWarning => ({
  issueNo: "8",
  announcedAt: "2026-11-18T08:42:01.000Z",
  startsAt: "2026-11-18T10:00:00.000Z",
  endsAt: "2026-11-18T23:00:00.000Z",
  titleTh: "ฝนตกหนักถึงหนักมากบริเวณภาคใต้ ฉบับที่ 8",
  headlineTh: "ในช่วงวันที่ 18-22 พฤศจิกายน 2569 บริเวณภาคใต้ตอนล่างจะมีฝนตกเพิ่มขึ้น",
  pdfUrl: "https://tmd.go.th/media/forecast/2026-11_18_17_warning_th.pdf",
  ...over,
});

describe("the TMD warning card", () => {
  it("names TMD and says it is not a Jaga alert", () => {
    const { getByText, container } = renderWithIntl(<TmdWarningsView warnings={[warning()]} />);
    expect(getByText("ประกาศเตือนจากกรมอุตุนิยมวิทยา")).toBeTruthy();
    expect(getByText(/ไม่ใช่ประกาศเตือนภัยของ Jaga/)).toBeTruthy();
    expect(getByText(/ที่มา: กรมอุตุนิยมวิทยา/)).toBeTruthy();
    expect(container.querySelector("[data-tmd-warnings]")?.getAttribute("data-tmd-warnings")).toBe(
      "1",
    );
  });

  it("quotes TMD's Thai as it was issued, marked as Thai", () => {
    const { getByText } = renderWithIntl(<TmdWarningsView warnings={[warning()]} />);
    const quote = getByText(warning().headlineTh);
    // Marked `lang="th"` so a screen reader in Malay or English reads it with a Thai voice, and
    // so nothing in the page can be mistaken for our own words.
    expect(quote.getAttribute("lang")).toBe("th");
    expect(getByText(warning().titleTh).getAttribute("lang")).toBe("th");
  });

  it("shows the announcement time and the period, in Bangkok time", () => {
    const { getByText } = renderWithIntl(<TmdWarningsView warnings={[warning()]} />);
    // 08:42 UTC is 15:42 in Bangkok, which is the time TMD itself printed.
    expect(getByText(/15:42/)).toBeTruthy();
    // 10:00 UTC to 23:00 UTC is 17:00 to 06:00 Bangkok.
    expect(getByText(/17:00/)).toBeTruthy();
    expect(getByText(/06:00/)).toBeTruthy();
  });

  it("links TMD's own PDF and TMD's phone number", () => {
    const { container } = renderWithIntl(<TmdWarningsView warnings={[warning()]} />);
    const pdf = container.querySelector("[data-tmd-pdf]");
    expect(pdf?.getAttribute("href")).toBe(warning().pdfUrl);
    expect(pdf?.getAttribute("rel")).toContain("noopener");
    // 1182 is TMD's weather line, not an emergency line: the hotlines of safety rule 4 are
    // elsewhere on the screen and are not replaced by this.
    expect(container.querySelector("[data-tmd-phone]")?.getAttribute("href")).toBe("tel:1182");
  });

  it("leaves out what TMD did not send", () => {
    const { container, queryByText } = renderWithIntl(
      <TmdWarningsView warnings={[warning({ pdfUrl: null, startsAt: null, endsAt: null })]} />,
    );
    expect(container.querySelector("[data-tmd-pdf]")).toBeNull();
    expect(queryByText(/ช่วงที่มีผล/)).toBeNull();
    // The notice itself is still there: a missing period is no reason to drop a warning.
    expect(queryByText(warning().headlineTh)).toBeTruthy();
  });

  it("carries no alert level and no alert colour", () => {
    // Brand slate and teal never show a status; only the alert palette does (CLAUDE.md "Brand").
    // A level badge or an alert colour here would make TMD's notice look like a Jaga level.
    const { container } = renderWithIntl(<TmdWarningsView warnings={[warning()]} />);
    const html = container.innerHTML;
    for (const alertClass of ["jaga-watch", "jaga-warning", "jaga-evacuate", "jaga-normal"]) {
      expect(html).not.toContain(alertClass);
    }
    expect(container.querySelector("[data-level]")).toBeNull();
  });

  it("opens the newest notice and folds the one behind it", () => {
    const { container } = renderWithIntl(
      <TmdWarningsView warnings={[warning(), warning({ issueNo: "7" })]} />,
    );
    const open = Array.from(container.querySelectorAll("details")).map((d) => d.open);
    expect(open).toEqual([true, false]);
  });

  /*
   * The home screen's form (the owner, 19 Nov 2026: "Long TMD text on the home page"). TMD writes
   * a paragraph, and open on the home screen it pushed the alert, SOS and the hotlines down the
   * page. What matters in these three is that folding it costs the reader no meaning and takes no
   * liberty with TMD's words: the box ends the quote, we never do.
   */
  it("folds every notice on the home screen, TMD's own opening lines in view", () => {
    const { container, getAllByText } = renderWithIntl(
      <TmdWarningsView warnings={[warning()]} compact />,
    );
    const box = container.querySelector<HTMLDetailsElement>("details[data-tmd-compact]");
    expect(box?.open).toBe(false);
    // TMD's words stand in the page twice - ended by the box in the summary, whole in the body -
    // and are quoted as Thai in both. Nothing is rewritten, trimmed or summarised anywhere.
    const quoted = getAllByText(warning().headlineTh);
    expect(quoted).toHaveLength(2);
    for (const node of quoted) expect(node.getAttribute("lang")).toBe("th");
    // Where the quote stops is the box's doing: `line-clamp` leaves every word in the page, so a
    // screen reader reads the notice whole whether it is folded or not.
    expect(container.querySelector("[data-tmd-lead]")?.className).toContain("line-clamp-2");
    expect(container.querySelector("[data-tmd-more]")?.textContent).toBe("อ่านเพิ่ม");
  });

  it("says, while folded, which period TMD's notice covers", () => {
    const { container } = renderWithIntl(<TmdWarningsView warnings={[warning()]} compact />);
    // 17:00 to 06:00 Bangkok, in the part of the card a reader sees without opening it: whether
    // the notice is about this afternoon is the first thing they need of it (safety rule 3's habit).
    expect(container.querySelector("summary")?.textContent).toContain("17:00");
  });

  it("stays open on the weather screen, where the reader went looking for it", () => {
    const { container } = renderWithIntl(<TmdWarningsView warnings={[warning()]} />);
    expect(container.querySelector<HTMLDetailsElement>("details")?.open).toBe(true);
    expect(container.querySelector("[data-tmd-lead]")).toBeNull();
    expect(container.querySelector("[data-tmd-compact]")).toBeNull();
  });

  it("draws nothing on a quiet day", () => {
    const { container } = renderWithIntl(<TmdWarningsView warnings={[]} />);
    expect(container.innerHTML).toBe("");
  });

  it("tells an English reader that TMD announces in Thai only", () => {
    const { getByText, queryByText } = renderWithIntl(
      <TmdWarningsView warnings={[warning()]} />,
      "en",
    );
    expect(getByText("Thai Meteorological Department warning")).toBeTruthy();
    expect(getByText(/announces in Thai only/)).toBeTruthy();
    // The notice itself is still TMD's Thai: safety text is never machine-translated.
    expect(queryByText(warning().headlineTh)).toBeTruthy();
  });
});
