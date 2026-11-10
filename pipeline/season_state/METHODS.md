# Season state: how wet the catchment already is (science plan Module 11)

The owner's question, 9 November 2026: *do we have the monthly trend of the river gauges, so we can
see the water rising through the wet season, and with the rainfall behind it decide an alert for
preparation?* Jaga could not answer it. The signal dashboard sees ninety-six hours of gauge, three
days of rain behind and five ahead; nothing says whether this river is running higher than it should
be for mid-November, and nothing notices a slow build-up.

This module is the record that answers it, and one rule built on top of it. **Nothing here is a
forecast and nothing here publishes.** It computes figures; an admin reads them; a person decides
(safety rules 2 and 8).

## The two figures

**Baseflow** is the gauge's daily **minimum**, on Bangkok days. The minimum because it is the
closest thing to a tide-free floor a single gauge offers: the tide and the afternoon's rain throw
the daily maximum about, while the floor follows what the catchment is still holding. A day with no
reading is dropped, never interpolated - a missing day must not be able to look like a day the river
did not rise.

**Antecedent rain** is the basin-mean rain already fallen, over fifteen days, thirty days, and from
the first of October. A day missing any hour is dropped, and a rolling window is computed only where
every day in it is present, so a gap can never read as a dry fortnight.

Both are reported as a **position in their own record** - below the lower third, in the middle,
above the upper third - and never as a bare number to be compared with another gauge. A floor of
12 m at X.40A and 0.7 m at X.44 say nothing about each other; only the position travels (safety
rule 8, and the same rule the coastal gate is written under).

## Inputs

- **Gauges:** the local ThaiWater archive, `pipeline/data/tidy/water_level_msl/`, read hourly by
  `read_hourly` from `dam_release/travel.py`, cleaned by `safe_return/recession.py`'s `clean`
  (readings more than 4 m above the bank are a broken sensor; gaps of up to 3 h are bridged).
  Every gauge with an Evacuate level in `supabase/seed/47_gauge_levels.sql`; zones and roles from
  `thresholds/config.yaml`, so this module and Module 3 cannot disagree about which gauge is which.
- **Rain:** `pipeline/out/thresholds/rain/*.parquet` - nine seasons (2017-2025) of hourly
  basin-mean GSMaP v8 gauge-adjusted rain, already cached by `thresholds rain`. No Earth Engine
  call is made here. The cache covers 1 October to 31 January of each season only, which is why the
  reference is per flood-season month and why there is no May-September figure.

## Which gauges are used, and how that is decided

The owner's instruction was inland gauges only, chosen by how tidal each one is, with the dropped
ones listed. Two attempts:

**A variance ratio does not work.** Splitting the record with the Godin filter and taking the
removed part's share of the variance kept every gauge Module 5 lists by hand as tidal (X.10A came
out at 0.25, X.275 at 0.02) and threw out X.77, where the 1.6 m daily wobble is Bang Lang opening
its turbines, not the moon. At a river-mouth gauge the flood peaks dominate the variance, so the
ratio measures floods, not tide.

**A harmonic fit does.** The Godin filter takes the slow part out, and least squares then fits four
sine pairs to what is left:

| Period | Hours | What it is |
|---|---|---|
| M2 | 12.4206 | the moon's semidiurnal tide |
| K1 | 23.9345 | the main diurnal tide, which the Gulf's largely diurnal tide rides on |
| O1 | 25.8193 | the other diurnal tide |
| S1 | 24.0000 | **not tidal**: exactly one solar day, so a hydropower station that opens its gates every evening, or any other human cycle |

`sea` is the three tidal amplitudes combined; `pulse` is S1. No tidal period is exactly 24 hours,
which is what lets this tell the sea at a river mouth from a turbine 40 m up a mountain river.
Separating S1 from K1 needs more than a year of record, because the two beat against each other
over about a year, so a gauge with less is left out and said to be, not assumed clean.

**The pulse is tested first.** A tall, square daily pulse is not a sine, so it leaks into the
neighbouring periods: X.77 reads 0.13 m of "sea" purely as leakage from its own 0.54 m pulse. Order
the tests the other way round and the report blames the ocean for a hydro plant.

Thresholds, set on 10 November 2026: `max_tide_m: 0.05`, which is the figure that reproduces the
tidal list Module 5 arrived at by hand (X.10A, BLGTD05, X.275, ONE038, ONE037, SLA005) and drops no
key or upstream gauge with it; and `max_pulse_m: 0.20`.

Of 46 gauges with levels, 32 are kept. What is dropped and why:

- **The sea:** X.10A (0.17 m), BLGTD05 (0.18), ONE036 (0.15), ONE038 (0.11), PTTEP4 (0.11),
  SLA007 (0.08), ONE037 (0.07), X.275 (0.07), SLA005 (0.06).
- **A daily pulse:** X.77 (0.54 m), BLGTD02 (0.54), BLGTD01 (0.48), PAT001 (0.44), FOP045 (0.32).

