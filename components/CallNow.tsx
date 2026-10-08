import { useTranslations } from "next-intl";
import { PhoneIcon } from "@/components/icons";
import { HOTLINES, type HotlineKey } from "@/lib/hotlines";

type Props = { numbers?: readonly HotlineKey[] };

/** Large call buttons for official hotlines: for screens whose whole point is "call now". */
export function CallNow({ numbers = ["ddpm", "medical"] }: Props) {
  const t = useTranslations("hotlines");
  return (
    <ul className="flex flex-col gap-3">
      {HOTLINES.filter((h) => numbers.includes(h.key)).map(({ key, number }) => (
        <li key={key}>
          <a
            href={`tel:${number}`}
            className="flex min-h-16 w-full items-center justify-center gap-3 rounded-2xl bg-jaga-slate px-5 py-3 text-white active:translate-y-px"
          >
            <PhoneIcon size={28} />
            <span className="flex flex-col items-start leading-tight">
              <span className="text-h3 font-bold">{number}</span>
              <span className="text-small">{t(key)}</span>
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}
