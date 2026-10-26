"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { TrashIcon } from "@/components/icons";
import { forgetSent, useSentFeedback } from "@/lib/feedback-store";
import type { PublicStatus } from "@/lib/feedback";
import { buttonSecondary, card, errorNotice, hint } from "@/lib/ui";

type Known = {
  id: string;
  key: string | null;
  publicStatus: PublicStatus;
  likedNote: string | null;
  improveNote: string | null;
  displayName: string | null;
};

/**
 * "Taking it back" (spec 17). A signed-in person deletes their own comment, published or not; an
 * **anonymous** sender has the same power through the key their phone kept, because otherwise a
 * published anonymous comment could never be withdrawn - and a page that can publish words it
 * cannot unpublish has no business asking for them.
 *
 * It draws nothing unless this device has something to come back for, so a first visit sees no
 * trace of it. Each row is checked with the server as the page opens (`/api/feedback/mine`),
 * which is also how a comment that an admin has since refused, or that the twelve-month clock has
 * taken, stops being offered: the answer comes back empty and the device forgets it.
 */
export function MyComments() {
  const t = useTranslations("feedback");
  const sent = useSentFeedback();
  const [known, setKnown] = useState<Known[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [gone, setGone] = useState<string[]>([]);

  const ids = sent.map((s) => s.id).join(",");
  useEffect(() => {
    if (sent.length === 0) return;
    let stopped = false;
    void (async () => {
      const rows: Known[] = [];
      for (const item of sent) {
        try {
          const response = await fetch("/api/feedback/mine", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: item.id, key: item.key }),
            cache: "no-store",
          });
          if (!response.ok) continue;
          const answer = (await response.json()) as { feedback: Record<string, unknown> | null };
          if (!answer.feedback) {
            // The row is gone, or the key no longer opens it. Stop offering it.
            forgetSent(item.id);
            continue;
          }
          const f = answer.feedback;
          rows.push({
            id: item.id,
            key: item.key,
            publicStatus: (f.publicStatus as PublicStatus) ?? "not_requested",
            likedNote: (f.likedNote as string | null) ?? null,
            improveNote: (f.improveNote as string | null) ?? null,
            displayName: (f.displayName as string | null) ?? null,
          });
        } catch {
          // Offline: say nothing rather than claim a comment is gone.
        }
      }
      if (!stopped) setKnown(rows);
    })();
    return () => {
      stopped = true;
    };
    // `ids` rather than `sent`: the array is rebuilt on every store event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  const withdraw = useCallback(async (item: Known) => {
    setBusy(item.id);
    setFailed(null);
    try {
      const response = await fetch("/api/feedback/mine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, key: item.key, action: "withdraw" }),
        cache: "no-store",
      });
      if (!response.ok) throw new Error(String(response.status));
      forgetSent(item.id);
      setKnown((rows) => rows.filter((r) => r.id !== item.id));
      setGone((list) => [...list, item.id]);
    } catch {
      setFailed(item.id);
    } finally {
      setBusy(null);
    }
  }, []);

  /*
   * Filtered rather than cleared from the effect: a row the device has forgotten (withdrawn here,
   * or refused and dropped on the last check) leaves the list because the phone's own list no
   * longer has it, not because a render set state.
   */
  const rows = known.filter((row) => sent.some((s) => s.id === row.id));
  if (rows.length === 0 && gone.length === 0) return null;

  return (
    <section className="flex flex-col gap-3" data-my-comments={rows.length}>
      <h2 className="text-h3 font-bold text-jaga-ink">{t("mine.title")}</h2>
      <p className={hint}>{t("mine.kept")}</p>
      {gone.length > 0 && (
        <p role="status" className={hint}>
          {t("mine.withdrawn")}
        </p>
      )}
      <ul className="flex flex-col gap-3">
        {rows.map((item) => (
          <li key={item.id} className={card} data-my-comment={item.id}>
            <p className={hint}>{t(`mine.status.${item.publicStatus}`)}</p>
            {item.displayName && <p className="font-bold text-jaga-ink">{item.displayName}</p>}
            {item.likedNote && <p className="whitespace-pre-wrap">{item.likedNote}</p>}
            {item.improveNote && <p className="whitespace-pre-wrap">{item.improveNote}</p>}
            {failed === item.id && (
              <p role="alert" className={errorNotice}>
                {t("mine.withdrawFailed")}
              </p>
            )}
            <button
              type="button"
              onClick={() => void withdraw(item)}
              disabled={busy === item.id}
              className={buttonSecondary}
              data-withdraw={item.id}
            >
              <TrashIcon size={22} />
              {busy === item.id ? t("mine.withdrawing") : t("mine.withdraw")}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
