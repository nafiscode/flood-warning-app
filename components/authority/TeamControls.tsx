"use client";

import { useTranslations } from "next-intl";
import { BellIcon, CheckIcon } from "@/components/icons";
import type { AlarmState, UnitActions } from "@/components/authority/BoardView";
import type { MyUnit } from "@/lib/dispatch";
import { buttonPrimary, card, checkBox, checkRow, hint } from "@/lib/ui";

/**
 * The alarm's own switch and each team's on-duty and phone switches (spec 5.2, 5.3), drawn the
 * same on the phone's board and in the war room. Taken out of BoardView on 24 Oct 2026 so the
 * two layouts cannot drift apart; the markup is unchanged.
 */
export function TeamControls({
  alarm,
  onArm,
  units,
  unitActions,
}: {
  alarm: AlarmState;
  onArm: () => void;
  units: MyUnit[];
  unitActions: UnitActions;
}) {
  const t = useTranslations("authority");
  return (
    <>
      <section className={card} data-alarm={alarm}>
        <h2 className="flex items-center gap-2 font-bold text-jaga-ink">
          <BellIcon size={22} />
          {t("alarm.title")}
        </h2>
        {alarm === "on" && (
          <p className="flex items-center gap-2 font-medium">
            <CheckIcon size={20} />
            {t("alarm.on")}
          </p>
        )}
        {alarm === "off" && (
          <>
            <p className="font-medium">{t("alarm.off")}</p>
            <button type="button" onClick={onArm} className={buttonPrimary}>
              {t("alarm.arm")}
            </button>
          </>
        )}
        {alarm === "none" && <p className="font-medium">{t("alarm.none")}</p>}
        <p className={hint}>{t("alarm.openOnly")}</p>
      </section>

      {units.map((unit) => (
        <section key={unit.id} className={card} data-unit={unit.id}>
          <div className="flex flex-col">
            <h2 className="font-bold text-jaga-ink">{unit.name}</h2>
            {unit.orgName && <p className={hint}>{unit.orgName}</p>}
          </div>
          <label className={checkRow}>
            <input
              type="checkbox"
              className={checkBox}
              checked={unit.onDuty}
              onChange={(e) => unitActions.duty(unit.id, e.target.checked)}
              data-duty="true"
            />
            <span className="flex flex-col">
              <span className="font-bold">
                {unit.onDuty ? t("unit.onDuty") : t("unit.offDuty")}
              </span>
              <span className={hint}>{t("unit.dutyHint")}</span>
            </span>
          </label>
          {unit.isOwner && (
            <label className={checkRow}>
              <input
                type="checkbox"
                className={checkBox}
                checked={unit.sharesPocPhone}
                onChange={(e) => unitActions.sharing(unit.id, e.target.checked)}
                data-sharing="true"
              />
              <span className="flex flex-col">
                <span className="font-medium">{t("unit.sharing")}</span>
                {!unit.sharesPocPhone && <span className={hint}>{t("unit.sharingOff")}</span>}
              </span>
            </label>
          )}
        </section>
      ))}
    </>
  );
}
