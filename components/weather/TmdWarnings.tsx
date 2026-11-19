"use client";

import { useFormatter, useLocale, useTranslations } from "next-intl";
import { MegaphoneIcon } from "@/components/icons";
import { useTmdWarnings } from "@/lib/use-tmd";
import type { TmdWarning } from "@/lib/tmd";
import { card, hint } from "@/lib/ui";

/**
 * The Thai Meteorological Department's own warnings, quoted on Jaga's weather screens (owner's
 * request, 18 Nov 2026).
 *
 * Why it is here: TMD is the national forecaster, and its announcement is what the television and
 * the provincial offices are reading out. Showing it inside Jaga means a resident sees the official
 * notice and Jaga's own screens together, instead of guessing which is current.
 *
 * What it is not, and how the card says so:
 * - It carries **no Jaga level, no alert colour and no all-clear** - brand slate and teal only,
 *   because the alert palette means a level and this is not one (CLAUDE.md "Brand", safety rule 10).
 * - It names TMD as the issuer, the time TMD announced it and the period it covers (safety rule 3's
 *   habit, applied to somebody else's notice), and links TMD's own PDF.
 * - It says in the reader's language that this is TMD's notice and not a Jaga alert.
 * - Nothing it says can change a Jaga alert. Only a person publishes those, with the single
 *   exception of the gauge alarm (safety rule 2).
 *
 * TMD writes in Thai only, so the notice is **quoted in Thai on every locale**, marked `lang="th"`,
 * with a line in the reader's language saying so. Safety text is never machine-translated at
 * runtime (CLAUDE.md "UI text"); a Malay or English reader gets our own words around a Thai quote,
 * which is honest, plus TMD's phone number for anyone who needs it explained.
 */
export function TmdWarnings({
  enabled = true,
  compact = false,
}: {
  enabled?: boolean;
  compact?: boolean;
}) {
  const { warnings } = useTmdWarnings(enabled);
  if (warnings.length === 0) return null;
  return <TmdWarningsView warnings={warnings} compact={compact} />;
}

export type TmdWarningsViewProps = {
  warnings: TmdWarning[];
  /** The first notice is open; the rest are folded. A test can open them all. */
  openAll?: boolean;
  /**
   * The home page's form (the owner, 19 Nov 2026: "Long TMD text on the home page"). TMD writes a
   * paragraph, and open on the home screen it pushed everything a resident came for - the alert,
   * SOS, the hotlines - down the page. Folded, every notice shows its title, the period it covers
   * and as much of TMD's own first lines as two lines of the box hold, with the rest a tap away.
   *
   * Nothing is summarised or shortened in the text itself: the words are TMD's, the box decides
   * where they stop, and the whole notice is in the page for a screen reader either way.
   */
  compact?: boolean;
};

/**
 * The card itself, with the notices handed in, so a test can fix a warning and read what the card
 * says about it without a network (tests/unit/tmd-card).
 */
export function TmdWarningsView({
  warnings,
  openAll = false,
  compact = false,
}: TmdWarningsViewProps) {
  const t = useTranslations("tmd");
  const locale = useLocale();
  const format = useFormatter();
  if (warnings.length === 0) return null;

  const when = (iso: string | null) =>
    iso === null
      ? null
      : format.dateTime(new Date(iso), {
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
          timeZone: "Asia/Bangkok",
        });

  return (
    <section className={card} data-tmd-warnings={String(warnings.length)}>
      <div className="flex items-start gap-3">
        {/* Icon and words together, never colour alone (CLAUDE.md, Accessibility). A megaphone:
            this is an announcement somebody else made, not a state Jaga is reporting. */}
        <MegaphoneIcon size={24} className="mt-0.5 shrink-0 text-jaga-slate" aria-hidden="true" />
        <div className="flex flex-col gap-1">
          <h2 className="text-h3 font-bold text-jaga-ink">{t("title")}</h2>
          <p className={hint}>{t("notAnAlert")}</p>
        </div>
      </div>

      {warnings.map((warning, index) => {
        const announced = when(warning.announcedAt);
        const starts = when(warning.startsAt);
        const ends = when(warning.endsAt);
        return (
          <details
            key={`${warning.issueNo ?? index}-${warning.announcedAt ?? index}`}
            open={openAll || (!compact && index === 0)}
            className="group rounded-xl border border-jaga-line bg-jaga-ground px-4 py-3"
            data-tmd-warning={warning.issueNo ?? "0"}
            data-tmd-compact={compact ? "true" : undefined}
          >
            <summary className="flex min-h-tap cursor-pointer list-none flex-col justify-center gap-1 font-medium text-jaga-ink">
              {/* TMD's own title, in Thai, whatever the reader's language. */}
              <span lang="th">{warning.titleTh}</span>
              {compact && (
                <>
                  {/* Folded, the card still carries the one thing that decides whether the notice
                      is about the reader's afternoon: the period TMD gives it. */}
                  {starts && ends && (
                    <span className={`${hint} font-normal group-open:hidden`}>
                      {t("covers", { from: starts, until: ends })}
                    </span>
                  )}
                  {/*
                   * TMD's own opening lines, cut off by the box and not by us: `line-clamp` ends
                   * them after two lines without taking a word out of the page, so nothing is
                   * quoted out of context and a screen reader still reads the notice whole.
                   * Writing a summary of an authority's warning in our own words is the one thing
                   * this card must never do (CLAUDE.md, "UI text").
                   */}
                  <span
                    lang="th"
                    className="line-clamp-2 font-normal text-jaga-ink group-open:hidden"
                    data-tmd-lead="true"
                  >
                    {warning.headlineTh}
                  </span>
                  <span
                    className="font-medium text-jaga-teal-ink underline group-open:hidden"
                    data-tmd-more="true"
                  >
                    {t("readMore")}
                  </span>
                </>
              )}
            </summary>
            <div className="mt-2 flex flex-col gap-2">
              <p lang="th" className="whitespace-pre-line text-jaga-ink">
                {warning.headlineTh}
              </p>
              {/* When TMD said it, and the period it is about: the two things that decide whether
                  a notice still applies to the reader's afternoon. */}
              {announced && <p className={hint}>{t("announced", { time: announced })}</p>}
              {starts && ends && (
                <p className={hint}>{t("covers", { from: starts, until: ends })}</p>
              )}
              {locale !== "th" && <p className={hint}>{t("thaiOnly")}</p>}
              {warning.pdfUrl && (
                <a
                  href={warning.pdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-tap items-center font-medium text-jaga-teal-ink underline"
                  data-tmd-pdf="true"
                >
                  {t("readPdf")}
                </a>
              )}
            </div>
          </details>
        );
      })}

      {/* Whose notice this is, and the number to ask about it. TMD's 1182 is a weather line, not
          an emergency line: the emergency hotlines stay where they always are (safety rule 4). */}
      <p className={hint}>
        {t("source")} ·{" "}
        <a
          href="tel:1182"
          className="font-medium text-jaga-teal-ink underline"
          data-tmd-phone="true"
        >
          {t("phone")}
        </a>
      </p>
    </section>
  );
}
