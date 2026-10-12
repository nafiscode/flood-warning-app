"use client";

import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { PhotoForm } from "@/components/authority/Finish";
import type { UnconfirmedRescue } from "@/lib/coverage";
import { hoursSince } from "@/lib/dispatch";
import { buttonPrimary, hint } from "@/lib/ui";
import { uploadProof } from "@/lib/upload";
import { useNow } from "@/lib/use-public";

/**
 * Rescues a team reported and the person never confirmed (spec 5.4), for the admins. Once the
 * person has had their time an admin may confirm instead, with a photo and a note saying how it
 * was checked - by a phone call to the family, a visit, a photo from the shelter. The database
 * decides whether it is time and writes the confirmation to the access log; this only carries it.
 *
 * Nothing is drawn while there is nothing waiting.
 */
type Props = {
  rows: UnconfirmedRescue[];
  /** Carries the confirmation to the server. Injected so the tests need no network. */
  send?: (sosId: string, photos: File[], note: string) => Promise<"done" | "refused" | "upload">;
};

async function sendConfirmation(sosId: string, photos: File[], note: string) {
  const sent = await uploadProof(sosId, photos);
  if (sent.photos.length === 0) return "upload" as const;
  const response = await fetch("/api/admin/confirm-rescue", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sos: sosId, photos: sent.photos, note }),
    cache: "no-store",
  });
  return response.ok ? ("done" as const) : ("refused" as const);
}

export function UnconfirmedRescues({ rows, send = sendConfirmation }: Props) {
  const t = useTranslations("warRoom");
  const locale = useLocale();
  const router = useRouter();
  const now = useNow();
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<"done" | "refused" | "upload" | null>(null);

  if (rows.length === 0 && result !== "done") return null;

  function confirm(sosId: string, photos: File[], note: string) {
    setBusy(true);
    setResult(null);
    send(sosId, photos, note)
      .then(
        (answer) => {
          setResult(answer);
          if (answer === "done") {
            setOpen(null);
            router.refresh();
          }
        },
        () => setResult("upload"),
      )
      .finally(() => setBusy(false));
  }

  return (
    <section
      className="flex flex-col gap-3 rounded-2xl border-2 border-jaga-edge bg-jaga-surface p-4"
      data-unconfirmed={rows.length}
    >
      <h2 className="text-h3 font-bold text-jaga-ink">{t("unconfirmed.title")}</h2>
      <p className={hint}>{t("unconfirmed.intro")}</p>
      {result && (
        <p
          role={result === "done" ? "status" : "alert"}
          className="rounded-xl border-2 border-jaga-edge bg-jaga-ground px-4 py-2 font-medium"
        >
          {t(`unconfirmed.${result}`)}
        </p>
      )}
      <ul className="flex flex-col gap-3">
        {rows.map((r) => {
          const place =
            locale === "th" || !r.tambonNameEn
              ? r.tambonNameTh
              : `${r.tambonNameTh} (${r.tambonNameEn})`;
          return (
            <li
              key={r.sosId}
              data-unconfirmed-case={r.sosId}
              data-due={r.due}
              className="flex flex-col gap-2 border-t border-jaga-line pt-3"
            >
              <p className="font-bold text-jaga-ink">
                {place || t("unconfirmed.noArea")}{" "}
                <span className={`${hint} font-normal tabular-nums`}>#{r.sosId.slice(0, 8)}</span>
              </p>
              <p>
                {now > 0 && r.completedAt
                  ? t("unconfirmed.row", {
                      unit: r.unitName,
                      hours: hoursSince(r.completedAt, now),
                    })
                  : t("unconfirmed.rowNoTime", { unit: r.unitName })}
                {r.proofCount > 0 ? ` · ${t("unconfirmed.proof", { count: r.proofCount })}` : ""}
              </p>
              {!r.due && <p className={hint}>{t("unconfirmed.notDue")}</p>}
              {r.due &&
                (open === r.sosId ? (
                  <PhotoForm
                    kind="confirm"
                    busy={busy}
                    onSend={(photos, note) => confirm(r.sosId, photos, note)}
                    onCancel={() => setOpen(null)}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setOpen(r.sosId)}
                    data-admin-confirm="true"
                    className={`${buttonPrimary} sm:w-auto sm:self-start`}
                  >
                    {t("unconfirmed.open")}
                  </button>
                ))}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
