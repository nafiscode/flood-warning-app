"use client";

import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { CASE_MARKS, COVER_MARKS } from "@/components/authority/marks";
import {
  coverageTotals,
  gapsByProvince,
  myPoints,
  pointsByProvince,
  type CoverageRow,
  type CoverageUnit,
  type PointsRow,
  type UnitContact,
} from "@/lib/coverage";
import { card, hint } from "@/lib/ui";

/**
 * The console's other views, drawn from props so the example page and the tests show exactly
 * what a team sees: the cases on a map (spec 5.1), the responsibility map with its gaps (5.6)
 * and the points board (5.5). The map itself is handed in as a slot: it needs WebGL, and the
 * words and lists around it must not.
 *
 * A gap is always written out as a list as well as drawn. The list is the part that can be read
 * aloud, searched and acted on; the map is the picture of it.
 */

type Loaded<T> = T | "failed" | null;

const mark = (style: React.CSSProperties) => (
  <span aria-hidden="true" className="inline-block size-4 shrink-0 rounded-full" style={style} />
);

function Waiting({ state, failed }: { state: unknown; failed: string }) {
  const t = useTranslations("authority");
  if (state === "failed") return <p className="font-medium">{failed}</p>;
  return <p className={hint}>{t("views.loading")}</p>;
}

/** Another team's point of contact, shown after it was asked for; the look is in the log. */
function Contact({ contact }: { contact: UnitContact | "failed" }) {
  const t = useTranslations("authority");
  if (contact === "failed") return <p className="font-medium">{t("coverage.contactFailed")}</p>;
  return (
    <span className="flex flex-col gap-1 pt-1" data-unit-contact-shown="true">
      {contact.name && <span>{t("coverage.contact", { name: contact.name })}</span>}
      {contact.phone ? (
        <a
          href={`tel:${contact.phone}`}
          className="inline-flex min-h-tap items-center font-bold underline"
        >
          {contact.phone}
        </a>
      ) : (
        <span className="font-medium">{t("coverage.contactNone")}</span>
      )}
      <span className={hint}>{t("act.phoneLogged")}</span>
    </span>
  );
}

/** The cases on a map, with the card of whichever one was tapped under it. */
export function CaseMapView({ map, picked }: { map: ReactNode; picked: ReactNode | null }) {
  const t = useTranslations("authority");
  return (
    <div className="flex flex-col gap-4" data-view="map">
      {map}
      <ul className="flex flex-wrap gap-x-4 gap-y-2">
        {CASE_MARKS.map((m) => (
          <li key={m.key} className="flex items-center gap-2 text-small">
            {mark(m.style)}
            <span>{t(`map.case.${m.key}`)}</span>
          </li>
        ))}
      </ul>
      {picked ?? <p className={hint}>{t("map.pickCase")}</p>}
    </div>
  );
}

type CoverageProps = {
  map: ReactNode;
  coverage: Loaded<CoverageRow[]>;
  /** The tambon tapped on the map or in the list, and the teams covering it. */
  picked: { tambon: string; units: Loaded<CoverageUnit[]> } | null;
  onPick: (tambon: string) => void;
  /** Other teams' contacts already asked for in this sitting, by unit (spec 5.3). */
  contacts?: Record<string, UnitContact | "failed">;
  onContact?: (unitId: string) => void;
};

