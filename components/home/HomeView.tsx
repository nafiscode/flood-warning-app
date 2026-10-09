"use client";

import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { MapIcon, PhoneIcon, WaveIcon } from "@/components/icons";
import { SafePlaces } from "@/components/places/SafePlaces";
import { SOSButton } from "@/components/sos/SOSButton";
import { getPathname, Link } from "@/i18n/navigation";
import { areaName, type Area } from "@/lib/area";
import type { MyPlaces } from "@/lib/me";
import type { NearbyPlaces } from "@/lib/places";
import { areaStatus, severity, type PublicStatus } from "@/lib/public-status";
import { BANGKOK_DATE_TIME } from "@/lib/time";
import { buttonSecondary, card, hint, notice } from "@/lib/ui";
import type { LoadState } from "@/lib/use-public";
import { DamNotice } from "@/components/map/Dam";
import { onPath, type Dam } from "@/lib/dam";
import { AlertHero, type HeroStatus } from "./AlertHero";
import { AreaChooser } from "./AreaChooser";
import { Checklist } from "./Checklist";
import { WatchedPlaces, WorseBanner, type WatchedStatus } from "./WatchedPlaces";

/**
 * Green "Normal" is shown only from a status checked this recently. An older copy (phone
 * offline for hours) could hide a new alert, so it falls back to "couldn't load".
 */
export const NORMAL_NEEDS_CHECK_WITHIN_MS = 30 * 60_000;

export type HomeViewProps = {
  /** False while this is still the server's HTML: nothing about the person is known yet. */
  ready: boolean;
  status: PublicStatus | null;
  /** When the status was last received, and whether the latest try failed. */
  checkedAt: number | null;
  failed: boolean;
  /** The area chosen on this phone; a home saved in the account comes first. */
  area: Area | null;
  me: MyPlaces | null;
  places: NearbyPlaces | null;
  placesState: LoadState;
  now: number;
  onChooseArea: (area: Area) => void;
  onRetry: () => void;
  projectLine: string | null;
  /** The dams, for the quiet dam notice. Null while loading or if it can't be had. */
  dams?: Dam[] | null;
  userAgent?: string;
};

/** What a tambon shows, never green from a copy that is too old to trust. */
export function heroStatusFor(
  status: PublicStatus | null,
  tambon: string,
  fresh: boolean,
): HeroStatus {
  if (!status) return { kind: "unknown" };
  const s = areaStatus(status, tambon);
  return s.kind === "normal" && !fresh ? { kind: "unknown" } : s;
}

/**
 * The home screen (spec 4.1), drawn from what it is given: no map, no fetching. The container
 * (HomeScreen) feeds it live data; the review page feeds it made-up examples.
 * Order: a watched place that is worse than home, the hero, the checklist, SOS and Report,
 * watched places, safe places. At Evacuate the SOS button moves directly under the hero
 * (decision 2026-09-29).
 */
