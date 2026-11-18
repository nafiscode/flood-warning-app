import { describe, expect, it } from "vitest";
import {
  currentWarnings,
  decodeEntities,
  isCurrent,
  isForServiceArea,
  KEEP_AFTER_END_MS,
  MAX_AGE_MS,
  parseWarnings,
  safeUrl,
  tagText,
  toIso,
  warningsUrl,
  type TmdWarning,
} from "@/lib/tmd";

/**
 * Reading the Thai Meteorological Department's warning feed.
 *
 * The sample below is the real feed of 18 November 2026, trimmed: TMD's own numeric character
 * references, its Bangkok timestamps with no offset, and the empty `<Warnings/>` wrapper that sits
 * in front of the records. The point of these tests is that a government feed we do not control
 * cannot put wrong words, a wrong time or an off-site link onto a safety screen - and cannot throw.
 */

/** "ฝนตกหนัก" as TMD encodes it. */
const HEAVY_RAIN_TH = "&#xE1D;&#xE19;&#xE15;&#xE01;&#xE2B;&#xE19;&#xE31;&#xE01;";
/** "ภาคใต้" (the South). */
const SOUTH_TH = "&#xE20;&#xE32;&#xE04;&#xE43;&#xE15;&#xE49;";

const FEED = `<?xml version="1.0"?>
<WeatherForecastDaily version="2.0"><header><title>Thailand Weather and Climate News</title>
<lastBuildDate>2026-11-19 00:55:44</lastBuildDate><status>200 OK</status></header><Warnings/>
<Warning><IssueNo>8</IssueNo><EffectStartDate>2026-11-18 17:00:00</EffectStartDate>
<EffectEndDate>2026-11-19 06:00:00</EffectEndDate><AnnounceDate>2026-11-18 15:42:01</AnnounceDate>
<TitleThai>${HEAVY_RAIN_TH}${SOUTH_TH}  </TitleThai>
<HeadlineThai>${SOUTH_TH} ${HEAVY_RAIN_TH}</HeadlineThai>
<DescriptionThai>${SOUTH_TH}</DescriptionThai>
<WebUrlThai>https://tmd.go.th/media/forecast/daily-forecast/2026-11_18_17_warning_th.pdf</WebUrlThai>
<ContactThai>1182</ContactThai></Warning>
</WeatherForecastDaily>`;

/** Just after TMD announced the notice above. */
const NOW = Date.parse("2026-11-18T09:00:00Z");

const warning = (over: Partial<TmdWarning> = {}): TmdWarning => ({
  issueNo: "8",
  announcedAt: "2026-11-18T08:42:01.000Z",
  startsAt: "2026-11-18T10:00:00.000Z",
  endsAt: "2026-11-18T23:00:00.000Z",
  titleTh: "ฝนตกหนักภาคใต้",
  headlineTh: "ภาคใต้ ฝนตกหนัก",
  pdfUrl: null,
  ...over,
});

describe("decoding TMD's Thai", () => {
  it("turns numeric character references into Thai", () => {
    expect(decodeEntities(HEAVY_RAIN_TH)).toBe("ฝนตกหนัก");
    expect(decodeEntities("&#3613;")).toBe("ฝ");
  });

  it("decodes the named entities and leaves anything else alone", () => {
    expect(decodeEntities("a &amp; b &lt;c&gt; &quot;d&quot;")).toBe('a & b <c> "d"');
    expect(decodeEntities("50&nbsp;mm")).toBe("50&nbsp;mm");
  });

  it("drops a nonsense reference rather than throwing", () => {
    // A broken character costs a reader one letter; an exception costs them the whole warning.
    expect(() => decodeEntities("&#xFFFFFFF;")).not.toThrow();
    expect(decodeEntities("&#xFFFFFFF;ฝน")).toBe("ฝน");
  });
});

describe("reading one field", () => {
  it("decodes and trims", () => {
    expect(tagText(FEED, "IssueNo")).toBe("8");
    expect(tagText(FEED, "TitleThai")).toBe("ฝนตกหนักภาคใต้");
  });

  it("is null for a missing or empty field", () => {
    expect(tagText(FEED, "TitleEnglish")).toBeNull();
    expect(tagText("<A>   </A>", "A")).toBeNull();
  });

  it("reads a tag that carries attributes", () => {
    expect(tagText('<Rainfall Unit="mm">22.60</Rainfall>', "Rainfall")).toBe("22.60");
  });
});

describe("TMD's timestamps", () => {
  it("reads them as Bangkok time", () => {
    // 15:42 in Bangkok is 08:42 UTC. Getting this wrong by seven hours would show a warning as
    // announced in the future, or expire one that is still running.
    expect(toIso("2026-11-18 15:42:01")).toBe("2026-11-18T08:42:01.000Z");
  });

  it("accepts a missing seconds field and the ISO separator", () => {
    expect(toIso("2026-11-18 17:00")).toBe("2026-11-18T10:00:00.000Z");
    expect(toIso("2026-11-18T17:00:00")).toBe("2026-11-18T10:00:00.000Z");
  });

  it("is null for anything it does not recognise", () => {
    expect(toIso(null)).toBeNull();
    expect(toIso("")).toBeNull();
    expect(toIso("18/11/2026")).toBeNull();
    expect(toIso("2026-13-45 99:99:99")).toBeNull();
  });
});

