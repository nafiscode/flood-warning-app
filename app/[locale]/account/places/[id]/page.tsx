import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { HomeLocationField } from "@/components/account/HomeLocationField";
import { Link } from "@/i18n/navigation";
import { getSessionProfile, localePath } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { buttonPrimary, card, checkBox, checkRow, errorNotice, hint, input, label } from "@/lib/ui";
import { deletePlace, savePlace } from "../actions";

const ERRORS = ["label", "location", "phone", "name", "consent", "limit", "save"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/account/places/[id]">): Promise<Metadata> {
  const { locale, id } = await params;
  const t = await getTranslations({ locale, namespace: "watched" });
  return { title: t(id === "new" ? "addTitle" : "editTitle") };
}

type Row = {
  id: string;
  label: string;
  notify: boolean;
  tambon: string | null;
  point: { coordinates: [number, number] };
  contact_name: string | null;
  contact_phone: string | null;
};

/** Add a watched place (/account/places/new) or change one of the person's own. */
export default async function WatchedPlace({
  params,
  searchParams,
}: PageProps<"/[locale]/account/places/[id]">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const query = await searchParams;
  const session = await getSessionProfile();
  if (!session) redirect(localePath(locale, "/sign-in"));
  const t = await getTranslations("watched");
  const tHome = await getTranslations("account.home");

  let place: Row | null = null;
  if (id !== "new") {
    if (!UUID.test(id)) notFound();
    const supabase = await createClient();
    const { data } = await supabase
      .from("saved_places")
      .select("id, label, notify, tambon, point, contact_name, contact_phone")
      .eq("id", id)
      .eq("user_id", session.userId)
      .maybeSingle();
    if (!data) notFound();
    place = data as unknown as Row;
  }
  const error = ERRORS.find((e) => e === query.error);

  return (
    <div className="flex flex-col gap-5">
      <form action={savePlace} className="flex flex-col gap-5">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="id" value={place?.id ?? ""} />
        <h1 className="text-h3 font-bold text-jaga-slate">{t(place ? "editTitle" : "addTitle")}</h1>
        {error && (
          <p role="alert" className={errorNotice}>
            {t(`error.${error}`)}
          </p>
        )}

        <section className={card}>
          <label htmlFor="label" className={label}>
            {t("label.label")}
          </label>
          <input
            id="label"
            name="label"
            defaultValue={place?.label ?? ""}
            maxLength={60}
            required
            className={input}
          />
          <p className={hint}>{t("label.hint")}</p>
        </section>

        <section className={card}>
          <h2 className="text-body font-bold">{t("location.title")}</h2>
          <p className={hint}>{t("location.why")}</p>
          {place && <p>{t(place.tambon ? "location.saved" : "location.outside")}</p>}
          <HomeLocationField
            text={{
              useGps: tHome("useGps"),
              locating: tHome("locating"),
              found: tHome("found"),
              failed: tHome("failed"),
              clear: tHome("clear"),
              useMap: tHome("useMap"),
              hideMap: tHome("hideMap"),
              mapHint: t("location.why"),
              mapFailed: tHome("mapFailed"),
            }}
            initial={
              place ? { lat: place.point.coordinates[1], lon: place.point.coordinates[0] } : null
            }
          />
          <label className={checkRow}>
            <input
              type="checkbox"
              name="notify"
              value="yes"
              defaultChecked={place?.notify ?? true}
              className={checkBox}
            />
            <span>{t("notify")}</span>
          </label>
        </section>

        <section className={card}>
          <h2 className="text-body font-bold">{t("person.title")}</h2>
          <p className={hint}>{t("person.privacy")}</p>
          <label htmlFor="contactName" className={label}>
            {t("person.name")}
          </label>
          <input
            id="contactName"
            name="contactName"
            defaultValue={place?.contact_name ?? ""}
            maxLength={80}
            placeholder={t("person.nameHint")}
            className={input}
          />
          <label htmlFor="contactPhone" className={label}>
            {t("person.phone")}
          </label>
          <input
            id="contactPhone"
            name="contactPhone"
            type="tel"
            inputMode="tel"
            defaultValue={place?.contact_phone ?? ""}
            placeholder="08x-xxx-xxxx"
            className={input}
          />
          <label className={checkRow}>
            <input
              type="checkbox"
              name="contactConsent"
              value="yes"
              defaultChecked={!!(place?.contact_name || place?.contact_phone)}
              className={checkBox}
            />
            <span>{t("person.consent")}</span>
          </label>
        </section>

        <button type="submit" className={buttonPrimary}>
          {t("save")}
        </button>
      </form>

      {place && (
        <details className={card}>
          <summary className="min-h-tap cursor-pointer font-medium">{t("delete")}</summary>
          <p className={hint}>{t("deleteNote")}</p>
          <form action={deletePlace}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="id" value={place.id} />
            <button
              type="submit"
              className="inline-flex min-h-tap w-full items-center justify-center rounded-xl border-2 border-jaga-slate bg-jaga-surface px-5 py-2 font-bold text-jaga-slate"
            >
              {t("deleteConfirm")}
            </button>
          </form>
        </details>
      )}

      <Link href="/account/places" className="inline-flex min-h-tap items-center underline">
        {t("back")}
      </Link>
    </div>
  );
}
