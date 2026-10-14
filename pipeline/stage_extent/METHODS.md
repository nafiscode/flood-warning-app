# Stage-to-extent library: methods note (S6)

Status, 14 Oct 2026: **built and run once, not reviewed by the owner, not in the app.** It is an
estimate of which land is under water at a given level of three river gauges. It is not a forecast
and not an alert. Its agreement with the radar is low (CSI about 0.15, see below), and that number
is the main thing to read in this note.

Settings: `config.yaml`. Science plan: `docs/science-plan.md` Module 4. Everything is local: no Earth
Engine, no network.

## Commands

From `pipeline/`:

```
uv run python -m stage_extent reach       # about 15 s
uv run python -m stage_extent pairs       # about 4 to 5 min (reads ~400 radar files)
uv run python -m stage_extent calibrate   # seconds
uv run python -m stage_extent layers      # about 50 s
uv run python -m stage_extent run         # all four
```

Outputs in `out/stage_extent/` (not in git):

| File | What | Size |
|---|---|---|
| `stage_extent_c97e0bf.pmtiles` | one vector layer `stage_extent`, all three gauges, zoom 8-11 | 0.47 MB, 28 tiles |
| `stage_extent_lookup_c97e0bf.csv` | station_code, stage_m, area_km2, buildings, layer_file (67 rows) | 3.5 kB |
| `stage_extent_summary_c97e0bf.json` | z0, scores, steps, sizes per gauge | 10 kB |
| `stage_extent_<code>_c97e0bf.tif` | first-wet stage per 30 m cell (m MSL), for checks | 34-77 kB |
| `calibration.json`, `pairs.json` | every paired pass, every score | 20 kB, 99 kB |
| `reach_<code>.npz`, `pairs_<code>.npz`, `reaches.geojson` | working files (heights, histograms, the stems) | 7-9 MB, 0.5 MB |

## Inputs

- Gauges: X.40A (Yala town, Pattani River), X.119A (Sungai Kolok), X.44 (Hat Yai, Khlong U-Taphao).
  Banks and positions as in `thresholds/config.yaml`. Levels in m MSL from the ThaiWater archive
  (`data/tidy/water_level_msl/<id>/`), read with `dam_release.travel.read_hourly`, the reader the
  thresholds use. The archive stores times in UTC: the collector reads ThaiWater's Bangkok clock
  times and converts them (`ingest_thaiwater/tidy.py`). Pass times in the radar file names are UTC.
  So both sides are compared in UTC. The archive starts on 12 Feb 2020.
- Readings above bank + 4 m are dropped as broken sensors (X.119A once read 22.8 m; its real record
  is 10.91 m).
- Radar: the per-pass files of the second S2 run only (`*_c97e0bf.tif`, 413 files). A pass exported
  at both 10 m and 20 m is read once, at 10 m. Codes 1 and 3 are flooded; 0 and 2 (VH only) are dry;
  250, 251 and 255 are unknown.
- Height: `out/hazard/burned/hand.tif` (the decided HAND), the unburned DEM
  `out/hazard/work/dem_utm.tif`, and the D8 pointer and accumulation from the burned DEM, all on
  the same 30 m UTM 47N grid.
- Buildings: `out/hazard/buildings/buildings_2023_30m.tif` (Open Buildings 2.5D, 2023).
- Province land: the hazard class raster (`> 0` is inside the four provinces). Nothing is scored or
  drawn outside it, so the Malaysian bank of the Kolok is left out.

## The reach

1. The gauge is moved to the cell with the most flow within 12 cells (40 for X.44, whose listed
   position is 1.2 km off the modelled channel, as in the thresholds).
2. The main stem runs 12 km down the D8 path and 12 km up it, upstream always taking the inflow
   with the most water. River km, not straight-line km.
3. The reach is the land whose flow path reaches that stretch of main stem inside a window of the
   reach plus 12 km. Tributaries are crossed, not stopped at.
4. For each such cell: its height above the main-stem cell its path reaches (on the unburned DEM).

Reach sizes inside the provinces: X.40A 178 km² (45 km² of it under 3 m), X.119A 149 km² (27 km²),
X.44 223 km² (28 km²).

