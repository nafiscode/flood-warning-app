import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { HomeLocationField } from "@/components/account/HomeLocationField";
import { Link } from "@/i18n/navigation";
import { getSessionProfile, localePath, needsName, setupPath } from "@/lib/auth";
import { VULNERABLE_ORDER } from "@/lib/coverage";
import { finderText } from "@/lib/place-finder-text";
import { createClient } from "@/lib/supabase/server";
import {
  buttonPrimary,
  buttonSecondary,
  card,
  checkBox,
  checkRow,
  errorNotice,
  hint,
  input,
  label,
  notice,
} from "@/lib/ui";
import { deleteHousehold, saveHousehold } from "../actions";
import { BackIcon, CheckIcon, TrashIcon } from "@/components/icons";

/**
 * A short box for a count, at the end of its row. Not the shared `input` class: that one is full
 * width, and a width added beside it loses to it, which left each box filling the row and its
 * label squeezed into a column one word wide.
 */
const countBox =
  "min-h-tap w-20 shrink-0 rounded-xl border border-jaga-text-2 bg-jaga-surface px-3 py-2 text-center text-body tabular-nums text-jaga-text";
const countRow = "flex min-h-tap items-center justify-between gap-4";

const ERRORS = ["size", "consent", "agreed", "phone", "location", "notes", "save"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/account/household/[key]">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "household" });
  return { title: t("title") };
}

type Row = {
  id: string;
  size: number | null;
  vulnerable: Record<string, number> | null;
  mobility_notes: string | null;
  contact_phone: string | null;
  point: { coordinates: [number, number] } | null;
};

/**
 * Tell the rescue teams who lives here (spec 4.7): `/account/household/home` for the person's own
 * home, `/account/household/<place id>` for someone at a place they watch. Optional, never a
 * request for help, and the person can change or delete it at any time.
 */
