import { BackIcon, HouseIcon } from "@/components/icons";
import { Link } from "@/i18n/navigation";
import { buttonSecondary } from "@/lib/ui";

/**
 * The way back from a page that is not the home screen (the owner, 16 Oct: every page needs one,
 * not only the header's links). `href` is the plain route; the Link adds the language itself.
 * The home screen gets a house, anything else an arrow.
 */
export function BackLink({ href = "/", label }: { href?: string; label: string }) {
  return (
    <Link
      href={href}
      prefetch={false}
      // Full width on a phone, a button-sized button where there is room.
      className={`${buttonSecondary} gap-2 sm:w-auto sm:self-start sm:px-8`}
      data-back-link={href}
    >
      {href === "/" ? <HouseIcon size={22} /> : <BackIcon size={22} />}
      {label}
    </Link>
  );
}
