"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { ProvinceSelect } from "@/components/ProvinceSelect";
import {
  entryToArea,
  pickName,
  type Area,
  type AreaDirectory,
  type Located,
  type TambonEntry,
} from "@/lib/area";
import { buttonPrimary, buttonSecondary, errorNotice, hint, input, label } from "@/lib/ui";

type Props = {
  onChoose: (area: Area) => void;
  /** Shown when the chooser was opened to change an area that is already chosen. */
  onCancel?: () => void;
};

type Problem =
  { kind: "gps" | "locate" | "list" | "outside" } | { kind: "notCovered"; province: string };

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(String(response.status));
  return (await response.json()) as T;
}

/**
 * Choosing the area the home screen is about: from the phone's position, or from a list of
 * province, district and tambon (when GPS fails or the person looks from elsewhere). Nobody has
 * to sign in for this. The choice is handed to the caller, which keeps it on the phone only; the
 * position is sent once to find the tambon and is not stored on the server.
 */
export function AreaChooser({ onChoose, onCancel }: Props) {
  const t = useTranslations("home.area");
  const locale = useLocale();
  const [locating, setLocating] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [directory, setDirectory] = useState<AreaDirectory | "loading" | null>(null);
  const [province, setProvince] = useState("");
  const [district, setDistrict] = useState("");
  const [tambon, setTambon] = useState("");

  function locate() {
    setProblem(null);
    if (!("geolocation" in navigator)) {
      setProblem({ kind: "gps" });
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        getJson<Located>(`/api/geo/locate?lat=${latitude.toFixed(6)}&lon=${longitude.toFixed(6)}`)
          .then((found) => {
            if (found.kind === "tambon") onChoose(found.area);
            else if (found.kind === "notCovered") {
              const p = found.province;
              setProblem({ kind: "notCovered", province: pickName(locale, p.nameTh, p.nameEn) });
            } else setProblem({ kind: "outside" });
          })
          .catch(() => setProblem({ kind: "locate" }))
          .finally(() => setLocating(false));
      },
      () => {
        setLocating(false);
        setProblem({ kind: "gps" });
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 60_000 },
    );
  }

  function openList() {
    setProblem(null);
    setDirectory("loading");
    getJson<AreaDirectory>("/api/geo/areas").then(setDirectory, () => {
      setDirectory(null);
      setProblem({ kind: "list" });
    });
  }

  const loaded = directory && directory !== "loading" ? directory : null;
  const inProvince = loaded?.tambons.filter((x) => x.provinceCode === province) ?? [];
  const districts = [...new Map(inProvince.map((x) => [x.districtCode, x])).values()];
  const tambons = inProvince.filter((x) => x.districtCode === district);
  const chosen: TambonEntry | undefined = tambons.find((x) => x.code === tambon);

  function confirm() {
    const p = loaded?.provinces.find((x) => x.code === province);
    if (chosen && p) onChoose(entryToArea(chosen, p, "list"));
  }

  return (
    <div className="flex flex-col gap-3" data-area-chooser="true">
      <button type="button" onClick={locate} disabled={locating} className={buttonPrimary}>
        {locating ? t("locating") : t("useGps")}
      </button>
      {!loaded && (
        <button
          type="button"
          onClick={openList}
          disabled={directory === "loading"}
          className={buttonSecondary}
        >
          {t("fromList")}
        </button>
      )}
      {problem && (
        <p role="alert" className={errorNotice}>
          {problem.kind === "notCovered"
            ? t("notCovered", { province: problem.province })
            : t(
                problem.kind === "gps"
                  ? "gpsFailed"
                  : problem.kind === "locate"
                    ? "locateFailed"
                    : problem.kind === "list"
                      ? "listFailed"
                      : "outside",
              )}
        </p>
      )}
      {loaded && (
        <div className="flex flex-col gap-3">
          <ProvinceSelect
            id="area-province"
            provinces={loaded.provinces}
            value={province}
            onChange={(code) => {
              setProvince(code);
              setDistrict("");
              setTambon("");
            }}
            emptyLabel={t("select")}
          />
          <div className="flex flex-col gap-1">
            <label htmlFor="area-district" className={label}>
              {t("district")}
            </label>
            <select
              id="area-district"
              value={district}
              disabled={province === ""}
              onChange={(event) => {
                setDistrict(event.target.value);
                setTambon("");
              }}
              className={input}
            >
              <option value="">{t("select")}</option>
              {districts.map((x) => (
                <option key={x.districtCode} value={x.districtCode}>
                  {pickName(locale, x.districtTh, x.districtEn)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="area-tambon" className={label}>
              {t("tambon")}
            </label>
            <select
              id="area-tambon"
              value={tambon}
              disabled={district === ""}
              onChange={(event) => setTambon(event.target.value)}
              className={input}
            >
              <option value="">{t("select")}</option>
              {tambons.map((x) => (
                <option key={x.code} value={x.code}>
                  {pickName(locale, x.nameTh, x.nameEn)}
                </option>
              ))}
            </select>
          </div>
          <button type="button" onClick={confirm} disabled={!chosen} className={buttonPrimary}>
            {t("use")}
          </button>
        </div>
      )}
      {onCancel && (
        <button type="button" onClick={onCancel} className="min-h-tap self-start underline">
          {t("cancel")}
        </button>
      )}
      <p className={hint}>{t("privacy")}</p>
    </div>
  );
}
