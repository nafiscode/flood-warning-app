"use client";

import { useFormatter, useLocale, useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";
import {
  AddSquareIcon,
  EditIcon,
  ParcelIcon,
  PhoneIcon,
  PinIcon,
  WaveIcon,
} from "@/components/icons";
import { MapFeatureTiles } from "@/components/map/MapFeatures";
import { SignInHint } from "@/components/account/SignInOffer";
import { SafePlaces } from "@/components/places/SafePlaces";
import { ReportsNear } from "@/components/reports/ReportsNear";
import { SOSButton } from "@/components/sos/SOSButton";
import { getPathname, Link } from "@/i18n/navigation";
import { areaName, tambonName, type Area } from "@/lib/area";
import { reportsNearMe, type TambonReports } from "@/lib/flood-reports";
import type { MyPlaces } from "@/lib/me";
import type { NearbyPlaces } from "@/lib/places";
import { areaStatus, damReleaseAt, severity, type PublicStatus } from "@/lib/public-status";
import { BANGKOK_DATE_TIME } from "@/lib/time";
import { buttonSecondary, card, hint, notice } from "@/lib/ui";
import type { LoadState } from "@/lib/use-public";
import { DamFigureCard } from "@/components/dam/DamFigureCard";
import { DamNotice } from "@/components/map/Dam";
import { attention, damForFigure, onPath, type Dam } from "@/lib/dam";
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
  /** The list shown is the one kept on the phone, because this visit could not refresh it (A9). */
  placesFromPhone?: boolean;
  placesSavedAt?: number | null;
  now: number;
  onChooseArea: (area: Area) => void;
  onRetry: () => void;
  projectLine: string | null;
  /** The dams, for the quiet dam notice. Null while loading or if it can't be had. */
  dams?: Dam[] | null;
  userAgent?: string;
  /** Tambons with a standing flood report from residents. Null while loading or unavailable. */
  reports?: TambonReports[] | null;
  /** The person's own standing reports, with the button that ends one. */
  myReports?: ReactNode;
  /** "Turn on notifications": drawn while there is something for the person to do about it. */
  push?: ReactNode;
  /**
   * The "put Jaga on your home screen" card. First in the places column, and not at Warning or
   * Evacuate.
   */
  install?: ReactNode;
  /** One line pointing at that card, high on the page. Phones and tablets only; see InstallLine. */
  installLine?: ReactNode;
  /** "Share Jaga". Drawn last, after the dam's card, and not at Warning or Evacuate either. */
  share?: ReactNode;
  /**
   * The long-term flood risk of the person's own tambon (the owner, 15 Oct): under the hero on an
   * ordinary day, after the checklist when somewhere of theirs is at Warning or Evacuate.
   */
  tambonRisk?: (code: string, name: string) => ReactNode;
  /**
   * "What the monitoring shows now" (the owner, 17 Oct): the live measurements under the hero on
   * an ordinary day, and **after the action checklist** at Warning or Evacuate, so that nothing
   * ever sits between a person and what to do. It is not a level and carries no alert colour:
   * the hero above it stays the one place that says what level is in force.
   */
  monitoringNow?: (args: {
    myCodes: string[];
    myPoint: { lat: number; lon: number } | null;
    dam: Dam | null;
    onMyRiver: boolean;
    damTambon: string | null;
  }) => ReactNode;
  /**
   * The way in for a rescue unit and the resident's own way in, side by side under the hero (the
   * owner, 18 Oct: ten people had signed in and no unit had registered, because the home screen
   * never said a unit could). Never at Warning or Evacuate.
   */
  joinJaga?: ReactNode;
  /** The unit's half of joinJaga, drawn under "Follow my requests" on the laptop console only. */
  unitCard?: ReactNode;
  /** "New to Jaga?" into What Jaga can do: the first visits only, never at Warning or Evacuate. */
  welcome?: ReactNode;
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
  const tSos = useTranslations("sos");
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
  const myCodes = myAreas.map((a) => a.code);
  /*
   * The quiet notice goes to someone on the river below the dam, and **only while the dam has
   * something to say**: `attention` is "none" on an ordinary day, and the notice draws nothing.
   */
  const damsOnMyPath = (props.dams ?? [])
    .map((dam) => ({ dam, hit: onPath(dam, myCodes) }))
    .filter(
      (x): x is { dam: Dam; hit: NonNullable<ReturnType<typeof onPath>> } =>
        x.hit !== null && attention(x.dam.signal) !== "none",
    );
  /*
   * The dam's figure goes wider than that notice (the owner, 12 Oct): it reaches the provinces
   * each dam's own water can reach - see `showsDamFigure`. It is drawn for everyone the notice is
   * not drawn for, **including someone on the river on a quiet day**: without that they would see
   * less of their own dam than a neighbour a province away (seen in a browser, 13 Oct).
   *
   * **One dam, not six** (the owner, 14 Oct, when five more reservoirs arrived): the river they
   * are on, else the largest that can reach them. The rest are a tap away on the map.
   */
  const pickedDam = damForFigure(
    (props.dams ?? []).filter((dam) => !damsOnMyPath.some((x) => x.dam.code === dam.code)),
    myCodes,
  );
  const damsNearMe = pickedDam ? [{ dam: pickedDam, hit: onPath(pickedDam, myCodes) }] : [];
  const areaNameOf = (code: string) => {
    const found = myAreas.find((a) => a.code === code);
    return found ? areaName(locale, found) : code;
  };

  const evacuate = hero?.kind === "alert" && hero.alert.level === "evacuate";
  // An invitation to install has no place on the screen while somebody's tambon is in danger.
  const tense = [hero, ...watched.map((w) => w.status)].some(
    (s) => s?.kind === "alert" && (s.alert.level === "warning" || s.alert.level === "evacuate"),
  );
  const sos = <SOSButton href={getPathname({ href: "/sos", locale })} />;
  /*
   * The dam's drawing and figures. On a laptop the owner wants it in the left-hand column, under
   * the flood-risk summary (16 Oct); on a phone it stays at the foot of the page, which is where
   * the owner put it on 15 Oct because it is background, not news.
   *
   * The two places are in different columns of the grid, and a grid cannot move an item from one
   * column's run of blocks into another's, so it is written in both and each width shows one.
   * `display: none` keeps the other out of the page for a screen reader as well as for the eye,
   * so nobody meets it twice. The copy at the foot of the page is written with no wrapper around
   * it, so that the page a phone builds is the same one it built before, element for element -
   * the laptop's copy is the one in a wrapper, and app/globals.css hides the other.
   */
  const damCards = damsNearMe.map(({ dam, hit }) => (
    <DamFigureCard
      key={dam.code}
      dam={dam}
      tambonCode={hit?.code ?? null}
      tambonName={hit ? areaNameOf(hit.code) : null}
    />
  ));
  const riskCard =
    !loading && !choosing && home && props.tambonRisk
      ? props.tambonRisk(home.code, tambonName(locale, home))
      : null;
  /*
   * The dam the section speaks about is the one this screen has already picked: the river they
   * are on when there is a notice for it, else the figure's dam. Picked here, never in the lib.
   */
  const monitoringDam = damsOnMyPath[0] ?? damsNearMe[0] ?? null;
  const monitoring =
    !loading && !choosing && home && props.monitoringNow
      ? props.monitoringNow({
          myCodes,
          myPoint: home ? { lat: home.lat, lon: home.lon } : null,
          dam: monitoringDam?.dam ?? null,
          onMyRiver: damsOnMyPath.length > 0,
          damTambon: monitoringDam?.hit ? areaNameOf(monitoringDam.hit.code) : null,
        })
      : null;
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
          className="inline-flex min-h-tap items-center gap-1.5 underline"
        >
          <EditIcon size={20} />
          {t("area.change")}
        </Link>
      ) : (
        <button
          type="button"
          onClick={() => setChoosing(true)}
          className="inline-flex min-h-tap items-center gap-1.5 underline"
        >
          <EditIcon size={20} />
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
    <div
      data-console-page="home"
      className="flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:items-start lg:gap-x-8 lg:gap-y-5"
    >
      <h1 className="sr-only">{t("title")}</h1>

      <div data-home-col="now" className="flex flex-col gap-5 lg:col-start-1 lg:row-span-2">
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
            tambonCode={hit.code}
            tambonName={areaNameOf(hit.code)}
            now={now}
            gatesOpenAt={damReleaseAt(props.status, dam.code, hit.code)}
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
          hero && (
            <AlertHero
              status={hero}
              area={areaLine}
              areaName={home ? tambonName(locale, home) : undefined}
              now={now}
              onRetry={props.onRetry}
            />
          )
        )}

        {/*
         * Under the hero and nowhere else (the owner, 18 Oct): what the tambon's level is stays
         * the first thing on the screen, and how to join Jaga is the second. It is in the static
         * HTML on purpose - the people it is for arrive from a link, often on a slow phone - and
         * it goes once a place of theirs is at Warning or Evacuate.
         */}
        {!tense && props.joinJaga}

        {/*
         * And one line saying Jaga can be installed, because on a phone the card itself is 56%
         * down the page (measured, 19 Oct) - the three columns stack and it is in the last one.
         */}
        {!loading && !choosing && !tense && props.installLine}

        {/*
         * What residents nearby have reported (the owner, 13 Oct). Under the hero, which stays
         * the one place that says what level the tambon is at: this is neighbours speaking, not
         * Jaga, and it says so.
         */}
        {!loading && !choosing && props.reports && (
          <ReportsNear near={reportsNearMe(props.reports, myCodes)} />
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

        {/*
         * The long-term risk and the live measurements are marked as the tail of this column
         * (the owner, 21 Oct): on a phone and a tablet the things to do - SOS, a flood report,
         * asking for food and water, and following what you have sent - are brought up above
         * them, so the screen reads what is happening, then what you can do, then the
         * background. Nothing moves on a laptop, where the two are side by side already.
         *
         * The wrapper is `display: contents`, so it is nothing at all in the page: what it does
         * is give app/globals.css something to name (the phone block, `data-home-tail`).
         */}
        <div className="contents" data-home-tail="true">
          {!tense && riskCard}

          {/* An ordinary day: the measurements sit under the hero and its reports. */}
          {!tense && monitoring}
        </div>

        {evacuate && sos}
        {!choosing && checklist}

        <div className="contents" data-home-tail="true">
          {tense && riskCard}

          {/*
           * At Warning or Evacuate the same section waits until after the checklist (and after
           * the SOS button, which moves up at Evacuate): what to do comes before what the
           * rivers read.
           */}
          {tense && monitoring}
        </div>

        {/* Laptop only: under the flood-risk summary (the owner, 16 Oct). */}
        <div className="hidden console:contents">{damCards}</div>
      </div>

      <div data-home-col="act" className="flex flex-col gap-5 lg:col-start-2 lg:row-start-1">
        {!evacuate && sos}

        {/* For someone who has just found Jaga: what it can do, one tap away (owner, 16 Oct). */}
        {!loading && !tense && props.welcome}

        <Link
          href="/report"
          prefetch={false}
          className={`${buttonSecondary} min-h-16 gap-3 text-h3 font-bold`}
        >
          <WaveIcon size={30} />
          {t("report")}
        </Link>
        {/* Reporting needs an account; a visitor is told so before tapping (the owner, 15 Oct). */}
        {ready && !me?.signedIn && <SignInHint what="report" />}

        {/* For someone safe but cut off (spec 4.10). Quieter than SOS and never in its way. */}
        <Link
          href="/supplies"
          prefetch={false}
          data-supplies-link="true"
          className={`${buttonSecondary} min-h-16 gap-3`}
        >
          <ParcelIcon size={30} />
          <span className="flex flex-col items-start leading-tight">
            <span className="text-h3 font-bold">{tSos("supplies.label")}</span>
            <span className="text-small font-normal">{tSos("supplies.homeHint")}</span>
          </span>
        </Link>

        {props.myReports}

        {/* Laptop only: the unit's way in, under "Follow my requests" (the owner, 20 Oct). */}
        {!tense && props.unitCard}

        {props.projectLine && (
          <a href={`tel:${props.projectLine}`} className={`${buttonSecondary} gap-2`}>
            <PhoneIcon size={22} />
            {t("projectLine")} {props.projectLine}
          </a>
        )}
      </div>

      {/*
       * The third column on a laptop: the person's own places, the way into the map, and
       * everything that is background rather than something to do now. On a phone and on a
       * tablet it is the same single run of blocks it has always been - the wrapper only
       * becomes a column where there is room for three.
       */}
      <div data-home-col="places" className="flex flex-col gap-5 lg:col-start-2 lg:row-start-2">
        {/*
         * "Put Jaga on your home screen" used to be the last thing on the page, and nobody found
         * it (the owner, 19 Oct). It is the first thing in this column now: on a laptop that is
         * the top of the third column, and on a phone it comes straight after SOS and reporting,
         * above the map and the safe places. It is still kept away while a place of theirs is at
         * Warning or Evacuate, and it still goes for three weeks on "Not now".
         */}
        {!loading && !choosing && !tense && props.install}

        <WatchedPlaces items={watched} now={now} />
        {me?.signedIn && (
          <Link
            href="/account/places"
            prefetch={false}
            data-manage-places="true"
            className="inline-flex min-h-tap items-center gap-1.5 underline"
          >
            {watched.length > 0 ? <PinIcon size={20} /> : <AddSquareIcon size={20} />}
            {t(watched.length > 0 ? "watched.manage" : "watched.addFirst")}
          </Link>
        )}

        {/* The map comes straight after the person's own places, and the safe places after it,
            folded under their own button (owner, 12 Oct). Since 15 Oct the way in is the map's five
            features as tiles, each opening the map on itself (the owner: the science should be seen). */}
        <MapFeatureTiles />

        {home && !loading && (
          <SafePlaces
            places={places}
            state={placesState}
            userAgent={props.userAgent}
            fromPhone={props.placesFromPhone}
            savedAt={props.placesSavedAt}
          />
        )}

        {/* Notifications are offered at any level: a warning is when they matter most. */}
        {!loading && !choosing && props.push}

        {/*
         * The same dam, for everyone the notice does not reach: the drawing and what it means,
         * with nothing saying water is coming to them, because it is not. Background, not news,
         * so it sits at the bottom, just before "Share Jaga" (owner, 15 Oct; it was above the map
         * button). The notice at the top of the left column still speaks when the dam has
         * something to say to someone on its river.
         */}
        {damCards}

        {!loading && !choosing && !tense && props.share}
      </div>
    </div>
  );
}
