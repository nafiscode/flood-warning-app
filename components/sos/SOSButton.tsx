import { useTranslations } from "next-intl";
import { LifebuoyIcon } from "@/components/icons";

type Props = {
  /** Where the button goes. The SOS flow arrives in A5; until then callers must pass a working target. */
  href: string;
  className?: string;
};

/** The SOS button: always the SOS label, icon and red (docs/brand.md). One tap, no login wall. */
export function SOSButton({ href, className = "" }: Props) {
  const t = useTranslations("sos");
  return (
    <a
      href={href}
      className={`flex min-h-20 w-full items-center justify-center gap-3 rounded-2xl bg-sos px-6 py-3 text-sos-fg shadow-md active:translate-y-px ${className}`}
    >
      <LifebuoyIcon size={36} />
      <span className="flex flex-col items-start leading-tight">
        <span className="text-h2 font-bold">{t("label")}</span>
        <span className="text-body font-medium">{t("action")}</span>
      </span>
    </a>
  );
}
