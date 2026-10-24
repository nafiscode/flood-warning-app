"use client";

import { useTranslations } from "next-intl";
import { BellIcon, CheckIcon } from "@/components/icons";
import type { AlarmState, UnitActions } from "@/components/authority/BoardView";
import type { MyUnit } from "@/lib/dispatch";
import { checkBox } from "@/lib/ui";

/**
 * The alarm's switch and each team's on-duty and phone switches as one slim row (24 Oct 2026),
 * for the war room, where the cards the phone's board uses would each take a third of the
 * window. The same switches, the same words and the same taps (spec 5.2, 5.3): nothing here is
 * new behaviour, only less room taken. The long explanations stay on the phone's cards; here
 * they are the hover text.
 */
const pill =
  "inline-flex min-h-tap items-center gap-2 rounded-xl border border-jaga-edge bg-jaga-surface px-3 text-small font-medium text-jaga-ink";

export function TeamStatusBar({
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
    <div className="flex flex-wrap items-center gap-2" data-war-status="true">
      <span data-alarm={alarm} className="inline-flex">
        {alarm === "on" && (
          <span className={pill}>
            <CheckIcon size={18} />
            {t("alarm.on")}
          </span>
        )}
        {alarm === "off" && (
          <button
            type="button"
            onClick={onArm}
            title={t("alarm.openOnly")}
            className="inline-flex min-h-tap items-center gap-2 rounded-xl bg-jaga-slate px-4 text-small font-bold text-white"
          >
            <BellIcon size={18} />
            {t("alarm.arm")}
          </button>
        )}
        {alarm === "none" && <span className={pill}>{t("alarm.none")}</span>}
      </span>
      {units.map((unit) => (
        <span key={unit.id} className="contents" data-unit={unit.id}>
          <label className={pill} title={t("unit.dutyHint")}>
            <input
              type="checkbox"
              className={`${checkBox} !mt-0 size-5`}
              checked={unit.onDuty}
              onChange={(e) => unitActions.duty(unit.id, e.target.checked)}
              data-duty="true"
            />
            {units.length > 1 ? `${unit.name} · ` : ""}
            {unit.onDuty ? t("unit.onDuty") : t("unit.offDuty")}
          </label>
          {unit.isOwner && (
            <label className={pill} title={t("unit.sharing")}>
              <input
                type="checkbox"
                className={`${checkBox} !mt-0 size-5`}
                checked={unit.sharesPocPhone}
                onChange={(e) => unitActions.sharing(unit.id, e.target.checked)}
                data-sharing="true"
              />
              {t("war.sharingShort")}
            </label>
          )}
        </span>
      ))}
    </div>
  );
}