Built-up cells (mean building presence of at least 0.10 over 5 x 5 cells, the hazard module's rule)
are left out of the score: the radar cannot see water between buildings. They are drawn in the
layer like any other land.

## The height

A cell is wet at gauge stage s when h < s − z0, with

    h = max(HAND, height above the main stem − 2 m)

In words: the cell is less than (s − z0) above its own stream, and less than (s − z0) + 2 m above
the main river where its water joins it. Next to the main stem the two terms are the same. Up a
tributary, the second term limits how far the main river's water reaches, and the 2 m allows for
the tributary's own water.

The 2 m was chosen from eight ways of measuring height, on the same calibration passes. One value is
used for all three gauges. It was chosen in-sample: the season-by-season check below covers z0, not
this choice.

| Allowance | X.40A CSI (held out) | X.119A | X.44 |
|---|---|---|---|
| 0 m (height above the main stem only) | 0.141 (0.126) | 0.126 (0.118) | 0.155 (0.139) |
| 1 m | 0.149 (0.147) | 0.132 (0.128) | 0.157 (0.133) |
| **2 m** | **0.156 (0.153)** | **0.141 (0.141)** | **0.162 (0.147)** |
| 3 m | 0.151 (0.148) | 0.135 (0.133) | 0.162 (0.146) |
| 4 m | 0.146 (0.139) | 0.134 (0.134) | 0.159 (0.148) |
| 6 m | 0.141 (0.136) | 0.120 (0.120) | 0.149 (0.145) |
| 8 m | 0.137 (0.137) | 0.096 (0.096) | 0.144 (0.143) |
| HAND alone (every stream rises as much) | 0.100 (0.098) | 0.048 (0.044) | 0.103 (0.079) |

The differences between 1 and 4 m are small. HAND alone is clearly worse: it wets the bottom of
every small valley in the reach whenever the main river is high.

## Pairing and calibration

- Each pass is paired with the gauge's reading nearest in time, within 1 hour. Otherwise it is
  skipped. 141 passes have no reading (before Feb 2020, or a gap).
- The radar's 10 or 20 m pixels are brought to the 30 m cells by area (a 20 m pixel cut by a 30 m
  cell counts by the share inside). A cell is known when half its area is known, and flooded when
  half its known area is flooded.
- A pass is kept when the radar saw at least half of the reach's low land (under 3 m). This drops
  the A070 orbit at Yala, which the terrain mask hides almost entirely there.
- **Calibration passes**: the gauge at most 1 m below its bank. Lower passes show paddies and rain
  ponding more than the river. X.44 had only one such pass (23 Nov 2025, 7.9 m), so for X.44 every
  pass from bank − 4.5 m (2.9 m) is used. That is six passes, five of them with the river in its
  channel.
- z0 is searched every 0.05 m from bank − 15 m to bank + 2 m. It is the value with the best pooled
  CSI over the calibration passes (TP, FP and FN summed over the passes).
- Held-out check: each season left out in turn, z0 refitted on the others, the left-out passes
  scored with it, the counts pooled.

## Results

CSI = TP / (TP + FP + FN). Hit rate = TP / (TP + FN). False-alarm ratio (FAR) = FP / (TP + FP).
Bias = the area the model calls wet over the area the radar saw wet. Built-up cells excluded.

| Gauge | Passes paired and seen | Calibration passes (seasons) | Stages | z0 (m MSL) | DEM at gauge | CSI in-sample | CSI held out | Hit rate | FAR | Bias |
|---|---|---|---|---|---|---|---|---|---|---|
| X.40A Yala | 70 | 11 (2020, 2022-2025) | 15.61-18.38 | 15.35 (bank − 1.15) | 14.50 | 0.156 | 0.153 | 0.40 | 0.80 | 1.96 |
| X.119A Sungai Kolok | 119 | 17 (2020-2025) | 8.36-10.68 | 8.70 (bank − 0.60) | 8.83 | 0.141 | 0.141 | 0.32 | 0.80 | 1.57 |
| X.44 Hat Yai | 70 | 6 (2020, 2022, 2025) | 3.03-7.90 | 3.00 (bank − 4.40) | 3.00 | 0.162 | 0.147 | 0.35 | 0.77 | 1.50 |

