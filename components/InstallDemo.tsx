"use client";

import { useTranslations } from "next-intl";
import Image from "next/image";
import type { ReactNode } from "react";
import { AddSquareIcon, InstallIcon, MenuDotsIcon, ShareIcon } from "@/components/icons";
import type { InstallGuide } from "@/lib/install";
import css from "./InstallDemo.module.css";

/** How long each picture stays before the next one, when the pictures play by themselves. */
export const DEMO_STEP_MS = 2800;

/** Which guides end on "and there is the icon". Leaving an in-app browser has no such ending. */
const HAS_RESULT: Record<InstallGuide, boolean> = {
  inApp: false,
  iosSafari: true,
  iosOther: true,
  android: true,
  macSafari: true,
  desktop: true,
};
const STEP_COUNT: Record<InstallGuide, number> = {
  inApp: 2,
  iosSafari: 3,
  iosOther: 3,
  android: 2,
  macSafari: 2,
  desktop: 2,
};

/** One picture per written step, and a last one showing the icon where there is one. */
export function demoFrames(guide: InstallGuide): number {
  return STEP_COUNT[guide] + (HAS_RESULT[guide] ? 1 : 0);
}

const WIDE: InstallGuide[] = ["desktop", "macSafari"];

const bar = "flex h-9 shrink-0 items-center gap-2 bg-jaga-surface px-3 text-jaga-ink";
const pill = "h-5 flex-1 rounded-full bg-jaga-ground";
const grey = "h-2 rounded-full bg-jaga-line";

/** "Tap here": a ring that pulses round whatever it is given. */
function Target({ children }: { children: ReactNode }) {
  return (
    <span className={css.target} data-demo-target="true">
      {children}
    </span>
  );
}

/** The page behind the menus: Jaga's own, reduced to its icon and a few lines. */
function Page({ dim = false }: { dim?: boolean }) {
  return (
    <div className={`flex flex-1 flex-col gap-2 p-3 ${dim ? "opacity-40" : ""}`}>
      <div className="flex items-center gap-2">
        <Image
          src="/icons/icon-192.png"
          alt=""
          width={22}
          height={22}
          unoptimized
          className="rounded-md"
        />
        <span className={`${grey} w-12`} />
      </div>
      <span className="h-12 rounded-lg bg-jaga-line" />
      <span className={`${grey} w-4/5`} />
      <span className={`${grey} w-3/5`} />
    </div>
  );
}

/** A menu: grey lines for the entries that don't matter, and the one to tap written out. */
function Rows({
  before,
  after,
  icon,
  label,
}: {
  before: number;
  after: number;
  icon?: ReactNode;
  label: string;
}) {
  const filler = (n: number, key: string) =>
    Array.from({ length: n }, (_, i) => (
      <span key={key + i} className="flex h-7 items-center px-2">
        <span className={`${grey} ${i % 2 ? "w-2/3" : "w-1/2"}`} />
      </span>
    ));
  return (
    <>
      {filler(before, "b")}
      <span
        className={`${css.pick} flex min-h-7 items-center gap-1.5 rounded-md bg-jaga-ground px-2 py-1 text-[11px] leading-tight font-bold text-jaga-ink`}
        data-demo-target="true"
      >
        {icon}
        {label}
      </span>
      {filler(after, "a")}
    </>
  );
}

/** The ending: a home screen, a taskbar or a Dock, with Jaga's icon arriving on it. */
function Result({ wide, label }: { wide: boolean; label: string }) {
  const tile = "size-8 rounded-lg bg-jaga-line";
  const jaga = (
    <span className={`${css.pop} flex flex-col items-center gap-0.5`} data-demo-result="true">
      <Image
        src="/icons/icon-192.png"
        alt=""
        width={32}
        height={32}
        unoptimized
        className="rounded-lg"
      />
      {!wide && <span className="text-[10px] leading-none font-bold text-jaga-ink">Jaga</span>}
    </span>
  );
  return wide ? (
    <div className="flex flex-1 flex-col justify-end gap-2 bg-jaga-ground">
      <p className="px-3 text-center text-[11px] font-bold text-jaga-ink">{label}</p>
      <div className="flex items-center justify-center gap-2 bg-jaga-surface p-2">
        <span className={tile} />
        <span className={tile} />
        {jaga}
        <span className={tile} />
      </div>
    </div>
  ) : (
    <div className="flex flex-1 flex-col gap-3 bg-jaga-ground p-3">
      <div className="grid grid-cols-4 justify-items-center gap-x-1 gap-y-3">
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} className={tile} />
        ))}
        {jaga}
      </div>
      <p className="mt-auto text-center text-[11px] font-bold text-jaga-ink">{label}</p>
    </div>
  );
}

/**
 * A drawing of the phone or computer screen at one step of "add to home screen": where to tap,
 * the menu that opens, and the icon arriving. It is a drawing, not a screenshot - every phone's
 * menu looks a little different - and it is decoration: the written steps beside it say the same
 * thing, so it is hidden from screen readers.
 */
