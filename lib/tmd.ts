/**
 * The Thai Meteorological Department's own severe-weather warnings (TMD, กรมอุตุนิยมวิทยา).
 *
 * TMD is Thailand's official forecaster, and its "ประกาศเตือน" is what the radio, the television
 * and the provincial offices read out. Jaga shows it so that a resident sees the national warning
 * and Jaga's own screens in one place, and never has to wonder which of the two is current.
 *
 * What this is NOT: a Jaga alert. TMD's notice carries no Jaga level, no alert colour and no
 * all-clear; it is shown as a quoted notice with TMD's name, its announcement time, the period it
 * covers and a link to TMD's own PDF (safety rules 2, 3 and 8). Nothing here can publish, raise or
 * lower anything - the only automatic publishing path in Jaga stays the automated alarm of safety
 * rule 2, which reads gauges, not forecasts.
 *
 * Language: TMD writes in Thai only. The notice is therefore quoted in Thai on every locale, with
 * the surrounding words in the reader's language and the quote marked `lang="th"`. Safety text is
 * never machine-translated at runtime (CLAUDE.md, "UI text").
 *
 * The feed is free and needs no key. The `uid`/`ukey` pair below is the one printed in TMD's own
 * public example; `TMD_API_UID`/`TMD_API_KEY` override it if TMD ever issues us our own.
 */

/** TMD asks nothing of a client's User-Agent; we identify ourselves anyway, as with Open-Meteo. */
export const USER_AGENT = `Jaga/1.0 (flood early warning, non-profit${
  process.env.CONTACT_EMAIL ? `; ${process.env.CONTACT_EMAIL}` : ""
})`;

export const WARNINGS_API = "https://data.tmd.go.th/api/WeatherWarningNews/v2/";

/** The whole service area is on Bangkok time, and so are TMD's timestamps. */
export const TMD_OFFSET = "+07:00";

/**
 * A warning is kept for this long after the period it covers has ended, so that a notice issued
 * for "yesterday evening to this morning" is still on the screen while people are reading it over
 * breakfast. After that it goes, because an expired warning on a safety screen is worse than none.
 */
export const KEEP_AFTER_END_MS = 6 * 60 * 60_000;

/** A notice older than three days is dropped even if TMD left no end time on it. */
export const MAX_AGE_MS = 3 * 24 * 60 * 60_000;

/**
 * The words that mean "this one is about the area Jaga covers".
 *
 * TMD's feed carries no area codes at all - only Thai prose - so relevance has to be read from the
 * text. The test is deliberately generous: "ภาคใต้" (the South) catches the region-wide notices,
 * which is how heavy rain over Pattani and Narathiwat is nearly always announced, and the four
 * province names catch anything narrower. Erring towards showing one notice too many is the right
 * way to be wrong here; a resident who reads a warning for the next province along has lost
 * nothing, and the text itself always names the area it is about.
 */
export const SOUTH_WORDS = [
  "ภาคใต้",
  "อ่าวไทย",
  "ปัตตานี",
  "ยะลา",
  "นราธิวาส",
  "สงขลา",
] as const;

/**
 * Words that make a notice nationwide: a tropical storm or a depression is announced for the
 * country and matters here whether or not the prose happens to name the South.
 */
export const NATIONWIDE_WORDS = ["พายุ", "ทั่วประเทศ", "ประเทศไทย"] as const;

export type TmdWarning = {
  /** TMD's own edition number within the episode ("ฉบับที่ 8"). */
  issueNo: string | null;
  /** When TMD announced it. */
  announcedAt: string | null;
  /** The period the warning covers, as TMD gives it. Either end may be missing. */
  startsAt: string | null;
  endsAt: string | null;
  /** TMD's Thai title and body, verbatim. Never translated, never edited. */
  titleTh: string;
  headlineTh: string;
  /** TMD's own PDF of the announcement, when the feed names one. */
  pdfUrl: string | null;
};

/* ------------------------------------------------------------------ parsing */

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/**
 * TMD serves its Thai text as numeric character references (`&#xE1D;` for ฝ), which is valid XML
 * and unreadable until decoded.
 */
export function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => codePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => codePoint(parseInt(dec, 10)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (whole, name: string) => ENTITIES[name] ?? whole);
}

function codePoint(value: number): string {
  // A malformed reference must not throw: a broken character is worth less than a lost warning.
  if (!Number.isFinite(value) || value < 0 || value > 0x10ffff) return "";
  try {
    return String.fromCodePoint(value);
  } catch {
    return "";
  }
}

/**
 * The first `<tag>` of a block, decoded and trimmed. A hand reader rather than an XML parser
 * because the feed is a flat list of flat records, and a dependency costs money to keep (CLAUDE.md,
 * "Budget guardrails"). It is tolerant on purpose: an attribute, odd whitespace or a missing field
 * yields null instead of throwing, because this runs between a government feed and a safety screen.
 */
