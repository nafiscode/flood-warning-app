import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import {
  AddSquareIcon,
  BellIcon,
  CameraIcon,
  CheckIcon,
  ClockIcon,
  CloudSunIcon,
  CrossIcon,
  DropIcon,
  ForwardIcon,
  HouseIcon,
  LifebuoyIcon,
  ListIcon,
  MapIcon,
  MegaphoneIcon,
  ParcelIcon,
  PhoneIcon,
  PinIcon,
  ShieldIcon,
  TriangleIcon,
  TrophyIcon,
  WaveIcon,
} from "@/components/icons";
import { SOSButton } from "@/components/sos/SOSButton";
import { getPathname, Link } from "@/i18n/navigation";
import {
  CAPABILITIES,
  CAPABILITY_ROLES,
  COMING_HAZARDS,
  RESIDENT_EXTRAS,
  type Capability,
  type CapabilityIcon,
  type CapabilityRole,
} from "@/lib/capabilities";
import { buttonPrimary, buttonQuiet, buttonSecondary } from "@/lib/ui";
import { AdminOnly } from "./AdminOnly";
import { ShareThisPage } from "@/components/ShareThisPage";
import { Hub } from "./Hub";
import { RolePicker } from "./RolePicker";
import { Scene } from "./Scene";

const ICONS: Record<CapabilityIcon, (size: number) => ReactNode> = {
  alert: (n) => <TriangleIcon size={n} />,
  map: (n) => <MapIcon size={n} />,
  sos: (n) => <LifebuoyIcon size={n} />,
  parcel: (n) => <ParcelIcon size={n} />,
  house: (n) => <HouseIcon size={n} />,
  pin: (n) => <PinIcon size={n} />,
  add: (n) => <AddSquareIcon size={n} />,
  bell: (n) => <BellIcon size={n} />,
  clock: (n) => <ClockIcon size={n} />,
  camera: (n) => <CameraIcon size={n} />,
  list: (n) => <ListIcon size={n} />,
  shield: (n) => <ShieldIcon size={n} />,
  wave: (n) => <WaveIcon size={n} />,
  megaphone: (n) => <MegaphoneIcon size={n} />,
  trophy: (n) => <TrophyIcon size={n} />,
  drop: (n) => <DropIcon size={n} />,
  cloud: (n) => <CloudSunIcon size={n} />,
};

const ROLE_ICONS: Record<CapabilityRole, CapabilityIcon> = {
  resident: "house",
  team: "sos",
  supplies: "parcel",
  admin: "shield",
};

/**
 * "What Jaga can do" (A17): who Jaga is for and where each thing is in the app. Built to be read
 * in a minute: what Jaga is in one picture, the SOS button where it always is, then one role at a
 * time, each capability a drawing, one line, where to find it and a button that opens it. No
 * donation prompt (safety rule 9); hazards still to come are named as placeholders only, with the
 * hotline to call instead (rule 10); the hotlines stay in the bar below (rule 4).
 */
