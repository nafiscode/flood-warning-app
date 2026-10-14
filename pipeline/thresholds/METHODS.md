# Trigger thresholds: methods (S5, provisional)

Science plan Module 3. `uv run python -m thresholds basins | rain | glofas | hindcast` from `pipeline/`.
The figures are in `out/thresholds/report.md`, rebuilt by `hindcast`; this note says how they are made and what they cannot carry.

## What this is, and what it is not

It produces `thresholds.yaml`: for each warning zone, a rain figure for Watch, a river level for Warning and the bank level for Evacuate. The admins' signal dashboard (A8) will show a **suggested** level from them, with the reason. Nothing here publishes an alert, and no screen may present a threshold as a forecast (safety rules 2 and 8).

Every figure is provisional. The gauges in the archive begin in February 2020, so only six seasons can be judged, and a zone has between one and fourteen floods in them.

## Zones and gauges

| Zone | Key gauge (the flood is defined here) | Bank | Upstream gauge | Bank | Rain basin |
|---|---|---|---|---|---|
| Pattani River | X.40A, Yala town | 16.5 m | X.77, Bannang Sata | 39.7 m | the 1,223 km² that drain to Yala without passing Bang Lang dam |
| Kolok River | X.119A, Sungai Kolok | 9.3 m | X.274, Waeng | 23.5 m | 771 km² above the gauge, more than half of it in Malaysia |
| Khlong U-Taphao | X.44, Hat Yai | 7.4 m | X.90, Khlong Hoi Khong | 9.34 m | 1,693 km² above the gauge |

Bank levels are the irrigation department's, as printed in its flood summaries for water years 2567 and 2568 (the station list has 7.15 m for X.44 and 40.3 m for X.77; the summaries' values are used). The reservoir's own catchment (1,992 km²) is a separate basin: the dam holds its water back, so rain there does not reach Yala as rain elsewhere does.

## The signals

- **Basin rain.** GSMaP v8 operational, the gauge-adjusted hourly rate, averaged over each basin on the product's own 0.1° grid (Earth Engine; about two to five minutes a season). Summed over 24 and 72 hours. A basin of a few hundred km² is two or three cells: the figure is coarse, and satellite rain is known to read low in the heaviest mountain rain.
- **River level** at the key and the upstream gauge, hourly, from the ThaiWater archive; and the key gauge's rise over six hours.
- **Modelled discharge.** GloFAS daily, from Open-Meteo's free flood API. GloFAS rivers do not sit exactly on ours, so the nine 5 km cells around the gauge are asked for and the one with the largest mean flow is kept. Reported before each flood, not used for a threshold: it is a model's reanalysis, and what it would have said as a forecast at the time is not what the archive holds.
- Not yet in: forecast rain, tide and wind at the river mouths, and the dam's release (it has its own grading, `pipeline/dam_release`).

## Floods, alarms and the score

- A **flood** is the key gauge at or above its bank for three hours or more; five days below the bank end it. Its onset is the first such hour.
- An **alarm** is a spell above a threshold within October to January; spells less than 48 hours apart are one alarm. It is a **hit** when a flood begins while it stands or within 120 hours of its start, a **false alarm** otherwise. An alarm in a season before the gauge reported is **unjudged**: counted, and left out of the false-alarm ratio.
- A flood is **detected** when an alarm that began before it covers it. Its lead is the time from that alarm's start to the onset.
- POD = floods detected / floods. FAR = false alarms / (hits + false alarms). CSI = floods detected / (floods + false alarms).

## How a threshold is chosen

For each level the candidates in `config.yaml` are all scored, and the one kept is the one with the **highest CSI**: the best balance of floods caught against false alarms. Ties go to the one that catches more floods, then to the longer lead. Watch is chosen from rain over 72 hours among candidates with a median lead of at least 12 hours. Warning is chosen from the upstream level, the key gauge's own approach to its bank, and rain over 24 hours, among candidates with a median lead of at least 3 hours. The first rule tried, "catch every flood with the fewest false alarms", was dropped on 14 Oct 2026: on the Pattani River it gave 60 mm in 72 hours with 24 false alarms in six seasons, and on the Kolok nothing at all. The chosen threshold may therefore miss the smallest floods (a river a few centimetres over its bank for a few hours); the report says how many. Evacuate is the key gauge at its bank: flooding under way.

