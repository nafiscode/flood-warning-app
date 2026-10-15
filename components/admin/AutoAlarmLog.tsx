import { DualTime } from "@/components/admin/DualTime";
import { AlertBadge } from "@/components/alerts/AlertBadge";
import { Link } from "@/i18n/navigation";
import type { AutoAlarm } from "@/lib/notices";
import { buttonPrimary, card, hint } from "@/lib/ui";

type T = (key: string, values?: Record<string, string | number>) => string;

/**
 * What the automatic alarm did (A8; owner, 15 Oct): every draft it raised, and whether an admin
 * sent it, dismissed it, it published itself, or the river fell back first. Admins only - the
 * page is behind the admin layout and the database function checks again.
 */
export function AutoAlarmLog({ alarms, t }: { alarms: AutoAlarm[]; t: T }) {
  return (
    <section
      id="auto-alarms"
      className="flex scroll-mt-28 flex-col gap-3"
      data-auto-alarms={alarms.length}
    >
      <h2 className="text-body font-bold text-jaga-ink">{t("auto.title")}</h2>
      <p className={hint}>{t("auto.intro")}</p>
      {alarms.length === 0 && <p className="font-medium">{t("auto.none")}</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        {alarms.map((a) => (
          <article key={a.id} className={card} data-auto-alarm={a.status}>
            <div className="flex flex-wrap items-center gap-2">
              <AlertBadge level={a.level} />
              <span
                className={`inline-flex min-h-tap items-center rounded-full border-2 px-3 font-bold ${
                  a.status === "pending"
                    ? "border-jaga-ink text-jaga-ink"
                    : "border-jaga-line text-jaga-text-2"
                }`}
              >
                {t(`auto.status.${a.status}`)}
              </span>
              {a.drill && (
                <span className="inline-flex min-h-tap items-center rounded-full border-2 border-jaga-edge px-3 font-bold">
                  {t("drillTag")}
                </span>
              )}
            </div>
            <p className="font-bold text-jaga-ink">{a.zone}</p>
            <p>
              {t("auto.reading", {
                gauge: a.gauge ?? "–",
                value: a.value ?? "–",
                threshold: a.threshold ?? "–",
              })}
            </p>
            <p className={hint}>
              {t("auto.raised")} <DualTime iso={a.createdAt} />
            </p>
            {a.status === "pending" ? (
              <>
                <p className="font-medium">
                  {t("auto.deadline")} <DualTime iso={a.deadline} />
                </p>
                <Link href="/admin/signals" className={`${buttonPrimary} w-auto px-4`}>
                  {t("auto.act")}
                </Link>
              </>
            ) : (
              a.decidedAt && (
                <p className={hint}>
                  {t("auto.decided", { name: a.decidedBy ?? t("auto.byJaga") })}{" "}
                  <DualTime iso={a.decidedAt} />
                </p>
              )
            )}
            {a.note && <p className={hint}>{a.note}</p>}
          </article>
        ))}
      </div>
    </section>
  );
}

/** The admin's own tick: hear every alert Jaga sends, or only those for their own places. */
export function AllAlertsTick({
  on,
  action,
  t,
}: {
  on: boolean;
  action: (form: FormData) => void;
  t: T;
}) {
  return (
    <form action={action} className={`${card} gap-3`} data-all-alerts={on ? "on" : "off"}>
      <h2 className="text-body font-bold text-jaga-ink">{t("bell.title")}</h2>
      <label className="flex min-h-tap items-start gap-3">
        <input
          type="checkbox"
          name="all"
          value="yes"
          defaultChecked={on}
          className="mt-1 h-6 w-6 shrink-0"
        />
        <span>
          <span className="block font-medium">{t("bell.all")}</span>
          <span className={`block ${hint}`}>{t("bell.hint")}</span>
        </span>
      </label>
      <button type="submit" className={`${buttonPrimary} w-auto self-start px-4`}>
        {t("bell.save")}
      </button>
    </form>
  );
}
