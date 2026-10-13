"use client";

import { useTranslations } from "next-intl";
import { CallNow } from "@/components/CallNow";
import { ClockIcon, LifebuoyIcon, PhoneIcon } from "@/components/icons";
import type { SosTeam, SosTeamPhone } from "@/lib/sos";
import { buttonPrimary, hint } from "@/lib/ui";

type Props = {
  team: SosTeam;
  /** When the request was sent, for "waiting 12 min". */
  createdAt: string;
  /** A request for food and water: the same facts in a delivery's words (spec 4.10). */
  supplies?: boolean;
  /** 0 until the browser's clock is known. */
  now: number;
  /** The team's number once the sender asked for it; "failed" when the asking did not work. */
  phone: SosTeamPhone | "failed" | null;
  asking: boolean;
  onAskPhone: () => void;
};

/**
 * Who is coming, for the person who asked for help (spec 4.6, 5.3).
 *
 * While nobody has accepted it says exactly that, with the time waited and the two hotlines
 * again - never a promise that someone is on the way. Once a team accepts it names the team,
 * gives its arrival estimate as a range with the time it was given (never a clock time: safety
 * rule 8), and offers one button to call the people actually coming.
 */
export function TeamStatus({
  team,
  createdAt,
  supplies = false,
  now,
  phone,
  asking,
  onAskPhone,
}: Props) {
  const t = useTranslations("sos");
  const base = supplies ? "supplies.team" : "team";

  if (team.searching) {
    const minutes = now > 0 ? Math.max(0, Math.floor((now - Date.parse(createdAt)) / 60_000)) : 0;
    return (
      <section
        className="flex flex-col gap-3 rounded-2xl border-2 border-jaga-edge bg-jaga-surface p-5"
        data-team="searching"
        data-team-exhausted={team.exhausted}
      >
        <h2 className="flex items-center gap-2 text-h3 font-bold text-jaga-ink">
          <ClockIcon size={24} />
          {team.exhausted ? t(`${base}.exhausted`) : t(`${base}.searching`)}
        </h2>
        {now > 0 && <p className="font-medium">{t("team.waited", { minutes })}</p>}
        <p>{team.exhausted ? t(`${base}.exhaustedBody`) : t(`${base}.searchingBody`)}</p>
        <p className="font-bold">{supplies ? t("supplies.team.urgent") : t("team.callNow")}</p>
        <CallNow />
      </section>
    );
  }

  return (
    <section
      className="flex flex-col gap-3 rounded-2xl border-2 border-jaga-teal-ink bg-jaga-surface p-5"
      data-team="accepted"
    >
      <h2 className="flex items-center gap-2 text-h3 font-bold text-jaga-ink">
        <LifebuoyIcon size={24} />
        {t(`${base}.accepted`)}
      </h2>
      <p className="flex flex-col">
        <span className="font-bold">{team.unitName}</span>
        {team.orgName && team.orgName !== team.unitName && (
          <span className={hint}>{team.orgName}</span>
        )}
      </p>
      {team.etaBand ? (
        <p className="flex flex-col" data-team-eta={team.etaBand}>
          <span className="font-bold">{t(`team.eta.${team.etaBand}`)}</span>
          <span className={hint}>
            {team.etaGivenAt
              ? t("team.etaGiven", { time: clock(team.etaGivenAt) })
              : t("team.etaEstimate")}
          </span>
        </p>
      ) : (
        <p data-team-eta="none">{t("team.etaNone")}</p>
      )}

      {phone && phone !== "failed" && phone.phone && (
        <div className="flex flex-col gap-2" data-team-phone="shown">
          <a href={`tel:${phone.phone}`} className={`${buttonPrimary} min-h-16 gap-3`}>
            <PhoneIcon size={28} />
            <span className="flex flex-col items-start leading-tight">
              <span className="text-h3 font-bold">{phone.phone}</span>
              <span className="text-small">
                {phone.isPoc ? t("team.phonePoc") : t("team.phoneOrg")}
              </span>
            </span>
          </a>
        </div>
      )}
      {phone && phone !== "failed" && !phone.phone && (
        <p className="font-medium">{t("team.phoneNone")}</p>
      )}
      {phone === "failed" && <p className="font-medium">{t("team.phoneFailed")}</p>}
      {(!phone || phone === "failed") && team.phoneAvailable && (
        <button
          type="button"
          onClick={onAskPhone}
          disabled={asking}
          data-team-call="true"
          className={`${buttonPrimary} gap-2`}
        >
          <PhoneIcon size={22} />
          {asking ? t("status.closing") : t("team.call")}
        </button>
      )}
      {!team.phoneAvailable && !phone && <p className={hint}>{t("team.phoneNone")}</p>}
    </section>
  );
}

/** Bangkok clock time, for "given at 14:05". */
function clock(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Bangkok",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}
