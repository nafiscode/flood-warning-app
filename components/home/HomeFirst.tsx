"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { ForwardIcon } from "@/components/icons";
import { Link } from "@/i18n/navigation";
import { card } from "@/lib/ui";
import type { Area } from "@/lib/area";
import { AreaChooser } from "./AreaChooser";
import { OtherHelp } from "./OtherHelp";

type Props = {
  /** The status is still being asked for: say so, as the phone's hero does. */
  loading: boolean;
  sos: ReactNode;
  onChooseArea: (area: Area) => void;
  projectLine: string | null;
  /** "Follow my requests" and the person's own reports, for someone who sent one without an area. */
  myReports?: ReactNode;
  /** "Jaga is not in service yet", said on every home screen before launch. */
  notInService?: ReactNode;
};

/** One of the three quiet ways in under the question. */
function QuietLink({ id, href, children }: { id: string; href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      prefetch={false}
      data-quiet-link={id}
      className="inline-flex min-h-tap items-center gap-1.5 font-medium text-jaga-teal-ink underline underline-offset-4"
    >
      {children}
      <ForwardIcon size={18} className="rtl:-scale-x-100" />
    </Link>
  );
}

/**
 * What a laptop shows a visitor who has not chosen an area (the owner, 23 Oct 2026: options A and
 * C). One question in the middle, SOS beside it where it always is, and three quiet ways in below
 * the question - what Jaga is, the risk map, and the way in for a rescue team - instead of seven
 * things asking for a tap at once. Everything else waits for its turn: sign-in and install come
 * as one setup card once there is an area (components/home/SetupSteps.tsx).
 *
 * Safety: SOS is one tap with nothing in front of it, and the hotlines stay in the bar. With no
 * area chosen the page says there is no status to show; it never draws an all-clear colour
 * (safety rule 10 in spirit).
 */
export function HomeFirst({
  loading,
  sos,
  onChooseArea,
  projectLine,
  myReports,
  notInService,
}: Props) {
  const t = useTranslations("homeFlow");
  const tHome = useTranslations("home");
  return (
    <div
      data-home-first="true"
      className="flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:items-start lg:gap-x-8"
    >
      <h1 className="sr-only">{tHome("title")}</h1>

      <div className="flex flex-col gap-5">
        {loading ? (
          <section data-hero="loading" className={card}>
            <p>{tHome("loading")}</p>
          </section>
        ) : (
          <section data-hero="choose" aria-labelledby="home-first-title" className={card}>
            <h2 id="home-first-title" className="text-h2 font-bold text-jaga-ink">
              {t("firstTitle")}
            </h2>
            <p className="text-lg">{t("firstBody")}</p>
            <AreaChooser onChoose={onChooseArea} />
          </section>
        )}

        {!loading && (
          <p
            data-no-status="true"
            className="rounded-xl border border-dashed border-jaga-line px-4 py-3 text-jaga-text-2"
          >
            {t("firstEmpty")}
          </p>
        )}

        {notInService}

        <nav
          aria-label={t("linksLabel")}
          data-quiet-links="true"
          className="flex flex-wrap gap-x-6"
        >
          <QuietLink id="what" href="/features">
            {t("linkWhat")}
          </QuietLink>
          <QuietLink id="map" href="/map">
            {t("linkMap")}
          </QuietLink>
          <QuietLink id="teams" href="/authority/register">
            {t("linkTeams")}
          </QuietLink>
        </nav>
      </div>

      <div className="flex flex-col gap-5">
        {sos}
        <OtherHelp projectLine={projectLine} />
        {myReports}
      </div>
    </div>
  );
}