Held-out z0 per season: X.40A 15.25 to 15.50; X.119A 8.70 to 8.85; X.44 2.75 to 3.15. So z0 is stable
from season to season. The fitted z0 lies within 0.85 m of the elevation model's own height at the
gauge (FABDEM's water surface), and within 0.13 m at two gauges. Using that DEM height as z0 with
no fitting at all gives CSI 0.142, 0.141 and 0.162.

The CSI is flat near its best: within 0.02 of the best for z0 from 14.30 to 15.85 (X.40A), 8.05 to
9.25 (X.119A) and 2.05 to 3.45 (X.44). The radar does not pin z0 down closely.

Other views of the same fit:

| Gauge | Mean CSI per pass at z0 | Same, best height cut for each pass | All seen passes at z0 (any stage): CSI, bias | Built-up cells included: CSI |
|---|---|---|---|---|
| X.40A | 0.143 | 0.154 | 0.093, 0.72 | 0.144 |
| X.119A | 0.084 | 0.106 | 0.075, 0.53 | 0.133 |
| X.44 | 0.124 | 0.140 | 0.077, 0.44 | 0.133 |

The second column is the most any single height cut could score on these passes, each pass with
its own cut. It is only a little above the first. So the low CSI is not a matter of z0 or of the
gauge reading. It is the height model and the radar.

**How well the radar agrees with itself.** At Yala, ten pairs of passes lie 12 hours apart (D164 at
about 06:00 Bangkok time, then A172 at about 18:30 the same day). At high water the two passes agree with a CSI of 0.41 (22 Dec
2022, 16.0 m) and 0.44 (23-24 Nov 2025, 17.0 and 18.4 m). At low water they agree with a CSI of
0.01 to 0.27: one orbit flags 2 to 3 km² of "flood" the other does not. At Hat Yai two pairs give
0.40 (29 Nov 2025, 3.7 m) and 0.04 (5 Dec 2025, 1.5 m). So against this radar, even a perfect map
would score about 0.4 at high water. The model scores about a third of that.

Tried and dropped: leaving out cells the radar flags as flooded in low-water passes of the same orbit
(paddies, ponds, radar artefacts). It changed the CSI by 0.002 at most.

## The layers

- Stage steps of 0.25 m from bank − 2 m (rounded down) to the highest good reading + 1 m (rounded
  up): X.40A 14.50 to 20.00 m (23 steps; record 18.97 m, 28 Nov 2024), X.119A 7.25 to 12.00 m (20;
  record 10.91 m, 28 Nov 2024), X.44 5.25 to 11.00 m (24; record 9.97 m, 25 Nov 2025).
- Each cell carries `from_m`, the first step s with s > h + z0. A cell never wet up to the top step
  is not drawn. The bands of one gauge do not overlap; **the land under water at stage s is every
  polygon of that station with `from_m <= s`.** One PMTiles file holds all three gauges
  (properties `station`, `from_m`). This replaces the plan's "one layer per 0.25 m step".
- The tiles are written as the hazard tiles are (same smoothing, cut 0.40, simplification 0.6 px).
  Areas read back from the zoom-11 tiles are 0.5 to 8 % above the raster's (most at the lowest
  bands, where the patches are thin; 0.5 % at the top band).
- The area and buildings in the lookup include the river channel itself and the built-up land.

| Stage | X.40A km² (buildings) | X.119A | X.44 |
|---|---|---|---|
| bank − 1 m | 5.5 (372) at 15.5 | 0 at 8.25 | 32.9 (19,507) at 6.5 |
| bank | 16.2 (2,736) at 16.5 | 8.1 (1,567) at 9.5 * | 48.6 (38,403) at 7.5 * |
| about bank + 1 m | 29.6 (8,287) at 17.5 | 17.0 (4,977) at 10.5 | 63.2 (54,938) at 8.5 |
| record | 55.4 (24,589) at 19.0 | 20.9 (6,790) at 11.0 | 84.5 (71,773) at 10.0 |

\* the first step at or above the bank.

No depth layer was made. Depth would be s − z0 − h per cell; the app cannot work it out from the
polygons. It can be added as a raster if wanted.

## Where it fails, and why