**X.77 matters and its loss should be read.** It is the Pattani zone's upstream gauge, and Module 3
reads its approach to its bank as a Warning signal several hours before the key gauge. Nothing here
changes that: the automated alarm and the thresholds still use X.77 exactly as before. What is
dropped is only its *floor* as a measure of how wet the catchment is, because below the dam the
floor is set by the turbine schedule. Module 5 already excludes a stretch of X.77 for the same
reason. The key gauge X.40A carries a smaller pulse of its own, 0.12 m, which is under the threshold
and is printed in the report so nobody has to rediscover it.

## The reference

Per gauge and per month (October, November, December, January): the lower third, median and upper
third of the floor, and the same of the seven-day change. Per zone and per month: the same three for
fifteen-day rain, thirty-day rain and the running total since 1 October.

**Terciles, never high percentiles.** The RID key gauges (X.40A, X.119A, X.44) begin on
13 February 2020, so six to seven seasons is the most any of them has; the basin rain has nine. A
98th percentile over six values is one day dressed up as a statistic. A month with fewer than three
seasons behind it gets **no figure at all** rather than a number resting on one year, and the
report and the stored `method` both say how many seasons each cell has.

## The rule, and what it is not allowed to do

A zone is `rising_wet` when **both** legs hold:

1. the floor rose on at least **5 of the last 7 days** at the zone's kept key gauge, and
2. the **fifteen-day** basin rain is in the **top third** of that basin's own record for the month.

Either leg alone is `rising` or `wet`, which is shown and raises nothing.

**"Above normal for the date" is deliberately not a condition.** It was the owner's first choice,
and the archive argued against it. At X.40A the floor sat at 11.8-12.2 m through 5-22 November 2025
against a November band of 12.82 / 13.01 / 13.48 m - in the *bottom* third - and the river went over
its 16.5 m bank on the 24th. The worst flood in this record fell on a catchment that was running
low. Adding that gate cut Hat Yai's 2025 season from 23 days to 7. So the figure is printed beside
the grade, where an admin can weigh it, and cannot silence anything (owner's decision, 10 November
2026).

How often it would have spoken, counted over the same seasons the terciles come from (in sample: a
check on how often an admin would hear from it, not a skill score):

| Zone | 2020 | 2021 | 2022 | 2023 | 2024 | 2025 |
|---|---|---|---|---|---|---|
| Pattani River | 3 | 0 | 1 | 1 | 2 | 2 |
| Kolok River | 3 | 1 | 3 | 1 | 2 | 1 |
| Khlong U-Taphao | 3 | 2 | 2 | 1 | 1 | 1 |

Episodes, not days. One to three a season per zone, so an admin hears from this a handful of times
between October and January, which is the point: a slow signal that spoke weekly would be ignored
by November.

## What it cannot do

- **It is not early.** Measured at X.40A, the rule's days in November 2025 are the 23rd to the 27th,
  and the river crossed its bank on the 24th. It is **context an admin reads beside the 72-hour
  rain rule**, not a longer-range replacement for it. Nothing in this module claims lead time, and
  the dashboard copy says so.
- **It cannot see a burst coming.** A catchment can be dry and flood two days later - see 2025.
- **It is in sample.** The terciles and the counts above come from the same six to nine seasons.
- **One gauge per zone.** The floor leg reads the key gauge only. A zone whose key gauge is dropped
  or stale gets no grade, and says so rather than guessing from a neighbour.

## GSMaP against Open-Meteo

The terciles are GSMaP; the live fifteen-day figure the dashboard compares against them comes from
Open-Meteo, because that is what the database already fetches hourly. These are different
instruments. The same mismatch already exists in Module 3 - its rain thresholds were scored on
GSMaP and are applied to live Open-Meteo sums - but it should be measured rather than assumed:
`uv run python -m season_state bias` asks the Open-Meteo archive for the same seasons at each zone's
own live rain points (read back out of `supabase/seed/46_zones_gauges_thresholds.sql`, so the two
are asked at identical coordinates) and writes the ratio of season totals into the report. It is the
only command that touches the network. Until it has run, the report says the comparison is
indicative.

## The seed: `supabase/seed/61_season_state.sql`

Two tables, both admin-only and both written only by this seed:

- `public.season_baseflow` - one row per kept gauge per month: the floor's terciles, the seven-day
  change's terciles, how many seasons and days are behind them, the gauge's sea amplitude, and a
  `method` holding the rules, the record span and the harmonic fit.
- `public.season_rain` - one row per zone per month: the three rain windows' terciles, the seasons
  and days behind them, and a `method` holding the rules, the record span and the hindcast above.

Rows are matched to their ids through `stations.thaiwater_id` and `warning_zones.basin`, never by a
hardcoded UUID, and an existing row is updated rather than duplicated.

## Commands

```
uv run python -m season_state run          # offline: the reference, the report and seed 61
uv run python -m season_state gauge X.40A  # one gauge, printed, including its last ten days
uv run python -m season_state bias         # the only networked command: GSMaP against Open-Meteo
```
