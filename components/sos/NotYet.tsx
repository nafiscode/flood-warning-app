import { CallNow } from "@/components/CallNow";
import { buttonSecondary } from "@/lib/ui";

type Props = { title: string; body: string; back: string; backHref: string };

/**
 * What the SOS and report screens show until the launch switch is on: that nobody receives
 * requests from the app yet, and the official numbers to call instead (safety rules 1, 4 and 10).
 * It must never look as though a request was taken.
 */
export function NotYet({ title, body, back, backHref }: Props) {
  return (
    <section className="flex flex-col gap-4" data-sos-soon="true">
      <h1 className="text-h3 font-bold text-jaga-ink">{title}</h1>
      <p>{body}</p>
      <CallNow />
      <a href={backHref} className={buttonSecondary}>
        {back}
      </a>
    </section>
  );
}
