"use client";

import { useFormatter, useLocale, useTranslations } from "next-intl";
import { ClockIcon, TriangleIcon, WaveIcon } from "@/components/icons";
import { flow, trend } from "@/lib/dam";
import { localName } from "@/lib/places";
import { BANGKOK_DATE_TIME } from "@/lib/time";
import { hint } from "@/lib/ui";
import type { DamBoardRow } from "@/lib/war-room";

/**
 * The dam on the admins' war room (spec section 15, the owner's decision of 10 Oct 2026).
 *
 * This is the upper of the two tiers. The lower one is a quiet line on the public screens, shown
 * by the app itself; this one is a row somebody has to judge. Code raised it and sent nothing:
 * only a person publishes an alert (safety rule 2), and what they send afterwards is the dam
 * release notice of spec section 15, which is the rest of A12.
 *
 * So the two buttons here do not send anything either. They record what the admin did, which is
 * what the impact record is later built from (spec section 16).
 */

type Props = {
  dams: DamBoardRow[];
  now: number;
  /** Null on the example page, which records nothing. */
  review: ((form: FormData) => void) | null;
};

function Figures({ dam, now }: { dam: DamBoardRow; now: number }) {
  const t = useTranslations("warRoom");
  const format = useFormatter();
  const signal = dam.signal;
  if (!signal) return <p className={hint}>{t("dam.noFigures")}</p>;
  const ageH = (now - new Date(signal.observedAt).getTime()) / 3_600_000;
  return (
    <div className="flex flex-col gap-1">
      <p className="font-medium">
        {t("dam.outflow", { cms: flow(signal.outflowCms) ?? 0 })}
        {(flow(signal.spilledCms) ?? 0) > 0 && (
          <> · {t("dam.spilled", { cms: flow(signal.spilledCms) ?? 0 })}</>
        )}
      </p>
      <p>
        {t("dam.storage", {
          mcm: Math.round(signal.storageMcm ?? 0),
          percent: signal.percentFull ?? 0,
        })}
        {" · "}
        {t(`dam.trend.${trend(signal)}`)}
      </p>
      <p className={`${hint} flex items-center gap-1.5`}>
        <ClockIcon size={18} aria-hidden="true" />
        {t("dam.observed", {
          time: format.dateTime(new Date(signal.observedAt), BANGKOK_DATE_TIME),
        })}
        {" · "}
        {t("dam.age", { hours: Math.max(0, Math.round(ageH)) })}
      </p>
      {/* An admin has to be able to tell a quiet dam from a feed that stopped answering. */}
      {signal.stale && <p className="font-medium">{t("dam.stale")}</p>}
      {signal.awaiting.length > 0 && (
        <p className={hint}>{t("dam.awaiting", { readings: signal.confirmedOver })}</p>
      )}
    </div>
  );
}

export function DamBoard({ dams, now, review }: Props) {
  const t = useTranslations("warRoom");
  const locale = useLocale();
  const format = useFormatter();
  if (dams.length === 0) return null;
  return (
    <>
      {dams.map((dam) => {
        const open = dam.notice?.status === "open";
        const name = localName(dam.name, locale);
        return (
          <section
            key={dam.code}
            data-dam-board={dam.code}
            data-dam-notice={dam.notice?.status ?? "none"}
            className={
              open
                ? "flex flex-col gap-3 rounded-2xl border-2 border-jaga-edge bg-jaga-surface p-4"
                : "flex flex-col gap-2 rounded-2xl border border-jaga-line bg-jaga-surface p-4"
            }
          >
            <h2 className="flex flex-wrap items-center gap-2 text-h3 font-bold text-jaga-ink">
              <WaveIcon size={24} aria-hidden="true" />
              {name}
              {open && (
                <span className="inline-flex items-center gap-2 rounded-xl bg-jaga-slate px-3 py-1 text-body text-white">
                  <TriangleIcon size={20} aria-hidden="true" />
                  {t("dam.toReview")}
                </span>
              )}
            </h2>

            <p className="font-medium">{t(`dam.grade.${dam.signal?.grade ?? "unknown"}`)}</p>
            {(dam.signal?.reasons ?? []).map((reason) => (
              <p key={reason}>{t(`dam.reason.${reason}`)}</p>
            ))}

            <Figures dam={dam} now={now} />

            <p className={hint}>
              {t("dam.tambons", { main: dam.tambonsMain, tributary: dam.tambonsTributary })}
            </p>

            {open && dam.notice && (
              <div className="flex flex-col gap-3 rounded-xl border border-jaga-line p-3">
                <p className="font-bold">{t("dam.reviewTitle")}</p>
                {/*
                 * Said plainly, because it is the whole point of this panel: nothing has gone out
                 * to anybody. The app has shown its quiet line to the people on the river; the
                 * alarm is this admin's to send.
                 */}
                <p>{t("dam.reviewBody")}</p>
                <p className={hint}>
                  {t("dam.raisedAt", {
                    time: format.dateTime(new Date(dam.notice.raisedAt), BANGKOK_DATE_TIME),
                  })}
                </p>
                {review && (
                  <form action={review} className="flex flex-col gap-3">
                    <input type="hidden" name="notice" value={dam.notice.id} />
                    <label className="flex flex-col gap-1">
                      <span className="font-medium">{t("dam.noteLabel")}</span>
                      <input
                        name="note"
                        className="min-h-tap w-full rounded-xl border border-jaga-text-2 bg-jaga-surface px-4 py-2"
                      />
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="submit"
                        name="status"
                        value="sent"
                        className="inline-flex min-h-tap items-center justify-center rounded-xl bg-jaga-slate px-5 py-2 font-medium text-white active:translate-y-px"
                      >
                        {t("dam.sent")}
                      </button>
                      <button
                        type="submit"
                        name="status"
                        value="dismissed"
                        className="inline-flex min-h-tap items-center justify-center rounded-xl border-2 border-jaga-edge bg-jaga-surface px-5 py-2 font-medium text-jaga-ink active:translate-y-px"
                      >
                        {t("dam.dismiss")}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            )}

            {dam.notice && !open && dam.notice.reviewedAt && (
              <p className={hint}>
                {t(`dam.reviewed.${dam.notice.status}`, {
                  who: dam.notice.reviewedByName ?? "—",
                  time: format.dateTime(new Date(dam.notice.reviewedAt), BANGKOK_DATE_TIME),
                })}
              </p>
            )}

            {/* A feed that stopped is worse than bad figures, because it looks like calm. */}
            {dam.feed.ok === false && (
              <p role="alert" className="font-medium">
                {t("dam.feedFailed", {
                  time: dam.feed.ranAt
                    ? format.dateTime(new Date(dam.feed.ranAt), BANGKOK_DATE_TIME)
                    : "—",
                })}
              </p>
            )}
          </section>
        );
      })}
    </>
  );
}
