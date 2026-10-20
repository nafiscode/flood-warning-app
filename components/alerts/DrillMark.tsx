import { useTranslations } from "next-intl";

/**
 * The mark on a drill the admins have sent (A10, the owner on 20 Oct).
 *
 * A sent drill is deliberately made to look and sound like the real thing - that is what it
 * proves - so the only thing keeping it from being read as a real alert is what it says. It
 * says it here, first, above the words, in the reader's own language: this is a drill, nothing
 * is happening, and nothing is being asked of you.
 *
 * It is drawn in the brand's own ink and never in an alert colour, so it cannot be mistaken for
 * a level, and it is added beside the level badge rather than in place of it (safety rule 3:
 * the level is never hidden or downgraded).
 */
export function DrillMark({ why = false }: { why?: boolean }) {
  const t = useTranslations("alert.drill");
  return (
    <p
      data-drill-mark="true"
      className="flex flex-col gap-1 rounded-xl border-2 border-jaga-slate bg-jaga-surface p-3"
    >
      <span className="text-small font-bold uppercase tracking-wide text-jaga-slate">
        {t("tag")}
      </span>
      <span className="font-bold text-jaga-ink">{t("note")}</span>
      {why && <span className="text-small text-jaga-text-2">{t("why")}</span>}
    </p>
  );
}
