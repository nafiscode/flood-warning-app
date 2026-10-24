"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import { LifebuoyIcon } from "@/components/icons";
import { Link } from "@/i18n/navigation";
import { useTeamEntry } from "@/lib/use-public";
import { buttonPrimary, offerCard } from "@/lib/ui";

/**
 * The way back into the team's board for a person on an approved team (the owner, 24 Oct 2026:
 * "so they will not get lost where to go for the next visit"). Two sizes of the same thing: a
 * highlighted card on the home screen, and one quiet pill on the map. Neither is drawn for
 * anyone else, so a resident, a visitor or a registration still waiting never sees a door to a
 * console they cannot open. It decides only what is drawn; the console itself is closed to
 * everyone but the team in the database (safety rule 5).
 *
 * The owner and the dispatchers go to the board, crew who were only handed cases go to those.
 */
const where = (team: "board" | "mine") => (team === "board" ? "/authority" : "/authority/mine");

export function TeamEntryCard() {
  const t = useTranslations("unitWay");
  const team = useTeamEntry();
  const titleId = useId();
  if (!team) return null;
  return (
    <section
      aria-labelledby={titleId}
      data-team-entry="card"
      className={`${offerCard} flex-1 border-2 border-jaga-teal-ink`}
    >
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-jaga-teal-ink text-white">
          <LifebuoyIcon size={22} />
        </span>
        <div className="flex flex-col gap-0.5">
          <h2 id={titleId} className="text-h3 font-bold text-jaga-ink">
            {t("teamTitle")}
          </h2>
          <p className="text-small text-jaga-text-2">{t("teamBody")}</p>
        </div>
      </div>
      <Link href={where(team)} prefetch={false} data-team-open="home" className={buttonPrimary}>
        {team === "board" ? t("teamOpen") : t("teamOpenMine")}
      </Link>
    </section>
  );
}

export function TeamEntryChip() {
  const t = useTranslations("unitWay");
  const team = useTeamEntry();
  if (!team) return null;
  return (
    <Link
      href={where(team)}
      prefetch={false}
      data-team-entry="chip"
      className="inline-flex min-h-tap items-center gap-2 self-start rounded-full border-2 border-jaga-teal-ink bg-jaga-surface px-4 font-bold text-jaga-ink"
    >
      <LifebuoyIcon size={20} />
      {team === "board" ? t("teamChip") : t("teamChipMine")}
    </Link>
  );
}
