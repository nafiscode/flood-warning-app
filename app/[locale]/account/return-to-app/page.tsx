/* eslint-disable @next/next/no-img-element -- one small static icon; next/image adds nothing here */
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
 *
 * No page can open an app on the home screen: a phone gives a web page no way to. So the page
 * cannot have a "back to Jaga" button that works; it shows the icon to look for and the two
 * movements instead, as large as the page allows (the owner, 13 Oct: the browser just stayed
 * there and nothing said to go back).
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
  const number =
    "flex size-9 shrink-0 items-center justify-center rounded-full bg-jaga-slate font-bold text-white";

  return (
    <div className="flex flex-col gap-5" data-return-to-app>
      <section className={`${card} items-center text-center`}>
        <img
          src="/icons/apple-touch-icon.png"
          alt=""
          width={88}
          height={88}
          className="rounded-[20px] shadow-md"
        />
        <h1 className="text-h2 font-bold text-jaga-ink">{t("title")}</h1>
        <p className="font-bold">{t("done")}</p>
        <ol className="flex w-full flex-col gap-3 text-start">
          <li className="flex items-center gap-3">
            <span aria-hidden="true" className={number}>
              1
            </span>
            <span>{t("leave")}</span>
          </li>
          <li className="flex items-center gap-3">
            <span aria-hidden="true" className={number}>
              2
            </span>
            <span>{t("tap")}</span>
          </li>
        </ol>
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
