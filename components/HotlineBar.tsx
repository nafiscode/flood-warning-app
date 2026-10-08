import { useTranslations } from "next-intl";
import { PhoneIcon } from "@/components/icons";
import { HOTLINES } from "@/lib/hotlines";

/**
 * The four official hotlines as plain tel: links. Part of the app shell on every page, so they
 * work offline too (safety rule 4). The number itself is always visible, so it can be dialled by
 * hand if the phone ignores the link.
 */
export function HotlineBar() {
  const t = useTranslations("hotlines");
  return (
    <nav aria-label={t("title")} className="border-t border-jaga-line bg-jaga-surface">
      {/* Wider than a phone on a laptop, but not the whole window: four numbers spread over
          1,500 px would be a row of distant buttons rather than one bar. */}
      <ul className="mx-auto grid max-w-screen-sm grid-cols-4 lg:max-w-3xl">
        {HOTLINES.map(({ key, number }) => (
          <li key={key}>
            <a
              href={`tel:${number}`}
              aria-label={t("call", { number, name: t(key) })}
              className="flex min-h-16 flex-col items-center justify-center gap-0.5 px-1 py-2 text-center text-jaga-text active:bg-jaga-ground"
            >
              <span className="flex items-center gap-1 text-body font-bold">
                <PhoneIcon size={18} />
                {number}
              </span>
              <span className="text-small leading-tight text-jaga-text-2">{t(key)}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
