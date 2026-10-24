"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { PhotoForm } from "@/components/authority/Finish";
import { PushCard } from "@/components/push/PushCard";
import { CheckIcon, PhoneIcon, PinIcon, RunningPersonIcon, ShareIcon } from "@/components/icons";
import { coordsText, directionsHref, vulnerableKeys } from "@/lib/dispatch";
import type { FieldCase, MyWork, TeamOpenCase } from "@/lib/field-crew";
import { uploadProof } from "@/lib/upload";
import {
  buttonPrimary,
  buttonQuiet,
  buttonSecondary,
  card,
  errorNotice,
  hint,
  notice,
} from "@/lib/ui";

/**
 * A crew member's own screen (24 Oct 2026): the cases handed to them, with the exact point to
 * navigate to, the requester's number behind a tap, and the three things a crew reports - on the
 * way, arrived, rescued with photos. Below, the cases their team holds that nobody has picked up.
 *
 * It reads its own list every ten seconds while it is in front. What each tap may do is decided
 * by the database from the assignment; this screen only draws what came back (safety rule 5).
 */
const POLL_MS = 10_000;

type Answer = { work?: MyWork | null; phone?: string | null; error?: string };

export function MyCases({ initial, preview = false }: { initial: MyWork; preview?: boolean }) {
  const t = useTranslations("fieldCrew");
  const tSos = useTranslations("sos");
  const tReport = useTranslations("report");
  const locale = useLocale();
  const [work, setWork] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<"failed" | "refused" | "upload" | "done" | null>(null);
  const [phones, setPhones] = useState<Record<string, string | null>>({});
  const [finishing, setFinishing] = useState<string | null>(null);
  const asking = useRef(false);

  const name = (th: string, en: string) => (locale === "th" ? th : en || th);

  const refresh = useCallback(() => {
    if (asking.current) return;
    asking.current = true;
    fetch("/api/authority/mine", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        setWork((await res.json()) as MyWork);
      })
      .catch(() => undefined)
      .finally(() => {
        asking.current = false;
      });
  }, []);

  useEffect(() => {
    // The admin's preview shows made-up cases and never asks the server for anyone's.
    if (preview) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [refresh, preview]);

  const send = useCallback(
    (body: Record<string, unknown>, key: string, after?: (answer: Answer) => void) => {
      if (preview) {
        // Answered here, from the made-up list: nothing is sent and no real number is shown.
        setMessage(null);
        setWork((was) => {
          const sos = String(body.sos ?? "");
          if (body.action === "advance") {
            return {
              ...was,
              cases: was.cases.map((c) =>
                c.sosId === sos
                  ? { ...c, status: body.status === "on_site" ? "on_site" : "en_route" }
                  : c,
              ),
            };
          }
          if (body.action === "take") {
            const taken = was.open.find((o) => o.sosId === sos);
            if (!taken) return was;
            return {
              ...was,
              open: was.open.filter((o) => o.sosId !== sos),
              cases: [
                ...was.cases,
                {
                  ...(was.cases[0] ?? (initial.cases[0] as FieldCase)),
                  sosId: sos,
                  assignmentId: `a-${sos}`,
                  status: "assigned",
                  kind: taken.kind,
                  tambonTh: taken.tambonTh,
                  tambonEn: taken.tambonEn,
                  peopleCount: taken.peopleCount,
                  needs: taken.kind === "supplies" ? ["water", "food"] : [],
                },
              ],
            };
          }
          if (body.action === "release" || body.action === "complete") {
            return {
              ...was,
              cases: was.cases.filter((c) => c.sosId !== sos && c.assignmentId !== body.id),
            };
          }
          return was;
        });
        if (body.action === "complete") setMessage("done");
        after?.({ phone: null });
        return;
      }
      setBusy(key);
      setMessage(null);
      fetch("/api/authority/mine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
      })
        .then(async (res) => {
          const answer = (await res.json().catch(() => ({}))) as Answer;
          if (!res.ok) {
            setMessage("refused");
            refresh();
            return;
          }
          if (answer.work) setWork(answer.work);
          after?.(answer);
        })
        .catch(() => setMessage("failed"))
        .finally(() => setBusy(null));
    },
    [refresh, preview, initial.cases],
  );

  /** The photos go from this phone into the private bucket; then the report names them. */
  const finish = (sos: string, photos: File[], note: string) => {
    if (preview) {
      // No photo leaves the page in a preview.
      send({ action: "complete", sos }, sos, () => setFinishing(null));
      return;
    }
    setBusy(sos);
    setMessage(null);
    uploadProof(sos, photos).then(
      (sent) => {
        if (sent.photos.length === 0) {
          setBusy(null);
          setMessage("upload");
          return;
        }
        send({ action: "complete", sos, photos: sent.photos, note }, sos, () => {
          setFinishing(null);
          setMessage("done");
        });
      },
      () => {
        setBusy(null);
        setMessage("upload");
      },
    );
  };

  const copy = (c: FieldCase) => {
    void navigator.clipboard?.writeText(coordsText(c.lat, c.lon)).catch(() => undefined);
  };

  return (
    <div className="flex flex-col gap-5">
      {/* A case handed to this person reaches their phone with the page closed once this is on. */}
      {!preview && <PushCard place="team" />}
      {message && (
        <p
          className={message === "done" ? notice : errorNotice}
          role="status"
          data-crew-message={message}
        >
          {t(`message.${message}`)}
        </p>
      )}

      {work.cases.length === 0 && (
        <section className={card}>
          <p className="font-bold text-jaga-ink">{t("none.title")}</p>
          <p className={hint}>{t("none.body")}</p>
        </section>
      )}

      {work.cases.map((c) => {
        const flags = vulnerableKeys(c.vulnerableFlags);
        const phone = c.sosId in phones ? phones[c.sosId] : undefined;
        return (
          <section key={c.sosId} className={card} data-my-case={c.sosId} data-status={c.status}>
            <div className="flex flex-col gap-1">
              <h2 className="text-h3 font-bold text-jaga-ink">
                {name(c.tambonTh, c.tambonEn)}
                <span className={`block ${hint}`}>
                  {t(`status.${c.status}`)} · {c.unitName}
                </span>
              </h2>
              {c.kind === "supplies" && <p className="font-medium">{t("supplies")}</p>}
              <p>
                {c.peopleCount != null && t("people", { count: c.peopleCount })}
                {c.depthRef && ` · ${tReport(`depths.${c.depthRef}` as "depths.knee")}`}
              </p>
              {flags.length > 0 && (
                <p className="font-medium" data-flags="true">
                  {flags
                    .map((k) =>
                      tSos.has(`vulnerable.${k}`)
                        ? tSos(`vulnerable.${k}` as "vulnerable.elderly")
                        : k,
                    )
                    .join(" · ")}
                </p>
              )}
              {c.injuries && <p>{c.injuries}</p>}
              {c.textNote && <p>{c.textNote}</p>}
              {c.needs.length > 0 && (
                <p>
                  {c.needs
                    .map((n) => (tSos.has(`needs.${n}`) ? tSos(`needs.${n}` as "needs.water") : n))
                    .join(" · ")}
                </p>
              )}
              {c.locationText && <p className={hint}>{c.locationText}</p>}
              <p className={hint} dir="ltr">
                {coordsText(c.lat, c.lon)}
                {c.accuracyM != null ? ` (±${Math.round(c.accuracyM)} m)` : ""}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <a
                href={directionsHref(c.lat, c.lon)}
                target="_blank"
                rel="noreferrer"
                className={buttonSecondary}
                data-navigate="true"
              >
                <PinIcon size={20} />
                {t("navigate")}
              </a>
              <button type="button" className={buttonSecondary} onClick={() => copy(c)}>
                <ShareIcon size={20} />
                {t("copy")}
              </button>
              {phone === undefined && c.hasPhone && (
                <button
                  type="button"
                  className={`${buttonSecondary} col-span-2`}
                  disabled={busy === c.sosId}
                  onClick={() =>
                    send({ action: "phone", sos: c.sosId }, c.sosId, (a) =>
                      setPhones((seen) => ({ ...seen, [c.sosId]: a.phone ?? null })),
                    )
                  }
                  data-show-phone="true"
                >
                  <PhoneIcon size={20} />
                  {t("showPhone")}
                </button>
              )}
              {phone !== undefined && (
                <p className="col-span-2 font-medium" data-phone="true" dir="ltr">
                  {phone ? (
                    <a href={`tel:${phone}`} className="underline">
                      {phone}
                    </a>
                  ) : (
                    t("noPhone")
                  )}
                </p>
              )}
              {!c.hasPhone && phone === undefined && (
                <p className={`col-span-2 ${hint}`}>{t("noPhone")}</p>
              )}
              <p className={`col-span-2 ${hint}`}>{t("directionsWarning")}</p>
            </div>

            {finishing === c.sosId ? (
              <PhotoForm
                kind="complete"
                supplies={c.kind === "supplies"}
                busy={busy === c.sosId}
                onSend={(photos, note) => finish(c.sosId, photos, note)}
                onCancel={() => setFinishing(null)}
              />
            ) : (
              <div className="flex flex-col gap-2">
                {c.status === "assigned" && (
                  <button
                    type="button"
                    className={buttonPrimary}
                    disabled={busy === c.sosId}
                    onClick={() =>
                      send({ action: "advance", sos: c.sosId, status: "en_route" }, c.sosId)
                    }
                    data-advance="en_route"
                  >
                    <RunningPersonIcon size={20} />
                    {t("enRoute")}
                  </button>
                )}
                {c.status === "en_route" && (
                  <button
                    type="button"
                    className={buttonPrimary}
                    disabled={busy === c.sosId}
                    onClick={() =>
                      send({ action: "advance", sos: c.sosId, status: "on_site" }, c.sosId)
                    }
                    data-advance="on_site"
                  >
                    <PinIcon size={20} />
                    {t("arrived")}
                  </button>
                )}
                <button
                  type="button"
                  className={c.status === "on_site" ? buttonPrimary : buttonSecondary}
                  disabled={busy === c.sosId}
                  onClick={() => setFinishing(c.sosId)}
                  data-complete="true"
                >
                  <CheckIcon size={20} />
                  {t("rescued")}
                </button>
                <button
                  type="button"
                  className={buttonQuiet}
                  disabled={busy === c.sosId}
                  onClick={() => send({ action: "release", id: c.assignmentId }, c.sosId)}
                  data-step-off="true"
                >
                  {t("stepOff")}
                </button>
              </div>
            )}
          </section>
        );
      })}

      {work.open.length > 0 && (
        <section className={card} data-open-cases="true">
          <h2 className="font-bold text-jaga-ink">{t("open.title")}</h2>
          <p className={hint}>{t("open.hint")}</p>
          {work.open.map((o: TeamOpenCase) => (
            <div key={o.sosId} className="flex flex-col gap-2" data-open-case={o.sosId}>
              <p className="font-medium">
                {name(o.tambonTh, o.tambonEn)}
                <span className={`block ${hint}`}>
                  {o.unitName}
                  {o.peopleCount != null ? ` · ${t("people", { count: o.peopleCount })}` : ""}
                  {o.crewCount > 0 ? ` · ${t("open.crew", { count: o.crewCount })}` : ""}
                </span>
              </p>
              <button
                type="button"
                className={buttonSecondary}
                disabled={busy === o.sosId}
                onClick={() => send({ action: "take", sos: o.sosId }, o.sosId)}
                data-take="true"
              >
                {t("open.take")}
              </button>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
