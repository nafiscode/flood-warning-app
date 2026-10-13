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
