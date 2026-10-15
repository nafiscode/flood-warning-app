"use client";

import { CheckIcon } from "@/components/icons";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { pickName } from "@/lib/area";
import type { MyReport } from "@/lib/flood-reports";
import { BANGKOK_DATE_TIME } from "@/lib/time";
import { buttonSecondary, card, errorNotice, hint } from "@/lib/ui";

/**
 * One's own flood reports and whether each still stands (the owner, 13 Oct): a report stays in
 * force until its reporter says the water has gone, others in the same area say so, or its time
 * runs out. Drawn from what it is given; `MyReports` below fetches.
 */
export function MyReportsView({
  reports,
  busy,
  failed,
  onEnd,
}: {
  reports: MyReport[];
  busy: string | null;
  failed: boolean;
  onEnd: (id: string) => void;
}) {
  const t = useTranslations("reportsNear.mine");
  const tReport = useTranslations("report");
  const locale = useLocale();
  const format = useFormatter();
  if (reports.length === 0) return null;
  return (
    <section className={card} data-my-reports={reports.length}>
      <h2 className="text-h3 font-bold text-jaga-ink">{t("title")}</h2>
      <ul className="flex flex-col gap-4">
        {reports.map((r) => (
          <li key={r.id} className="flex flex-col gap-1" data-my-report={r.state}>
            <p className="font-bold">
              {r.depth
                ? t("item", {
                    place: pickName(locale, r.nameTh, r.nameEn),
                    depth: tReport(`depths.${r.depth}`),
                  })
                : pickName(locale, r.nameTh, r.nameEn)}
            </p>
            <p className={hint}>
              {t("sent", { time: format.dateTime(new Date(r.createdAt), BANGKOK_DATE_TIME) })}
            </p>
            <p>{t(r.state)}</p>
            {r.state === "standing" && (
              <>
                <p className={hint}>{t("standingHint")}</p>
                <button
                  type="button"
                  className={buttonSecondary}
                  disabled={busy !== null}
                  onClick={() => onEnd(r.id)}
                >
                  <CheckIcon size={22} />
                  {t(busy === r.id ? "ending" : "end")}
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      {failed && (
        <p role="alert" className={errorNotice}>
          {t("endFailed")}
        </p>
      )}
    </section>
  );
}

const hasSession = () =>
  typeof document !== "undefined" && /(^|;\s*)sb-[^=]*-auth-token/.test(document.cookie);

/**
 * The live list. Asked only when this browser holds a session, so a visitor never calls the
 * server for it. `tick` changes after a report is sent, so the new one appears at once.
 */
export function MyReports({ tick = 0, always = false }: { tick?: number; always?: boolean }) {
  const [reports, setReports] = useState<MyReport[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [again, setAgain] = useState(0);

  useEffect(() => {
    if (!hasSession()) return;
    let cancelled = false;
    fetch("/api/report/mine", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ reports: MyReport[] }>) : null))
      .then(
        (body) => {
          if (!cancelled && body) setReports(body.reports);
        },
        () => {},
      );
    return () => {
      cancelled = true;
    };
  }, [tick, again]);

  async function end(id: string) {
    setBusy(id);
    setFailed(false);
    try {
      const r = await fetch(`/api/report/${id}/end`, { method: "POST" });
      if (!r.ok) throw new Error("refused");
      setAgain((n) => n + 1);
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  }

  // On the home screen only a report that still stands is worth the room.
  const shown = always ? reports : reports.filter((r) => r.state === "standing");
  return <MyReportsView reports={shown} busy={busy} failed={failed} onEnd={end} />;
}