export function CoverageView({
  map,
  coverage,
  picked,
  onPick,
  contacts = {},
  onContact,
}: CoverageProps) {
  const t = useTranslations("authority");
  const tWar = useTranslations("warRoom");
  const locale = useLocale();
  const name = (r: CoverageRow) => (locale === "th" ? r.nameTh : `${r.nameTh} (${r.nameEn})`);

  if (!Array.isArray(coverage)) {
    return (
      <div className="flex flex-col gap-4" data-view="coverage">
        {map}
        <Waiting state={coverage} failed={t("coverage.failed")} />
      </div>
    );
  }
  const totals = coverageTotals(coverage);
  const groups = gapsByProvince(coverage);
  const pickedRow = picked ? (coverage.find((r) => r.tambon === picked.tambon) ?? null) : null;

  return (
    <div className="flex flex-col gap-4" data-view="coverage">
      <p className={hint}>{t("coverage.intro")}</p>
      {map}
      <ul className="flex flex-wrap gap-x-4 gap-y-2">
        {COVER_MARKS.map((m) => (
          <li key={m.key} className="flex items-center gap-2 text-small">
            {mark(m.style)}
            <span>{t(`coverage.mark.${m.key}`)}</span>
          </li>
        ))}
      </ul>

      <section className={card} data-coverage-totals={totals.gaps}>
        <p className="font-bold text-jaga-ink">
          {t("coverage.summary", {
            covered: totals.covered,
            total: totals.tambons,
            gaps: totals.gaps,
          })}
        </p>
        <p className={hint}>{t("coverage.mine", { count: totals.mine })}</p>
      </section>

      {picked && (
        <section className={card} data-coverage-picked={picked.tambon}>
          <h2 className="font-bold text-jaga-ink">{pickedRow ? name(pickedRow) : picked.tambon}</h2>
          {!Array.isArray(picked.units) ? (
            <Waiting state={picked.units} failed={t("coverage.failed")} />
          ) : picked.units.length === 0 ? (
            <p className="font-medium">{t("coverage.noUnits")}</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {picked.units.map((u) => (
                <li key={u.id} className="flex flex-col">
                  <span className="font-medium">
                    {u.name}
                    {u.mine ? ` · ${t("coverage.yours")}` : ""}
                  </span>
                  <span className={hint}>
                    {[
                      u.orgName,
                      u.capabilities
                        .map((c) => (tWar.has(`capability.${c}`) ? tWar(`capability.${c}`) : c))
                        .join(", "),
                      u.onDuty ? t("unit.onDuty") : t("unit.offDuty"),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  {!u.mine && onContact && !(u.id in contacts) && (
                    <button
                      type="button"
                      onClick={() => onContact(u.id)}
                      data-unit-contact={u.id}
                      className="inline-flex min-h-tap items-center self-start font-medium underline"
                    >
                      {t("coverage.showContact")}
                    </button>
                  )}
                  {u.id in contacts && <Contact contact={contacts[u.id]!} />}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="flex flex-col gap-3" data-coverage-gaps={totals.gaps}>
        <h2 className="font-bold text-jaga-ink">{t("coverage.gapsTitle")}</h2>
        {groups.length === 0 && <p className="font-medium">{t("coverage.noGaps")}</p>}
        {groups.map((group) => (
          <details key={group.province} className="rounded-2xl border border-jaga-line p-3">
            <summary className="flex min-h-tap cursor-pointer items-center font-medium">
              {t.has(`coverage.province.${group.province}`)
                ? t(`coverage.province.${group.province}`)
                : group.province}
              {" · "}
              {t("coverage.gapCount", { count: group.rows.length })}
            </summary>
            <ul className="flex flex-wrap gap-2 pt-2">
              {group.rows.map((r) => (
                <li key={r.tambon}>
                  <button
                    type="button"
                    onClick={() => onPick(r.tambon)}
                    data-gap={r.tambon}
                    className="inline-flex min-h-tap items-center rounded-xl border border-jaga-edge px-3 text-small"
                  >
                    {name(r)}
                    {r.coordinationUnits > 0 ? ` · ${t("coverage.coordinatorOnly")}` : ""}
                  </button>
                </li>
              ))}
            </ul>
          </details>
        ))}
      </section>
    </div>
  );
}

/** Confirmed rescues and points, team by team. A board of thanks, kept inside the consoles. */
export function PointsView({ points }: { points: Loaded<PointsRow[]> }) {
  const t = useTranslations("authority");
  if (!Array.isArray(points)) {
    return (
      <div data-view="points">
        <Waiting state={points} failed={t("points.failed")} />
      </div>
    );
  }
  const mine = myPoints(points);
  const groups = pointsByProvince(points);
  return (
    <div className="flex flex-col gap-4" data-view="points">
      <section className={card} data-points-mine={mine.points}>
        <p className="text-h3 font-bold text-jaga-ink">{t("points.mine", mine)}</p>
        <p className={hint}>{t("points.rule")}</p>
      </section>
      {groups.length === 0 && <p className="font-medium">{t("points.none")}</p>}
      {groups.map((group) => (
        <section key={group.province} className="flex flex-col gap-2">
          <h2 className="font-bold text-jaga-ink">
            {t.has(`coverage.province.${group.province}`)
              ? t(`coverage.province.${group.province}`)
              : group.province}
          </h2>
          <table className="w-full text-start">
            <thead>
              <tr className={hint}>
                <th scope="col" className="py-1 text-start font-medium">
                  {t("points.team")}
                </th>
                <th scope="col" className="py-1 text-end font-medium">
                  {t("points.cases")}
                </th>
                <th scope="col" className="py-1 text-end font-medium">
                  {t("points.points")}
                </th>
              </tr>
            </thead>
            <tbody>
              {group.rows.map((r) => (
                <tr
                  key={r.unitId}
                  data-points-row={r.unitId}
                  className={`border-t border-jaga-line ${r.mine ? "font-bold" : ""}`}
                >
                  <td className="py-2">
                    {r.unitName}
                    {r.mine ? ` · ${t("coverage.yours")}` : ""}
                    {r.orgName && <span className={`block font-normal ${hint}`}>{r.orgName}</span>}
                  </td>
                  <td className="py-2 text-end tabular-nums">{r.cases}</td>
                  <td className="py-2 text-end tabular-nums">{r.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
