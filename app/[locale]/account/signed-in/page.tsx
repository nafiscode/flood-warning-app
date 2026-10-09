import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { localePath, safeNextPath } from "@/lib/auth";
import { supabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { buttonPrimary, buttonSecondary, card, hint } from "@/lib/ui";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/account/signed-in">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "account.signedIn" });
  return { title: t("title") };
}

function one(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

/**
 * Shown once after a LINE sign-in that finished in another browser than the one that started it
 * (see app/api/auth/callback). The person checks the name before going on: a link prepared by
 * someone else would sign them in to that person's account.
 */
export default async function SignedIn({
  params,
  searchParams,
}: PageProps<"/[locale]/account/signed-in">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const query = await searchParams;
  const next = safeNextPath(one(query.next)) ?? localePath(locale, "/account");
  if (!supabaseConfigured()) redirect(localePath(locale, "/sign-in"));
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) redirect(localePath(locale, "/sign-in"));
  const t = await getTranslations("account.signedIn");

  // The name the person gave here, else the name on their LINE account.
  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("user_id", claims.sub)
    .maybeSingle();
  const meta = (claims.user_metadata ?? {}) as Record<string, unknown>;
  const name =
    [profile?.display_name, meta.name, meta.full_name].find(
      (v): v is string => typeof v === "string" && v.trim() !== "",
    ) ?? t("unnamed");

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-h3 font-bold text-jaga-ink">{t("title")}</h1>
      <section className={card}>
        <p>
          {t("as")}
          <span className="block text-h3 font-bold [overflow-wrap:anywhere]">{name}</span>
        </p>
        <p className={hint}>{t("why")}</p>
        <a href={next} className={buttonPrimary}>
          {t("continue")}
        </a>
        <form action="/api/auth/sign-out" method="post">
          <button type="submit" className={buttonSecondary}>
            {t("notMe")}
          </button>
        </form>
      </section>
    </div>
  );
}
