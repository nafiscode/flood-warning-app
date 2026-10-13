import { getTranslations } from "next-intl/server";
import type { AlertAreas } from "@/lib/admin-alerts";
import { checkBox, checkRow } from "@/lib/ui";

/**
 * Provinces, their districts and their tambons as nested tick boxes named `province`,
 * `district` and `tambon` - the names lib/alert-console.ts `areaChoice` reads. Plain HTML, so
 * choosing an area works before any script has loaded.
 */
export async function AreaTree({ areas, locale }: { areas: AlertAreas; locale: string }) {
  const t = await getTranslations("alertConsole.form.area");
  const name = (area: { name_th: string; name_en: string }) =>
    locale === "th" || !area.name_en ? area.name_th : area.name_en;
  return (
    <>
      {areas.provinces.map((province) => (
        <div key={province.code} className="flex flex-col border-t border-jaga-line pt-2">
          <label className={checkRow}>
            <input type="checkbox" name="province" value={province.code} className={checkBox} />
            <span className="font-bold">{t("wholeProvince", { name: name(province) })}</span>
          </label>
          <details>
            <summary className="min-h-tap cursor-pointer py-2 text-jaga-teal-ink underline">
              {t("chooseDistricts", { name: name(province) })}
            </summary>
            <div className="flex flex-col ps-4">
              {areas.districts
                .filter((d) => d.province_code === province.code)
                .map((district) => (
                  <div key={district.code}>
                    <label className={checkRow}>
                      <input
                        type="checkbox"
                        name="district"
                        value={district.code}
                        className={checkBox}
                      />
                      <span>{t("wholeDistrict", { name: name(district) })}</span>
                    </label>
                    <details>
                      <summary className="min-h-tap cursor-pointer py-2 text-small text-jaga-teal-ink underline">
                        {t("chooseTambons", { name: name(district) })}
                      </summary>
                      <div className="flex flex-col ps-4">
                        {areas.tambons
                          .filter((tb) => tb.district_code === district.code)
                          .map((tambon) => (
                            <label key={tambon.code} className={checkRow}>
                              <input
                                type="checkbox"
                                name="tambon"
                                value={tambon.code}
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
      {areas.provinces.length === 0 && <p role="alert">{t("unavailable")}</p>}
    </>
  );
}