**Everywhere: the agreement is low.** About 80 % of the land the model calls wet, the radar saw dry
(FAR 0.77 to 0.80). The model calls 1.5 to 2 times as much land wet as the radar saw, and still
finds only 32 to 40 % of the land the radar saw wet (hit rate). Reasons that apply to all three:
- The radar misses water under trees and crops (rubber, oil palm, orchards) and between buildings.
  Some of the model's "false alarms" are likely real water the radar could not see. Some are not.
- A 30 m bare-earth DEM does not see levees, embankments, roads on fill and the incised channel.
  It floods land a levee protects. Highway embankments (science plan Module 8) also block water.
- The radar passes rarely catch the peak. The highest calibration pass is 0.6 m below the record at
  Yala (18.38 against 18.97 m), 0.2 m below at Sungai Kolok (10.68 against 10.91 m) and 2.1 m below at
  Hat Yai (7.90 against 9.97 m). Everything above those levels is extrapolation.
- One z0 for 24 km of river assumes the same depth along the whole reach.

**X.40A, Yala town.** The best of the three, and the most data (11 passes, five seasons). Two things
to know. The dam: Bang Lang's release changes the level at the gauge, but not how far a given level
spreads, so it does not change this map. It does change how fast the level rises (dam_release).
Second, the A070 orbit is masked by terrain here, so all calibration passes are A172 (evening) and
D164 (morning).

**X.119A, Sungai Kolok.** Six of the 17 calibration passes have the river 0.56 to 0.94 m below its
bank. At those levels the model is dry and the radar still shows wet land (paddies, ponding), so
they score 0. The five passes clearly above the bank (9.8 to 10.7 m) score 0.15 to 0.20; they carry
the fit. The Malaysian bank is not scored or drawn, though the river is the border and water spreads
both ways. Tide: the thresholds' tide check found Ban Muno (X.119), 25 km up from the sea and below
this gauge, already above the tide's reach, so the tide is not a factor here.

**X.44, Hat Yai: do not use this layer below about the bank without a local check.**
- Only one pass found the river above its bank (23 Nov 2025, 7.9 m, two days after the peak of
  9.97 m). The other five calibration passes have the river in its channel (3.0 to 3.8 m). So z0 is
  fitted almost entirely on in-channel water.
- z0 came out at 3.0 m, the DEM's own channel height, while the gauge's typical level is 0.5 m. The
  DEM's channel is too high: the U-Taphao here is dug out and embanked, which a 30 m DEM cannot see.
  The result: the layer puts 48.6 km² and about 38,000 buildings under water **at bank level**, when
  by definition the river is still in its channel at the gauge. That is not believable.
- Hat Yai also floods from rain on the town and from its smaller canals, and the flood-diversion
  canals change how much water stays in the U-Taphao. None of that is in one gauge level.
- Songkhla Lake: the thresholds' tide check found X.44 above the tide's reach, but with a small
  daily swing (0.25 m, r 0.38 with the sea at a 5 h lag) and a slow level that partly follows the
  lake's (r 0.55). The lower end of this reach, 12 km down towards the lake, backs up when the lake
  is high. At low and middle stages the gauge level is partly the lake, not the river's flow.
- The town centre is built-up, so it is not scored at all.

**Pattani town and the river mouths** are outside these three reaches. The tide reaches Pattani
town (X.10A) and Ban Brido (X.275), so a stage-to-extent map for them would need the tide as a
second input. Not attempted.

## Sample sizes, plainly

34 calibration passes in all (11, 17, 6), from six seasons (2020 to 2025). The gauges start in
Feb 2020, so the radar seasons 2017 to 2019 cannot be paired. Seasons held out: five at X.40A, six
at X.119A, three at X.44. The allowance of 2 m and the calibration level of X.44 were chosen on the
same data.

## Open

- The owner has not seen this. Before any of it goes into the app, show the three maps beside the
  November 2024 and 2025 floods as people remember them, and ask whether X.44 should be left out.
- Not uploaded to R2, not in the database, not wired into the app.
- No depth layer; no layer for Pattani town, Yarang, Ban Brido or Tak Bai (tide, and no key gauge).
- Possible improvements, not tried: a z0 per stretch of river instead of one per gauge; levees and
  road embankments burned into the DEM; GISTDA's flood maps as a second check (they also miss
  towns); scoring only the land the radar saw wet at least once in high water.
