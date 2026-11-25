"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLocale, useTranslations } from "next-intl";
import type { Area } from "@/lib/area";
import type { Gauge, GaugeData } from "@/lib/map-data";
import { useStored } from "@/lib/phone-store";
import { FloodScene } from "./FloodScene";

/**
 * Open the flood scene for one gauge from the bell (24 Nov 2026). The bell is fed by the light
 * gauge summary, which carries no channel; so on demand - only when the person taps Watch, and
 * only during an actual bank-reached event - this fetches the one full gauge and hands it to
 * `FloodScene`. Rendered through a portal to the document body so it stands above the bell panel
 * whatever the header's stacking. It never fires on its own: a measurement, shown when asked.
 */
const GAUGES_URL = "/api/public/gauges";

export function BankScene({ gaugeId, onClose }: { gaugeId: string; onClose: () => void }) {
  const t = useTranslations("map.gauge.scene");
  const locale = useLocale();
  const area = useStored<Area>("area");
  const [gauge, setGauge] = useState<Gauge | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(GAUGES_URL, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(
        (data: GaugeData) => {
          if (cancelled) return;
          const found = data.gauges.find((g) => g.id === gaugeId) ?? null;
          if (found) setGauge(found);
          else setFailed(true);
        },
        () => {
          if (!cancelled) setFailed(true);
        },
      );
    return () => {
      cancelled = true;
    };
  }, [gaugeId]);

  if (typeof document === "undefined") return null;

  const areaName = area ? (locale === "en" ? area.nameEn : area.nameTh) : null;

  const body = gauge ? (
    <FloodScene gauge={gauge} areaName={areaName} onClose={onClose} />
  ) : (
    // While the one gauge loads, or when it could not be read: a plain overlay with a way out, so
    // the person is never stranded on a blank screen (and the hotline bar stays below it).
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-x-0 top-0 bottom-[8.5rem] z-40 flex flex-col items-center justify-center gap-4 bg-jaga-slate p-6 text-center text-white sm:bottom-28"
      data-bank-scene-state={failed ? "unavailable" : "loading"}
    >
      <p className="text-lg font-medium">{failed ? t("unavailable") : t("loading")}</p>
      <button
        type="button"
        onClick={onClose}
        className="inline-flex min-h-tap items-center rounded-lg bg-white px-4 font-semibold text-jaga-slate"
      >
        {t("close")}
      </button>
    </div>
  );

  return createPortal(body, document.body);
}

/** The Watch control the bell shows on a bank-reached item; opens the scene when tapped. */
export function BankSceneButton({ gaugeId }: { gaugeId: string }) {
  const t = useTranslations("notices");
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-tap items-center gap-2 self-start rounded-lg bg-jaga-dam px-4 font-semibold text-white"
        data-bank-scene-open={gaugeId}
      >
        {t("bankReached.watch")}
      </button>
      {open && <BankScene gaugeId={gaugeId} onClose={() => setOpen(false)} />}
    </>
  );
}
