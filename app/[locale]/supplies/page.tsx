import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { NotYet } from "@/components/sos/NotYet";
import { SendSupplies } from "@/components/sos/SendSupplies";
import { getPathname } from "@/i18n/navigation";
import { sosSendingEnabled } from "@/lib/features";
import { sosMessages } from "@/lib/messages";
import { alternates } from "@/lib/seo";

// Rendered per request for the same reason as /sos: the launch switch is read here.
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/supplies">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "sos" });
  return { title: t("supplies.label"), alternates: alternates(locale, "/supplies") };
}

/**
 * Asking for food, drinking water and essentials (spec 4.10): for someone who is safe where they
 * are and cut off by the water. It is sent like an SOS and followed on the same case page.
 *
 * Until the launch switch is on nobody receives requests, so this is the same call-first page as
 * /sos: it must not look as though a delivery is coming (safety rules 1 and 4).
 */
export default async function SuppliesPage({ params }: PageProps<"/[locale]/supplies">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("sos");

  if (!sosSendingEnabled()) {
    return (
      <NotYet
        title={t("supplies.soonTitle")}
        body={t("supplies.soonBody")}
        back={t("back")}
        backHref={getPathname({ href: "/", locale })}
      />
    );
  }

  return (
    <NextIntlClientProvider messages={sosMessages(await getMessages())}>
      <SendSupplies />
    </NextIntlClientProvider>
  );
}