The science plan's first idea, "the value reached 48 to 72 hours before onset in both events", is printed in the report (the signals before each flood) and was not used as the rule: three days before these floods the rain had not begun, so such a threshold would stand most of the season.

## The event timeline

`pipeline/data/event_timeline.csv` (private data repo) was meant to be filled by the owner from memory. The owner was not in the area during either flood, so on 13 Oct 2026 it was filled from Thai-language news and, above all, from the irrigation department's flood summaries (`water.rid.go.th/hyd/Report/2567/Flood_2567/21_2567.pdf`, `.../2568/Flood_2568/21_2568.pdf` and `20_2568.pdf`), which give the over-bank dates and peaks per station. 39 rows; 13 rest on a dated, specific statement, 19 are weak (a province-wide "since the 26th", a warning date). `event_timeline_notes.md` beside it has the sources and what could not be found. The hindcast's floods come from the gauges themselves; the timeline is printed beside them as a check and for the districts that have no gauge.

## Limits

- **Few floods.** There are between one and fourteen per zone. The false-alarm ratio comes from six seasons. Both will move with every new season.
- **The threshold was chosen on the same floods it is scored on.** There is no held-out test. The scores are the best case.
- **Flood means the gauge over its bank.** Streets flood from local rain before the river leaves its bank (Yala, 22 November 2025: water in the streets two days before X.40A went over) and a gauge can fail at the height of a flood (X.90, 24 November 2025).
- **Hat Yai has one flood by this definition** (November 2025); in November 2024 X.44 peaked 14 cm under its bank while the town flooded from Khlong Wa and its own drains. The U-Taphao thresholds stand on a single event and should be treated as placeholders.
- **The Kolok basin is mostly in Malaysia**, where no gauge of ours stands; rain there is from the satellite alone.
- **Rain thresholds do not know how wet the ground is.** The same 72-hour rain floods a saturated basin and not a dry one.
- Lead times are from the alarm's start to the gauge's onset. The time needed to decide, write and send an alert comes out of them.

## Levels for every gauge (14 Oct 2026)

