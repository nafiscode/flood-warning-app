/**
 * The one chart shape this feature uses: a labelled horizontal bar per row, with the number
 * written beside it.
 *
 * **Why not a chart library.** Every figure here is one series against one axis - how many people
 * said a thing, or the average rating in a month. A list of bars answers that exactly, weighs
 * nothing on a slow 3G connection, needs no JavaScript, works at 360 px and reads correctly to a
 * screen reader because it *is* a list with the numbers in it. The dataviz rules it has to obey
 * are the ones that matter for a single series: one hue (the brand teal, which clears 3:1 against
 * the surface in both themes), every value directly labelled, recessive everything else, and no
 * legend - the heading names the series.
 *
 * **No alert colour, ever.** This page carries opinions of the app, and a colour that means a
 * level somewhere else must not appear beside them (spec 17; docs/brand.md: brand teal and slate
 * never show a status).
 *
 * A row with nothing to show draws no bar at all and says so in words, rather than a bar of zero
 * length that reads as a measured nothing.
 */
export type Bar = {
  key: string;
  label: string;
  /** 0 to 1 of the track. Null draws no bar and shows `emptyNote` instead. */
  share: number | null;
  /** The figure as it is read: "4.2", "18 people". */
  value: string;
  /** A quiet second line: what was done about it, how many answers a month had. */
  note?: string | null;
  emptyNote?: string | null;
};

export function Bars({ bars, className = "" }: { bars: Bar[]; className?: string }) {
  return (
    <ul className={`flex flex-col gap-3 ${className}`}>
      {bars.map((bar) => (
        <li key={bar.key} className="flex flex-col gap-1" data-bar={bar.key}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-medium text-jaga-ink">{bar.label}</span>
            <span className="shrink-0 tabular-nums font-bold text-jaga-ink" data-bar-value>
              {bar.share === null ? "—" : bar.value}
            </span>
          </div>
          {bar.share === null ? (
            <p className="text-small text-jaga-text-2">{bar.emptyNote}</p>
          ) : (
            <div
              className="h-2.5 w-full overflow-hidden rounded-full bg-jaga-line"
              role="presentation"
            >
              {/* Rounded at the far end only: the data end, anchored to the baseline. */}
              <div
                className="h-full rounded-e-full bg-jaga-teal-ink"
                style={{ width: `${Math.max(2, Math.min(100, bar.share * 100))}%` }}
              />
            </div>
          )}
          {bar.note && <p className="text-small text-jaga-text-2">{bar.note}</p>}
        </li>
      ))}
    </ul>
  );
}
