"use client";

import { useTranslations } from "next-intl";
import type { AlertLevel } from "@/lib/brand/tokens";
import { useStored, writeStored } from "@/lib/phone-store";
import { card, checkBox, checkRow, hint } from "@/lib/ui";

/** The items of each flood checklist; their texts are in messages (alert.checklist.flood). */
export const FLOOD_CHECKLIST = {
  normal: ["a", "b"],
  watch: ["a", "b", "c", "d"],
  warning: ["a", "b", "c", "d"],
  evacuate: ["a", "b", "c", "d"],
  return: ["a", "b", "c", "d"],
} as const satisfies Record<AlertLevel, readonly string[]>;

type Props = {
  level: AlertLevel;
  /** Ticks belong to one alert (or to "normal"); a new alert starts with an empty list. */
  listId: string;
};

/**
 * What to do at this level (spec section 7), as a list the person can tick off. The ticks are
 * remembered on this phone only (decision 2026-09-29) and are never sent anywhere.
 */
export function Checklist({ level, listId }: Props) {
  const t = useTranslations("home");
  const tItem = useTranslations(`alert.checklist.flood.${level}`);
  const key = `checklist.${listId}`;
  const ticked = useStored<string[]>(key) ?? [];
  const items: readonly string[] = FLOOD_CHECKLIST[level];

  function toggle(item: string, on: boolean) {
    writeStored(
      key,
      on ? [...ticked.filter((x) => x !== item), item] : ticked.filter((x) => x !== item),
    );
  }

  return (
    <section className={card} data-checklist={level}>
      <h2 className="text-body font-bold">{t("checklistTitle")}</h2>
      <ul className="flex flex-col">
        {items.map((item) => (
          <li key={item}>
            <label className={checkRow}>
              <input
                type="checkbox"
                className={checkBox}
                checked={ticked.includes(item)}
                onChange={(event) => toggle(item, event.target.checked)}
              />
              <span>{tItem(item)}</span>
            </label>
          </li>
        ))}
      </ul>
      <p className={hint}>{t("checklistNote")}</p>
    </section>
  );
}
