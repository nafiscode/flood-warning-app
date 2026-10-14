import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { menuGroups, readAdminCounts } from "@/lib/admin-counts";
import { getSessionProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { card, hint } from "@/lib/ui";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/admin">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "admin" });
  return { title: t("title") };
}

const count =
  "inline-flex min-w-6 items-center justify-center rounded-full bg-jaga-slate px-1.5 text-small font-bold text-white";

/**
 * Admin home: every page of the console, in the same four groups as the menu above it (watch,
 * warn, review, records), each with a line on what it is for. What waits for an admin is
 * counted on the review group and on each of its pages.
 */
export default async function AdminHome({ params }: PageProps<"/[locale]/admin">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("admin");
  const session = await getSessionProfile();
  const counts = await readAdminCounts(await createClient());
  const groups = menuGroups(
    (key, values) => t(key as never, values as never),
    counts,
    session?.role === "super_admin",
  );

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-h3 font-bold text-jaga-ink">{t("title")}</h1>
      <p className={hint}>{t("signedInAs", { name: session?.displayName ?? "" })}</p>
      <div className="grid gap-5 lg:grid-cols-2">
        {groups.map((g) => (
          <section key={g.key} className={card} data-admin-home-group={g.key}>
            <h2 className="flex items-center gap-2 text-body font-bold">
              {g.title}
              {g.waiting && (
                <span className={count}>
                  <span aria-hidden="true">{g.waiting}</span>
                  <span className="sr-only">{g.waitingLabel}</span>
                </span>
              )}
            </h2>
            <p className={hint}>{t(`menu.groups.${g.key}.note`)}</p>
            <ul className="grid list-none gap-2 p-0 sm:grid-cols-2">
              {g.items.map((item) => (
                <li key={item.key}>
                  <Link
                    href={item.href}
                    data-admin-home-link={item.key}
                    className="flex min-h-tap items-center justify-between gap-2 rounded-xl border-2 border-jaga-edge bg-jaga-surface px-4 py-2 font-medium text-jaga-ink active:translate-y-px"
                  >
                    {item.label}
                    {item.waiting && (
                      <span className={count}>
                        <span aria-hidden="true">{item.waiting}</span>
                        <span className="sr-only">{item.waitingLabel}</span>
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
