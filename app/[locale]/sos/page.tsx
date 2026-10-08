import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { NotYet } from "@/components/sos/NotYet";
import { SendSOS } from "@/components/sos/SendSOS";
import { getPathname } from "@/i18n/navigation";
import { sosSendingEnabled } from "@/lib/features";
import { projectLine } from "@/lib/hotlines";
import { sosMessages } from "@/lib/messages";
import { createClient } from "@/lib/supabase/server";

/**
 * Rendered per request, not at build time. The launch switch and the "not in service yet" page it
 * controls are read here, and a prerendered page would freeze whichever answer the build saw: on
 * launch day the switch would do nothing until someone rebuilt the site. The page is small and
 * fetches nothing, and the service worker keeps the last visited copy for offline.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/[locale]/sos">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "sos" });
  return { title: t("label") };
}

type Place = { id: string; label: string; lat: number; lon: number };

/**
 * The SOS confirmation screen (spec 4.6): one screen between the home screen's button and a sent
 * request. ?place=<id> sends it for someone at one of the person's watched places (spec 4.9).
 *
 * Until the launch switch is on, this is a call-first page instead: nobody receives requests from
 * the app yet, so it must not look as though help is coming (safety rules 1 and 4).
 */
export default async function SosPage({ params, searchParams }: PageProps<"/[locale]/sos">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("sos");

  if (!sosSendingEnabled()) {
    return (
      <NotYet
        title={t("soonTitle")}
        body={t("soonBody")}
        back={t("back")}
        backHref={getPathname({ href: "/", locale })}
      />
    );
  }

  const { place: placeId } = await searchParams;
  const place = typeof placeId === "string" ? await watchedPlace(placeId) : null;
  return (
    <NextIntlClientProvider messages={sosMessages(await getMessages())}>
      <SendSOS projectLine={projectLine()} place={place} />
    </NextIntlClientProvider>
  );
}

/** The watched place this SOS is for, read with the person's own session (their rows only). */
async function watchedPlace(id: string): Promise<Place | null> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("saved_places")
      .select("id, label, point")
      .eq("id", id)
      .maybeSingle();
    const point = data?.point as { coordinates: [number, number] } | null;
    if (!data || !point) return null;
    return {
      id: data.id as string,
      label: data.label as string,
      lat: point.coordinates[1],
      lon: point.coordinates[0],
    };
  } catch {
    // Not signed in, or the database can't be reached: send a plain SOS instead of failing.
    return null;
  }
}
