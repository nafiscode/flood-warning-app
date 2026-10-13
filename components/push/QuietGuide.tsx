"use client";

import { useTranslations } from "next-intl";
import Image from "next/image";
import { type ReactNode, useEffect, useState } from "react";
import { BellIcon, CheckIcon, MoonIcon, PauseIcon, PlayIcon } from "@/components/icons";
import { DEMO_STEP_MS } from "@/components/InstallDemo";
import { useOnPhone } from "@/lib/phone-store";
import { QUIET_FRAMES, QUIET_STEPS, quietGuide, type QuietGuide } from "@/lib/quiet";
import { hint } from "@/lib/ui";
import pick from "../InstallDemo.module.css";
import css from "./QuietGuide.module.css";

const grey = "h-2 rounded-full bg-jaga-line";
const jagaIcon = (size: number) => (
  <Image
    src="/icons/icon-192.png"
    alt=""
    width={size}
    height={size}
    unoptimized
    className="rounded-md"
  />
);

/** A settings screen: its name, grey lines for the rows that don't matter, the one to tap. */
function Screen({
  title,
  before,
  after,
  icon,
  label,
  end,
}: {
  title: string;
  before: number;
  after: number;
  icon?: ReactNode;
  label: string;
  end?: ReactNode;
}) {
  const filler = (n: number, key: string) =>
    Array.from({ length: n }, (_, i) => (
      <span key={key + i} className="flex h-7 items-center gap-2 px-2">
        <span className="size-4 shrink-0 rounded bg-jaga-line" />
        <span className={`${grey} ${i % 2 ? "w-2/3" : "w-1/2"}`} />
      </span>
    ));
  return (
    <>
      <p className="shrink-0 bg-jaga-surface px-3 py-2 text-[12px] leading-tight font-bold text-jaga-ink">
        {title}
      </p>
      <div className="flex flex-1 flex-col gap-0.5 p-2">
        {filler(before, "b")}
        <span
          className={`${pick.pick} flex min-h-7 items-center gap-1.5 rounded-md bg-jaga-surface px-2 py-1 text-[11px] leading-tight font-bold text-jaga-ink`}
          data-demo-target="true"
        >
          {icon}
          <span className="flex-1">{label}</span>
          {end}
        </span>
        {filler(after, "a")}
      </div>
    </>
  );
}

/**
 * A drawing of the phone's settings at one step of "let Jaga through Do Not Disturb". It is a
 * drawing, not a screenshot - every phone's settings look a little different - and it is
 * decoration: the written steps beside it say the same thing, so screen readers skip it.
 */
export function QuietDemo({ guide, frame }: { guide: QuietGuide; frame: number }) {
  const t = useTranslations("push.quiet.demo");
  const moon = <MoonIcon size={14} />;
  const apps = t(guide === "ios" ? "appsIos" : "appsAndroid");
  const first =
    guide === "ios" ? (
      <Screen title={t("settings")} before={2} after={2} icon={moon} label={t("focus")} />
    ) : (
      <Screen
        title={t("settings")}
        before={2}
        after={2}
        icon={<BellIcon size={14} />}
        label={t("notifications")}
      />
    );
  const frames: ReactNode[] = [
    first,
    <Screen
      key="dnd"
      title={t(guide === "ios" ? "focus" : "notifications")}
      before={guide === "ios" ? 0 : 2}
      after={guide === "ios" ? 3 : 1}
      icon={moon}
      label={t("dnd")}
    />,
    <Screen key="apps" title={t("dnd")} before={1} after={2} label={apps} />,
    <Screen
      key="jaga"
      title={apps}
      before={1}
      after={2}
      icon={jagaIcon(18)}
      label="Jaga"
      end={<CheckIcon size={14} className="text-jaga-teal-ink" />}
    />,
    // The ending: the phone asleep, and Jaga's notification coming through all the same.
    <div
      key="done"
      className="flex flex-1 flex-col items-center gap-3 bg-jaga-slate p-2 text-white"
      data-demo-result="true"
    >
      <span
        className={`${css.banner} flex w-full items-center gap-1.5 rounded-xl bg-jaga-surface p-1.5 text-jaga-ink`}
      >
        {jagaIcon(22)}
        <span className="flex flex-1 flex-col gap-1">
          <span className="text-[10px] leading-none font-bold">Jaga</span>
          <span className={`${grey} w-4/5`} />
        </span>
        <BellIcon size={16} className={css.ringing} />
      </span>
      <MoonIcon size={40} className="mt-auto" />
      <p className="mb-auto text-center text-[11px] leading-tight font-bold">{t("done")}</p>
    </div>,
  ];
  const shown = Math.min(frame, frames.length - 1);
  return (
    <div
      aria-hidden="true"
      data-quiet-demo={guide}
      data-frame={shown}
      className="relative mx-auto flex h-64 w-40 shrink-0 flex-col overflow-hidden rounded-3xl border-4 border-jaga-edge bg-jaga-ground"
    >
      {/* A new key for each picture, so its movement starts again every time it comes round. */}
      <div key={shown} className="relative flex min-h-0 flex-1 flex-col">
        {frames[shown]}
      </div>
    </div>
  );
}