export function Capabilities() {
  const t = useTranslations("capabilities");
  const hazardName = useTranslations("sos.hazards");
  const locale = useLocale();

  const choices = CAPABILITY_ROLES.map((role) => ({
    role,
    name: t(`roles.${role}.name`),
    who: t(`roles.${role}.who`),
    icon: ICONS[ROLE_ICONS[role]](22),
    panel: <RolePanel role={role} />,
  }));

  return (
    <div className="flex flex-col gap-8" data-capabilities>
      {/* What Jaga is, in the brand slate: the one place on the page that is meant to impress. */}
      <section className="relative overflow-hidden rounded-3xl bg-jaga-slate px-5 py-7 text-white lg:grid lg:grid-cols-[1.1fr_1fr] lg:items-center lg:gap-8 lg:px-10 lg:py-10">
        <div className="flex flex-col gap-4">
          <h1 className="text-h2 font-bold leading-tight lg:text-h1">{t("title")}</h1>
          <p className="text-body text-white/90">{t("lead")}</p>
          <ul className="flex flex-wrap gap-2" data-capabilities-stats>
            {(["provinces", "tambons", "rivers", "offline"] as const).map((key) => (
              <li
                key={key}
                className="rounded-full bg-white/10 px-3 py-1 text-small font-medium ring-1 ring-white/20"
              >
                {t(`stats.${key}`)}
              </li>
            ))}
          </ul>
        </div>
        <div className="mt-6 lg:mt-0">
          <Hub />
        </div>
      </section>

      {/* Help first, as on every screen of the app: nothing here comes before asking for it. */}
      <section className="flex flex-col gap-2" data-capabilities-sos>
        <SOSButton href={getPathname({ href: "/sos", locale })} />
        <p className="text-small text-jaga-text-2">{t("emergency")}</p>
      </section>

      <section className="grid gap-3 sm:grid-cols-2" aria-labelledby="jaga-is">
        <h2 id="jaga-is" className="text-h3 font-bold text-jaga-ink sm:col-span-2">
          {t("is.title")}
        </h2>
        <IsList
          title={t("is.doesTitle")}
          yes
          items={[t("is.does1"), t("is.does2"), t("is.does3")]}
        />
        <IsList title={t("is.notTitle")} items={[t("is.not1"), t("is.not2"), t("is.not3")]} />
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="jaga-who">
        <div>
          <h2 id="jaga-who" className="text-h3 font-bold text-jaga-ink">
            {t("picker.title")}
          </h2>
          <p className="text-jaga-text-2">{t("picker.hint")}</p>
        </div>
        <RolePicker choices={choices} label={t("picker.label")} />
      </section>

      <section
        className="flex flex-col gap-3"
        aria-labelledby="jaga-hazards"
        data-capabilities-hazards
      >
        <h2 id="jaga-hazards" className="text-h3 font-bold text-jaga-ink">
          {t("hazards.title")}
        </h2>
        <ul className="grid grid-cols-2 gap-2 lg:grid-cols-5">
          <li className="col-span-2 flex items-center gap-3 rounded-2xl border-2 border-jaga-teal-ink bg-jaga-surface p-3 lg:col-span-1">
            <WaveIcon size={24} />
            <span className="flex flex-col">
              <span className="font-bold text-jaga-ink">{hazardName("flood")}</span>
              <span className="text-small text-jaga-text-2">{t("hazards.now")}</span>
            </span>
          </li>
          {/* Placeholders: grey, dashed, no data and no colour that could read as "all clear". */}
          {COMING_HAZARDS.map(({ key, hotline }) => (
            <li
              key={key}
              data-coming-hazard={key}
              className="flex flex-col gap-1 rounded-2xl border-2 border-dashed border-jaga-line p-3 text-jaga-text-2"
            >
              <span className="font-medium text-jaga-text">{hazardName(key)}</span>
              <span className="text-small">{t("hazards.soon")}</span>
              <a
                href={`tel:${hotline}`}
                className="mt-auto inline-flex min-h-tap items-center gap-1.5 font-bold text-jaga-ink underline"
              >
                <PhoneIcon size={18} />
                {t("hazards.call", { number: hotline })}
              </a>
            </li>
          ))}
        </ul>
        <p className="text-small text-jaga-text-2">{t("hazards.note")}</p>
      </section>

      <section className="flex flex-col gap-4 rounded-3xl border border-jaga-line bg-jaga-surface p-5 lg:p-8">
        <h2 className="text-h3 font-bold text-jaga-ink">{t("closing.title")}</h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {(["free", "languages", "offline", "privacy"] as const).map((key) => (
            <li key={key} className="flex items-start gap-2">
              <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-jaga-teal-ink text-jaga-surface">
                <CheckIcon size={14} />
              </span>
              {t(`closing.${key}`)}
            </li>
          ))}
        </ul>
        <div className="grid gap-2 sm:grid-cols-2">
          <Link href="/" prefetch={false} className={buttonPrimary}>
            <HouseIcon size={22} />
            {t("closing.home")}
          </Link>
          <Link href="/map" prefetch={false} className={buttonSecondary}>
            <MapIcon size={22} />
            {t("closing.map")}
          </Link>
        </div>
      </section>

      {/* Pass it on: this page, or Jaga. */}
      <ShareThisPage path="/features" title={t("title")} text={t("lead")} />
    </div>
  );
}

