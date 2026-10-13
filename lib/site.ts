/**
 * Where Jaga lives on the web, for the things that must be whole addresses: the picture and the
 * link a chat app shows when someone shares Jaga.
 *
 * `NEXT_PUBLIC_SITE_URL` wins once the project has its own domain. Until then Vercel says which
 * address is the live one; on a laptop it is localhost.
 */
export function siteUrl(env: Record<string, string | undefined> = process.env): string {
  const own = env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "");
  if (own && /^https?:\/\//.test(own)) return own;
  const vercel = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  return "http://localhost:3000";
}

/**
 * The picture a link to Jaga carries (scripts/og.mjs draws it). Chat apps keep a link's picture
 * for a long time, so a new picture gets a new number here and in the script.
 */
export const SHARE_IMAGE = { url: "/og/jaga-share-1.png", width: 1200, height: 630 } as const;

/** The address to share for a language: Thai is the bare address, the others carry their code. */
export function sharePath(locale: string): string {
  return locale === "th" ? "/" : `/${locale}`;
}

/** Open Graph wants a language and a region. */
export const OG_LOCALE: Record<string, string> = { th: "th_TH", ms: "ms_MY", en: "en_US" };
