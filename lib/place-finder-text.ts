import { getTranslations } from "next-intl/server";
import type { FinderText } from "@/components/account/PlaceFinder";

/**
 * The words of the "find the place" box, read on the server and handed to the field as plain
 * text, so the pages that have a pin to place send no extra messages to the browser for it.
 */
export async function finderText(): Promise<FinderText> {
  const t = await getTranslations("placeFinder");
  return {
    label: t("label"),
    hint: t("hint"),
    placeholder: t("placeholder"),
    search: t("search"),
    paste: t("paste"),
    searching: t("searching"),
    resolving: t("resolving"),
    results: t("results"),
    none: t("none"),
    failed: t("failed"),
    partial: t("partial"),
    linkFailed: t("linkFailed"),
    unknownLink: t("unknownLink"),
    pinned: t("pinned"),
    inArea: t("inArea"),
    notCovered: t("notCovered"),
    outside: t("outside"),
    credit: t("credit"),
    howTitle: t("howTitle"),
    how: [t("how.a"), t("how.b"), t("how.c")],
  };
}
