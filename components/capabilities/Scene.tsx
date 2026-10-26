import { useTranslations } from "next-intl";
import type { CSSProperties, ReactNode } from "react";
import {
  BellIcon,
  CameraIcon,
  CheckIcon,
  DropIcon,
  HouseIcon,
  LifebuoyIcon,
  MegaphoneIcon,
  ParcelIcon,
  PhoneIcon,
  PersonIcon,
  PinIcon,
  ShieldIcon,
  TriangleIcon,
  TrophyIcon,
} from "@/components/icons";
import type { Scene as SceneName } from "@/lib/capabilities";
import { HAZARD_CLASSES } from "@/lib/hazard-layer";
import { MINE_COLORS } from "@/lib/mine-colors";
import s from "./Scene.module.css";

/**
 * A small moving drawing of the real screen behind one capability (A17). Decorative: the line of
 * words beside it says everything, so the drawing is hidden from screen readers. The few words
 * inside it come from the message files like any other text on the page.
 */
export function Scene({ name }: { name: SceneName }) {
  return (
    <div className={s.frame} aria-hidden="true" data-scene={name}>
      <Drawing name={name} />
    </div>
  );
}

function Drawing({ name }: { name: SceneName }) {
  const t = useTranslations("capabilities.scene");
  const level = useTranslations("alert.level");
  const needs = useTranslations("sos.needs");
  const sos = useTranslations("sos");

  switch (name) {
    case "alert":
      return (
        <Screen>
          <span className="inline-flex w-fit items-center gap-1 rounded-md bg-alert-warning px-2 py-0.5 font-bold text-alert-warning-fg">
            <TriangleIcon size={14} />
            {level("warning")}
          </span>
          <span className={s.bar} style={{ width: "85%" }} />
          <span className={s.bar} style={{ width: "60%" }} />
          {[s.s1, s.s2, s.s3].map((step, i) => (
            <span key={i} className="flex items-center gap-2">
              <span className="grid size-4 place-items-center rounded border border-jaga-teal-ink text-jaga-teal-ink">
                <CheckIcon size={12} className={step} />
              </span>
              <span className={s.bar} style={{ width: `${70 - i * 12}%` }} />
            </span>
          ))}
        </Screen>
      );

    case "map":
      return (
        <svg viewBox="0 0 200 100" preserveAspectRatio="xMidYMid slice" className="size-full">
          <path
            d="M-5 70 C 30 60, 50 80, 85 62 S 140 30, 205 38"
            fill="none"
            stroke="var(--jaga-dam)"
            strokeWidth="9"
            opacity="0.25"
          />
          <ellipse cx="78" cy="64" rx="34" ry="16" fill={HAZARD_CLASSES[2].color} opacity="0.6" />
          <ellipse cx="80" cy="64" rx="20" ry="9" fill={HAZARD_CLASSES[1].color} opacity="0.6" />
          <ellipse cx="150" cy="40" rx="26" ry="11" fill={HAZARD_CLASSES[2].color} opacity="0.6" />
          <path
            d="M-5 70 C 30 60, 50 80, 85 62 S 140 30, 205 38"
            fill="none"
            stroke="var(--jaga-dam)"
            strokeWidth="2.5"
            className={s.flow}
          />
          {/* A river gauge: a glass whose water rises. */}
          <rect
            x="112"
            y="54"
            width="10"
            height="22"
            rx="2"
            fill="var(--jaga-surface)"
            stroke="var(--jaga-ink)"
          />
          <rect
            x="113.5"
            y="60"
            width="7"
            height="14.5"
            rx="1"
            fill="var(--jaga-dam)"
            className={s.rise}
          />
          {/* Safe places: small squares. */}
          {[
            [36, 30],
            [166, 72],
          ].map(([x, y]) => (
            <rect
              key={x}
              x={x! - 5}
              y={y! - 5}
              width="10"
              height="10"
              rx="2.5"
              fill="var(--jaga-teal-ink)"
            />
          ))}
          {/* The person's own home. */}
          <circle
            cx="60"
            cy="40"
            r="6"
            fill="var(--jaga-teal)"
            stroke="var(--jaga-surface)"
            strokeWidth="2.5"
          />
          <circle cx="60" cy="40" r="11" fill="none" stroke="var(--jaga-teal)" className={s.s4} />
        </svg>
      );

    case "sos":
      return (
        <Screen>
          <span
            className={`${s.press} flex items-center justify-center gap-1.5 rounded-xl bg-sos py-2 text-base font-bold text-sos-fg`}
          >
            <LifebuoyIcon size={18} />
            {sos("label")}
          </span>
          <Steps words={[t("sent"), t("accepted"), t("coming")]} />
        </Screen>
      );

    case "supplies":
      return (
        <Screen>
          <div className="flex flex-wrap gap-1.5">
            {(["water", "food", "baby", "medicine"] as const).map((need, i) => (
              <span key={need} className={`${s.chip} ${s.chipOn}`}>
                {i === 0 ? <DropIcon size={12} /> : <ParcelIcon size={12} />}
                {needs(need).split(" (")[0]}
                <CheckIcon size={12} className={[s.s1, s.s2, s.s3, s.s4][i]} />
              </span>
            ))}
          </div>
          <span className={s.bar} style={{ width: "70%" }} />
          <span className={s.bar} style={{ width: "45%" }} />
        </Screen>
      );

    case "places":
      return (
        <Screen>
          {[0.8, 1.4, 2.1].map((km, i) => (
            <span
              key={km}
              className={`flex items-center gap-2 rounded-lg px-1.5 py-1 ${
                i === 0 ? `bg-jaga-teal-ink/10 ${s.ping}` : ""
              }`}
            >
              <span className="grid size-5 shrink-0 place-items-center rounded-md bg-jaga-teal-ink text-jaga-surface">
                <HouseIcon size={12} />
              </span>
              <span className={s.bar} style={{ width: "50%" }} />
              <span className="ms-auto font-medium">{t("km", { n: km })}</span>
            </span>
          ))}
        </Screen>
      );

    case "watch":
      return (
        <svg viewBox="0 0 200 100" preserveAspectRatio="xMidYMid slice" className="size-full">
          <path
            d="M0 80 L60 60 L110 72 L200 40"
            fill="none"
            stroke="var(--jaga-line)"
            strokeWidth="6"
          />
          <path d="M40 0 L70 100" fill="none" stroke="var(--jaga-line)" strokeWidth="4" />
          {[
            { x: 52, y: 42, c: "var(--jaga-teal)", r: 7, label: t("home"), cls: "" },
            { x: 120, y: 60, c: MINE_COLORS[1], r: 5.5, label: t("family"), cls: s.s2 },
            { x: 165, y: 30, c: MINE_COLORS[2], r: 5.5, label: t("shop"), cls: s.s3 },
          ].map((p) => (
            <g key={p.x} className={p.cls}>
              <circle
                cx={p.x}
                cy={p.y}
                r={p.r}
                fill={p.c}
                stroke="var(--jaga-surface)"
                strokeWidth="2.5"
              />
              <text
                x={p.x}
                y={p.y + p.r + 11}
                textAnchor="middle"
                fontSize="10"
                fontWeight="600"
                fill="var(--jaga-ink)"
              >
                {p.label}
              </text>
            </g>
          ))}
        </svg>
      );

    case "register":
      return (
        <Screen>
          <span className={s.bar} style={{ width: "55%" }} />
          <span className="h-5 rounded-md border border-jaga-line" />
          <div className="grid grid-cols-5 gap-1">
            {Array.from({ length: 10 }, (_, i) => (
              <span
                key={i}
                className={`h-3 rounded-sm ${
                  [1, 2, 6, 7].includes(i) ? `bg-jaga-teal-ink ${s.s1}` : "bg-jaga-line"
                }`}
              />
            ))}
          </div>
          <span
            className={`${s.chip} ${s.chipOn} ${s.s3} w-fit`}
            style={{ marginBlockStart: "0.15rem" }}
          >
            <ShieldIcon size={12} />
            {t("verified")}
          </span>
        </Screen>
      );

    case "offer":
      return (
        <Screen>
          <span className="flex items-center gap-2 font-bold text-jaga-ink">
            <span className={s.swing}>
              <BellIcon size={16} />
            </span>
            {t("newRequest")}
            <Countdown />
          </span>
          <span className={s.bar} style={{ width: "80%" }} />
          <span className={s.bar} style={{ width: "55%" }} />
          <span
            className={`${s.ping} mt-1 rounded-lg bg-jaga-slate py-1.5 text-center font-bold text-white`}
          >
            {t("accept")}
          </span>
        </Screen>
      );

    case "eta":
      return (
        <Screen>
          <div className="flex gap-1">
            {["15", "15–30", "30–60"].map((band, i) => (
              <span key={band} className={`${s.chip} ${i === 1 ? `${s.chipOn} ${s.s2}` : ""}`}>
                {i === 0 ? `< ${t("minutes", { n: band })}` : t("minutes", { n: band })}
              </span>
            ))}
          </div>
          <div className="relative mt-2 h-8">
            <span className="absolute inset-x-0 top-1/2 border-t-2 border-dashed border-jaga-line" />
            <span className="absolute end-0 top-1/2 -translate-y-1/2 text-jaga-teal-ink">
              <PinIcon size={20} />
            </span>
            <span className={`absolute start-[45%] top-0 ${s.travel}`}>
              <span className="grid size-8 place-items-center rounded-full bg-jaga-slate text-white">
                <LifebuoyIcon size={18} />
              </span>
            </span>
          </div>
        </Screen>
      );

    case "finish":
      return (
        <Screen>
          <span className="relative grid h-16 place-items-center overflow-hidden rounded-lg bg-jaga-ground text-jaga-text-2">
            <CameraIcon size={28} />
            <span className={`${s.flash} absolute inset-0 bg-white`} />
          </span>
          <span className={`${s.chip} ${s.chipOn} ${s.s3} w-fit`}>
            <CheckIcon size={12} />
            {t("safe")}
          </span>
        </Screen>
      );

    case "field":
      return (
        <svg viewBox="0 0 200 100" preserveAspectRatio="xMidYMid slice" className="size-full">
          <path
            d="M0 70 C 60 55, 120 85, 200 60"
            fill="none"
            stroke="var(--jaga-dam)"
            strokeWidth="2.5"
            className={s.flow}
          />
          <g className={s.drop}>
            <path
              d="M100 18 a14 14 0 0 1 14 14 c0 11 -14 24 -14 24 s-14 -13 -14 -24 a14 14 0 0 1 14 -14z"
              fill="var(--jaga-teal-ink)"
            />
            <circle cx="100" cy="32" r="5" fill="var(--jaga-surface)" />
          </g>
          <g className={s.s3}>
            <rect x="122" y="22" width="34" height="18" rx="9" fill="var(--jaga-slate)" />
            <text x="139" y="35" textAnchor="middle" fontSize="11" fontWeight="700" fill="white">
              +2
            </text>
          </g>
        </svg>
      );

    case "coverage":
      return (
        <Screen>
          <div className="grid grid-cols-6 gap-1">
            {Array.from({ length: 18 }, (_, i) => {
              const gap = i === 4 || i === 15;
              const mine = [7, 8, 13, 14].includes(i);
              return (
                <span
                  key={i}
                  className={`h-3.5 rounded-sm ${
                    gap
                      ? "border border-dashed border-jaga-text-2"
                      : mine
                        ? "bg-jaga-teal-ink"
                        : "bg-jaga-teal-ink/30"
                  }`}
                />
              );
            })}
          </div>
          <span className={`${s.chip} ${s.chipOn} ${s.s3} mt-1 w-fit`}>
            <TrophyIcon size={12} />
            +12
          </span>
        </Screen>
      );

    case "suppliesBoard":
      return (
        <Screen>
          {[0, 1].map((row) => (
            <span
              key={row}
              className={`flex items-center gap-2 rounded-lg border border-jaga-line px-2 py-1.5 ${
                row === 0 ? s.s1 : s.s2
              }`}
            >
              <span className="grid size-6 shrink-0 place-items-center rounded-md bg-jaga-teal-ink/15 text-jaga-teal-ink">
                <ParcelIcon size={14} />
              </span>
              <span className="flex flex-1 flex-col gap-1">
                <span className={s.bar} style={{ width: row ? "60%" : "80%" }} />
                <span className="flex gap-1 text-jaga-teal-ink">
                  <DropIcon size={12} />
                  <ParcelIcon size={12} />
                </span>
              </span>
            </span>
          ))}
        </Screen>
      );

    case "escalate":
      return (
        <Screen>
          <span className="flex items-center gap-2 rounded-lg border border-jaga-line px-2 py-1.5">
            <ParcelIcon size={16} />
            <span className={s.bar} style={{ width: "60%" }} />
          </span>
          <span className={`${s.s2} self-center text-jaga-text-2`}>↓</span>
          <span
            className={`${s.s3} flex items-center gap-1.5 rounded-lg bg-sos px-2 py-1.5 font-bold text-sos-fg`}
          >
            <LifebuoyIcon size={16} />
            {sos("label")}
          </span>
        </Screen>
      );

    case "console":
      return (
        <Screen>
          <span className="flex items-center gap-2">
            <MegaphoneIcon size={16} />
            <span className="inline-flex items-center gap-1 rounded-md bg-alert-watch px-1.5 py-0.5 font-bold text-alert-watch-fg">
              {level("watch")}
            </span>
          </span>
          <div className="grid grid-cols-5 gap-1">
            {Array.from({ length: 10 }, (_, i) => (
              <span
                key={i}
                className={`h-3 rounded-sm ${[2, 3, 7].includes(i) ? `bg-jaga-ink ${s.s1}` : "bg-jaga-line"}`}
              />
            ))}
          </div>
          <span className={`${s.chip} ${s.s2} w-fit`}>
            <CheckIcon size={12} />
            {t("reviewed")}
          </span>
          <span
            className={`${s.s3} rounded-lg bg-jaga-slate py-1 text-center font-bold text-white`}
          >
            {t("publish")}
          </span>
        </Screen>
      );

    case "signals":
      return (
        <svg viewBox="0 0 200 100" preserveAspectRatio="none" className="size-full">
          <line
            x1="0"
            y1="38"
            x2="200"
            y2="38"
            stroke="var(--jaga-ink)"
            strokeDasharray="5 4"
            strokeWidth="1.2"
          />
          <path
            d="M0 82 C 30 80, 50 78, 75 72 S 110 60, 130 48 S 160 26, 200 22"
            fill="none"
            stroke="var(--jaga-teal-ink)"
            strokeWidth="3"
            pathLength={100}
            vectorEffect="non-scaling-stroke"
            className={s.draw}
          />
        </svg>
      );

    case "autoAlarm":
      return (
        <Screen>
          <span className="flex items-center justify-center gap-3 py-1">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="grid size-9 place-items-center rounded-full bg-jaga-slate text-white"
              >
                <span
                  className={s.swing}
                  style={{ animationDelay: `${i * 0.15}s` } as CSSProperties}
                >
                  <BellIcon size={16} />
                </span>
              </span>
            ))}
          </span>
          <span className="flex items-center justify-center gap-2 font-bold text-jaga-ink">
            <Countdown />
            {t("minutes", { n: 20 })}
          </span>
        </Screen>
      );

    case "warRoom":
      return (
        <Screen>
          <div className="grid grid-cols-3 gap-1.5">
            {[3, 12, 41].map((n, i) => (
              <span
                key={n}
                className={`flex flex-col items-center rounded-lg border border-jaga-line py-1.5 ${
                  [s.s1, s.s2, s.s3][i]
                }`}
              >
                <span className="text-lg font-bold text-jaga-ink">{n}</span>
                <span className={s.bar} style={{ width: "60%" }} />
              </span>
            ))}
          </div>
          <span className={s.bar} style={{ width: "75%" }} />
          <span className={s.bar} style={{ width: "50%" }} />
        </Screen>
      );

    case "people":
      return (
        <Screen>
          <span className="w-fit rounded-md border border-jaga-line px-2 py-0.5 font-mono text-[0.7rem] font-bold tracking-widest text-jaga-ink">
            7F3A9-C21B4
          </span>
          {[0, 1].map((row) => (
            <span key={row} className="flex items-center gap-2">
              <span className="grid size-6 place-items-center rounded-full bg-jaga-ground text-jaga-text-2">
                <PersonIcon size={14} />
              </span>
              <span className={s.bar} style={{ width: row === 0 ? "38%" : "28%" }} />
              {row === 0 ? (
                <span className={`${s.chip} ${s.chipOn} ${s.s3}`}>
                  <CheckIcon size={12} />
                  {t("letIn")}
                </span>
              ) : (
                <span className={`${s.chip} ${s.s1}`}>{t("letIn")}</span>
              )}
            </span>
          ))}
        </Screen>
      );

    case "crew":
      return (
        <Screen>
          <span className="flex items-center gap-2 font-bold text-jaga-ink">
            <LifebuoyIcon size={16} />
            <span className={s.bar} style={{ width: "45%" }} />
          </span>
          <div className="flex items-center gap-2">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className={`grid size-7 place-items-center rounded-full ${
                  i === 1 ? `${s.ping} bg-jaga-slate text-white` : "bg-jaga-ground text-jaga-text-2"
                }`}
              >
                <PersonIcon size={16} />
              </span>
            ))}
          </div>
          <span className={`${s.chip} ${s.chipOn} ${s.s3} w-fit`}>
            <PinIcon size={12} />
            {t("coming")}
          </span>
        </Screen>
      );

    case "teamRoom":
      return (
        <svg viewBox="0 0 200 100" preserveAspectRatio="xMidYMid slice" className="size-full">
          <rect x="6" y="8" width="38" height="84" rx="5" fill="var(--jaga-ground)" />
          {[0, 1, 2].map((i) => (
            <rect
              key={i}
              x="10"
              y={14 + i * 16}
              width="30"
              height="11"
              rx="3"
              fill={i === 0 ? "var(--jaga-sos)" : "var(--jaga-line)"}
            />
          ))}
          <rect x="50" y="8" width="94" height="84" rx="5" fill="var(--jaga-ground)" />
          <path
            d="M50 62 C 75 50, 95 78, 144 52"
            fill="none"
            stroke="var(--jaga-dam)"
            strokeWidth="3"
            opacity="0.5"
            className={s.flow}
          />
          <circle cx="92" cy="46" r="6" fill="var(--jaga-sos)" />
          <circle cx="92" cy="46" r="11" fill="none" stroke="var(--jaga-sos)" strokeWidth="1.5" />
          <circle cx="116" cy="64" r="4" fill="var(--jaga-text)" />
          <rect
            x="150"
            y="8"
            width="44"
            height="84"
            rx="5"
            fill="var(--jaga-surface)"
            stroke="var(--jaga-line)"
          />
          <rect x="155" y="14" width="34" height="8" rx="3" fill="var(--jaga-line)" />
          <rect x="155" y="26" width="24" height="5" rx="2" fill="var(--jaga-line)" />
          <g className={s.s3}>
            <rect x="155" y="70" width="34" height="14" rx="5" fill="var(--jaga-slate)" />
            <text x="172" y="80" textAnchor="middle" fontSize="8" fontWeight="700" fill="white">
              {t("accept")}
            </text>
          </g>
        </svg>
      );

    case "verify":
      return (
        <Screen>
          <span className="flex items-center justify-center gap-4 py-2">
            <span
              className={`${s.swing} grid size-10 place-items-center rounded-full bg-jaga-slate text-white`}
            >
              <PhoneIcon size={20} />
            </span>
            <span
              className={`${s.s3} grid size-10 place-items-center rounded-full bg-jaga-teal-ink text-jaga-surface`}
            >
              <ShieldIcon size={20} />
            </span>
          </span>
          <span className={`${s.chip} ${s.chipOn} ${s.s3} self-center`}>
            <CheckIcon size={12} />
            {t("verified")}
          </span>
        </Screen>
      );

    case "dam":
      return (
        <svg viewBox="0 0 200 100" preserveAspectRatio="xMidYMid slice" className="size-full">
          {/* The reservoir behind the dam, its water rising; the river below it running. */}
          <rect
            x="0"
            y="40"
            width="82"
            height="60"
            fill="var(--jaga-dam)"
            opacity="0.55"
            className={s.rise}
          />
          <path d="M78 22 L100 22 L118 100 L74 100 Z" fill="var(--jaga-slate)" />
          <path
            d="M118 92 C 140 88, 160 94, 205 90"
            fill="none"
            stroke="var(--jaga-dam)"
            strokeWidth="4"
            className={s.flow}
          />
          <path
            d="M120 84 C 145 78, 165 86, 205 80"
            fill="none"
            stroke="var(--jaga-dam)"
            strokeWidth="2"
            opacity="0.6"
            className={s.flow}
          />
        </svg>
      );
  }
}

function Screen({ children }: { children: ReactNode }) {
  return <div className={s.screen}>{children}</div>;
}

/** Three steps of a request, ticked one after another. */
function Steps({ words }: { words: string[] }) {
  return (
    <div className="mt-1 grid grid-cols-3 gap-1 text-center">
      {words.map((word, i) => (
        <span key={word} className="flex flex-col items-center gap-1">
          <span
            className={`grid size-5 place-items-center rounded-full bg-jaga-teal-ink text-jaga-surface ${
              [s.s1, s.s2, s.s3][i]
            }`}
          >
            <CheckIcon size={12} />
          </span>
          <span className="text-[0.8125rem] leading-tight text-jaga-text-2">{word}</span>
        </span>
      ))}
    </div>
  );
}

/** A ring that empties: the time a team has to answer, or before the alarm acts by itself. */
function Countdown() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" className="-rotate-90">
      <circle cx="10" cy="10" r="8" fill="none" stroke="var(--jaga-line)" strokeWidth="3" />
      <circle
        cx="10"
        cy="10"
        r="8"
        fill="none"
        stroke="var(--jaga-teal-ink)"
        strokeWidth="3"
        pathLength={100}
        className={s.sweep}
      />
    </svg>
  );
}
