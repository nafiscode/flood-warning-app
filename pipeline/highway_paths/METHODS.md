# Highway paths: where a main highway may be holding flood water back (Module 8, part 2)

Built 15 Oct 2026. `docs/science-plan.md` Module 8 part 2; settings in `config.yaml`; the generated
list is `report.md` beside this file and `pipeline/out/highway_paths/`.

**What it is for.** The owner's knowledge of the area (12 Oct 2026): the main highways sit on about
2 m of fill. They stay dry when the land beside them floods, and they hold water back where it has no
way through. This module points the provincial highway and irrigation offices at the stretches where
the radar record looks like that, and at the drainage crossings with no mapped bridge or culvert.
**It is advice for those offices, to be checked on the ground. It is never a public alert**, it feeds
no alert level and nothing in the app reads it.

## Inputs

| Input | From | Used for |
|---|---|---|
| Highway lines (motorway, trunk, primary; links too) | the safe places' road cache `out/safe_places/osm/roads_*.npz` (OpenStreetMap, ODbL) | sections, sides, bridges |
| Highway numbers and names, culverts, waterways passing the roads | `highway_paths fetch`: one Overpass request per quarter-degree tile that carries a main highway, cached in `out/highway_paths/osm/paths_*.json.gz` | names in the list, openings |
| D8 flow directions and accumulation | `out/hazard/burned/d8_pointer.tif`, `d8_accum.tif` (30 m, FABDEM with OSM rivers burned in) | which side drains to the road; drainage crossings |
| Ground height | `out/hazard/work/dem_utm.tif` (FABDEM, unburned, 30 m) | which side is higher |
| Radar seasons | `jaga_sar_max_season-20XX_20m_c97e0bf.tif` (nine seasons 2017-2025) | flooded share of each side per season |
| Radar passes | `jaga_sar_scene_*_20m_c97e0bf.tif` (368 passes; the 45 10 m event passes repeat dates already at 20 m and are not read) | how often each side held water |
| Tambons, districts | `supabase/seed/30_tambons.sql`, `20_districts.sql` | where each section is |

Only the second radar parameter set (hash c97e0bf) is read. Flooded means the VV rule (codes 1 and 3)
as everywhere else in Jaga; 2 (VH only) counts as observed and dry; 250 (terrain mask), 251
(permanent water) and 255 (no data) count as not observed. A pass file covers only its own footprint
on the 20 m master lattice, so it is read at an offset of whole cells.

## Rules, as built

1. **Lines and sections.** OSM splits a road at every bridge and every change of lanes or name. Ways
   of the main classes that meet end to end, where exactly two ways meet, are joined into lines; a
   line is cut every 500 m, a last piece under 150 m joined to the one before. A section is kept when
   its middle lies in a tambon of the four provinces. Its number and name are those of its longest
   way, filled from its other ways when that one has none.
2. **The two sides.** Points every 20 m along the section and every 20 m across it, from 40 to 300 m on
   each side (the first 30 m are the road, its embankment and its ditches, mixed in one radar cell). A
   point is kept only when the nearest highway line to it (any main line or link, densified every
   10 m) is the section's own line and at least 30 m away: a strip never reaches across another
   highway, a slip road or the other carriageway. Left and right are as seen travelling in the
   direction the line is drawn.
3. **Dual carriageways.** A divided highway is two one-way lines 10 to 60 m apart, and by rule 2 each
   keeps only its outer side. When a side of a section comes out under 30 % of its points, and a
   parallel main line (|cos| of the angle at least 0.9) lies within 80 m of the section's middle,
   that line's points on the empty side, within the section's length, are borrowed. Both carriageways
   are then scored on the same corridor; the lists show only one of the two.
4. **Which side is upstream.** Three verdicts, used in this order: (a) **D8**: the share of a side's
   points whose flow direction points towards the road (dot product above 0.1); the side where more of
   the land drains to the road is upstream when the two shares differ by at least 0.10; (b) a
   **drainage crossing** in the section (rule 6): the side its water comes from; (c) **height**: the
   side higher on average by at least 0.5 m. All verdicts are kept, and whether D8 and height agree.
   When none decides, the section is compared wetter side against drier side and the radar parts of
   its score count half.