function IsList({ title, items, yes = false }: { title: string; items: string[]; yes?: boolean }) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-jaga-line bg-jaga-surface p-4">
      <h3 className="font-bold text-jaga-ink">{title}</h3>
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li key={item} className="flex items-start gap-2">
            <span
              className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full ${
                yes
                  ? "bg-jaga-teal-ink text-jaga-surface"
                  : "bg-jaga-ground text-jaga-ink ring-1 ring-jaga-line"
              }`}
            >
              {yes ? <CheckIcon size={14} /> : <CrossIcon size={14} />}
            </span>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function RolePanel({ role }: { role: CapabilityRole }) {
  const t = useTranslations("capabilities");
  return (
    <div className="flex flex-col gap-4">
      <p className="rounded-2xl bg-jaga-teal-ink/10 px-4 py-3 text-jaga-ink">
        {t(`roles.${role}.intro`)}
      </p>
      <h3 className="sr-only">{t("canDo")}</h3>
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {CAPABILITIES[role].map((item) => (
          <CapabilityCard key={item.key} item={item} adminOnly={role === "admin"} />
        ))}
      </ul>
      {role === "admin" && <p className="text-small text-jaga-text-2">{t("admin.note")}</p>}
      {role === "resident" && (
        <div className="flex flex-col gap-2">
          <h3 className="font-bold text-jaga-ink">{t("alsoTitle")}</h3>
          <ul className="grid gap-2 sm:grid-cols-2">
            {RESIDENT_EXTRAS.map((extra) => (
              <li key={extra.key}>
                <Link
                  href={extra.href}
                  prefetch={false}
                  data-capability-extra={extra.key}
                  className="flex min-h-tap items-center gap-3 rounded-2xl border border-jaga-line bg-jaga-surface px-4 py-3 hover:border-jaga-teal-ink"
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-jaga-ground text-jaga-ink">
                    {ICONS[extra.icon](20)}
                  </span>
                  <span className="flex flex-col">
                    <span className="font-medium text-jaga-ink">
                      {t(`extras.${extra.key}.title`)}
                    </span>
                    <span className="text-small text-jaga-text-2">
                      {t(`extras.${extra.key}.text`)}
                    </span>
                  </span>
                  <ForwardIcon
                    size={20}
                    className="ms-auto shrink-0 text-jaga-text-2 rtl:-scale-x-100"
                  />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function CapabilityCard({ item, adminOnly }: { item: Capability; adminOnly: boolean }) {
  const t = useTranslations("capabilities");
  const open = (
    <Link
      href={item.href}
      prefetch={false}
      className={`${buttonQuiet} justify-center`}
      data-capability-open={item.key}
    >
      {t("open")}
      <ForwardIcon size={20} className="rtl:-scale-x-100" />
    </Link>
  );
  return (
    <li
      className="flex min-w-0 flex-col gap-3 rounded-2xl border border-jaga-line bg-jaga-surface p-3"
      data-capability={item.key}
    >
      <Scene name={item.scene} />
      <div className="flex flex-1 flex-col gap-2 px-1">
        <h4 className="flex items-start gap-2 font-bold leading-snug text-jaga-ink">
          <span className="mt-0.5 shrink-0 text-jaga-teal-ink">{ICONS[item.icon](22)}</span>
          {t(`items.${item.key}.title`)}
        </h4>
        <p className="text-jaga-text">{t(`items.${item.key}.text`)}</p>
        <p className="text-small text-jaga-text-2" data-capability-where>
          <span className="font-medium">{t("whereLabel")}: </span>
          {t(`items.${item.key}.where`)}
        </p>
      </div>
      {adminOnly ? <AdminOnly>{open}</AdminOnly> : open}
    </li>
  );
}
