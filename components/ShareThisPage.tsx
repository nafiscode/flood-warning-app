import { useLocale, useTranslations } from "next-intl";
import { SharePair } from "@/components/SharePair";
import { sharePath } from "@/lib/site";

/**
 * The share pair at the foot of a page somebody reads rather than uses (the owner, 20 Oct 2026):
 * this page, and Jaga. A server component, so every word is read here and handed to the client
 * one as plain strings - those pages send no message namespace to the browser.
 *
 * `title` and `text` are the page's own, so what lands in a chat says what the link is. The
 * second button keeps `install.share`, which is Jaga's own line and already written in three
 * languages.
 */
export function ShareThisPage({
  path,
  title,
  text,
}: {
  path: string;
  title: string;
  text: string;
}) {
  const t = useTranslations("share");
  const app = useTranslations("install.share");
  const locale = useLocale();
  const here = locale === "th" ? path : `/${locale}${path}`;
  return (
    <SharePair
      heading={t("heading")}
      body={t("body")}
      page={{ path: here, title, text, button: t("thisPage") }}
      app={{
        path: sharePath(locale),
        title: app("title"),
        text: app("text"),
        button: app("button"),
      }}
      copied={app("copied")}
      manual={app("manual")}
    />
  );
}
