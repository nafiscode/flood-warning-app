import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AlertBadge } from "@/components/alerts/AlertBadge";
import { AlertStatus } from "@/components/alerts/AlertStatus";
import { Logo } from "@/components/brand/Logo";
import { HotlineBar } from "@/components/HotlineBar";
import { OpenMeteoAttribution } from "@/components/OpenMeteoAttribution";
import { SOSButton } from "@/components/sos/SOSButton";
import { contrastRatio } from "@/lib/brand/contrast";
import { alert, ALERT_LEVELS, brand } from "@/lib/brand/tokens";
import { devPagesEnabled } from "@/lib/dev-pages";

export const metadata: Metadata = { robots: { index: false, follow: false } };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-h3 font-bold text-jaga-ink">{title}</h2>
      {children}
    </section>
  );
}

export default async function BrandReview({ params }: PageProps<"/[locale]/dev/brand">) {
  if (!devPagesEnabled()) notFound();
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("devBrand");

  // A fixed sample: issued with a next update at 14:00 Bangkok, viewed at 16:30, so it is stale.
  const nextUpdateAt = new Date("2026-11-20T07:00:00Z");
  const viewedAt = new Date("2026-11-20T09:30:00Z");

  return (
    // Reviewed at 360 px, the target phone width (CLAUDE.md).
    <div className="mx-auto flex w-full max-w-[360px] flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-h2 font-bold">{t("title")}</h1>
        <p className="text-small text-jaga-text-2">{t("note")}</p>
      </header>

      <Section title={t("logo")}>
        <div className="flex flex-col items-start gap-4 rounded-xl bg-jaga-surface p-4">
          <Logo size={96} />
          <Logo size={64} layout="stacked" />
          <Logo size={48} />
          <div className="flex items-end gap-3">
            <Logo size={120} layout="mark" animated />
            <Logo size={64} layout="mark" />
            <Logo size={32} layout="mark" />
            <Logo size={16} layout="mark" />
          </div>
        </div>
        <div className="flex flex-col items-start gap-4 rounded-xl bg-jaga-slate p-4">
          <Logo size={96} tone="reverse" />
          <Logo size={40} tone="reverse" />
          <div className="flex items-end gap-3">
            <Logo size={64} layout="mark" tone="reverse" animated />
            <Logo size={32} layout="mark" tone="reverse" />
          </div>
        </div>
      </Section>

      <Section title={t("levels")}>
        <div className="flex flex-col items-start gap-3">
          {ALERT_LEVELS.map((level) => (
            <AlertBadge key={level} level={level} size="hero" />
          ))}
          <div className="flex flex-wrap gap-2">
            {ALERT_LEVELS.map((level) => (
              <AlertBadge key={level} level={level} />
            ))}
          </div>
        </div>
      </Section>

      <Section title={t("stale")}>
        <div className="flex flex-col items-start gap-3">
          {ALERT_LEVELS.map((level) => (
            <AlertStatus key={level} level={level} nextUpdateAt={nextUpdateAt} now={viewedAt} />
          ))}
        </div>
      </Section>

      <Section title={t("sos")}>
        <SOSButton href="#sos-demo" />
      </Section>

      <Section title={t("hotlines")}>
        <div className="overflow-hidden rounded-xl border border-jaga-line">
          <HotlineBar />
        </div>
      </Section>

      <Section title={t("attribution")}>
        <OpenMeteoAttribution />
      </Section>

      <Section title={t("tokens")}>
        <ul className="grid grid-cols-2 gap-2 text-small">
          {Object.entries(brand).map(([name, hex]) => (
            <li key={name} className="flex items-center gap-2">
              <span
                className="size-8 shrink-0 rounded border border-jaga-line"
                style={{ background: hex }}
              />
              <span className="leading-tight">
                {name}
                <br />
                <span className="text-jaga-text-2">{hex}</span>
              </span>
            </li>
          ))}
          {Object.entries(alert).map(([name, c]) => (
            <li key={name} className="flex items-center gap-2">
              <span
                className="flex size-8 shrink-0 items-center justify-center rounded text-small font-bold"
                style={{ background: c.bg, color: c.fg }}
              >
                Aa
              </span>
              <span className="leading-tight">
                {name}
                <br />
                <span className="text-jaga-text-2">
                  {c.bg} · {contrastRatio(c.fg, c.bg).toFixed(1)}:1
                </span>
              </span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
