import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { About } from "@/components/about/About";
import { Portrait } from "@/components/about/Portrait";
import { Link } from "@/i18n/navigation";
import { PORTRAIT, PORTRAIT_READY } from "@/lib/about";
import { devPagesEnabled } from "@/lib/dev-pages";
import { hint } from "@/lib/ui";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * "Who built Jaga" for review, before it becomes the public page at `/about` (the owner's
 * request, 20 Oct 2026: design it in dev first). Development and Vercel previews only
 * (lib/dev-pages.ts), so nothing about the owner is public until they have read it.
 *
 * It also shows the portrait slot both ways, because that was the one thing the owner left to
 * decide at review: `?photo=1` renders the page with the photo, which needs a file at
 * `public/about/<PORTRAIT>` to show anything.
 */
export default async function AboutReviewPage({
  params,
  searchParams,
}: PageProps<"/[locale]/dev/about">) {
  if (!devPagesEnabled()) notFound();
  const { locale } = await params;
  const query = await searchParams;
  // Shows the page as it really is; `?photo=0` shows the initials the slot falls back to.
  const photo = query.photo === "0" ? false : PORTRAIT_READY || query.photo === "1";
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 rounded-2xl border border-jaga-line bg-jaga-ground p-4">
        <h1 className="text-h3 font-bold text-jaga-ink">Review: who built Jaga</h1>
        <p className={hint}>
          Not public yet. This page lives at <code>/dev/about</code>; once it is approved it moves
          to <code>/about</code> and gains a third tab on &ldquo;How Jaga works&rdquo; and a line in
          the footer links. Thai is the source copy; Malay still shows the English until round 2 of
          the translation.
        </p>
        <p className={hint}>
          <b>Check the wording:</b> the four paragraphs under &ldquo;why I built this&rdquo; are now
          written from what you told me &mdash; that you are from the region but were abroad for the
          last two floods, and that Jaga is for everyone else to use before and during one. Read
          them and tell me if any of it lands wrong. Everything else comes from your career profile.
        </p>
        <div className="flex flex-col gap-2">
          <p className="font-medium text-jaga-ink">The portrait slot, both ways</p>
          <div className="flex items-center gap-4 rounded-2xl bg-jaga-slate p-4">
            <Portrait />
            <Portrait show cut />
          </div>
          <p className={hint}>
            Left: the initials, which the slot falls back to. Right: the portrait the page draws
            now, cut out of the photo you sent and standing in the page&rsquo;s own light (
            <code>public/about/{PORTRAIT}</code>, 25 KB).
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            href={photo ? "/dev/about?photo=0" : "/dev/about?photo=1"}
            prefetch={false}
            className="inline-flex min-h-tap items-center font-medium text-jaga-ink underline"
          >
            {photo ? "Show the initials instead" : "Show the page with the photo"}
          </Link>
          {(["th", "en", "ms"] as const)
            .filter((l) => l !== locale)
            .map((l) => (
              <a
                key={l}
                href={`/${l}/dev/about${photo ? "" : "?photo=0"}`}
                className="inline-flex min-h-tap items-center font-medium text-jaga-ink underline"
              >
                Read it in {l}
              </a>
            ))}
        </div>
      </header>

      <About showPortrait={photo} />
    </div>
  );
}
