import { useLocale, useTranslations } from "next-intl";
import { pickName, type Province } from "@/lib/area";
import { hint, input, label } from "@/lib/ui";

type Props = {
  id: string;
  provinces: Province[];
  /** A province code, or "" for nothing chosen / all four. */
  value: string;
  onChange: (code: string) => void;
  /** Text of the empty choice: "All four provinces" on the map, "Choose…" in a form. */
  emptyLabel: string;
};

/**
 * The province selector, driven by provinces.status (spec section 2). The four covered provinces
 * can be chosen. The other 73 are listed but disabled, with the standing note that Jaga doesn't
 * cover them yet and the numbers to call: a province Jaga doesn't cover never gets a status, a
 * color or a "normal" (safety rule 10).
 */
export function ProvinceSelect({ id, provinces, value, onChange, emptyLabel }: Props) {
  const t = useTranslations("map.province");
  const locale = useLocale();
  const name = (p: Province) => pickName(locale, p.nameTh, p.nameEn);
  const active = provinces.filter((p) => p.status === "active");
  const comingSoon = provinces.filter((p) => p.status !== "active");
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className={label}>
        {t("label")}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={input}
      >
        <option value="">{emptyLabel}</option>
        {active.map((p) => (
          <option key={p.code} value={p.code}>
            {name(p)}
          </option>
        ))}
        {comingSoon.length > 0 && (
          <optgroup label={t("comingSoon")}>
            {comingSoon.map((p) => (
              <option key={p.code} value={p.code} disabled data-coming-soon="true">
                {name(p)}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      <p className={hint} data-not-covered-note="true">
        {t("othersNote")}
      </p>
    </div>
  );
}
