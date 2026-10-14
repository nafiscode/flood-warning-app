# Safe-return window: methods (Module 5, provisional)

Science plan Module 5. `uv run python -m safe_return run` from `pipeline/` (about three minutes, all
local). It writes `out/safe_return/events.csv` (one row per event), `summary.json`, `report.md` (also
beside this file) and `supabase/seed/48_gauge_recession.sql`. `safe_return gauge X.40A` prints one
gauge's events.

## What this is, and what it is not

When the water goes down, an admin issues a Return alert with a window, as a range ("expect to be
able to return from … to …"). This package gives that admin the record: at each river gauge, how long
the river took in past floods to fall from its peak back below the bank and back below its Warning
level. It is a record of past falls, not a forecast of this one: rain on a falling river starts it
rising again, and none of these figures knows the rain to come (safety rule 8). Nothing here sets or
publishes a window (safety rule 2).

## Inputs

- Hourly water level from the ThaiWater archive (`data/tidy/water_level_msl/<station id>/`, read with
  `dam_release.travel.read_hourly`; times UTC). Most gauges begin in 2020; the HII gauges (JNA, PAT,
  SLA) go back to 2011–2016. All of each record is used.
- The levels as loaded into the app: Warning and Evacuate (= the bank) per gauge from
  `supabase/seed/47_gauge_levels.sql` (written by `thresholds gauges`, 14 Oct 2026), parsed from the
  file itself so the two cannot disagree. 46 gauges have both; BLGTU05 and BLGTU06 have no bank and
  are skipped.
- Zones and roles (key, upstream, downstream, other) from `thresholds/config.yaml`.

## Rules, as built

Cleaning:
- A reading more than **4 m above the bank** is a broken sensor and is dropped (as in S6: X.119A once
  read 22.8 m against a 9.3 m bank, X.10A 12.84 m against 1.15 m). 1 reading at X.40A, more elsewhere;
  the count per gauge is in `method.record.broken_readings_dropped`.
- Gaps of **3 hours or less** are bridged by a straight line; longer gaps stay gaps, whole.

Events:
- An **event** is the level at or above the gauge's **Warning** level for at least **3 hours in a
  row**. Spells above Warning with fewer than **12 hours** between them are one event (missing hours
  count as between).
- **Below** a level means below it and staying below for **12 observed hours**. The same 12 hours
  joins spells into one event, so an event ends exactly when the river has stayed below Warning that
  long. A shorter dip (a low tide, a pause in the rain) is not a return.
- Only events whose peak falls in **October to March** count: the north-east monsoon and its tail
  (the late-February 2022 flood peaked at Pattani town on 2 March). Others stay in events.csv as
  `off_season` (192 across all gauges).
- One known non-flood period is excluded: **X.77, 1 March to 1 June 2026**. From late March 2026 the
  river at X.77 crossed its Warning (38.15 m) about once a day, peaking near 01:00 Bangkok, while the
  EGAT gauge beside it (BLGTD02) shows the same daily rise, about 35 to 36.6 m, and nothing else:
  Bang Lang's turbine pulses. In March to May 2025 X.77 stayed under 37.5 m. **Either the pulses grew
  or the gauge's zero moved; X.77's provisional Warning level is crossed by ordinary dam operation and
  should be looked at.**

Dropped events (listed in events.csv with the reason, left out of every figure):
- `gap_at_peak`: a gap (after bridging) within **6 hours** of the highest reading: the true peak may
  be in the gap (17 events).
- `starts_in_gap`: the river was already above Warning when the record or a gap began: the rise and
  the peak were not seen (73 events, most at the HII gauges with patchy early years).

Durations, per event, from the hour of the **highest reading** (the first such hour if it repeats):
- `to_bank_h`: hours until the first hour below the bank that is followed by 12 observed hours below
  it. Only for events that reached the bank.
- `to_warning_h`: the same for the Warning level.
- `above_bank_h`: hours at or above the bank from the event's start to its return below Warning.
- **Censored**: a gap of more than 3 hours, or the end of the record, came before the return. The
  figure is then a lower bound (the river was still up at least that long), flagged in events.csv,
  counted per gauge and **left out of the percentiles**. 17 events across all gauges. The worst one:
  X.40A's record peak, 18.97 m on 28 November 2024, is censored 25 hours after the peak by a gap.

Per gauge:
- Percentiles (25th, 50th, 75th, linear) over the complete events only; **none under 3 complete
  events** (the durations themselves are still listed in `method.durations`).
- `to_warning_h` is given twice: over all events (the seed's columns), and over the over-bank floods
  only (`method.to_warning_h_over_bank`). After an Evacuate the second is the one to read: the
  Warning-only events fall back fast and pull the first under the time to the bank (X.283: 67.5 h
  over all events, 118.5 h over the four floods that went over the bank, against 96 h to the bank).
- A **typical range** = 25th to 75th percentile widened outward: whole hours, or half days when the
  top passes 48 hours (a low end under a day stays in hours).
- Seasons are named by the October they start in (an event in January 2025 is season 2024).

Sensitivity of the 12 hours (medians of the key and nearby gauges with 6, 12 and 24 hours): X.40A,
X.119A, X.119, X.174 do not move. 6 hours splits the tidal X.10A into 13 events (to Warning 12 h
instead of 78 h: the river dips under the line at each low tide). 24 hours lifts X.274's to-Warning
median from 15 to 25 h and, by one more censored event, moves X.283's. 12 is kept.

## Results (15 Oct 2026)

456 events counted at 46 gauges. Figures: median (25th–75th percentile; shortest–longest), hours.

| Zone | Gauge | Role | Events (over bank) | Peak to below bank | Peak to below Warning, over-bank floods | Hours over bank | Censored |
|---|---|---|---|---|---|---|---|
| Pattani | X.77 | upstream | 10 (2) | 15 and 27 (n=2) | 36 and 122 (n=2) | 33 (n=2) | 0 |
| Pattani | **X.40A** Yala | key | 11 (9) | **34 (23–61; 1–111)** | **49.5 (33–85; 13–126)** | 54.5 (42–88) | 1 |
| Pattani | X.283 Yarang | downstream | 6 (4) | 96 (64–117; 29–121) | 118.5 (84–136; 34–137) | 119 (83–152) | 0 |
| Pattani | X.275 Ban Brido | downstream | 14 (13) | 91.5 (39–214; 1–691) | 95.5 (45–220; 19–714) | 225.5 | 2 |
| Pattani | X.10A Pattani town | downstream | 7 (7) | 54 (38–99; 2–127) | 78 (50.5–114.5; 14–149) | 119 (46–151) | 0 |
| Kolok | X.274 Waeng | upstream | 14 (8) | 15 (6–22.5; 2–36) | 30 (16–50; 12–79) | 33 (12–41) | 0 |
| Kolok | **X.119A** Sungai Kolok | key | 19 (16) | **59.5 (40–90; 10–143)** | **86.5 (63–108; 35–166)** | 82.5 (53–118) | 1 |
| Kolok | X.119 Ban Muno | downstream | 10 (3) | 37 (31–39; 25–41) | 85 (82–85.5; 79–86) | 49 (49–60) | 0 |
| U-Taphao | X.90 | upstream | 1 (1) | 32 (n=1) | 38 (n=1) | 46 | 0 |
| U-Taphao | **X.44** Hat Yai | key | 2 (1) | **48 (n=1)** | **55 (n=1)** | 111 | 0 |
| U-Taphao | X.173A Sadao | other | 2 (2) | 39 and 74 (n=2) | 54 and 88 (n=2) | 52 and 132 | 0 |
| U-Taphao | X.174 Khlong Wa | other | 7 (3) | 36 (22–43; 8–50) | 57 (45.5–66; 34–75) | 52 (33–94) | 0 |

What it says:
- **Pattani River.** At Yala (X.40A) the river is usually back in its bank about a day and a half after
  the peak (a day to two and a half), and below Warning about two days after (one and a half to three
  and a half). The great floods take longest: January 2021 (18.63 m) 111 h to the bank and 126 h to
  Warning; November 2025 (18.73 m) 89 h and 116 h. The fall slows downstream: Yarang (X.283) is back
  in its bank about four days after its peak (two and a half to five) and below Warning after three
  and a half to five and a half. At Pattani
  town the tide sets the end (below).
- **Kolok.** At Sungai Kolok (X.119A) the bank takes about two and a half days (one and a half to
  four) and Warning three and a half (two and a half to four and a half); November 2024 (10.91 m) took
  143 h and 166 h. Upstream at Waeng (X.274) the river is back in its bank within a day. Ban Muno
  (X.119) leaves its bank rarely (3 times) but falls below Warning only about three and a half days
  after its peak.
- **Hat Yai.** One flood over the bank at X.44 (November 2025, 9.97 m): back in its bank 48 h after
  the peak, below Warning at 55 h, 111 h over the bank in all. In November 2024 X.44 peaked under its
  bank (7.26 m) and was below Warning 12 h later. **Nothing can be said from one flood**: the U-Taphao
  figures are placeholders, as its thresholds are.

## Gauges with too few events

Under 3 complete events below Warning, so no median or range: BLGTD01 and MOU454 (no event at all;
neither has reached its bank), BLGTU02, FOP045, SAY002, SKN001, SKN002, X.67A, X.90 (one or two),
X.173A, X.44, and JNA001, JNA002, SLA007 (whose listed banks also look too low). Under 3 complete
over-bank floods, so no time to the bank: also X.77, BLGTD02, SLA002, X.113.

## Tide and lake

- **Tidal** (measured by `thresholds tide`, 14 Oct 2026: X.10A, BLGTD05, X.275, ONE038, ONE037,
  SLA005). The level dips under a line at each low tide; staying below for 12 hours needs the high
  tides below it too, so the figure there is how long until the high tides were clear of it. With a
  6-hour rule X.10A's events split at every low tide (12 h to Warning instead of 78 h). At Pattani town
  the river's own fall and the spring tides are not separated: a flood that ends at neap tide ends
  sooner.
- **Songkhla Lake** (ONE037, ONE038, ONE039, SLA005, SLA007, PTTEP4). These gauges fall with the
  lake, which drains slowly through one outlet at Songkhla and can be held up by the wind: Ranot
  (ONE039) takes about a week. Their figures are the lake's, not their stream's.
- **Near a mouth, tide not checked**: ONE036 (Thepha), JNA001 (Chana).
- **Listed bank looks too low** (from seed 47: the river within 0.3 m of it for more than a tenth of
  the record): X.275, FOP041, JNA001, JNA002, ONE037, ONE038, ONE039, SLA005, SLA007. Their events
  are mostly ordinary high water and their figures should not be used. `method.usable` is false
  for these and for the gauges with too few events (26 of 46 usable).

## The seed: `supabase/seed/48_gauge_recession.sql`

One row per gauge with levels (46), matched on `public.stations.thaiwater_id`, as seed 47 does
(`code` is not unique there: seed 46 appends `#id` where two listings share one). It ends in
`on conflict (station_id) do update`, so the table needs a unique `station_id`. The migration is not
written; the columns it needs:

| Column | Type | Meaning |
|---|---|---|
| `station_id` | uuid, primary key or unique, references `stations(id)` | the gauge |
| `events` | integer not null | events counted (not dropped), October to March |
| `to_bank_h_p25`, `to_bank_h_p50`, `to_bank_h_p75` | double precision, null | hours from peak to below the bank, over complete over-bank floods; null under 3 |
| `to_warning_h_p25`, `to_warning_h_p50`, `to_warning_h_p75` | double precision, null | hours from peak to below Warning, over all complete events; null under 3 |
| `above_bank_h_p50` | double precision, null | median hours at or above the bank in a flood |
| `censored` | integer not null | events whose return is not on record (a gap or the end of the record) |
| `first_season`, `last_season` | integer, null | seasons (named by their October) of the first and last counted event |
| `method` | jsonb not null | everything else: the rules, `warning_m`, `bank_m`, counts (`over_bank`, `censored_bank`, `censored_warning`, `dropped` by reason), `to_bank_h` / `to_warning_h` n, min, max, `to_warning_h_over_bank` (n, p25, p50, p75, min, max), `above_bank_h` spread, `to_bank_range_h` / `to_warning_range_h` ([low, high], the typical ranges), `durations` (every complete duration), `record` (from, to, years, observed share), `flags` (tidal, lake, coastal_unchecked, bank_suspect, never_reached_bank), `usable`, `source` |

Admins only would be the natural reading rule, like the signal dashboard's other tables; nothing in
it is personal.

## Limits

- **Few floods.** Six seasons at most gauges; three key gauges with 11, 19 and 2 events. Every new
  season moves the figures.
- **Censored events are left out**, so the figures lean short: the longest falls are the likeliest to
  run into a gap. At X.40A the censored one is the record flood of November 2024.
- **From the peak**, not from the moment an admin would issue anything: the time to decide and write
  comes out of it, and the peak is known only once the river has started to fall.
- **The gauge, not the streets.** Below the bank at the gauge is not dry streets: low land behind the
  bank drains later, pumped areas sooner, and roads stay cut by debris and damage.
- **Bang Lang's release** is in the record but not separated: a high release holds the Pattani River
  up whatever the rain did.
- Warning levels are provisional (seed 47); when an admin changes one, this should be run again.
