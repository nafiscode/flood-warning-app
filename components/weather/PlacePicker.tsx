"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { PinIcon } from "@/components/icons";
import { coarse, pickName, type Located } from "@/lib/area";
import { buttonPrimary, buttonSecondary, errorNotice, hint, input, label } from "@/lib/ui";
import { placeDetail, type WeatherPlace } from "@/lib/weather";

type Props = {
  onChoose: (place: WeatherPlace) => void;
  onCancel?: () => void;
};

type Problem = "gps" | "search" | "none";

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(String(response.status));
  return (await response.json()) as T;
}

/**
 * Choosing the place the weather is for: this phone's position, or a name typed in. Nobody has
 * to sign in and nothing is stored on the server; the choice stays on the phone.
 *
 * The position is turned into a name by Jaga's own tambon lookup (/api/geo/locate), not by an
 * outside service, and only a rounded point (about 100 m) is kept.
 */
export function PlacePicker({ onChoose, onCancel }: Props) {
  const t = useTranslations("weather.place");
  const locale = useLocale();
  const [locating, setLocating] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [found, setFound] = useState<WeatherPlace[] | null>(null);

  function locate() {
    setProblem(null);
    if (!("geolocation" in navigator)) {
      setProblem("gps");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const lat = Number(coarse(coords.latitude));
        const lon = Number(coarse(coords.longitude));
        getJson<Located>(`/api/geo/locate?lat=${lat}&lon=${lon}`)
          .then((located) => {
            // Inside the four provinces the tambon gives the name; elsewhere there is none to
            // give, and the weather is shown for "your location" all the same.
            const named =
              located.kind === "tambon"
                ? {
                    name: pickName(locale, located.area.nameTh, located.area.nameEn),
                    area: pickName(locale, located.area.provinceTh, located.area.provinceEn),
                  }
                : { name: t("yourLocation"), area: null };
            onChoose({ ...named, country: null, countryCode: null, lat, lon, from: "gps" });
          })
          .catch(() =>
            onChoose({
              name: t("yourLocation"),
              area: null,
              country: null,
              countryCode: null,
              lat,
              lon,
              from: "gps",
            }),
          )
          .finally(() => setLocating(false));
      },
      () => {
        setLocating(false);
        setProblem("gps");
      },
      { enableHighAccuracy: false, timeout: 20_000, maximumAge: 300_000 },
    );
  }

  function search(event: React.FormEvent) {
    event.preventDefault();
    const name = query.trim();
    if (name.length < 2) return;
    setProblem(null);
    setFound(null);
    setSearching(true);
    getJson<{ places: WeatherPlace[] }>(
      `/api/public/geocode?q=${encodeURIComponent(name)}&lang=${locale}`,
    )
      .then(({ places }) => {
        if (places.length === 0) setProblem("none");
        else setFound(places);
      })
      .catch(() => setProblem("search"))
      .finally(() => setSearching(false));
  }

  return (
    <div className="flex flex-col gap-3" data-weather-picker="true">
      <button type="button" onClick={locate} disabled={locating} className={buttonPrimary}>
        {locating ? t("locating") : t("useGps")}
      </button>
      <form onSubmit={search} className="flex flex-col gap-2">
        <label htmlFor="weather-place" className={label}>
          {t("searchLabel")}
        </label>
        <input
          id="weather-place"
          name="q"
          type="search"
          autoComplete="off"
          enterKeyHint="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("searchPlaceholder")}
          className={input}
        />
        <button
          type="submit"
          disabled={searching || query.trim().length < 2}
          className={buttonSecondary}
        >
          {searching ? t("searching") : t("search")}
        </button>
      </form>
      {problem && (
        <p role="alert" className={errorNotice}>
          {t(problem === "gps" ? "gpsFailed" : problem === "none" ? "noResults" : "searchFailed")}
        </p>
      )}
      {found && (
        <ul className="flex flex-col divide-y divide-jaga-line">
          {found.map((place) => (
            <li key={`${place.lat},${place.lon},${place.name}`}>
              <button
                type="button"
                onClick={() => onChoose(place)}
                className="flex min-h-tap w-full flex-col items-start justify-center gap-0.5 py-2 text-start"
              >
                <span className="inline-flex items-center gap-2 font-medium">
                  <PinIcon size={20} className="text-jaga-teal-ink" />
                  {place.name}
                </span>
                {placeDetail(place) && <span className={hint}>{placeDetail(place)}</span>}
              </button>
            </li>
          ))}
        </ul>
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
