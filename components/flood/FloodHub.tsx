import { useTranslations } from "next-intl";
import { DropIcon, MapIcon, PinIcon, WaveIcon } from "@/components/icons";
import { Link } from "@/i18n/navigation";
import { buttonPrimary, buttonSecondary, card, hint } from "@/lib/ui";

/**
 * The hub at /flood: what Jaga is, for somebody who searched for a flood app rather than for a
 * place (A10, 10 Nov 2026, the owner's SEO ask).
 *
 * Every other public page answers "what is happening in <place>". Nothing answered "what is this
 * app, and does it cover me" - so a search for แอปน้ำท่วม, แอปน้ำท่วมภาคใต้ or น้ำท่วม 3 จังหวัด had no page
 * on this site to land on, and the home screen had to carry it alone while also being the screen
 * somebody opens in a flood. This is that page, and it is a real one: what Jaga does, where it
 * covers, the questions people actually ask, and the way on to the fifteen place pages.
 *
 * Three things it is not allowed to be.
 *   - It never implies cover Jaga does not have. It names the four provinces in words and ends on
 *     "if you are anywhere else, call 1784 or 1669" (safety rule 10). ภาคใต้ on its own is fourteen
 *     provinces; the copy says ชายแดนภาคใต้ and names them, which is the true claim.
 *   - It never states a forecast as a certainty, and the FAQ says so in as many words (rule 8).
 *   - Asking for help comes before anything else on it, and behind nothing (rule 1).
 *
 * Drawn entirely on the server with no live data: it is the same for every reader, so it caches,
 * opens on a failing connection and cannot leak anything. The live figures live one tap away on
 * the place pages, which is where somebody who wants a number is going.
 */

type PlaceLink = { slug: string; name: string };

export function FloodHub({
  provinces,
  districts,
}: {
  provinces: PlaceLink[];
  districts: PlaceLink[];
}) {
  const t = useTranslations("floodHub");
  const tProvince = useTranslations("province");
  const tHotline = useTranslations("hotlines");

  const does = [
    { key: "alert", Icon: WaveIcon },
    { key: "sos", Icon: PinIcon },
    { key: "map", Icon: MapIcon },
    { key: "places", Icon: PinIcon },
    { key: "offline", Icon: DropIcon },
  ] as const;

  const hotlines = [
    { number: "1784", name: tHotline("ddpm") },
    { number: "1669", name: tHotline("medical") },
    { number: "191", name: tHotline("police") },
    { number: "199", name: tHotline("fire") },
  ];

  return (
    <article className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <h1 className="text-h1 font-bold text-jaga-ink">{t("title")}</h1>
        <p className="text-body">{t("lead")}</p>
      </header>

      {/* Asking for help is the first thing on the page and sits behind nothing (safety rule 1). */}
      <section className="flex flex-col gap-3">
        <h2 className="text-h3 font-bold text-jaga-ink">{t("act.title")}</h2>
        <Link href="/sos" prefetch={false} className={buttonPrimary}>
          {t("act.sos")}
        </Link>
        <Link href="/" prefetch={false} className={buttonSecondary}>
          {t("act.home")}
        </Link>
        <Link href="/map" prefetch={false} className={buttonSecondary}>
          {t("act.map")}
        </Link>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-h3 font-bold text-jaga-ink">{t("what.title")}</h2>
        <ul className="flex flex-col gap-2">
          {does.map(({ key, Icon }) => (
            <li key={key} className="flex items-start gap-3">
              <Icon className="mt-1 size-5 shrink-0 text-jaga-teal-ink" aria-hidden="true" />
              <span className="text-body">{t(`what.${key}`)}</span>
            </li>
          ))}
        </ul>
      </section>

      {/*
        The place pages, which are the pages a local flood search lands on. Listing them here is
        what makes them reachable by a crawler from one address, and useful to a reader who has
        arrived at the general page and wants their own town.
      */}
      <section className="flex flex-col gap-4">
        <h2 className="text-h3 font-bold text-jaga-ink">{t("where.title")}</h2>

        <div className="flex flex-col gap-2">
          <h3 className="text-small font-bold text-jaga-ink">{t("where.provinces")}</h3>
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {provinces.map((place) => (
              <li key={place.slug}>
                <Link
                  href={`/flood/${place.slug}`}
                  prefetch={false}
                  className="inline-flex min-h-tap items-center underline"
                >
                  {place.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="text-small font-bold text-jaga-ink">{t("where.districts")}</h3>
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {districts.map((place) => (
              <li key={place.slug}>
                <Link
                  href={`/flood/${place.slug}`}
                  prefetch={false}
                  className="inline-flex min-h-tap items-center underline"
                >
                  {place.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        {/* The true claim, in the same words every place page ends on (safety rule 10). */}
        <p className={hint}>{tProvince("coverage")}</p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-h3 font-bold text-jaga-ink">{t("faq.title")}</h2>
        <dl className="flex flex-col gap-4">
          {FAQ_KEYS.map((key) => (
            <div key={key} className={`${card} flex flex-col gap-1`}>
              <dt className="font-bold text-jaga-ink">{t(`faq.${key}Q`)}</dt>
              <dd className="text-body">{t(`faq.${key}A`)}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* One tap from the hotlines, on this page as on every other (safety rule 4). */}
      <section className="flex flex-col gap-2">
        <h2 className="text-h3 font-bold text-jaga-ink">{tHotline("title")}</h2>
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          {hotlines.map(({ number, name }) => (
            <li key={number}>
              <a
                href={`tel:${number}`}
                className="inline-flex min-h-tap items-center underline"
              >
                {tHotline("call", { number, name })}
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <Link href="/how-it-works" prefetch={false} className={buttonSecondary}>
          {t("act.how")}
        </Link>
      </section>
    </article>
  );
}

/**
 * The questions, in the order a stranger asks them. Exported because the page turns the same list
 * into schema.org FAQPage, and two lists that could drift would be a page whose structured data
 * stopped matching its own words.
 */
export const FAQ_KEYS = ["install", "free", "area", "who", "forecast"] as const;
