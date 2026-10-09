"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import type { MyPlaces } from "@/lib/me";
import { useOnPhone, useStored } from "@/lib/phone-store";
import { useNow } from "@/lib/use-public";
import { areaPlaceDetail, useWeather, useWeatherPlace, weatherPins } from "@/lib/use-weather";
import { WeatherMaps } from "./WeatherMaps";
import type { WeatherPlace } from "@/lib/weather";
import { WeatherView } from "./WeatherView";

/**
 * The live weather page: the place comes from the phone (a weather choice, or the home and area
 * the person already chose on the home screen), the forecast from /api/public/weather.
 *
 * Like the home screen, the page itself is the same HTML for everyone and everything personal is
 * put together here, on the phone.
 */
export function WeatherScreen() {
  const ready = useOnPhone();
  const locale = useLocale();
  const me = useStored<MyPlaces>("me");
  const { place, fromArea, setPlace } = useWeatherPlace(me, locale);
  const { weather, fetchedAt, failed, refresh } = useWeather(place);
  const now = useNow();
  const t = useTranslations("weather");
  const [picking, setPicking] = useState(false);

  function choose(chosen: WeatherPlace) {
    setPlace(chosen);
    setPicking(false);
  }

  return (
    <WeatherView
      ready={ready}
      place={place}
      detail={fromArea ? areaPlaceDetail(fromArea, locale) : null}
      weather={weather}
      fetchedAt={fetchedAt}
      failed={failed}
      now={now}
      picking={picking}
      onPick={() => setPicking(true)}
      onChoose={choose}
      onCancelPick={() => setPicking(false)}
      onRetry={refresh}
      maps={
        <WeatherMaps
          place={place}
          places={weatherPins(place, me, locale, { home: t("map.home") })}
        />
      }
    />
  );
}
