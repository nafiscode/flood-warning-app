import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { localePath, safeNextPath } from "@/lib/auth";
import { isFlowId } from "@/lib/sign-in-flow";
import { buttonSecondary, card, hint } from "@/lib/ui";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/account/return-to-app">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "account.returnToApp" });
  return { title: t("title"), referrer: "no-referrer", robots: { index: false } };
}

function one(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

/**
 * Shown in the phone's browser when a LINE sign-in started in Jaga on the home screen comes
 * back here (see app/api/auth/callback): the LINE app cannot return to an installed web app.
 * The sign-in is waiting for the app, which collects it by itself when the person opens it
 * again. This browser is not signed in unless they ask for that with the second button.
 */
export default async function ReturnToApp({
  params,
  searchParams,
}: PageProps<"/[locale]/account/return-to-app">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const query = await searchParams;
  const flow = one(query.flow);
  if (!isFlowId(flow)) redirect(localePath(locale, "/sign-in"));
  const next = safeNextPath(one(query.next));
  const t = await getTranslations("account.returnToApp");
  const here = `/api/auth/callback?${new URLSearchParams({ flow, here: "1", ...(next ? { next } : {}) })}`;

  return (
    <div className="flex flex-col gap-5" data-return-to-app>
      <h1 className="text-h3 font-bold text-jaga-ink">{t("title")}</h1>
      <section className={card}>
        <p className="font-bold">{t("done")}</p>
        <p>{t("open")}</p>
        <p className={hint}>{t("stuck")}</p>
        <p className={hint}>{t("soon")}</p>
      </section>
      <section className={card}>
        <p className={hint}>{t("why")}</p>
        <a href={here} rel="nofollow" className={buttonSecondary} data-sign-in-here>
          {t("here")}
        </a>
      </section>
    </div>
  );
}
