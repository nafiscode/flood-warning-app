import { useMessages, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

/**
 * The pages a reader goes to in order to judge the work, as plain links: the science, the
 * system, and who built it. No JavaScript, so the switch works on a page served from the offline
 * cache, and each page is its own address a paper or an email can point at.
 *
 * "Who built Jaga" appears only where its content does. That page's words are not in this
 * repository (the owner, 20 Oct 2026) and arrive with the build, so a fork has nothing behind the
 * link - and a tab leading nowhere is worse than two tabs.
 */
export function HowNav({ current }: { current: "science" | "system" | "about" }) {
  const t = useTranslations("howItWorks.nav");
  const hasAbout = Boolean((useMessages() as { about?: unknown }).about);
  const tabs = [
    { key: "science", href: "/how-it-works" },
    { key: "system", href: "/how-it-works/system" },
    ...(hasAbout ? ([{ key: "about", href: "/about" }] as const) : []),
  ] as const;
  return (
    <nav aria-label={t("label")} data-how-nav>
      <ul className={`grid gap-2 ${tabs.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
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
