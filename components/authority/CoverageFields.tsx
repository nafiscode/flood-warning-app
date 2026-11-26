import { getTranslations } from "next-intl/server";
import { CoverageMap } from "@/components/authority/CoverageMap";
import { createClient } from "@/lib/supabase/server";
import { card, checkBox, checkRow, hint, label } from "@/lib/ui";

type Area = { code: string; name_th: string; name_en: string };
type District = Area & { province_code: string };
type Tambon = Area & { district_code: string };

/**
 * What is ticked, as "province:94", "district:9401", "tambon:940101". Registration ticks nothing;
 * an admin editing a team starts from what the team has now.
 */
export type CoverageSelection = ReadonlySet<string>;

/**
 * The area picker used by the registration form and the admin's team editor: a list of provinces,
 * districts and tambons with a map beside it. Plain checkboxes named `province`, `district` and
 * `tambon`, so both forms read them the same way and the database expands them to tambons. The
 * checkboxes stay the single source of truth: the map only mirrors them (see CoverageMap).
 */
export async function CoverageFields({
  locale,
  selected,
}: {
  locale: string;
  selected?: CoverageSelection;
}) {
  const t = await getTranslations("authorityRegister");
  const supabase = await createClient();
  const [{ data: provinces }, { data: districts }, { data: tambons }] = await Promise.all([
    supabase
      .from("provinces")
      .select("code, name_th, name_en")
      .eq("status", "active")
      .order("code"),
    supabase.from("districts").select("code, province_code, name_th, name_en").order("code"),
    supabase
      .from("tambons")
      .select("code, district_code, name_th, name_en")
      .order("code")
      .limit(2000),
  ]);
  const name = (area: Area) => (locale === "th" ? area.name_th : area.name_en);
  const districtsOf = (province: string) =>
    ((districts ?? []) as District[]).filter((d) => d.province_code === province);
  const tambonsOf = (district: string) =>
    ((tambons ?? []) as Tambon[]).filter((tb) => tb.district_code === district);
  const on = (level: string, code: string) => selected?.has(`${level}:${code}`) ?? false;
  // A group that holds something ticked starts open, so the admin sees what the team has.
  const anyIn = (level: string, prefix: string) =>
    [...(selected ?? [])].some((s) => s.startsWith(`${level}:${prefix}`));

  return (
    <fieldset className={card}>
      <legend className={`${label} float-start`}>{t("coverage.label")}</legend>
      <p className={`clear-both ${hint}`}>{t("coverage.hint")}</p>
      <CoverageMap
        text={{
          useMap: t("coverage.useMap"),
          hideMap: t("coverage.hideMap"),
          mapHint: t("coverage.mapHint"),
          count: t("coverage.mapCount", { count: "{n}" }),
          locked: t("coverage.mapLocked"),
          mapFailed: t("coverage.mapFailed"),
        }}
      />
      {((provinces ?? []) as Area[]).map((province) => (
        <div key={province.code} className="flex flex-col border-t border-jaga-line pt-2">
          <label className={checkRow}>
            <input
              type="checkbox"
              name="province"
              value={province.code}
              defaultChecked={on("province", province.code)}
              className={checkBox}
            />
            <span className="font-bold">
              {t("coverage.wholeProvince", { name: name(province) })}
            </span>
          </label>
          <details
            open={anyIn("district", province.code) || anyIn("tambon", province.code) || undefined}
          >
            <summary className="min-h-tap cursor-pointer py-2 text-jaga-teal-ink underline">
              {t("coverage.chooseDistricts", { name: name(province) })}
            </summary>
            <div className="flex flex-col ps-4">
              {districtsOf(province.code).map((district) => (
                <div key={district.code}>
                  <label className={checkRow}>
                    <input
                      type="checkbox"
                      name="district"
                      value={district.code}
                      defaultChecked={on("district", district.code)}
                      className={checkBox}
                    />
                    <span>{t("coverage.wholeDistrict", { name: name(district) })}</span>
                  </label>
                  <details open={anyIn("tambon", district.code) || undefined}>
                    <summary className="min-h-tap cursor-pointer py-2 text-small text-jaga-teal-ink underline">
                      {t("coverage.chooseTambons", { name: name(district) })}
                    </summary>
                    <div className="flex flex-col ps-4">
                      {tambonsOf(district.code).map((tambon) => (
                        <label key={tambon.code} className={checkRow}>
                          <input
                            type="checkbox"
                            name="tambon"
                            value={tambon.code}
                            defaultChecked={on("tambon", tambon.code)}
                            className={checkBox}
                          />
                          <span>{name(tambon)}</span>
                        </label>
                      ))}
                    </div>
                  </details>
                </div>
              ))}
            </div>
          </details>
        </div>
      ))}
      {(provinces ?? []).length === 0 && <p role="alert">{t("coverage.unavailable")}</p>}
    </fieldset>
  );
}
