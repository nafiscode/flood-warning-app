import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

/**
 * The two pages of "How Jaga works" (A18), as plain links: the science, and the system. No
 * JavaScript, so the switch works on a page that was served from the offline cache, and each
 * page is its own address a paper or an email can point at.
 */
export function HowNav({ current }: { current: "science" | "system" }) {
  const t = useTranslations("howItWorks.nav");
  const tabs = [
    { key: "science", href: "/how-it-works" },
    { key: "system", href: "/how-it-works/system" },
  ] as const;
  return (
    <nav aria-label={t("label")} data-how-nav>
      <ul className="grid grid-cols-2 gap-2">
        {tabs.map(({ key, href }) => {
          const on = key === current;
          return (
            <li key={key}>
              <Link
                href={href}
                prefetch={false}
                aria-current={on ? "page" : undefined}
                data-how-tab={key}
                className={`flex min-h-tap items-center justify-center rounded-2xl border-2 px-3 py-2 text-center font-medium ${
                  on
                    ? "border-jaga-teal-ink bg-jaga-teal-ink/10 text-jaga-ink"
                    : "border-jaga-line bg-jaga-surface text-jaga-text hover:border-jaga-teal-ink/60"
                }`}
              >
                {t(key)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