export function HomeView(props: HomeViewProps) {
  const { ready, status, checkedAt, failed, me, places, placesState, now } = props;
  const t = useTranslations("home");
  const locale = useLocale();
  const format = useFormatter();
  const [choosing, setChoosing] = useState(false);

  const home = me?.signedIn && me.home ? me.home : props.area;
  const fresh = checkedAt !== null && now - checkedAt < NORMAL_NEEDS_CHECK_WITHIN_MS;
  const loading = !ready || (!status && !failed);
  const hero: HeroStatus | null = home && !loading ? heroStatusFor(status, home.code, fresh) : null;

  const watched: WatchedStatus[] = (me?.signedIn ? me.places : []).map((place) => ({
    place,
    status: place.area
      ? heroStatusFor(status, place.area.code, fresh)
      : ({ kind: "outside" } as const),
  }));
  const rank = (s: WatchedStatus["status"]) => (s.kind === "alert" ? severity(s) : 0);
  const homeRank = hero ? rank(hero) : 0;
  const worse = watched
    .filter((w) => rank(w.status) > homeRank)
    .sort((a, b) => rank(b.status) - rank(a.status));

  /*
   * The dam's quiet notice goes only to someone whose own area or watched place is on the river
   * below the dam (spec section 15). The names come from their own places, so the notice says
   * "Bana" rather than a tambon code; a place with no area is skipped, as it is everywhere else.
   */
  const myAreas = [home, ...watched.map((w) => w.place.area)].filter((a): a is Area => !!a);
  const damsOnMyPath = (props.dams ?? [])
    .map((dam) => ({
      dam,
      hit: onPath(
        dam,
        myAreas.map((a) => a.code),
      ),
    }))
    .filter((x): x is { dam: Dam; hit: NonNullable<ReturnType<typeof onPath>> } => x.hit !== null);
  const areaNameOf = (code: string) => {
    const found = myAreas.find((a) => a.code === code);
    return found ? areaName(locale, found) : code;
  };

  const evacuate = hero?.kind === "alert" && hero.alert.level === "evacuate";
  const sos = <SOSButton href={getPathname({ href: "/sos", locale })} />;
  const checklist =
    hero?.kind === "alert" ? (
      <Checklist level={hero.alert.level} listId={hero.alert.id} />
    ) : hero?.kind === "normal" ? (
      <Checklist level="normal" listId="normal" />
    ) : null;

  const areaLine = home && (
    <div className="flex flex-wrap items-start justify-between gap-x-3">
      <p>
        <span className={`block ${hint}`}>
          {home.from === "account" ? t("area.fromAccount") : t("area.label")}
        </span>
        <span className="font-bold" data-area={home.code}>
          {areaName(locale, home)}
        </span>
      </p>
      {home.from === "account" ? (
        <Link
          href="/account/setup"
          prefetch={false}
          className="inline-flex min-h-tap items-center underline"
        >
          {t("area.change")}
        </Link>
      ) : (
        <button type="button" onClick={() => setChoosing(true)} className="min-h-tap underline">
          {t("area.change")}
        </button>
      )}
    </div>
  );

  return (
    /*
     * One column on a phone, two on a laptop (the owner asked for the window to be used, 8 Oct).
     * The order on a phone is exactly as before, because the left column is written first and
     * the columns stack: what is happening on the left, what to do on the right. At Evacuate the
     * SOS button stays directly under the hero (decision 2026-09-29), in the left column.
     */
    <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:items-start lg:gap-8">
      <h1 className="sr-only">{t("title")}</h1>

      <div className="flex flex-col gap-5">
        {worse.map((item) => (
          <WorseBanner key={item.place.id} item={item} now={now} />
        ))}

        {/*
         * The quiet dam notice, for someone whose own area or watched place is on the river
         * below the dam (spec section 15). It is not an alert and carries no alert colour: the
         * hero below it is still what says what level their tambon is at.
         */}
        {damsOnMyPath.map(({ dam, hit }) => (
          <DamNotice
            key={dam.code}
            dam={dam}
            via={hit.via}
            tambonName={areaNameOf(hit.code)}
            now={now}
          />
        ))}

        {loading ? (
          <section data-hero="loading" className={card}>
            <p>{t("loading")}</p>
          </section>
        ) : !home || choosing ? (
          <section data-hero="choose" className={card}>
            <h2 className="text-h3 font-bold text-jaga-ink">{t("area.chooseTitle")}</h2>
            <p>{t("area.chooseBody")}</p>
            <AreaChooser
              onChoose={(area) => {
                setChoosing(false);
                props.onChooseArea(area);
              }}
              onCancel={home ? () => setChoosing(false) : undefined}
            />
          </section>
        ) : (
          hero && <AlertHero status={hero} area={areaLine} now={now} onRetry={props.onRetry} />
        )}

        {!loading && status && !status.inService && hero?.kind !== "notInService" && (
          // Said on every home screen before launch, also beside a real alert or the chooser.
          <p className={notice} data-not-in-service="true">
            <span className="block font-bold">{t("notInService.title")}</span>
            {t("notInService.body")}
          </p>
        )}

        {checkedAt !== null && !loading && (
          <p
            className={failed ? notice : hint}
            role={failed ? "status" : undefined}
            data-checked={failed ? "old" : "ok"}
          >
            {t(failed ? "status.offline" : "status.checked", {
              time: format.dateTime(new Date(checkedAt), BANGKOK_DATE_TIME),
            })}
          </p>
        )}

        {evacuate && sos}
        {!choosing && checklist}
      </div>

      <div className="flex flex-col gap-5">
        {!evacuate && sos}

        <Link
          href="/report"
          prefetch={false}
          className={`${buttonSecondary} min-h-16 gap-3 text-h3 font-bold`}
        >
          <WaveIcon size={30} />
          {t("report")}
        </Link>

        {props.projectLine && (
          <a href={`tel:${props.projectLine}`} className={`${buttonSecondary} gap-2`}>
            <PhoneIcon size={22} />
            {t("projectLine")} {props.projectLine}
          </a>
        )}

        <WatchedPlaces items={watched} now={now} />
        {me?.signedIn && (
          <Link
            href="/account/places"
            prefetch={false}
            data-manage-places="true"
            className="inline-flex min-h-tap items-center underline"
          >
            {t(watched.length > 0 ? "watched.manage" : "watched.addFirst")}
          </Link>
        )}

        {home && !loading && (
          <SafePlaces places={places} state={placesState} userAgent={props.userAgent} />
        )}

        <Link href="/map" prefetch={false} className={`${buttonSecondary} gap-2`}>
          <MapIcon size={22} />
          {t("mapLink")}
        </Link>
      </div>
    </div>
  );
}
