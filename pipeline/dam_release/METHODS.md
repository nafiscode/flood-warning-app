# Dam release: the path, and how the live figures are graded

S7, `docs/science-plan.md` Module 7. Bang Lang dam (EGAT) on the Pattani River, Yala.
Built 10 Oct 2026. Run with `uv run python -m dam_release geometry` and `… thresholds`.

## What this is, and what it is not

This note covers the **interim** release path and the **grading rules**, which is what the app
shows today. It does **not** contain travel times or arrival ranges: those are steps 2–3 of S7
and have not been measured yet. Nothing in the app therefore says when water will arrive — only
that water has been released, and which tambons the river runs through.

## The path (step 3, interim)

Source: OpenStreetMap, © OpenStreetMap contributors, ODbL. Decided on 10 Oct 2026 as the interim
source, to be compared against the HAND-and-radar zone from S7 steps 2–3 and most likely
replaced. Everything carries `source = 'osm'` in the database so both versions can sit there at
once.

| | |
|---|---|
| Reservoir | 43.0 km², one outer ring and 13 islands (OSM relation 3224558) |
| Outlet channel | 0.31 km (OSM way 1336823769) |
| River to the sea | 134.3 km in 3 mapped ways, mouth at 101.2442 E, 6.9041 N |
| Tributaries | 10, each with ≥ 5 km of mapped network, lower 5 km of each kept |
| Detail | simplified to 10 m |

How the river is found: the walk starts at the mapped channel leaving the dam and follows the
direction each way is drawn in, which for an OSM waterway is the direction of flow. Ways that
meet share a node, so connectivity is exact coordinate equality, with a 30 m tolerance for a
river split across two ways with one node a hair out. Where a junction offers more than one
channel the larger class wins, then the longer line.

Tributaries are ways that *end* on the main stem, so their water runs into the river. The whole
mapped network above each one is measured, and anything under 5 km is left out: it cannot back up
water worth drawing. From the junction the reach is followed back upstream for 5 km — this is the
"lower reaches of the streams that join it" of spec section 15, where a rising main stem backs
water into the tributary instead of letting it drain.

### Limits, to be stated wherever this is drawn

- The line says **where the river runs, not how far the water spreads**. It is not a flood extent
  and not a zone. Anyone outside the line can still be flooded.
- Only the tributaries **somebody has mapped**. OSM has 22 tributaries on a 135 km river, which
  is certainly fewer than exist. A stream that is missing gets no line and no mention.
- **The spillway's own channel is not mapped in OSM.** The spillway is shown as a point, not a
  drawn channel: inventing a line on a safety map would be worse than showing none.
- The **outlet point** is the head of the mapped outlet channel, which is approximately the
  powerhouse tailwater. It is not a surveyed powerhouse position and still needs confirming.
- The dam wall and main spillway positions are the owner's (9 Oct 2026). OSM's own `name:en` for
  the reservoir relation is wrong ("Mae Wat Bypass Road"), so every name shown is ours.

## The grading rules (step 4)

Measured over **108,597 hourly readings, 31 Dec 2011 to 8 Oct 2026** (dam id 50, EGAT, via
ThaiWater). Hourly release and spill are volumes per hour in million m³; × 1e6/3600 gives m³/s.

There is **no probability here, on purpose.** Three releases in fifteen years, no hydraulic model
and hourly gauges cannot produce a calibrated percentage; one would be invented precision
(safety rule 8). The app shows which rule fired, the figures, and when they were read.

### What the record holds

| | |
|---|---|
| Spill above zero | 893 hours, 0.82% of the record — 2014 (439 h, peak 83.3 m³/s), 2015 (340 h, peak 113.1), 2021 (114 h, peak 648.2) |
| Outflow | median 47.0 m³/s; **99th percentile without spill 160.2 m³/s** |
| Storage | max 1,504.7 Mm³; above normal high (1,454.4) for 133 hours in 15 years |
| 6-hour storage rise | 99th percentile 1.13 Mm³/h |
| Inflow | 99th percentile 405.6 m³/s |

The turbine ceiling of 160 m³/s in `config.yaml` was chosen before this was measured and the
99th percentile of outflow without spill came out at 160.2 — so "more water is leaving than the
turbines alone can pass" is a defensible reading of that line.

### The two tiers

Named criteria, from the dam's own figures. The owner's decision of 10 Oct 2026: the lower tier
is shown by the app itself with its disclaimer; the upper tier reaches the admins, who review it
and send the real alarm. Code never publishes an alert (safety rule 2).

