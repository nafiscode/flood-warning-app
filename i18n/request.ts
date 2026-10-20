import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";

/**
 * The copy of pages that are *about somebody* (today: "Who built Jaga") does not live in this
 * repository - the owner's decision of 20 Oct 2026, because the repo is public and their career
 * and face are not something they chose to publish here. `scripts/fetch-content.mjs` brings it
 * down during the build into `messages/about/`, which is gitignored.
 *
 * This import is resolved at **build** time, not per request, so a page costs nothing extra to
 * serve. Where the file is absent - a fork, or a build that could not reach the bucket - the
 * namespace is simply missing and the page that needs it takes itself out of the way.
 */
async function aboutMessages(locale: string): Promise<Record<string, unknown>> {
  try {
    return { about: (await import(`../messages/about/${locale}.json`)).default };
  } catch {
    return {};
  }
}

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  return {
    locale,
    messages: {
      ...(await import(`../messages/${locale}.json`)).default,
      ...(await aboutMessages(locale)),
    },
    timeZone: "Asia/Bangkok",
  };
});
