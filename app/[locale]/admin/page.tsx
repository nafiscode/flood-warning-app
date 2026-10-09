import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getSessionProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { buttonSecondary, card, hint } from "@/lib/ui";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/admin">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "admin" });
  return { title: t("title") };
}

/** Admin home. The war room (A6) is here; the alert console and the signal dashboard follow. */
export default async function AdminHome({ params }: PageProps<"/[locale]/admin">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("admin");
  const session = await getSessionProfile();
  const supabase = await createClient();
  const { count } = await supabase
    .from("authority_units")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-h3 font-bold text-jaga-ink">{t("title")}</h1>
      <p className={hint}>{t("signedInAs", { name: session?.displayName ?? "" })}</p>
      <section className={card}>
        <h2 className="text-body font-bold">{t("warRoom.title")}</h2>
        <p className={hint}>{t("warRoom.note")}</p>
        <Link href="/admin/war-room" className={buttonSecondary}>
          {t("warRoom.open")}
        </Link>
      </section>
      <section className={card}>
        <h2 className="text-body font-bold">{t("impact.title")}</h2>
        <p className={hint}>{t("impact.note")}</p>
        <Link href="/admin/impact" className={buttonSecondary}>
          {t("impact.open")}
        </Link>
      </section>
      <section className={card}>
        <h2 className="text-body font-bold">{t("authorities.title")}</h2>
        <p>{t("authorities.pendingCount", { count: count ?? 0 })}</p>
        <Link href="/admin/authorities" className={buttonSecondary}>
          {t("authorities.open")}
        </Link>
      </section>
      {session?.role === "super_admin" && (
        <section className={card}>
          <h2 className="text-body font-bold">{t("invitations.title")}</h2>
          <Link href="/admin/invitations" className={buttonSecondary}>
            {t("invitations.open")}
          </Link>
        </section>
      )}
    </div>
  );
}
