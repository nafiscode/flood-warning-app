"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { PersonIcon, TrashIcon } from "@/components/icons";
import type { CaseAssignment, CrewMember } from "@/lib/dispatch";
import { buttonSecondary, buttonQuiet, hint, input } from "@/lib/ui";

/**
 * Who on the team holds this case (24 Oct 2026). The team accepted it as one; here the owner or a
 * dispatcher hands it to named people, who then see its exact point and the requester's number
 * on their own phones and report "on the way", "arrived" and "rescued" with the photos.
 * A team with nobody else on it never sees a reason to use this: the owner just carries on.
 */
type Props = {
  crew: CrewMember[];
  assigned: CaseAssignment[];
  busy: boolean;
  onAssign: (userId: string) => void;
  onUnassign: (assignmentId: string) => void;
};

export function CrewPanel({ crew, assigned, busy, onAssign, onUnassign }: Props) {
  const t = useTranslations("authority");
  const [pick, setPick] = useState("");
  const free = crew.filter((m) => !assigned.some((a) => a.userId === m.userId));
  // Nobody to hand it to: the owner is the only person, so the panel would only be noise.
  if (crew.length <= 1 && assigned.length === 0) return null;

  return (
    <div className="flex flex-col gap-2" data-crew="true">
      <h4 className="font-bold text-jaga-ink">{t("crew.title")}</h4>
      {assigned.length === 0 ? (
        <p className={hint}>{t("crew.none")}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {assigned.map((a) => (
            <li
              key={a.id}
              className="flex items-center justify-between gap-3"
              data-assigned={a.userId}
            >
              <span className="font-medium">
                {a.name || t("crew.noName")}
                {a.selfAssigned && <span className={hint}> · {t("crew.tookIt")}</span>}
              </span>
              <button
                type="button"
                className={buttonQuiet}
                disabled={busy}
                onClick={() => onUnassign(a.id)}
                aria-label={t("crew.remove", { name: a.name || t("crew.noName") })}
                data-unassign="true"
              >
                <TrashIcon size={20} />
                {t("crew.removeShort")}
              </button>
            </li>
          ))}
        </ul>
      )}
      {free.length > 0 && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <select
            className={input}
            value={pick}
            onChange={(e) => setPick(e.target.value)}
            aria-label={t("crew.pick")}
            data-crew-pick="true"
          >
            <option value="">{t("crew.pick")}</option>
            {free.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name || t("crew.noName")} · {t(`crew.role.${m.role}`)}
                {m.openCases > 0 ? ` · ${t("crew.open", { count: m.openCases })}` : ""}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={buttonSecondary}
            disabled={busy || pick === ""}
            onClick={() => {
              onAssign(pick);
              setPick("");
            }}
            data-assign="true"
          >
            <PersonIcon size={20} />
            {t("crew.assign")}
          </button>
        </div>
      )}
    </div>
  );
}
