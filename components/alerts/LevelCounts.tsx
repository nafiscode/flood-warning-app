import { AlertBadge } from "@/components/alerts/AlertBadge";
import type { LevelTally } from "@/lib/map-console";

/**
 * How many tambons stand at each level, as a row of badges with their counts.
 *
 * It lives apart from the two places that draw it - the laptop console's readout strip and the
 * summary above the map - so the same tally can never be written two ways. Each level is drawn
 * and written as well as coloured, because the badge carries its own icon and word, so a count
 * never rests on a colour a reader may not see (safety rule 3, and the accessibility rule that
 * no level is shown by colour alone).
 *
 * Levels with no tambons are left out: "0 at Evacuate" is noise on a quiet day, and an empty
 * list is the caller's to word - this component never says what nothing means.
 */
export function LevelCounts({ tally }: { tally: readonly LevelTally[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {tally
        .filter((x) => x.tambons > 0)
        .map(({ level, tambons }) => (
          <li key={level} className="flex items-center gap-1.5" data-console-level={level}>
            <AlertBadge level={level} />
            <span className="text-h3 font-bold text-jaga-ink">{tambons}</span>
          </li>
        ))}
    </ul>
  );
}