/**
 * "Let Jaga through Do Not Disturb and Sleep": a folded guide under the notifications card, with
 * a moving picture and the same steps in words. It says plainly that only the person can set
 * this, and that a notification let through still follows the phone's volume.
 */
export function QuietGuideView({
  guide,
  startOpen = false,
}: {
  guide: QuietGuide;
  startOpen?: boolean;
}) {
  const t = useTranslations("push.quiet");
  const [open, setOpen] = useState(startOpen);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    if (!open || !playing) return;
    // Someone who asked their phone for less motion steps through by tapping the steps instead.
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => setFrame((f) => (f + 1) % QUIET_FRAMES), DEMO_STEP_MS);
    return () => window.clearInterval(id);
  }, [open, playing]);

  return (
    <div className="flex flex-col gap-3" data-quiet={guide}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        data-quiet-button="true"
        className="inline-flex min-h-tap items-center gap-2 self-start text-start underline"
      >
        <MoonIcon size={22} className="shrink-0" />
        {t("button")}
      </button>
      {open && (
        <>
          <p>{t("intro")}</p>
          <QuietDemo guide={guide} frame={frame} />
          <button
            type="button"
            onClick={() => setPlaying(!playing)}
            data-quiet-play={playing ? "on" : "off"}
            className="inline-flex min-h-tap items-center gap-2 self-center underline"
          >
            {playing ? <PauseIcon size={20} /> : <PlayIcon size={20} />}
            {t(playing ? "pause" : "play")}
          </button>
          <ol className="flex flex-col gap-1" data-quiet-steps={guide}>
            {Array.from({ length: QUIET_STEPS }, (_, i) => (
              <li key={i}>
                {/* Tapping a step shows its picture and holds it there. */}
                <button
                  type="button"
                  onClick={() => {
                    setFrame(i);
                    setPlaying(false);
                  }}
                  aria-current={frame === i ? "step" : undefined}
                  className={`flex min-h-tap w-full items-start gap-3 rounded-xl p-1.5 text-start ${
                    frame === i ? "bg-jaga-ground" : ""
                  }`}
                >
                  <span
                    className={`flex size-10 shrink-0 items-center justify-center rounded-xl border bg-jaga-ground font-bold text-jaga-ink ${
                      frame === i ? "border-2 border-jaga-teal-ink" : "border-jaga-line"
                    }`}
                  >
                    {i + 1}
                  </span>
                  <span className="pt-1">{t(`${guide}.s${i + 1}`)}</span>
                </button>
              </li>
            ))}
          </ol>
          {guide === "android" && <p className={hint}>{t("brands")}</p>}
          <p className={hint}>{t("sound")}</p>
        </>
      )}
    </div>
  );
}

/** Which guide this phone gets, once the page is alive in a browser. None on a computer. */
export function useQuietGuide(): QuietGuide | null {
  const ready = useOnPhone();
  if (!ready) return null;
  return quietGuide(navigator.userAgent, navigator.maxTouchPoints ?? 0);
}