5. **Flood on each side.** Each side's 20 m radar cells, each cell once per side.
   - *Seasons*: per season, flooded cells / observed cells (a side with fewer than 25 observed cells
     is "not seen" that season). `asymmetry` = the mean over the seasons where both sides were seen of
     (upstream share - downstream share). A season counts as *clearly wetter* on one side when the
     shares differ by 0.10 or more and that side has at least 5 flooded cells.
   - *Passes* ("longer"): over the passes that saw at least 10 cells of both sides, the share of
     observed cell-passes that were flooded, upstream minus downstream (`persistence`), and how many
     passes had 10 % or more of a side flooded. Water that stands for weeks is caught by more of the
     passes 6 to 12 days apart than water that drains in a day, so this is a proxy for how long water
     stood, not a measured duration.
6. **Drainage crossings.** Every 30 m cell with at least 1 km2 of land draining through it whose D8
   step to its downstream cell passes from one side of a main highway line to the other (the crossing
   point within 12 m of the line). Crossings of the same section within 90 m of each other are one
   crossing, the largest kept. On a 30 m model the 2 m embankment is smoothed away, so these are where
   water would cross if the road were not there: the places that need an opening.
7. **Openings.** The highway's own bridges (runs of bridge segments in the road cache, one point
   each), anything tagged `man_made=culvert`, `tunnel=culvert` or `culvert=yes`, and waterways drawn
   crossing a main highway line (water has a mapped way through; its size is unknown). Only openings
   within 100 m of a main line are used. A crossing has a mapped opening when one lies within 100 m of
   it; the nearest one is named up to 1 km away.
8. **Score** (0 to 1, each part scaled to 0..1 then weighted): asymmetry 0.35 (full at 0.25),
   seasons 0.15 (seasons upstream clearly wetter minus downstream clearly wetter, full at 4),
   persistence 0.20 (full at 0.05), crossing 0.15 (largest catchment on a log scale, 0 at 1 km2, full
   at 100 km2), no mapped opening at that crossing 0.15. Negative values count 0.
9. **Classes.** *Look here first*: score at least 0.55, upstream clearly wetter in at least 2
   seasons, and a sign in the radar (below). *Worth a look*: score at least 0.30 and a sign in the
   radar: asymmetry of at least 0.02 or persistence of at least 0.01, positive. *No sign*: the rest.
   *Not seen*: the radar saw both sides in no season and no pass. A crossing without a mapped opening
   and no difference between the sides can reach 0.30 on its own and still stays *no sign*: that is a
   question for the map, not evidence of held water.
10. **Stretches.** Neighbouring flagged sections of one line are one stretch (id `R` + its first
    section), told in the report by its best section. The other carriageway of a listed stretch is
    left out of the report.

## Results (15 Oct 2026)

Run time about 1 to 2 minutes (the 368 pass files are read in strips of rows, about 0.3 s each); the
Overpass fetch took about 80 minutes on 15 Oct because every public server answered 500/502/504 for
most requests (two tiles needed a second `fetch`; all 42 tiles are cached now).

| | |
|---|---|
| Main highway ways in the road cache (all tiles) | 3,474, joined into 773 lines (plus 1,200 link lines) |
| Sections in the four provinces | 4,366, 2,099 km (Songkhla 981, Narathiwat 473, Pattani 365, Yala 280) |
| Sections with a highway number from OSM | 4,094 (94 %) |
| Sections that borrowed a side from a twin carriageway | 3,212 (74 %; most trunk roads here are divided) |
| Side points kept by the nearest-line rule | 1.72 M of 2.94 M; 1.49 M distinct 20 m radar cells |
| Upstream side decided by D8 / crossing / height / unclear | 3,342 / 115 / 449 / 460 |
| D8 and height agree, where both decide | 2,435 of 2,694 (90 %) |
| Openings within 100 m of a main line | 765 bridges, 102 culverts, 542 mapped waterway crossings (958 culvert elements fetched in all) |
| Drainage crossings of 1 km2 or more in the provinces | 578, in 564 sections (223 flow steps left out as streams running along the road) |
| Sections whose largest crossing has no mapped opening within 100 m | 410 |
| Classes | look here first 70, worth a look 165, no sign 3,676, not seen 455 |
| Flagged stretches | 61 with a look-first section, 136 worth a look |

