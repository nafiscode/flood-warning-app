# GISTDA's flood maps as a second opinion

Decisions 2026-10-09 and 2026-10-13. GISTDA maps floods from satellites for the whole country and
publishes a repeated-flood layer through its open API. This module sets that layer against Jaga's
own radar flood maps (S2) and hazard classes (S3). It changes nothing in either: it only counts.

**Read every figure here as "consistent", not "correct".** Both maps are satellite readings, largely
of the same Sentinel-1 radar, and share its blind spots. Neither is a ground observation.

## The data

- Source: `GET /features/flood-freq` on `api-gateway.gistda.or.th/api/2.0/resources`, asked per
  province (`pv_idn` 90, 94, 95, 96), 5,000 polygons a page. Free key, sent as an `API-Key` header.
- **Their answers repeat the caller's key inside `links`.** `fetch.slim` keeps the geometry and
  `tb_idn`, `freq`, `area_rai`, `y_<year>` only; nothing else is stored, and errors are logged by
  status alone.
- Fetched 13 Oct 2026: 478,640 polygons (Songkhla 199,247, Pattani 112,073, Yala 38,239,
  Narathiwat 129,081). Each carries one yes-or-no per calendar year, 2011 to 2024.
- What a "yes" means is not documented: which passes, which sensor, what minimum size. The layer is
  built from the floods GISTDA chose to map. **A "no" is therefore not a dry year**: 2018 is "no" for
  every polygon in the four provinces, and the owner's look at their download page (13 Oct) found
  that their maps often do not cover the far south.

## Method

1. `burn`: every polygon is burned onto the 20 m radar grid (EPSG:32647, cell-centre rule) as a
   number whose bits are its years. Two polygons over one cell both count. Check: flooded area per
   year from the raster agrees with the polygons' own `area_rai` to within 0.3 km² in every year
   (`out/gistda/burn.json`).
2. `compare`, season by season: Jaga's flood is the VV rule in the season maximum (codes 1 and 3),
   on land the radar observed, inside the four provinces. Season Y runs 1 October Y to 31 January
   Y+1, so it is set against **their year Y or Y+1**; the same-year figures are in the JSON too.
3. "Near" = within 60 m (3 cells) of the other map's flood: a patch drawn one or two cells apart by
   two processing chains is the same flood.
4. Years flooded, 2017 to 2024: our count of seasons against their count of years, cell by cell.
5. Hazard classes: their count of years 2011 to 2024, taken to the 30 m class grid by nearest cell.

Output: `out/gistda/compare_<radar run>.json`. Everything runs in strips of 1,024 rows.

## Results (radar run c97e0bf, 13 Oct 2026)

### Season by season, four provinces

| Season | Ours km² | Theirs km² | Both km² | Theirs also in ours | Theirs within 60 m of ours | Ours also in theirs | Ours within 60 m of theirs | CSI |
|---|---|---|---|---|---|---|---|---|
| 2017 | 1,296 | 1,113 | 778 | 70% | 97% | 60% | 71% | 0.48 |
| 2018 | 948 | 223 | 171 | 77% | 96% | 18% | 24% | 0.17 |
| 2019 | 614 | 391 | 202 | 52% | 84% | 33% | 41% | 0.25 |
| 2020 | 596 | 421 | 231 | 55% | 89% | 39% | 47% | 0.30 |
| 2021 | 653 | 483 | 212 | 44% | 79% | 32% | 42% | 0.23 |
| 2022 | 910 | 527 | 380 | 72% | 94% | 42% | 55% | 0.36 |
| 2023 | 671 | 526 | 289 | 55% | 87% | 43% | 56% | 0.32 |
| 2024 | 810 | 429 | 330 | 77% | 95% | 41% | 52% | 0.36 |

- **Where GISTDA maps a flood, Jaga's radar almost always has one at or beside it** (79 to 97%
  within 60 m; 44 to 77% on the same cells). Adding our VH-only cells raises the same-cell figure to
  62 to 90%.
- **Jaga maps much more flood than GISTDA** (1.2 to 4.3 times the area); 29 to 76% of ours has no
  GISTDA flood within 60 m. Two causes that this comparison cannot separate: their layer holds only
  the floods they mapped (season 2018: nothing of theirs under 2018, 223 km² under 2019, against
  948 km² of ours), and ours is the maximum over every pass of four months with a small patch
  filter at 20 m, so it also holds short-lived water, wet fields and some speckle.
- Under 2% of their flood falls on land our terrain mask removes, and almost none on our permanent
  water. The mask is not hiding floods they see.

### Years flooded, 2017 to 2024

| | km² |
|---|---|
| Ours, flooded in at least one season | 2,780 |
| Theirs, flagged in at least one year | 1,252 |
| Both | 1,023 (82% of theirs, 37% of ours) |
| Ours, at least two seasons | 1,217 |
| Theirs, at least two years | 664 |
| Both | 572 (86% of theirs, 47% of ours) |

Of the land we flag in **one season only** (1,563 km²), 84% is never flagged by GISTDA. Of the land
we flag in **five or more seasons** (448 km²), 85% is. The single-season cells are the weakest part
of our record, which is what the frequency floor in the hazard classes (at least two seasons,
decision 2026-10-08) assumes.

### Hazard classes

GISTDA flags 1,482 km² of the classed land in at least one year 2011 to 2024.

| Class | km² | Share GISTDA flags | Share flagged 3 years or more | Its share of all GISTDA-flagged land | Its share of land flagged 3 years or more |
|---|---|---|---|---|---|
| High | 1,208 | 66.5% | 42.4% | 54.2% | 81.6% |
| Medium | 2,072 | 17.6% | 4.3% | 24.6% | 14.2% |
| Low | 2,963 | 7.1% | 0.8% | 14.2% | 3.6% |
| Minimal | 12,529 | 0.8% | 0.0% | 7.0% | 0.7% |

- The classes order GISTDA's flood the right way, and **96% of the land GISTDA flags three years or
  more is High or Medium**.
- **104 km² that GISTDA flags at least once is Minimal** on our map (7% of theirs), with about
  11,300 buildings on it. Not yet looked at: it is the list of places to check first.
- Medium and High by basis: of the land classed from radar and elevation, GISTDA flags 40.5%; of
  the land classed **from elevation alone because it is built-up**, 5.3%.

### The towns

| Place | GISTDA flags, any year 2011 to 2024 | In the year the owner reports a flood |
|---|---|---|
| Hat Yai city centre (9.2 km²) | 1.6% | 2025 is not in their layer; no year above 1.6% |
| Pattani town (14.8 km²) | 10.1% | 2024: 1.3% (2017: 8.7%) |

**GISTDA's layer is as blind in the towns as our radar.** It can neither support nor contradict the
built-up rule of the hazard classes; that still rests on elevation and on what residents report.

## Limits

- Agreement is between two satellite products, not with the ground.
- Their years are calendar years, our seasons cross the new year; the "Y or Y+1" rule lets one of
  their floods count for two of our seasons.
- Season 2025 and the 2025 event are not in their layer (it ends in 2024).
- The recent-flood layers (1, 3, 7 and 30 days) were empty for the four provinces on 13 Oct 2026 and
  are not used here; they are for the app's map in season.
- Licence listed as "Open Data Common"; to confirm in writing before anything of theirs is shown
  in the app (`docs/attributions.md`).

## Commands

```
uv run python -m gistda fetch      # about 20 minutes, resumable
uv run python -m gistda burn       # about 7 minutes
uv run python -m gistda compare    # about 1 minute
```