export default async function HouseholdPage({
  params,
  searchParams,
}: PageProps<"/[locale]/account/household/[key]">) {
  const { locale, key } = await params;
  setRequestLocale(locale);
  const query = await searchParams;
  const session = await getSessionProfile();
  if (!session) redirect(localePath(locale, "/sign-in"));
  if (needsName(session)) redirect(setupPath(locale, `/account/household/${key}`));
  const placeId = UUID.test(key) ? key : null;
  if (!placeId && key !== "home") notFound();

  const t = await getTranslations("household");
  const tSos = await getTranslations("sos");
  const tHome = await getTranslations("account.home");
  const finder = await finderText();
  const supabase = await createClient();

  let placeLabel: string | null = null;
  if (placeId) {
    const place = await supabase
      .from("saved_places")
      .select("label")
      .eq("id", placeId)
      .eq("user_id", session.userId)
      .maybeSingle();
    if (!place.data) notFound();
    placeLabel = place.data.label as string;
  }
  const found = placeId
    ? await supabase
        .from("households")
        .select("id, size, vulnerable, mobility_notes, contact_phone, point")
        .eq("owner_id", session.userId)
        .eq("saved_place_id", placeId)
        .maybeSingle()
    : await supabase
        .from("households")
        .select("id, size, vulnerable, mobility_notes, contact_phone, point")
        .eq("owner_id", session.userId)
        .is("saved_place_id", null)
        .maybeSingle();
  const household = (found.data as unknown as Row | null) ?? null;
  const profile = placeId
    ? null
    : await supabase
        .from("profiles")
        .select("home_point")
        .eq("user_id", session.userId)
        .maybeSingle();
  const homePoint =
    (profile?.data?.home_point as { coordinates?: [number, number] } | null)?.coordinates ?? null;
  const at = household?.point?.coordinates ?? homePoint;

  const error = ERRORS.find((e) => e === query.error);
  const done = query.done === "saved" || query.done === "deleted" ? query.done : null;

  return (
    <div className="flex flex-col gap-5" data-household-form={key}>
      <form action={saveHousehold} className="flex flex-col gap-5">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="key" value={key} />
        <h1 className="text-h3 font-bold text-jaga-ink">
          {placeLabel ? t("titlePlace", { place: placeLabel }) : t("title")}
        </h1>
        {done && (
          <p role="status" className={notice} data-household-done={done}>
            {t(done)}
          </p>
        )}
        {error && (
          <p role="alert" className={errorNotice}>
            {t(`error.${error}`)}
          </p>
        )}
        <p>{t("intro")}</p>
        <p className={notice}>{t("who")}</p>

        <section className={card}>
          <label className={countRow}>
            <span className={`${label} min-w-0 flex-1`}>{t("size")}</span>
            <input
              id="size"
              name="size"
              type="number"
              inputMode="numeric"
              min={1}
              max={50}
              required
              defaultValue={household?.size ?? ""}
              className={countBox}
            />
          </label>
        </section>

        <section className={card}>
          <h2 className="text-body font-bold">{t("vulnerableTitle")}</h2>
          <p className={hint}>{t("vulnerableHint")}</p>
          {VULNERABLE_ORDER.map((k) => (
            <label key={k} className={countRow} data-count-row={k}>
              <span className="min-w-0 flex-1">{tSos(`vulnerable.${k}`)}</span>
              <input
                name={`v_${k}`}
                type="number"
                inputMode="numeric"
                min={0}
                max={20}
                defaultValue={household?.vulnerable?.[k] ?? 0}
                className={countBox}
              />
            </label>
          ))}
        </section>

        <section className={card}>
          <label htmlFor="notes" className={label}>
            {t("notes")}
          </label>
          <textarea
            id="notes"
            name="notes"
            maxLength={500}
            defaultValue={household?.mobility_notes ?? ""}
            className={`${input} min-h-24`}
          />
          <p className={hint}>{t("notesHint")}</p>
          <label htmlFor="phone" className={label}>
            {t("phone")}
          </label>
          <input
            id="phone"
            name="phone"
            type="tel"
            inputMode="tel"
            defaultValue={household?.contact_phone ?? ""}
            placeholder="08x-xxx-xxxx"
            className={input}
          />
          <p className={hint}>{t("phoneHint")}</p>
        </section>

        <section className={card}>
          <h2 className="text-body font-bold">{t("location")}</h2>
          {placeId ? (
            <p>{t("locationPlace")}</p>
          ) : (
            <HomeLocationField
              text={{
                useGps: tHome("useGps"),
                locating: tHome("locating"),
                found: tHome("found"),
                failed: tHome("failed"),
                clear: tHome("clear"),
                useMap: tHome("useMap"),
                hideMap: tHome("hideMap"),
                mapHint: t("locationHint"),
                mapFailed: tHome("mapFailed"),
              }}
              finder={finder}
              locale={locale}
              initial={at ? { lat: at[1], lon: at[0] } : null}
            />
          )}
        </section>

        <section className={card}>
          <label className={checkRow}>
            <input type="checkbox" name="consent" value="yes" required className={checkBox} />
            <span>{t("consent")}</span>
          </label>
          {placeId && (
            <label className={checkRow}>
              <input type="checkbox" name="agreed" value="yes" required className={checkBox} />
              <span>{t("agreed")}</span>
            </label>
          )}
          <button type="submit" className={buttonPrimary}>
            <CheckIcon size={22} />
            {t("save")}
          </button>
        </section>
      </form>

      {household && (
        <details className="rounded-2xl border border-jaga-line p-4">
          <summary className="flex min-h-tap cursor-pointer items-center font-medium">
            {t("delete")}
          </summary>
          <form action={deleteHousehold} className="flex flex-col gap-3 pt-2">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="key" value={key} />
            <input type="hidden" name="id" value={household.id} />
            <p className={hint}>{t("deleteNote")}</p>
            <button type="submit" className={buttonSecondary} data-household-delete="true">
              <TrashIcon size={22} />
              {t("delete")}
            </button>
          </form>
        </details>
      )}

      <Link href="/account" className={buttonSecondary}>
        <BackIcon size={22} />
        {t("back")}
      </Link>
    </div>
  );
}
