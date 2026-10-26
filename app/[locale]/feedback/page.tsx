import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { FeedbackForm } from "@/components/feedback/FeedbackForm";
import { MyComments } from "@/components/feedback/MyComments";
import { PublicComments } from "@/components/feedback/PublicComments";
import { PublicFigures } from "@/components/feedback/PublicFigures";
import { HouseIcon } from "@/components/icons";
import { Link } from "@/i18n/navigation";
import { MOMENTS, type Moment, type PublicComment, type PublicFigures as Figures } from "@/lib/feedback";
import { feedbackMessages } from "@/lib/messages";
import { alternates } from "@/lib/seo";
import { createPublicClient } from "@/lib/supabase/public";
import { supabaseConfigured } from "@/lib/supabase/env";
import { formColumn, hint, notice } from "@/lib/ui";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/feedback">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "feedback" });
  return {
    title: t("title"),
    description: t("lead"),
    alternates: alternates(locale, "/feedback"),
  };
}

/**
 * Rendered per request: the figures and the comments change when an admin approves one, and a
 * page frozen at build time would still be showing last month's numbers. Both reads are small
 * and neither carries anything personal.
 */
export const dynamic = "force-dynamic";

/**
 * `/feedback` (A15, spec 17): the page both collects and publishes.
 *
 * In order: the form, then Jaga's own figures, then the approved comments - the owner's layout of
 * 16 Oct 2026. Open without an account, in all three languages.
 *
 * **What this page may never carry** (spec 17, safety rules 3, 6, 8 and 9): an alert colour, a
 * level, a hazard icon, a donation prompt, or anything finer about a person than the service area
 * by month. It stays reachable at its address even at Warning and Evacuate - it is the invitation
 * that stops, not the door - which is why the link to it, not the page, is what the tense check
 * in `components/FeaturesLink.tsx` hides.
 */
export default async function FeedbackPage({
  params,
  searchParams,
}: PageProps<"/[locale]/feedback">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const query = await searchParams;
  const t = await getTranslations("feedback");

  const moment: Moment = MOMENTS.find((m) => m === query.moment) ?? "menu";
  const sos = typeof query.case === "string" && isUuid(query.case) ? query.case : null;

  const { figures, comments } = await read();

  return (
    <div className={`flex flex-col gap-8 ${formColumn}`} data-feedback-page="true">
      <section className="flex flex-col gap-3">
        <Link
          href="/"
          prefetch={false}
          className="inline-flex min-h-tap items-center gap-2 self-start font-medium underline"
          data-back-home="true"
        >
          <HouseIcon size={22} />
          {t("home")}
        </Link>
        <h1 className="text-h2 font-bold text-jaga-ink">{t("title")}</h1>
        <p>{t("lead")}</p>
        {/* This page is about the app, and says so before it asks anything. */}
        <p className={notice}>{t("notFlood")}</p>
        <p className={hint}>{t("emergency")}</p>
      </section>

      <NextIntlClientProvider messages={feedbackMessages(await getMessages())}>
        <FeedbackForm screen="/feedback" moment={moment} sos={sos} />
        {/* Only drawn where this device has a comment of its own to take down. */}
        <MyComments />
      </NextIntlClientProvider>

      {figures && <PublicFigures figures={figures} locale={locale} />}
      {comments && <PublicComments comments={comments} locale={locale} />}
    </div>
  );
}

/**
 * The two public reads, as a visitor. Either failing leaves that part off the page rather than
 * breaking the form: somebody who came here to say the app is slow must still be able to say it.
 */
async function read(): Promise<{ figures: Figures | null; comments: PublicComment[] | null }> {
  if (!supabaseConfigured()) return { figures: null, comments: null };
  const supabase = createPublicClient();
  const [figuresAnswer, commentsAnswer] = await Promise.all([
    supabase.rpc("public_feedback_figures", { p_months: 12 }),
    supabase.rpc("public_feedback", { p_limit: 50 }),
  ]);
  const figures = (figuresAnswer.data ?? null) as Figures | null;
  const rows = Array.isArray(commentsAnswer.data) ? commentsAnswer.data : null;
  const comments =
    rows?.map((row: Record<string, unknown>) => ({
      id: row.id as string,
      month: (row.month as string) ?? "",
      displayName: (row.display_name as string | null) ?? null,
      rating: (row.rating as number | null) ?? null,
      liked: (row.liked as string[] | null) ?? [],
      likedNote: (row.liked_note as string | null) ?? null,
      improve: (row.improve as string[] | null) ?? [],
      improveNote: (row.improve_note as string | null) ?? null,
    })) ?? null;
  return { figures: figuresAnswer.error ? null : figures, comments };
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
