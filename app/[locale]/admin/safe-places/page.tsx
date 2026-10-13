import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { DualTime } from "@/components/admin/DualTime";
import { readAreas } from "@/lib/admin-alerts";
import { isAdminHere } from "@/lib/admin-guard";
import {
  PLACE_STATUS,
  PLACE_TYPES,
  PLACE_VERIFICATION,
  readSafePlaces,
  type AdminPlace,
} from "@/lib/admin-tools";
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
import { addSafePlace, updateSafePlace } from "../tools-actions";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/admin/safe-places">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "adminTools" });
  return { title: t("places.title") };
}

export const dynamic = "force-dynamic";

const ERRORS = ["save", "name", "capacity", "position", "outside"] as const;
const DONE = ["saved", "added"] as const;

/**
 * Safe-place management (spec 6.5): one district at a time, because there are a few thousand
 * places. For each: whether it is open, full or closed, what it needs, how many it holds, its
 * name, and whether an admin stands behind it. "Rejected" takes a place off every public list
 * without deleting it. A new place needs a name and a position inside the service area.
 */
export default async function SafePlaces({
  params,
  searchParams,
}: PageProps<"/[locale]/admin/safe-places">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const query = await searchParams;
  if (!(await isAdminHere())) return null;
  const t = await getTranslations("adminTools");
  const tPlaces = await getTranslations("places");
  const areas = await readAreas();
  const district = areas.districts.find((d) => d.code === query.district) ?? null;
  const only = PLACE_VERIFICATION.find((v) => v === query.only) ?? null;
  const places = district ? await readSafePlaces(district.code, only) : [];
  const error = ERRORS.find((e) => e === query.error);
  const done = DONE.find((d) => d === query.done);
  const name = (a: { name_th: string; name_en: string }) =>
    locale === "th" || !a.name_en ? a.name_th : a.name_en;

  const form = (p: AdminPlace) => (
    <form action={updateSafePlace.bind(null, locale)} className="flex flex-col gap-3 pt-2">
      <input type="hidden" name="place" value={p.id} />
      <input type="hidden" name="district" value={district?.code ?? ""} />
      <label htmlFor={`status-${p.id}`} className={label}>
        {t("places.status")}
      </label>
      <select id={`status-${p.id}`} name="status" defaultValue={p.status} className={input}>
        {PLACE_STATUS.map((s) => (
          <option key={s} value={s}>
            {tPlaces(`status.${s}`)}
          </option>
        ))}
      </select>
      <label htmlFor={`needs-${p.id}`} className={label}>
        {t("places.needs")}
      </label>
      <input
        id={`needs-${p.id}`}
        name="needs"
        defaultValue={p.needs ?? ""}
        maxLength={500}
        className={input}
      />
      <label htmlFor={`capacity-${p.id}`} className={label}>
        {t("places.capacity")}
      </label>
      <input
        id={`capacity-${p.id}`}
        name="capacity"
        inputMode="numeric"
        defaultValue={p.capacity ?? ""}
        className={input}
      />
      <label htmlFor={`verification-${p.id}`} className={label}>
        {t("places.verification")}
      </label>
      <select
        id={`verification-${p.id}`}
        name="verification"
        defaultValue={p.verification}
        className={input}
      >
        {PLACE_VERIFICATION.map((v) => (
          <option key={v} value={v}>
            {t(`places.verified.${v}`)}
          </option>
        ))}
      </select>
      <label htmlFor={`th-${p.id}`} className={label}>
        {t("places.nameTh")}
      </label>
      <input id={`th-${p.id}`} name="nameTh" defaultValue={p.nameTh} required className={input} />
      <label htmlFor={`en-${p.id}`} className={label}>
        {t("places.nameEn")}
      </label>
      <input id={`en-${p.id}`} name="nameEn" defaultValue={p.nameEn} className={input} />
      <button type="submit" className={buttonSecondary} data-save-place="true">
        {t("places.save")}
      </button>
    </form>
  );

  return (
    <div className="flex flex-col gap-5" data-safe-places={places.length}>
      <h1 className="text-h3 font-bold text-jaga-ink">{t("places.title")}</h1>
      <p className={hint}>{t("places.intro")}</p>
      {done && (
        <p role="status" className={notice}>
          {t(`places.done.${done}`)}
        </p>
      )}
      {error && (
        <p role="alert" className={errorNotice}>
          {t(`places.error.${error}`)}
        </p>
      )}

      <form method="get" className={card}>
        <label htmlFor="district" className={label}>
          {t("places.district")}
        </label>
        <select
          id="district"
          name="district"
          defaultValue={district?.code ?? ""}
          required
          className={input}
        >
          <option value="">{t("places.chooseDistrict")}</option>
          {areas.provinces.map((province) => (
            <optgroup key={province.code} label={name(province)}>
              {areas.districts
                .filter((d) => d.province_code === province.code)
                .map((d) => (
                  <option key={d.code} value={d.code}>
                    {name(d)}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
        <label htmlFor="only" className={label}>
          {t("places.show")}
        </label>
        <select id="only" name="only" defaultValue={only ?? ""} className={input}>
          <option value="">{t("places.showAll")}</option>
          {PLACE_VERIFICATION.map((v) => (
            <option key={v} value={v}>
              {t(`places.verified.${v}`)}
            </option>
          ))}
        </select>
        <button type="submit" className={buttonPrimary}>
          {t("places.open")}
        </button>
      </form>

      {district && (
        <p className="font-bold text-jaga-ink">
          {t("places.count", { count: places.length, name: name(district) })}
        </p>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        {places.map((p) => (
          <article
            key={p.id}
            id={`place-${p.id}`}
            className={`${card} scroll-mt-32`}
            data-place={p.id}
            data-verification={p.verification}
          >
            <p className="font-bold text-jaga-ink">
              {locale === "th" || !p.nameEn ? p.nameTh : p.nameEn}
              <span className={`block font-normal ${hint}`}>
                {tPlaces(`type.${p.type}`)} ·{" "}
                {(locale === "th" || !p.tambonEn ? p.tambonTh : p.tambonEn) ?? "–"}
              </span>
            </p>
            <p>
              {tPlaces(`status.${p.status}`)} · {t(`places.verified.${p.verification}`)}
              {p.capacity !== null && ` · ${t("places.holds", { count: p.capacity })}`}
            </p>
            {p.needs && <p>{p.needs}</p>}
            <p className={hint}>
              {p.score !== null && `${t("places.score", { score: p.score.toFixed(2) })} · `}
              {p.source && `${t("places.source", { source: p.source })} · `}
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lon}`}
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                {p.lat.toFixed(5)}, {p.lon.toFixed(5)}
              </a>
            </p>
            {p.flags.length > 0 && (
              <p className={hint}>{t("places.flags", { flags: p.flags.join(", ") })}</p>
            )}
            <p className={hint}>
              {t("places.updated")} <DualTime iso={p.updatedAt} />
            </p>
            <details>
              <summary className="flex min-h-tap cursor-pointer items-center font-medium underline">
                {t("places.edit")}
              </summary>
              {form(p)}
            </details>
          </article>
        ))}
      </div>

      <details className={card}>
        <summary className="flex min-h-tap cursor-pointer items-center font-bold underline">
          {t("places.add.summary")}
        </summary>
        <form action={addSafePlace.bind(null, locale)} className="flex flex-col gap-3 pt-2">
          <label htmlFor="add-th" className={label}>
            {t("places.nameTh")}
          </label>
          <input id="add-th" name="nameTh" required maxLength={200} className={input} />
          <label htmlFor="add-en" className={label}>
            {t("places.nameEn")}
          </label>
          <input id="add-en" name="nameEn" maxLength={200} className={input} />
          <label htmlFor="add-type" className={label}>
            {t("places.add.type")}
          </label>
          <select id="add-type" name="type" defaultValue="shelter" className={input}>
            {PLACE_TYPES.map((type) => (
              <option key={type} value={type}>
                {tPlaces(`type.${type}`)}
              </option>
            ))}
          </select>
          <label htmlFor="add-lat" className={label}>
            {t("places.add.lat")}
          </label>
          <input
            id="add-lat"
            name="lat"
            required
            inputMode="decimal"
            placeholder="6.54321"
            className={input}
          />
          <label htmlFor="add-lon" className={label}>
            {t("places.add.lon")}
          </label>
          <input
            id="add-lon"
            name="lon"
            required
            inputMode="decimal"
            placeholder="101.28123"
            className={input}
          />
          <p className={hint}>{t("places.add.positionHint")}</p>
          <label htmlFor="add-capacity" className={label}>
            {t("places.capacity")}
          </label>
          <input id="add-capacity" name="capacity" inputMode="numeric" className={input} />
          <label className={checkRow}>
            <input type="checkbox" name="verified" value="yes" className={checkBox} />
            <span>{t("places.add.verified")}</span>
          </label>
          <button type="submit" className={buttonPrimary} data-add-place="true">
            {t("places.add.send")}
          </button>
        </form>
      </details>
    </div>
  );
}