The owner asked for Watch, Warning and Evacuate at every river gauge, not only the three key gauges. `uv run python -m thresholds gauges` (`thresholds/gauges.py`) writes them to `gauge_levels.md` (beside this file), `out/thresholds/gauge_levels.json` and `supabase/seed/47_gauge_levels.sql` (table `gauge_levels`, provisional; an admin changes them on the signal dashboard's gauge map, and a level an admin set is never overwritten by a re-seed).

- **Evacuate is the bank**, the irrigation department's own flood marker at that gauge, as the key gauges' hindcast chose.
- **Warning** is the highest level below the bank whose crossings came, in the median, at least 6 hours before the river reached its bank, chosen by the critical success index over the whole record (2017 onwards, every month); **Watch** the same with 24 hours and at least 0.2 m below Warning. Candidates run from 0.1 to 4 m below the bank.
- **A level may not be one the river sits above for weeks:** Warning is exceeded in at most 3 % of the record's hours, Watch in at most 6 %. Without this, at gauges near the sea (banks of 1–2 m) the tide kept a low "alarm" on for months, its "lead" came out in thousands of hours, and the levels fell below mean sea level. Where a rule-picked level was under that floor, it was lifted to it (marked "lifted").
- **With fewer than three floods on record** (or no candidate that gave the lead), the level comes from how fast the river rises: Warning = bank less the 95th percentile of all 6-hour rises (at least 0.3 m), Watch = bank less the 24-hour rise, and at least half as far again below the bank as Warning. 32 of 46 gauges are set this way, including X.44 at Hat Yai (one flood) — so most of these are informed placeholders, not tested thresholds.
- **The key gauges keep what the owner accepted for their zones** (X.40A Warning 16.0, Evacuate 16.5; X.119A 8.8 and 9.3; X.44 Evacuate 7.4) and gain only a level-based Watch below them. In the app the key gauge's levels and its zone's `key_level_m` threshold are one value: saving either changes both.
- **Nine gauges are flagged "bank looks too low"**: the river stands within 0.3 m of the listed bank more than a tenth of the time (X.275, FOP041, JNA001, JNA002, ONE037, ONE038, ONE039, SLA005, SLA007 — mostly tidal reaches). There the listed bank is no flood marker and the levels need someone who knows the gauge. **Two gauges never reached their listed bank** in the record (BLGTD01, MOU454). BLGTU05 and BLGTU06 have no bank and no levels.
- The automated alarm reads them: a ticked gauge other than its zone's key gauge raises Warning (never more on its own) at its own Evacuate level.

## The tide check (14 Oct 2026)

The A8 phase prompt asked for ThaiWater's own tide and storm-surge data to be evaluated before Open-Meteo Marine was taken. **ThaiWater's public API has no tide or surge series**: its summary call (`public/thailand_main`) carries `wave` and `storm`, and both are pictures (SWAN wave-height maps from HII, storm-track images), not numbers; no tide-station listing answers. The only observed sea-driven water level in the four provinces is at the river gauges the tide reaches, so they were the yardstick.

`uv run python -m thresholds tide` (`thresholds/tide.py`) fetches Open-Meteo's hourly `sea_level_height_msl` at each zone's `tide_point` for 2022 to October 2026 (cached in `out/thresholds/tide/`), splits each series with a centred 25-hour mean into the **tidal band** and the **slow part** (river, surge, monsoon set-up), and correlates gauge with model at the best lag. Output: `out/thresholds/tide_check.json` and `.md`.

| Zone | Gauge | Tidal band: r, lag, spread gauge/model | Tidal range gauge / model (m) | Slow part: r, lag | Over bank: hours, by tide alone | Reading |
|---|---|---|---|---|---|---|
| Pattani | X.10A (Pattani town) | 0.80, 1 h, 1.07 | 0.48 / 0.50 | 0.83, 2 h | 668, 23 | tidal, follows the model |
| Pattani | BLGTD05 (Pattani town, EGAT) | 0.90, 1 h, 1.02 | 0.50 / 0.50 | 0.85, 2 h | 602, 14 | tidal, follows the model |
| Pattani | X.275 (Ban Brido) | 0.62, 2 h, 0.68 | 0.32 / 0.50 | 0.61, 12 h | 3,844, 78 | partly tidal |
| Kolok | X.119 (Ban Muno) | 0.06 | 0.12 / 0.91 | 0.47, 23 h | 239, 6 | above the tide's reach |
| U-Taphao | ONE038 (Songkhla lake) | 0.90, 1 h, 0.56 | 0.30 / 0.52 | 0.92, 1 h | 634, 128 | tidal, damped by the lake |
| U-Taphao | ONE037 (U-Taphao at the lake) | 0.87, 3 h, 0.38 | 0.20 / 0.52 | 0.90, 10 h | 1,262, 238 | tidal, damped |
| U-Taphao | SLA005 (Pak Ro) | 0.84, 3 h, 0.31 | 0.16 / 0.52 | 0.88, 12 h | 2,847, 384 | tidal, damped |
| U-Taphao | X.44 (Hat Yai) | 0.38, 5 h | 0.25 / 0.52 | 0.55, 7 h | 133, 13 | above the tide's reach |

What it says:

- **Open-Meteo Marine is kept.** At Pattani town, 5 km from the mouth, the model's tide matches the gauges in phase (1 hour) and range (within 7%), and its slow part follows theirs (r 0.83 to 0.85). There is nothing in ThaiWater's public data to prefer.
- **Songkhla lake damps the sea**: the tide inside the lake is a third to a half of the open sea's, one to three hours late, while the lake's slow level follows the sea's closely (r 0.88 to 0.92). The U-Taphao zone's sea figure is the sea at the lake's outlet, not the water in Hat Yai, and the dashboard's caveat says the tide is a model.
- **The Kolok has no tidal gauge to check against**: Ban Muno is 25 km up the river and above the tide's reach. The model's range off Tak Bai (0.91 m) is unverified.
- **At the gauges near the sea, most hours over the listed bank are not the tide alone** (23 of 668 at X.10A, 78 of 3,844 at X.275): the river's own slow level stands above those banks for long spells. That is why `thresholds gauges` flags their banks as too low to mark a flood, rather than a tide problem.
- Not tested: whether the model catches a storm surge. None of these years had a surge large enough to tell apart from the monsoon set-up in the slow part.

## Forecast rain before the floods (14 Oct 2026)

`uv run python -m thresholds forecast` (`thresholds/forecast.py`) asks Open-Meteo's archive of past forecasts (`previous-runs-api`, which starts during 2024, so only seasons 2024 and 2025) for the rain each model forecast over the zone's rain points, averaged as the live feed does. `precipitation_previous_dayN` at an hour is the forecast for that hour made about N days earlier; summing `previous_day3` over the 72 hours from t gives a three-day forecast that was all issued by t. The rule the signal dashboard uses ("the next 72 hours hold the Watch threshold" -> Watch) and lower thresholds for forecast rain were scored like every other threshold, against the floods at the key gauges (Pattani 2, Kolok 3, Hat Yai 1). Output: `out/thresholds/forecast_check.json` and `.md`.

**What the models saw coming, 72 hours of basin rain before each flood (mm):**

| Flood | Satellite (GSMaP) | Default (= ICON here) 1 / 2 / 3 days ahead | ECMWF IFS | GFS | JMA |
|---|---|---|---|---|---|
| Pattani, 27 Nov 2024 | 411 | 9 / 3 / 11 | 28 / 33 / 34 | 45 / 39 / 10 | 18 / 5 / 13 |
| Pattani, 23 Nov 2025 | 647 | 97 / 37 / 39 | 108 / 45 / 62 | 30 / 27 / 107 | 101 / 48 / 30 |
| Kolok, 26 Nov 2024 | 324 | 46 / 31 / 34 | 49 / 71 / 58 | 64 / 74 / 36 | 43 / 37 / 35 |
| Kolok, 26 Nov 2025 | 320 | 132 / 103 / 74 | 112 / 97 / 89 | 295 / 87 / 70 | 93 / 74 / 67 |
| Hat Yai, 22 Nov 2025 | 286 | 86 / 62 / 85 | 90 / 48 / 77 | 64 / 27 / 29 | 142 / 87 / 66 |

(The Kolok flood of 30 Dec 2024 came with 12 mm of satellite rain: the river rose from rain over Malaysia or from the sea, not from the basin above the gauge.)

- **Every model was far too dry**, by a factor of 2 to 40 against the satellite. GSMaP (gauge-adjusted) may itself read high, but the floods happened and the gauges agree. Open-Meteo's default model for this place behaves like DWD's ICON, the driest of the five in 2024.
- **At the same threshold as rain already fallen, the forecast rule caught almost nothing**: Pattani 0 of 2, Hat Yai 0 of 1, Kolok 1 of 3. So the live dashboard's "forecast -> Watch" reason will rarely fire, and when it does not, that is not reassurance.
- **Lower thresholds for forecast rain** give lead but cost false alarms, and with six floods the best model and figure differ from zone to zone (Pattani: GFS 80 mm, 2/2, 1 false, 65 h; Kolok: ECMWF 100 mm, 2/3, 2 false, 37 h; Hat Yai: ICON 40 mm, 1/1, 0 false, 107 h). Picking per zone would be fitting six events.
- **The wettest of the five models each hour, 150 mm over the next 72 hours**: Pattani 2/2 with 2 false alarms and a median lead of 51 hours; Hat Yai 1/1, 1 false, 54 hours; Kolok 1/3, 4 false. Taking the hourly maximum inflates totals, which is what lets a high figure work.
- Nothing here changes the live rule yet: that is the owner's choice (decision log).