export function tagText(block: string, tag: string): string | null {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i").exec(block);
  if (!match) return null;
  const text = decodeEntities(match[1]!).replace(/\s+/g, " ").trim();
  return text.length > 0 ? text : null;
}

/** `2026-11-18 15:42:01` as TMD writes it: Bangkok local, with no offset of its own. */
export function toIso(stamp: string | null): string | null {
  if (!stamp) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(stamp.trim());
  if (!match) return null;
  const [, y, m, d, hh, mm, ss] = match;
  const iso = `${y}-${m}-${d}T${hh}:${mm}:${ss ?? "00"}${TMD_OFFSET}`;
  const at = Date.parse(iso);
  return Number.isFinite(at) ? new Date(at).toISOString() : null;
}

/** Every `<Warning>` record in the feed, in the order TMD listed them. */
export function parseWarnings(xml: string): TmdWarning[] {
  const out: TmdWarning[] = [];
  // The feed also carries an empty `<Warnings/>` wrapper; `<Warning>` with a closing tag is the
  // record. Split on the opening tag and keep only what precedes each `</Warning>`.
  for (const chunk of xml.split(/<Warning(?:\s[^>]*)?>/i).slice(1)) {
    const end = chunk.search(/<\/Warning>/i);
    const block = end === -1 ? chunk : chunk.slice(0, end);
    const titleTh = tagText(block, "TitleThai");
    const headlineTh = tagText(block, "HeadlineThai") ?? tagText(block, "DescriptionThai");
    // A notice with no words is not a notice.
    if (!titleTh && !headlineTh) continue;
    const pdf = tagText(block, "WebUrlThai");
    out.push({
      issueNo: tagText(block, "IssueNo"),
      announcedAt: toIso(tagText(block, "AnnounceDate")),
      startsAt: toIso(tagText(block, "EffectStartDate")),
      endsAt: toIso(tagText(block, "EffectEndDate")),
      titleTh: titleTh ?? headlineTh!,
      headlineTh: headlineTh ?? titleTh!,
      pdfUrl: safeUrl(pdf),
    });
  }
  return out;
}

/**
 * Only an https link on TMD's own site is passed on. The feed is a government source, but it is
 * still somebody else's text arriving over the network and ending up in an `href` on our page.
 */
export function safeUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    if (parsed.hostname !== "tmd.go.th" && !parsed.hostname.endsWith(".tmd.go.th")) return null;
    parsed.protocol = "https:";
    return parsed.toString();
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------- filtering */

/** Does this notice concern the four provinces Jaga serves? */
export function isForServiceArea(warning: TmdWarning): boolean {
  const text = `${warning.titleTh} ${warning.headlineTh}`;
  return (
    SOUTH_WORDS.some((word) => text.includes(word)) ||
    NATIONWIDE_WORDS.some((word) => text.includes(word))
  );
}

/** Is it still current? */
export function isCurrent(warning: TmdWarning, now: number): boolean {
  const end = warning.endsAt ? Date.parse(warning.endsAt) : NaN;
  if (Number.isFinite(end)) return end + KEEP_AFTER_END_MS > now;
  // No end time: fall back to the announcement, so a stale notice cannot sit on the screen for
  // ever. A record with neither is dropped, because we cannot say that it is current.
  const announced = warning.announcedAt ? Date.parse(warning.announcedAt) : NaN;
  return Number.isFinite(announced) && announced + MAX_AGE_MS > now;
}

/**
 * The notices worth showing: for this area, still current, newest first. A reader gets at most
 * `limit` of them - on a bad week TMD runs several episodes at once, and a wall of Thai prose on a
 * phone is read by nobody.
 */
export function currentWarnings(
  warnings: TmdWarning[],
  now: number,
  limit = 2,
): TmdWarning[] {
  return warnings
    .filter((w) => isForServiceArea(w) && isCurrent(w, now))
    .sort((a, b) => order(b) - order(a))
    .slice(0, limit);
}

function order(warning: TmdWarning): number {
  const at = warning.announcedAt ? Date.parse(warning.announcedAt) : NaN;
  if (Number.isFinite(at)) return at;
  const start = warning.startsAt ? Date.parse(warning.startsAt) : NaN;
  return Number.isFinite(start) ? start : 0;
}

/* ------------------------------------------------------------------ the feed */

export function warningsUrl(): string {
  const uid = process.env.TMD_API_UID || "api";
  const ukey = process.env.TMD_API_KEY || "api12345";
  const url = new URL(WARNINGS_API);
  url.searchParams.set("uid", uid);
  url.searchParams.set("ukey", ukey);
  return url.toString();
}
