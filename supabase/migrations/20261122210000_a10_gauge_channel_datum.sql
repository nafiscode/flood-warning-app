-- A channel whose heights are on another datum is not this river's channel.
--
-- The owner, 22 Nov 2026, looking at the card for X.67A บ้านนาสีทอง on the live site: "check why
-- this gauge has strange cross section with 2 sides water level, and fix it".
--
-- The drawing was right and the figures were wrong. ThaiWater lists that station's bank at
-- **39.92 m MSL** - the level Jaga warns against, and the one its Evacuate line is drawn from -
-- while listing its two bank tops at **6.278 and 6.29** and its bed at **-1.223**. Those last
-- three are a real channel, about 7.5 m deep, but measured down from the station's own staff
-- gauge rather than from mean sea level. Drawn against levels of 38.65, 39.30 and 39.92, the
-- reading of 35.41 came out twenty-nine metres above both bank tops, so the card filled the
-- ground on either side of the channel with water: a river standing out of its banks on both
-- sides, beside a sentence saying the station was อยู่ในระดับปกติ.
--
-- A picture that contradicts the words under it is worse than no picture at all (safety rule 10),
-- and between the two it is the words that have been checked. So the channel goes and the station
-- keeps the schematic one, with the card saying the shape is a drawing - which is already what
-- every station without listed heights does. Nothing a reader needs is lost: the levels, the
-- reading and the bank are untouched, because they were never the part that was wrong.
--
-- **The rule.** A station's listed bank tops and its bank level describe the same physical bank
-- and must agree. Where the lower bank top sits more than 10 m from `stations.warning_m`, the
-- whole channel is dropped - the bed too, because the bed is listed on the datum of the bank tops
-- and keeping it would be the same mistake with one fewer clue.
--
-- Ten metres is not fine judgement. Of the 46 stations on jaga-dev carrying listed heights, 45
-- sit within 4.28 m of their bank level and most within 2 m (a surveyed bank top a little above
-- the warning bank is ordinary); X.67A sits 33.64 m away. The threshold has an order of magnitude
-- of clear air on both sides.
--
-- This is also fixed in the two places that would otherwise put it back:
--   * `pipeline/gauge_section` applies the same test and no longer writes the row (seed 62 now
--     carries 49 rows, not 50);
--   * `lib/gauge-section.ts` applies it again at drawing time, so a bad row that reaches the
--     database from anywhere can still never draw a river standing over its banks.
--
-- Data only: no function, policy or grant is touched, and it can be run again safely.

delete from public.gauge_channel gc
 using public.stations s
 where s.id = gc.station_id
   and s.warning_m is not null
   and least(
         coalesce(gc.left_bank_m, gc.right_bank_m),
         coalesce(gc.right_bank_m, gc.left_bank_m)
       ) is not null
   and abs(
         least(
           coalesce(gc.left_bank_m, gc.right_bank_m),
           coalesce(gc.right_bank_m, gc.left_bank_m)
         ) - s.warning_m
       ) > 10;