- **quiet** — outflow within the turbine range and storage below normal high.
- **watchful** (the app's own quiet notice, no sound, no push) — storage above normal high
  (1,454.4 Mm³), **or** storage rising faster than 4.0 Mm³/h over 6 hours, **or** inflow above
  500 m³/s.
- **releasing** (reaches the admins to review and send) — spill above zero, **or** total outflow
  above 160 m³/s.

### The spike guard

The archive holds plainly impossible single hours: an outflow of **1,944 m³/s with no spill**
(26 Jun 2015, against a record spill peak of 648), an inflow of **6,241 m³/s**, a six-hour
storage rise of **141 Mm³/h**. One of those must not put a notice on anyone's screen or wake an
admin at three in the morning.

So a rule must hold for **two readings in a row** before it grades (`min_consecutive_h: 2`).
Nothing is discarded and no value is declared too big to be true — a lone reading is still shown,
labelled as waiting for the next one, and a release that is really happening confirms itself
within the hour.

What the guard is worth, over the whole record:

| | hours | spells | unconfirmed hours |
|---|---|---|---|
| watchful | 535 | 79 | 775 |
| releasing | 1,614 | 279 | 2,087 |

**473 single readings are held back** — 23% of the raw `releasing` hours were spikes. 279 spells
in fifteen years is about **19 admin notices a year**, concentrated in the November–December
peak; `watchful` is about 5 spells a year.

Thresholds live in `system_settings.dam_grades`, which admins own, so these are starting values,
not constants. Re-run `thresholds` after changing them to see what the change would have cost.

## Still open

- Done 14 Oct 2026: the owner chose the zone with its outer band. `zone --seed` writes
  `supabase/seed/42_dam_zone.sql` (table `dam_zones`, the river's line and 55 tambons under source
  `s7`, arrival ranges for all 55) and the dam's `geometry_source` becomes `s7`.
- Whether water left the dam unrecorded in the floods of 2024 and 2025: see "The outside check".
- The powerhouse position, and whether the spillway channel should be digitised by hand.
- A contact at EGAT Bang Lang (the owner).

## The RID reservoirs (14 Oct 2026)

The owner asked for every reservoir that matters to the flood in the four provinces, not only Bang
Lang. What exists, and what each one allows:

**What was found.** ThaiWater's `/analyst/dam` answer carries four lists; in provinces 90, 94, 95
and 96 it serves **one hourly dam** (Bang Lang, EGAT) and **five daily reservoirs**, all the Royal
Irrigation Department's: Khlong Sadao (57 Mm3, Songkhla), Khlong La (21), Khlong Chamrai (6), Klai
Ban (3.7, Narathiwat) and Ban Baik (1.2, Yala). Its `dam_small_tele` list has nothing here, and two
further points in the medium list are nameless with no figures. The gated barrages were looked for
in `/public/watergate_load` and that list came back empty.

**Why these matter.** Khlong Sadao sits on the upper Khlong U-Taphao: the walk downstream from it
runs 123 km **through Hat Yai** to Songkhla Lake, which is the owner's own benchmark flood. A tenth
of that reservoir released in a day is 66 m3/s into that channel. Khlong La is on the same system.
The other three are small and their water reaches a town only through channels nobody has mapped.

**What is not there.**

* No history. `dam_medium_graph` answers with an empty series for every one of them (tried with
  both the row id and the dam id), and `dam_daily_graph` with nothing. So there is no archive to
  measure a threshold against, and Jaga's own record of them begins the day the feed starts.
* No spill figure. The medium list publishes storage, inflow and release, so "water over the
  spillway" can never be the reason a RID reservoir grades as releasing.
* No channel below three of them. The walk needs a mapped waterway starting at the dam
  (`dam_release find`); Khlong Chamrai, Klai Ban and Ban Baik have none within 5 km, and Khlong La's
  stops 6 km short of the river it must join. Nothing is drawn where nothing is mapped.
* No reservoir outline for Khlong Sadao or Ban Baik: Overpass has no water polygon near either
  (it answered 504 for Khlong Sadao for an hour and then returned no shapes). The column is
  nullable; the dam keeps its mark, its figures and its path.

**The grade rules, and why they are provisional.** Bang Lang's thresholds come from its own
fifteen-year archive (above). These five have no archive, so each carries rules in proportion to
its own capacity, which is the only honest scale available:

| Rule | Proportion | Khlong Sadao | Khlong La | Khlong Chamrai | Klai Ban | Ban Baik |
| --- | --- | --- | --- | --- | --- | --- |
| releasing, m3/s | a tenth of capacity in a day | 65.7 | 24.8 | 6.9 | 4.3 | 1.4 |
| watchful inflow, m3/s | a fifth in a day | 131 | 49.6 | 13.9 | 8.6 | 2.8 |
| watchful rise, Mm3/h | a twentieth in a day | 0.118 | 0.045 | 0.013 | 0.008 | 0.003 |

Also per dam: the rise is measured one reading back (a day), one reading grades (two would be two
days, and a daily figure is already a day's mean), and the figures are called stale after 48 hours.
**Revisit these after a season of readings**: the first flood they see is the first evidence.

## Travel times (12 Oct 2026, not validated)

`uv run python -m dam_release travel` measures how long water takes between the gauges and writes the arrival range for every tambon on the path (`out/dam_release/arrival_by_tambon.csv`, `supabase/seed/41_dam_arrivals.sql`, table `dam_arrivals`).

**What there is to measure from.** No flood release has a clean record. The spill of January 2021 is the only one since the river gauges began; the river at Yala was then already rising from rain (514 m³/s there with 142 m³/s leaving the dam) and shows no step when the dam's water should have arrived. The operator's own gauges start in December 2021. The owner asked (12 Oct) that the times should not rest on low water alone if there is another way, so two kinds of evidence are used.

1. **The turbines' pulses.** In the dry months the outflow steps between 0 and about 160 m³/s every day. The shift at which the hourly change of a gauge follows the hourly change of the outflow best, one value per month, January to May 2022 to 2026:

| Gauge | River km | Months with a clear fit | Lag |
|---|---|---|---|
| BLGTD01, tailwater bridge | 0.6 | 19 | 0 h in every month |
| BLGTD02, Bannang Sata | 18.3 | 24 | 3 h (quartiles 3 to 3) |
| BLGTD03, Yala town at Tha Sap | 77.8 | 23 | 17 h (17 to 17) |
| X.40A, the same place, RID's gauge | 77.8 | 29 | 17 h (17 to 19) |
| X.275 Ban Brido, BLGTD05 and X.10A Pattani town | 120 to 129 | 1, 0, 0 | not visible: the pulses are damped out and the tide takes over |

2. **Floods since 2020.** A flood is a spell with the upstream gauge above its 95th percentile level, rising at least 1 m ("large": 2.5 m). Two lags per flood: from the steepest three-hour rise upstream to the steepest downstream (the front), and peak to peak. Lower quartile / median / upper quartile, in hours; lags below zero (the lower gauge rose first, so rain, not travel) are left out:

| Reach | km | Floods | Front | Peak |
|---|---|---|---|---|
| Bannang Sata to Yala (BLGTD03) | 59.5 | 34 | 11 / 14 / 35 | 12 / 14 / 22 |
| the same, large floods | | 11 | 6 / 10 / 33 | 12 / 19 / 28 |
| Bannang Sata to Yala (X.40A) | 59.5 | 34 | 10 / 16 / 34 | 12 / 14 / 22 |
| the same, large floods | | 11 | 6 / 8 / 16 | 14 / 21 / 28 |
| Yala (X.40A) to Ban Brido | 42.5 | 24 | 5 / 7 / 32 | 25 / 34 / 41 |
| Yala (BLGTD03) to Ban Brido | 42.5 | 21 | 8 / 14 / 22 | 20 / 29 / 38 |
| Ban Brido to Pattani town (BLGTD05) | 8.3 | 9 | 2 / 12 / 18 | 5 / 12 / 16 |
| Ban Brido to Pattani town (X.10A) | 9.0 | 13 | 6 / 18 / 22 | 6 / 11 / 14 |

The two agree where they can be compared: an ordinary flood's peak takes 14 hours from Bannang Sata to Yala, and the pulses take 17 − 3 = 14. In the large floods the front lag is shorter (6 to 10 hours), but then rain is falling below the dam too and the gauges rise partly together, so that figure is used only as the earliest bound.

**The decided times** (`travel.anchors` in config.yaml), hours after the gates open for the first rise, and hours after the highest release for the highest water:

| Place | River km | First rise | Highest water | Where the numbers come from |
|---|---|---|---|---|
| Tailwater bridge | 0.6 | 0 | 0 | pulses |
| Bannang Sata | 18.3 | 3 to 4 | 3 to 4 | pulses, 24 months |
| Yala town | 77.8 | 9 to 18 | 15 to 26 | 3 + 6 (large-flood front, lower quartile) to 4 + 14 (median); peak 3 + 12 to 4 + 22 |
| Ban Brido | 120.3 | 14 to 32 | 40 to 74 | Yala + 5 to Yala + 14; peak Yala + 25 to Yala + 48 |
| Pattani town | 128.6 | 16 to 44 | 45 to 90 | Ban Brido + 2 to + 12; peak + 5 to + 16 |

Between two gauges a tambon gets the times in proportion to the river distance at which the river first touches it; below Pattani town the last reach's speed is carried on to the mouth. A tambon reached only by the lower reach of a tributary takes the times of the junction. `warn_from_h` is the earliest time with 20 % taken off, rounded down to half an hour: the time a warning counts down to (spec section 15). 39 tambons: 36 on the river, 3 on a tributary.

**Limits.**
- These are ranges read off quartiles of a few dozen floods, with hourly gauges. They are not a forecast and there is no hydraulic model. A release larger than anything in the record (the record's largest is about 800 m³/s) may travel faster than the earliest time.
- The front of a flood is found as the steepest three-hour rise in a window; in a flood with two rises it can pick the wrong one, which is part of why the upper quartiles are wide.
- Rain below the dam adds water these times know nothing about: the river can rise at Yala or Pattani before any dam water arrives.
- An even speed within a reach is assumed. The 60 km between Bannang Sata and Yala have no gauge.
- From Ban Brido down the river is tidal: the first rise there is the least certain figure in the table.
- The safety margin (20 %) and the choice of quartiles are starting values, not measured.

**Checked against the operator's record, 12 Oct 2026.** The owner doubts that the 2025 flood came without water from the dam. Since December 2021 the record has no hour of spill. The tailwater gauge 0.6 km below the dam reads 43.83 m (median) and up to 44.56 m (99th percentile) at full turbine outflow; its highest in Nov–Dec 2024 was 44.59 m and in Nov–Dec 2025 43.90 m. Storage peaked at 1,215 Mm³ (84 % of the normal high level's capacity) in 2024 and 1,019 Mm³ (70 %) in 2025. Both series are the operator's, so this shows the record agrees with itself, not that it is right. An outside check (RID's discharge at Yala against the tributaries, or the reservoir's area from satellite) has not been made.

## The zone (13 Oct 2026, not validated)

`uv run python -m dam_release zone` builds the land a rise in the river can reach below the dam: `out/dam_release/bang_lang_zone.tif` (band 1: 1 zone, 2 outer band; band 2: height above the river), `geojson/bang_lang_zone.geojson`, `zone_by_tambon.csv` and `zone.json`. It is the second version of step 3. The owner saw it beside the OpenStreetMap path and chose it, with the outer band, on 14 Oct 2026: a release notice now goes to the 55 tambons of the outer band, and the map shades the zone and outlines the band. A tambon the river does not run through takes the arrival times of the nearest point of the river (the earliest its water could come). The spill of 6 January 2021 that anchors the largest release is also on film: the owner pointed to footage of the spillway that day, which agrees with the archive (level 115.9 m, the highest on record, that evening).

**Method.**

1. *The river's surface.* The 25th percentile of the heights on and one cell beside the mapped channel, in 500 m stretches, made to fall towards the sea (pool-adjacent-violators, so one pit in the model does not lower the whole river below it). The model is FABDEM on the 30 m grid, **unburned** (`out/hazard/work/dem_utm.tif`): the routing copy has the rivers cut 10 m in. Surface: 48.8 m at the dam, 0.5 m at the mouth.
2. *Height above the river.* Each land cell takes the surface of the river cell nearest to it in a straight line; its own height less that.
3. *How high the river has stood.* At four gauges, the highest level in the archive as a six-hour median, less the surface of step 1 there:

| Gauge | River km | Highest level (m MSL) | When | River surface in the model | Rise |
|---|---|---|---|---|---|
| BLGTD02, Bannang Sata (EGAT) | 18.6 | 40.56 | 25 Dec 2023 | 38.05 | 2.51 m |
| X.40A, Yala town (RID) | 78.1 | 18.95 | 28 Nov 2024 | 14.50 | 4.45 m |
| X.275, Ban Brido (RID) | 120.6 | 3.48 | 26 Nov 2025 | 2.22 | 1.26 m |
| X.10A, Pattani town (RID) | 129.7 | 1.88 | 29 Nov 2024 | 0.71 | 1.17 m |

   Between gauges the rise goes by river distance; above the first and below the last it stays at theirs; it is never taken as less than 1 m. The January 2021 release, the largest on record, came within 0.3 m of the highest level at Yala (18.63 m) and at Pattani town.
4. *The zone.* Cells no higher above the river than that rise, within 6 km of the channel, inside a tambon, and joined to the channel through other such cells (a low field behind a ridge is out; the lower valley of a side stream is in). The outer band is the same with one metre added.

**Result.** Zone 224 km², about 36,500 buildings (Open Buildings 2023), in 51 tambons. With the outer band 325 km², about 86,500 buildings, 55 tambons. The interim path lists 39 tambons: one of them (La-Ae, reached only by a side stream's lower 5 km) has nothing in the zone, and 13 tambons the river does not run through have land in it (Dato, Tuyong, Bang Tawa, Pado, Pa Nan, Rawaeng, Wat, Ko Lam, Mae Lan, Pa Rai, Li Don, Na Tham, Phron).

**Against the radar** (the VV rule, inside the 6 km corridor):

| Radar map | Share of the radar's flood the zone holds | Share of the zone the radar saw wet | Same, with the outer band |
|---|---|---|---|
| Season 2020 (holds the January 2021 release) | 67 % | 18 % | 79 % / 15 % |
| Nov–Dec 2024 | 65 % | 19 % | 83 % / 17 % |
| Nov–Dec 2025 | 62 % | 24 % | 76 % / 21 % |

For comparison, one uniform rise along the whole river holds 55–57 % of the 2020 and 2024 floods at 2 m (170 km²) and 74–83 % at 4 m (353 km²): the gauge-anchored zone does better per km² than either.

**Limits.**

- A level-pool reading of a 30 m model. No volume, no duration, no flow: it cannot say whether a release of a given size fills the zone. It says which land is low enough and joined to the river at the highest levels the gauges have shown.
- Those highest levels are mostly rain floods with water from the whole catchment, not releases. A release alone, into a low river, would stand lower. The zone is therefore the outer case for the river, which is the right way round for a warning.
- The radar's flood in the corridor is largely rain standing on the plain, not river water, and the radar is blind in towns and under trees. "Holds 65 %" and "18 % seen wet" are a sanity check, not a score.
- The gauges are in metres above Thai mean sea level, the model in EGM2008 heights: a difference of some decimetres is inside the method.
- "Nearest river cell in a straight line" is wrong across a ridge and loose on the coastal plain, hence the 6 km limit, which is visible as a cut on the plain west of Yarang and Pattani town. The model also gives the tidal flats and fish ponds north-west of Pattani town heights near zero; they are in the zone where they lie inside a tambon.
- Embankments, road fills and channels narrower than a cell are not in the model (science plan Module 8).

## The outside check of the dam's figures (13 Oct 2026)

The owner does not take it as settled that the floods of late 2024 and 2025 came without water from the dam (12 Oct). The dam's own record says: no spill since January 2021, releases stopped altogether from the evening of 26 November 2024 to 30 November, and from 23 November 2025 through the flood. Three things were set against that which do not come from the operator. The scripts were one-off; the numbers below are what they printed.

**1. The reservoir seen from space.** Water area inside the mapped reservoir from Sentinel-1 (VV below −17 dB after a 30 m median; `out/dam_release/reservoir_area.csv`, 35 passes). In both floods the area grew as the reported storage did: 29.2 km² on 17 November 2024, 34.2 on the 29th, 36.8 on 11 December (reported 725, 1,095, 1,215 Mm³); 25–29 km² on 11–24 November 2025, 36.6 on the 29th (657–742, then 901 Mm³). On one orbit the rank correlation of area with reported storage is 0.94 (six passes); on the other, with 28 passes, 0.44, because wind on the water makes single passes read low. So the reservoir was filling through both floods, which is what the record says, and it stood below its January 2021 state (38 km² at 1,370–1,440 Mm³). This confirms the storage figures. It cannot show whether water was also let out while the reservoir filled.

**2. The irrigation department's gauge at Bannang Sata (X.77), 18.6 km below the dam.** ThaiWater lists X.77 with a wrong position (on Khlong Yai, 20 km west); the department's own listing puts it on the main stem at Bannang Sata, beside EGAT's BLGTD02, with 2,283 km² above it against 1,992 km² above the dam. On 27 November 2024 at 16:00 it read 901 m³/s while the dam reported no release at all and an inflow of about 1,650 m³/s. Taken at face value, the 291 km² between the dam and the gauge gave 3.1 m³/s per km² while the 1,992 km² above the dam gave 0.83. Over 24 November to 6 December: 333 Mm³ passed X.77, the dam reported 92 Mm³ released, leaving 241 Mm³ (828 mm) from those 291 km², against 280 mm from the catchment above the dam. In 2025 the same sums give 368 mm against 125 mm. **Three times more water per km² from the land just below the dam than from the land above it, in both floods.**

   That is either heavier rain below the dam, a gauge that over-reads, or water from the dam that the record does not show. The gauge is not good enough to choose: against the dam's own outflow in the dry months, when nothing else feeds the river, X.77 read 0.68 of it in 2024, 0.99 in 2025 and 2.42 in 2026. Its rating moves by a factor of two or more from year to year.

**3. The irrigation department's gauge at Yala (X.40A).** 797 Mm³ passed Yala from 22 November to 10 December 2024, of which the dam's reported releases are 155 Mm³ (19 %); in 2025, 621 Mm³ and 23 Mm³ (4 %); in the January 2021 release, 615 Mm³ and 369 Mm³ (60 %). The government's statement of 1 December 2024 that the dam had held back over 400 Mm³ in a week agrees with the archive (storage up 466 Mm³).

**4. The rain on both sides of the dam** (GSMaP basin means, collected for S5 on 14 Oct). From 24 November to 6 December 2024, 686 mm fell on the catchment above the dam and 835 mm on the 291 km² between the dam and X.77. The dam's own figures put 280 mm of that into the reservoir, a runoff share of 0.41. X.77's figures need 828 mm to have run off the land below, a share of 0.99: all of the rain. In 2025 (20 to 30 November): 762 mm and 963 mm of rain, shares of 0.16 above the dam and 0.38 below it. So the rain was heavier below the dam, but not three times heavier, and X.77 asks the land below the dam to shed more than twice the share of its rain that the land above did. If the lower land ran off as the upper did, about 140 Mm³ in 2024 and 60 Mm³ in 2025 at X.77 are not accounted for. A gauge that reads twice too high at flood stage would account for all of it; so would a release of that size.

**Reading.** Nothing outside the operator contradicts the record, and the satellite confirms the part of it that can be seen from above. But the one independent gauge close to the dam shows more water than the land below the dam should easily give, in both floods, and it is too unsteady to say why. The question is not closed. What would close it: the rain on those 291 km² and on the catchment above the dam in the same days (GSMaP, collected in S5), and the department's rating notes for X.77.

## A full reservoir's own zone (27 Oct 2026, not validated)

`uv run python -m dam_release spill` builds, for each reservoir with no gauge below it, the land one day of spill from a full reservoir can reach. Outputs: `out/dam_release/spill/<code>.json` and `<code>_by_tambon.csv`, `out/dam_release/geojson/<code>_spill.geojson`, and with `--seed` the seed `supabase/seed/43_dam_spill_zone.sql`.

**Why it exists.** The owner asked on 26 Oct 2026: which reservoirs have no release zone, and for an irrigation reservoir that merely collects water, where does the water go when it fills up and who is in the way? Five of the six reservoirs had no zone. Three of them — Khlong Chamrai, Klai Ban, Ban Baik — had no mapped channel below them either, so `admin_send_dam_release` refused to send for them at all ("that dam has no release zone"), and the other two had no arrival times. Khlong Chamrai, which prompted the question, went from 42.8 % full on 12 October to 55.8 % on 24 October with the season's rain still to come.

**The six steps.**

1. **The start.** The cell inside the mapped pool that the most land drains to; without a pool outline, the cell near the given wall position with the largest catchment that does not stand above the wall. Its flow accumulation is the catchment above the wall.
2. **The path.** The hazard module's D8 pointer, followed downstream. It is built on the breached and filled surface, so a path exists where no channel is mapped — which is the whole point for three of these five.
3. **The cut.** The path stops at the first cell whose own catchment is ten times the reservoir's. Past that junction the flood is the receiving river's, and that river has gauges and thresholds of its own. The owner chose this on 26 Oct 2026 over running to the sea: a 6 Mm³ reservoir must not put its name on Hat Yai's flood.
4. **The corridor.** Not a radius: the land that drains into the kept reach, below the wall, from the same flow directions. A radius reaches over the divide into the next valley, which lies lower, and the volume balance of step 6 would then be spent filling somebody else's valley. (Measured: with a 3 km radius, a 0.1 m rise at Khlong Chamrai "held" 56.8 Mm³ — nine times the whole reservoir — because the corridor had taken in the neighbouring khlong's floor.)
5. **A day's spill.** The reservoir is full, so what arrives has to leave: the catchment above the wall × the wettest day on record over it × the share that runs off. 0.6 for the zone, 0.9 for the outer band, where the ground is already saturated.
6. **The fill.** The water surface, level above the channel's own falling surface (S7's `river_surface` and `height_above_river`, so both kinds of zone are read the same way), whose volume over the corridor equals that day's spill. Ground more than 2 m below the channel counts as exactly 2 m below it, so one pit in a 30 m model cannot swallow the volume. The band is never thinner than 0.3 m nor deeper than 5 m, and the outer band is never drawn on the zone's own line (at least 0.5 m more).

**Checked against the dam that has a zone.** Traced from Bang Lang the method gives a catchment of 1,992 km² (RID's figure above the dam is about 2,080) and 129 km to the Pattani river mouth, against 134 km for the mapped channel. The path is right; it is the only part of this that can be checked against something independent.

**The design rain, and why the rain gauges could not carry it.** `spill rain` asks GSMaP, hour by hour over each catchment, for the nine flood seasons 2017–2025 — the same collection, band and grid the flood thresholds were measured on. The rain gauges are the cross-check, and they are the reason the satellite is the input: ThaiWater's daily archive holds single "days" of 1,052 mm at Ban Pula Tiri and a run of 164 → 333 → 455 → 719 → 980 → 1,035 mm at Sadao over six days of November 2025, which is a running total and not daily rain. `daily_rain` differences a run of three days or more that never falls and reaches 250 mm, and anything still over 400 mm is treated as a gauge fault; even so, a point gauge cannot be trusted with a single day's extreme here. Where both can be read they agree:

| Reservoir | Catchment | Satellite, wettest 24 h | The nearest usable gauge |
| --- | --- | --- | --- |
| Khlong Sadao | 23.2 km² | 311.6 mm (24 Nov 2025) | 248.4 mm, Sadao town, 9.9 km |
| Khlong La | 24.2 km² | 339.3 mm (24 Nov 2025) | 300.6 mm, Ton Nga Chang, 11.0 km |
| Khlong Chamrai | 8.4 km² | 345.3 mm (24 Nov 2025) | 311.2 mm, Sadao, 12.5 km |
| Klai Ban | 2.5 km² | 557.0 mm (23 Nov 2025) | 102.5 mm, one gauge, one year of record |
| Ban Baik | 2.8 km² | 411.0 mm (23 Nov 2025) | 388.8 mm, Raman, 12.5 km |

All five fall in the floods of 23–24 November 2025. Klai Ban's 557 mm is the one figure to treat with suspicion: it is the highest of the five over the smallest catchment, its gauge has a year of record and says 102 mm, and GSMaP is known to read high at extremes. **A seed is refused unless the satellite has been asked** (`spill --seed`), so no zone rests on the gauges.

**The result.**

| Reservoir | Full | Reach kept | A day's spill | Zone | Outer band | Tambons | Water arrives |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Khlong Sadao | 56.7 Mm³ | 14.8 of 29.7 km | 4.35 Mm³ | 1.14 m, 5.7 km², 3,242 buildings | 1.64 m, 7.0 km², 3,862 | 2 | 0–6.4 h |
| Khlong La | 21.4 Mm³ | 21.2 of 29.7 km | 4.93 Mm³ | 0.30 m, 8.6 km², 660 | 0.80 m, 13.2 km², 2,188 | 3 | 0–10.3 h |
| Khlong Chamrai | 6.0 Mm³ | 5.3 of 29.4 km | 1.74 Mm³ | 1.74 m, 1.6 km², 150 | 2.25 m, 1.8 km², 163 | 1 | 0 h (it is in the tambon) |
| Klai Ban | 3.7 Mm³ | 5.5 km, to the flats | 0.84 Mm³ | 0.42 m, 3.3 km², 85 | 0.92 m, 5.2 km², 240 | 2 | 0–0.2 h |
| Ban Baik | 1.2 Mm³ | 7.6 of 28.9 km | 0.69 Mm³ | 0.30 m, 2.6 km², 271 | 0.80 m, 8.3 km², 2,127 | 3 | 0–3.0 h |

Khlong Chamrai's zone is one tambon, Khlong Hoi Khong: 1.6 km² of low land along 5.3 km of khlong, about 150 buildings. That is the honest answer for a 6 Mm³ reservoir, and it is 150 buildings more than the nobody it could warn before.

**Two results to look at again.** Ban Baik's outer band jumps from 2.6 km² and 271 buildings to 8.3 km² and 2,127 for half a metre more water, because its reach ends in the flats of Yala town where the ground is nearly level — so two Yala city tambons are on a 1.2 Mm³ reservoir's notice list. And Khlong Sadao's list falls from the 17 tambons of the interim OpenStreetMap path (the river line all the way through Hat Yai to Songkhla Lake) to 2, which is the cut of step 3 doing exactly what it was asked to do. Both follow from the owner's own choices; both are worth a second look before the season.

**Against the radar** (the share of the radar's flood inside the corridor the zone holds / the share of the zone the radar saw wet):

| Reservoir | Season 2020 | Nov–Dec 2024 | Nov–Dec 2025 |
| --- | --- | --- | --- |
| Khlong Sadao | 7.6 % / 2.1 % | 3.9 % / 0.5 % | 9.4 % / 3.5 % |
| Khlong La | 55.0 % / 19.9 % | 59.7 % / 13.9 % | 38.0 % / 20.7 % |
| Khlong Chamrai | 11.4 % / 1.6 % | 15.8 % / 1.8 % | 14.7 % / 2.6 % |
| Klai Ban | 28.2 % / 10.9 % | 42.7 % / 21.7 % | 33.3 % / 14.9 % |
| Ban Baik | 21.3 % / 13.8 % | 10.9 % / 3.7 % | 34.1 % / 43.3 % |

Khlong La's figures sit where Bang Lang's zone sits (62–67 % held, 18–24 % wet) and Klai Ban's are respectable. Khlong Sadao's and Khlong Chamrai's are poor: their reaches are upland and narrow, where the radar is blind under trees and the wet pixels in the corridor are rain standing on the valley sides rather than water out of the channel. As with Bang Lang's zone this is a sanity check, not a score — but for those two it is a check the zone does not pass, and nothing here should be read as validation.

**Limits.** Everything S7's zone cannot say, and five more:

- There is no routing and no attenuation. A level pool holding a volume is not a flood wave; it says which land is low enough, joined to the channel, and inside the valley this reservoir's water goes down. The depth is the depth of the band, not a forecast for anybody's house.
- The design rain is the wettest 24 hours in nine seasons of a satellite product, not a return period, and for the smallest catchments one GSMaP pixel is larger than the catchment itself.
- The runoff shares, 0.6 and 0.9, are judgement. Nothing here measures them: the reservoirs publish no inflow history at all (`dam_medium_graph` is empty for every one of them), so there is no event to fit them to. **Revisit after the first flood these five see with Jaga watching.**
- The arrival times are the reach length at an assumed 0.5 to 2 m/s. Nothing is measured, there is no gauge below any of these reservoirs to measure it with, and the peak is given the same window as the first rise because the two cannot be told apart over reaches this short. Every screen that shows them says so.
- The cut at ten times the catchment is a ratio of catchments, not of volumes. For the biggest of the five it may cut too early: 57 Mm³ is a lot of water in absolute terms even where the receiving river drains thirteen times more land.

## When a full reservoir rings the phones (27 Oct 2026)

Three rules were added for the reservoirs, all of them in the database and all of them the admins' to change (migrations `..s7_reservoir_full_rule`, `..s7_reservoir_auto_alarm`, `..s7_auto_all_clear`).

**Being full now grades as something.** For all five reservoirs the capacity at normal high water *is* the full capacity, so S7's `above_normal_high` could only fire above 100 % and a reservoir at 99 % and climbing graded as quiet. Now: at or above 80 % of capacity it is `watchful` with the reason `near_full`; at or above 95 % **and still filling** it is `releasing` with the reason `full_and_rising`, which raises a row on the war room. Full and steady is watchful, not releasing — the water is not rising towards anybody. The same grade also lights the reservoir's tile on the map, because the state that rings every admin's phone has to be the state a reader sees blinking.

**The automated alarm, extended.** The owner asked on 27 Oct 2026 for the reservoirs to work like the river gauges under safety rule 2's one exception. A reservoir an admin has ticked (all five are, by `supabase/seed/44_auto_alarm_dams.sql`) raises a draft at 95 % and filling, on every admin's phone, from the reviewed template `reservoir_full_warning`, naming the tambons of its own overflow zone. If nobody sends or dismisses it within the grace time, Jaga publishes that draft itself, marked as issued without review and written to `audit_log`; if the reservoir has stopped filling by then, nothing is published. What is different from a gauge: one daily reading grades rather than two hourly ones, 48 hours old counts as fresh, and the level is **Warning, never Evacuate** — the biggest of the five holds 57 Mm³, the smallest 1.2, and their zones are a screening band from an elevation model. Telling a tambon to leave on that evidence stays a person's decision.

**And when it is over.** Nothing used to take an alert down: it stood with its level until an admin superseded it. Now, when the water is clearly back down — a reservoir under 85 % of capacity, or a gauge 0.3 m under the threshold that fired, for two readings in a row — and the alert has stood for six hours, the same road carries the all-clear from the reviewed `flood_return` template, superseding the alert it answers. The margins are hysteresis: a reading wobbling across the line that fired would otherwise flap between warning and all-clear, which is worse than either. Only an alert the automated path published itself is cleared this way; a person's alert is a person's to take down. Six hours is the floor because an alert cleared twenty minutes after it was raised was a false alarm, and the way to deal with one of those is for a person to withdraw it, not for the machine to declare the area safe.

**One bug found on the way.** `auto_alarm_check` had no `not is_drill` filter on the guards that ask whether an alert already stands over a zone, although the drill-delivery migration of 20 Oct 2026 recorded that the automated alarm "reads `not is_drill` already". It did not. A drill sent over an area would therefore have suppressed the automated alarm there for 48 hours — and a drill sent to everyone, over the whole service area, would have suppressed it everywhere. Fixed in `..s7_reservoir_auto_alarm` as part of the same replacement.