describe("parsing the feed", () => {
  it("reads the record, not the empty wrapper", () => {
    const warnings = parseWarnings(FEED);
    expect(warnings).toHaveLength(1);
    const [first] = warnings;
    expect(first!.issueNo).toBe("8");
    expect(first!.titleTh).toBe("ฝนตกหนักภาคใต้");
    expect(first!.headlineTh).toBe("ภาคใต้ ฝนตกหนัก");
    expect(first!.announcedAt).toBe("2026-11-18T08:42:01.000Z");
    expect(first!.startsAt).toBe("2026-11-18T10:00:00.000Z");
    expect(first!.endsAt).toBe("2026-11-18T23:00:00.000Z");
    expect(first!.pdfUrl).toContain("tmd.go.th");
  });

  it("falls back to the description when there is no headline", () => {
    const xml = `<Warning><DescriptionThai>${SOUTH_TH}</DescriptionThai></Warning>`;
    expect(parseWarnings(xml)[0]!.headlineTh).toBe("ภาคใต้");
  });

  it("skips a record with no words in it", () => {
    expect(parseWarnings("<Warning><IssueNo>9</IssueNo></Warning>")).toHaveLength(0);
  });

  it("returns nothing for junk instead of throwing", () => {
    for (const junk of ["", "not xml", "<html>503</html>", "<Warning>"]) {
      expect(() => parseWarnings(junk)).not.toThrow();
      expect(parseWarnings(junk)).toHaveLength(0);
    }
  });
});

describe("the link we pass on", () => {
  it("keeps TMD's own https link", () => {
    expect(safeUrl("https://tmd.go.th/a.pdf")).toBe("https://tmd.go.th/a.pdf");
    expect(safeUrl("https://www.tmd.go.th/a.pdf")).toBe("https://www.tmd.go.th/a.pdf");
  });

  it("upgrades http to https", () => {
    expect(safeUrl("http://tmd.go.th/a.pdf")).toBe("https://tmd.go.th/a.pdf");
  });

  it("refuses anything that is not TMD", () => {
    // The feed is somebody else's text that ends up in an href on our page.
    expect(safeUrl("https://tmd.go.th.example.com/a.pdf")).toBeNull();
    expect(safeUrl("https://example.com/a.pdf")).toBeNull();
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("not a url")).toBeNull();
    expect(safeUrl(null)).toBeNull();
  });
});

describe("is it about the area Jaga covers", () => {
  it("keeps a notice for the South or one of the four provinces", () => {
    expect(isForServiceArea(warning())).toBe(true);
    for (const word of ["ปัตตานี", "ยะลา", "นราธิวาส", "สงขลา", "อ่าวไทย"]) {
      expect(isForServiceArea(warning({ titleTh: word, headlineTh: word }))).toBe(true);
    }
  });

  it("keeps a storm notice, which is announced for the whole country", () => {
    const storm = warning({ titleTh: "พายุโซนร้อน", headlineTh: "พายุเคลื่อนเข้าประเทศไทย" });
    expect(isForServiceArea(storm)).toBe(true);
  });

  it("drops a notice about another region", () => {
    const north = warning({
      titleTh: "อากาศหนาวภาคเหนือ",
      headlineTh: "ภาคเหนือและภาคตะวันออกเฉียงเหนืออุณหภูมิลดลง",
    });
    expect(isForServiceArea(north)).toBe(false);
  });
});

describe("is it still current", () => {
  it("keeps one that is running now", () => {
    expect(isCurrent(warning(), NOW)).toBe(true);
  });

  it("keeps one for a few hours after it ends, then drops it", () => {
    const ended = Date.parse(warning().endsAt!);
    expect(isCurrent(warning(), ended + KEEP_AFTER_END_MS - 60_000)).toBe(true);
    expect(isCurrent(warning(), ended + KEEP_AFTER_END_MS + 60_000)).toBe(false);
  });

  it("falls back to the announcement when TMD left no end time", () => {
    const open = warning({ endsAt: null });
    expect(isCurrent(open, NOW)).toBe(true);
    expect(isCurrent(open, Date.parse(open.announcedAt!) + MAX_AGE_MS + 1)).toBe(false);
  });

  it("drops a record with no usable time at all", () => {
    // We cannot say such a notice is current, so we do not show it as if it were.
    expect(isCurrent(warning({ endsAt: null, announcedAt: null }), NOW)).toBe(false);
  });
});

describe("what a reader is shown", () => {
  it("is this area's current notices, newest first", () => {
    const older = warning({ issueNo: "7", announcedAt: "2026-11-18T02:00:00.000Z" });
    const north = warning({ issueNo: "6", titleTh: "ภาคเหนือ", headlineTh: "ภาคเหนือ" });
    const list = currentWarnings([older, warning(), north], NOW);
    expect(list.map((w) => w.issueNo)).toEqual(["8", "7"]);
  });

  it("shows at most the limit, because nobody reads a wall of prose on a phone", () => {
    const many = [1, 2, 3, 4].map((n) =>
      warning({ issueNo: String(n), announcedAt: new Date(NOW - n * 60_000).toISOString() }),
    );
    expect(currentWarnings(many, NOW)).toHaveLength(2);
    expect(currentWarnings(many, NOW, 3)).toHaveLength(3);
  });

  it("is empty on a quiet day", () => {
    expect(currentWarnings([], NOW)).toEqual([]);
  });
});

describe("the feed's address", () => {
  it("carries the public credentials TMD prints in its own example", () => {
    const url = new URL(warningsUrl());
    expect(url.origin + url.pathname).toBe("https://data.tmd.go.th/api/WeatherWarningNews/v2/");
    expect(url.searchParams.get("uid")).toBeTruthy();
    expect(url.searchParams.get("ukey")).toBeTruthy();
  });
});
