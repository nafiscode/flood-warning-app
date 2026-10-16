/* eslint-disable @next/next/no-img-element -- a credit's logo is a small static file, when it has one */
import { useTranslations } from "next-intl";
import { CREDIT_GROUPS, creditsOf, initialsOf, type Credit } from "@/lib/how-it-works";

/**
 * Credits and thanks (the owner's request, 16 Oct 2026). Jaga is a non-profit built almost
 * entirely on data other people decided to give away: the radar, the elevation model, the
 * rainfall records, the river telemetry, the roads and the buildings. Without any one of them
 * there would be no flood map for these four provinces, so this section names every one of them,
 * says what Jaga uses it for, and thanks them.
 *
 * `docs/attributions.md` stays the source of record; the licence line here is the short form and
 * the credit line is the licensor's own words, shown wherever one is asked for.
 *
 * A logo appears only where the organisation's brand terms allow it and the owner has put the
 * file in `public/credits/`. Everywhere else the card draws the initials in the brand colours, so
 * the page is complete, costs nothing to download, and never implies an endorsement.
 */
export function Credits() {
  const t = useTranslations("howItWorks.credits");
  return (
    <section className="flex flex-col gap-5" aria-labelledby="jaga-credits" id="credits">
      <div className="flex flex-col gap-3 rounded-3xl bg-jaga-slate px-5 py-6 text-white lg:px-8">
        <h2 id="jaga-credits" className="text-h3 font-bold">
          {t("title")}
        </h2>
        <p className="text-white/90">{t("thanks")}</p>
        <p className="text-small text-white/80">{t("endorse")}</p>
      </div>

      {CREDIT_GROUPS.map((group) => (
        <div key={group} className="flex flex-col gap-3">
          <h3 className="text-h3 font-bold text-jaga-ink">{t(`groups.${group}`)}</h3>
          <ul className="grid gap-3 sm:grid-cols-2">
            {creditsOf(group).map((credit) => (
              <CreditCard key={credit.id} credit={credit} />
            ))}
          </ul>
        </div>
      ))}

      <p className="text-small text-jaga-text-2">{t("licenceNote")}</p>
    </section>
  );
}

function CreditCard({ credit }: { credit: Credit }) {
  const t = useTranslations("howItWorks.credits");
  return (
    <li
      className="flex min-w-0 gap-3 rounded-2xl border border-jaga-line bg-jaga-surface p-4"
      data-credit={credit.id}
    >
      <span className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-xl border border-jaga-line bg-jaga-ground">
        {credit.logo ? (
          <img
            src={`/credits/${credit.logo}`}
            alt=""
            width={56}
            height={56}
            loading="lazy"
            decoding="async"
            className="size-full object-contain p-1"
          />
        ) : (
          <span
            aria-hidden="true"
            className="font-bold leading-none text-jaga-teal-ink"
            data-credit-initials
          >
            {initialsOf(credit.name)}
          </span>
        )}
      </span>
      <span className="flex min-w-0 flex-col gap-1">
        <a
          href={credit.href}
          target="_blank"
          rel="noopener noreferrer external"
          className="font-bold leading-snug text-jaga-ink underline"
        >
          {credit.name}
        </a>
        {credit.dataset && <span className="text-small text-jaga-text">{credit.dataset}</span>}
        <span className="text-jaga-text">{t(`use.${credit.id}`)}</span>
        <span className="text-small text-jaga-text-2">{credit.licence}</span>
        {credit.credit && (
          <span className="text-small italic text-jaga-text-2">{credit.credit}</span>
        )}
      </span>
    </li>
  );
}