export function InstallDemo({ guide, frame }: { guide: InstallGuide; frame: number }) {
  const t = useTranslations("install.demo");
  const wide = WIDE.includes(guide);
  const share = <ShareIcon size={18} />;
  const dots = <MenuDotsIcon size={18} />;
  const addHome = (
    <Rows before={2} after={1} icon={<AddSquareIcon size={14} />} label={t("addHome")} />
  );
  const sheet = (
    <div
      className={`${css.sheet} absolute inset-x-0 bottom-0 flex flex-col gap-0.5 rounded-t-xl border-t border-jaga-line bg-jaga-surface p-2`}
    >
      {addHome}
    </div>
  );
  const dropdown = (rows: ReactNode, start = false) => (
    <div
      className={`${start ? `${css.dropStart} start-1` : `${css.drop} end-1`} absolute top-9 flex w-4/5 max-w-44 flex-col gap-0.5 rounded-lg border border-jaga-line bg-jaga-surface p-1.5 shadow-lg`}
    >
      {rows}
    </div>
  );
  const confirm = (
    <>
      <div className={`${bar} justify-between border-b border-jaga-line`}>
        <span className={`${grey} w-8`} />
        <Target>
          <span className="px-1 text-[12px] font-bold text-jaga-teal-ink">{t("add")}</span>
        </Target>
      </div>
      <div className="flex items-center gap-2 p-3">
        <Image
          src="/icons/icon-192.png"
          alt=""
          width={32}
          height={32}
          unoptimized
          className="rounded-lg"
        />
        <span className="text-[12px] font-bold text-jaga-ink">Jaga</span>
      </div>
    </>
  );
  const topBar = (end: ReactNode, on: boolean) => (
    <div className={`${bar} border-b border-jaga-line`}>
      <span className={pill} />
      {on ? <Target>{end}</Target> : end}
    </div>
  );
  const result = <Result wide={wide} label={t(wide ? "doneComputer" : "donePhone")} />;

  const frames: Record<InstallGuide, ReactNode[]> = {
    iosSafari: [
      <>
        <Page />
        <div className={`${bar} justify-center border-t border-jaga-line`}>
          <span className={`${grey} w-5`} />
          <Target>{share}</Target>
          <span className={`${grey} w-5`} />
        </div>
      </>,
      <>
        <Page dim />
        {sheet}
      </>,
      confirm,
      result,
    ],
    iosOther: [
      <>
        {topBar(share, true)}
        <Page />
      </>,
      <>
        {topBar(share, false)}
        <Page dim />
        {sheet}
      </>,
      confirm,
      result,
    ],
    android: [
      <>
        {topBar(dots, true)}
        <Page />
      </>,
      <>
        {topBar(dots, false)}
        <Page dim />
        {dropdown(
          <Rows
            before={2}
            after={1}
            icon={<AddSquareIcon size={14} />}
            label={t("addHomeAndroid")}
          />,
        )}
      </>,
      result,
    ],
    inApp: [
      <>
        {topBar(dots, false)}
        <Page />
      </>,
      <>
        {topBar(dots, true)}
        <Page dim />
        {dropdown(<Rows before={1} after={1} label={t("openBrowser")} />)}
      </>,
    ],
    desktop: [
      <>
        {topBar(<InstallIcon size={18} />, true)}
        <Page />
      </>,
      <>
        {topBar(<InstallIcon size={18} />, false)}
        <Page dim />
        {dropdown(
          <>
            <span className="flex items-center gap-1.5 px-1 py-1 text-[11px] font-bold text-jaga-ink">
              <Image src="/icons/icon-192.png" alt="" width={18} height={18} unoptimized />
              Jaga
            </span>
            <Rows before={0} after={0} icon={<InstallIcon size={14} />} label={t("install")} />
          </>,
        )}
      </>,
      result,
    ],
    macSafari: [
      <>
        <div className={`${bar} border-b border-jaga-line text-[11px]`}>
          <span className={`${grey} w-6`} />
          <Target>
            <span className="px-1 font-bold">{t("file")}</span>
          </Target>
          <span className={`${grey} w-6`} />
          <span className={`${grey} w-6`} />
        </div>
        <Page />
      </>,
      <>
        <div className={`${bar} border-b border-jaga-line text-[11px]`}>
          <span className={`${grey} w-6`} />
          <span className="px-1 font-bold">{t("file")}</span>
          <span className={`${grey} w-6`} />
          <span className={`${grey} w-6`} />
        </div>
        <Page dim />
        {dropdown(<Rows before={2} after={1} label={t("addDock")} />, true)}
      </>,
      result,
    ],
  };
  const shown = Math.min(frame, frames[guide].length - 1);

  return (
    <div
      aria-hidden="true"
      data-install-demo={guide}
      data-frame={shown}
      className={`relative mx-auto flex shrink-0 flex-col overflow-hidden border-4 border-jaga-edge bg-jaga-ground ${
        wide ? "h-44 w-full max-w-72 rounded-xl" : "h-64 w-40 rounded-3xl"
      }`}
    >
      {/* A new key for each picture, so its menu slides in again every time it comes round. */}
      <div key={shown} className="relative flex min-h-0 flex-1 flex-col">
        {frames[guide][shown]}
      </div>
    </div>
  );
}