**The record agrees with the expectation that water lies in the lows.** Among the 3,499 sections
with a decided upstream side, the downstream side is wetter by 5 points or more in 712 and the
upstream side in 344. The 344 are the anomaly this module looks for: water standing on the side it
comes from.

**Mapped openings at the drainage crossings, by catchment size** (nearest bridge, culvert or mapped
waterway crossing):

| Land upstream | Crossings | within 100 m | 100-300 m | farther or none |
|---|---:|---:|---:|---:|
| 1-3 km2 | 242 | 32 | 20 | 190 |
| 3-10 km2 | 127 | 34 | 4 | 89 |
| 10-100 km2 | 154 | 50 | 15 | 89 |
| 100 km2 or more | 55 | 40 | 1 | 14 |

Every crossing of 100 km2 or more must have a bridge, yet 14 of 55 have none mapped within 300 m.
That is the size of the two errors together: a 30 m flow path can cross a few hundred metres from
the real river on flat land, and some bridges are not tagged as bridges in OpenStreetMap. Read "no
mapped opening" on small crossings with that in mind.

The top stretches per province, with their reasons, are in `report.md`; figures of the six best are in
`out/highway_paths/figures/`. A first look at the figures: the flagged places are mostly coastal and
plain stretches of road 42 (Pattani, Narathiwat, Tak Bai), road 43 (Thepha, Chana) and the roads
409/410 near Yala, with water standing in broad patches on one side and a drainage crossing in the
section. None of them has been looked at on imagery or on the ground.

## Limits, plainly

- **The radar sees water extent, not depth.** A side that is wetter more often is not proof that the
  road holds water back; a field 20 cm deep and a pond 2 m deep look the same.
- **10 to 20 m cells beside a road are noisy.** The road, its embankment, ditches, trees and buildings
  mix in the first cells; that is why the first 30 m are skipped, but a wet ditch running along the
  toe of the embankment can still lift one side.
- **A wetter side can be a natural low, a paddy, a fish pond or a swamp** that would be wet with no
  road at all. The upstream rule removes the commonest case (a road along a river, whose floodplain is
  the lower, downstream side) and the record shows it does: where the upstream side is decided, the
  downstream side is the wetter one about twice as often as the upstream side. What remains is where
  water stands on the side it comes from, which is what a dam does, but irrigated paddy on one side
  only would look the same in the wet season.
- **"No mapped opening" usually means "not mapped".** OpenStreetMap here holds very few culverts
  (see the counts above), and pipe culverts under every highway are the rule, not the exception. The
  question for the office is whether the opening that exists is big enough, not whether one exists.
- **Upstream on flat land is uncertain.** FABDEM's error of a metre or more is larger than the slopes
  of the coastal plain; D8 on such land follows the breaching of the elevation model as much as the
  land. The two verdicts are kept side by side; where they disagree the report says so.
- **The radar is blind in towns** (buildings) and masked in steep land; such sides count as not
  observed, so many urban and hill sections are *not seen*, not *no sign*.
- **Highway numbers are often missing** in OpenStreetMap here (the `ref` tag), so many sections are
  named only by class and place. The map link in the CSV finds them.
- **Season maxima mix dense and sparse sampling** (two satellites in 2017-2021, one after), and the 20
  m seasons let two-pixel speckle through (sar_floods/METHODS.md); the persistence counts depend on how
  many passes saw a side.
- **Nothing here is validated on the ground.** The list is where to look first, in order; the class
  names say so and the report repeats it.

## Rerun

```
cd pipeline
uv run python -m highway_paths fetch      # Overpass extras; resumable, skips cached tiles
uv run python -m highway_paths run        # about 3 minutes on this laptop
uv run pytest tests/test_highway_paths.py
```
