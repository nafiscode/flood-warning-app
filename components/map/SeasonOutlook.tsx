"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import {
  OUTLOOK_URL,
  stillCurrent,
  timesInTen,
  type SeasonOutlook as Outlook,
} from "@/lib/season-outlook";
import { card, hint } from "@/lib/ui";
import { useFetched, useNow, type LoadState } from "@/lib/use-public";

const ISSUED = { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" } as const;

/**
 * What the outlook says, from what it is given. Always in the same order: the lean, what points
 * that way, how often such outlooks were right here, that the worst floods cannot be foreseen
 * this far ahead, and that alerts come from people. Plain text on a plain card: no alert colour,
 * no weather icon (safety rules 8 and 10).
 */
export function SeasonOutlookText({
  outlook,
  load,
  now,
}: {
  outlook: Outlook | null;
  load: LoadState;
  now: number;
}) {
  const t = useTranslations("map.outlook");
  const format = useFormatter();
  if (load === "loading") return <p className={hint}>{t("loading")}</p>;
  if (load === "unavailable") return <p className={hint}>{t("failed")}</p>;
  if (!outlook || (now > 0 && !stillCurrent(outlook, now))) return <p>{t("noneIssued")}</p>;
  return (
    <div className="flex flex-col gap-2" data-outlook-lean={outlook.lean}>
      <p className="font-bold">{t(`lean.${outlook.lean}`)}</p>
      {outlook.pacific && <p>{t(`pacific.${outlook.pacific}`)}</p>}
      {outlook.skill_pct !== null && <p>{t("skill", { n: timesInTen(outlook.skill_pct) })}</p>}
      <p>{t("bursts")}</p>
      <p>{t("alerts")}</p>
      <p className={hint}>
        {t("issued", { date: format.dateTime(new Date(`${outlook.issued_on}T00:00:00Z`), ISSUED) })}{" "}
        · {t("source")}
      </p>
    </div>
  );
}

/**
 * The fold under the map. Closed until opened, and the outlook is asked for only then, so the map
 * page costs nothing more for someone who never opens it.
 */
export function SeasonOutlook() {
  const t = useTranslations("map.outlook");
  const [open, setOpen] = useState(false);
  const got = useFetched<{ outlook: Outlook | null }>(open ? OUTLOOK_URL : null);
  const now = useNow();
  return (
    <details
      className={`${card} mt-4`}
      data-season-outlook="true"
      onToggle={(event) => setOpen((event.target as HTMLDetailsElement).open)}
    >
      <summary className="min-h-tap cursor-pointer font-bold">{t("title")}</summary>
      <div className="mt-3">
        <SeasonOutlookText outlook={got.data?.outlook ?? null} load={got.state} now={now} />
      </div>
    </details>
  );
}
