import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { PhoneIcon } from "@/components/icons";
import { Link } from "@/i18n/navigation";
import { pickName } from "@/lib/area";
import { getSessionProfile, localePath } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { buttonPrimary, buttonSecondary, card, hint, notice } from "@/lib/ui";

const MAX_PLACES = 10;

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/account/places">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "watched" });
  return { title: t("title") };
}

type Row = {
  id: string;
  label: string;
  notify: boolean;
  contact_name: string | null;
  contact_phone: string | null;
  tambons: { name_th: string; name_en: string } | null;
};

/**
 * The places a person watches for others (spec 4.9): up to 10, each with its tambon, whether
 * alerts are on, and the person there. Only the owner can read any of this.
 */
export default async function WatchedPlaces({
  params,
  searchParams,
}: PageProps<"/[locale]/account/places">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const query = await searchParams;
  const session = await getSessionProfile();
  if (!session) redirect(localePath(locale, "/sign-in"));
  const t = await getTranslations("watched");

  const supabase = await createClient();
  const { data } = await supabase
    .from("saved_places")
    .select("id, label, notify, contact_name, contact_phone, tambons(name_th, name_en)")
    .eq("user_id", session.userId)
    .order("created_at");
  const places = (data ?? []) as unknown as Row[];
  const done = query.done === "saved" || query.done === "deleted" ? query.done : null;

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-h3 font-bold text-jaga-ink">{t("title")}</h1>
      <p>{t("intro")}</p>
      {done && (
        <p role="status" className={notice}>
          {t(`done.${done}`)}
        </p>
      )}
      <p className={hint}>{t("count", { count: places.length })}</p>
      {places.length === 0 && <p className={notice}>{t("none")}</p>}
      <ul className="flex flex-col gap-4">
        {places.map((place) => (
          <li key={place.id} className={card} data-place={place.id}>
            <h2 className="text-body font-bold">{place.label}</h2>
            <p className={hint}>
              {place.tambons
                ? pickName(locale, place.tambons.name_th, place.tambons.name_en)
                : t("location.outside")}
              {!place.notify && <span className="block">{t("notifyOff")}</span>}
            </p>
            {place.contact_phone && (
              <a href={`tel:${place.contact_phone}`} className={`${buttonSecondary} gap-2`}>
                <PhoneIcon size={22} />
                {place.contact_name ?? place.label} {place.contact_phone}
              </a>
            )}
            <Link href={`/account/places/${place.id}`} className={buttonSecondary}>
              {t("edit")}
            </Link>
          </li>
        ))}
      </ul>
      {places.length < MAX_PLACES ? (
        <Link href="/account/places/new" className={buttonPrimary}>
          {t("add")}
        </Link>
      ) : (
        <p className={notice}>{t("error.limit")}</p>
      )}
    </div>
  );
}
