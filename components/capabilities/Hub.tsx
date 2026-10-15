/* eslint-disable @next/next/no-img-element -- the logo is a small static SVG */
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { HouseIcon, LifebuoyIcon, ShieldIcon, WaveIcon } from "@/components/icons";
import { markSrc } from "@/components/brand/Logo";
import s from "./Scene.module.css";

/**
 * What Jaga is, in one picture (A17): a carrier in the middle. What the rivers, the rain and the
 * dam say comes in from the top; the alerts that people (the admins, at the bottom) write go out
 * to residents on one side; a resident's request goes out to the teams nearby on the other. The
 * dashes run the way things travel. Jaga itself rescues nobody, and the picture never says it does.
 *
 * Laid out as a grid rather than a drawing, so the labels wrap like any text at 360 px and in all
 * three languages; the links are dashed lines whose dashes move (still under reduced motion).
 */
export function Hub() {
  const t = useTranslations("capabilities.hub");
  return (
    <figure className="flex flex-col gap-4" data-capabilities-hub>
      <div
        className="mx-auto grid w-full max-w-md grid-cols-[minmax(0,1fr)_2.25rem_auto_2.25rem_minmax(0,1fr)] items-center"
        aria-hidden="true"
      >
        <Node className="col-span-5" icon={<WaveIcon size={22} />}>
          {t("rivers")}
        </Node>
        <span className={`col-start-3 ${s.vline} ${s.down}`} />

        {/* This row lines up on the icons' centres, not on the labels under them. */}
        <Node className="col-start-1 self-start pt-2.5" icon={<HouseIcon size={22} />}>
          {t("you")}
        </Node>
        {/* Alerts out to the person, and their request in: two lines, two ways. */}
        <span className="mt-[26px] flex flex-col gap-2 self-start">
          <span className={`${s.hline} ${s.left}`} />
          <span className={`${s.hline} ${s.right}`} />
        </span>
        <span className="grid size-16 place-items-center self-start rounded-full border-2 border-jaga-teal-light bg-jaga-slate shadow-lg">
          <img src={markSrc(40, "reverse")} width={28} height={40} alt="" />
        </span>
        <span className={`mt-[30.5px] self-start ${s.hline} ${s.right}`} />
        <Node className="self-start pt-2.5" icon={<LifebuoyIcon size={22} />}>
          {t("teams")}
        </Node>

        <span className={`col-start-3 ${s.vline} ${s.up}`} />
        <Node className="col-span-5" icon={<ShieldIcon size={22} />}>
          {t("admins")}
        </Node>
      </div>
      <figcaption className="text-center text-small text-white/90">{t("caption")}</figcaption>
    </figure>
  );
}

function Node({
  className = "",
  icon,
  children,
}: {
  className?: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <span
      className={`flex flex-col items-center gap-1 text-center text-small font-medium leading-snug text-white ${className}`}
    >
      <span className="grid size-11 place-items-center rounded-full bg-white/10 text-jaga-teal-light ring-1 ring-white/25">
        {icon}
      </span>
      {children}
    </span>
  );
}
