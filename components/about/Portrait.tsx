/* eslint-disable @next/next/no-img-element -- one small static file, sized in the markup */
import { useTranslations } from "next-intl";
import { initialsOf, PORTRAIT } from "@/lib/about";

/**
 * The founder's portrait on "Who built Jaga". A face is what makes the page land for the reader
 * who knows the owner personally, so there is a slot for one - but the page has to be complete
 * before the file exists, and it has to stay cheap on a slow connection.
 *
 * So: `show` is false until the owner puts a compressed portrait at `public/about/<PORTRAIT>`
 * (the repo's own limit: longest side 1600 px or less, quality about 0.7). Until then the card
 * draws the initials in the brand colours, the way a credits card does for an organisation with
 * no logo. The box keeps the same size either way, so the layout does not move when the photo
 * arrives.
 */
export function Portrait({ show = false }: { show?: boolean }) {
  const t = useTranslations("about");
  return (
    <span
      data-about-portrait={show ? "photo" : "initials"}
      className="grid size-28 shrink-0 place-items-center overflow-hidden rounded-3xl bg-white/10 ring-1 ring-white/25 lg:size-36"
    >
      {show ? (
        <img
          src={`/about/${PORTRAIT}`}
          alt={t("portraitAlt")}
          width={144}
          height={144}
          decoding="async"
          className="size-full object-cover"
        />
      ) : (
        <span aria-hidden="true" className="text-h1 font-bold leading-none text-white/85">
          {initialsOf(t("name"))}
        </span>
      )}
    </span>
  );
}
