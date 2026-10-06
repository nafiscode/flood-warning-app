# Sentinel-1 flood extents: methods note (S2)

Status, 6 Oct 2026: **the 21 exports for November–December 2024 completed on Earth Engine** (20 passes and the event maximum, 10 m, parameters `cd222f1`); downloaded, checked and uploaded to the private bucket on 6 Oct (see "First results, Nov–Dec 2024"). They used 232 EECU-hours (see "Compute used"); the project moved to the Contributor tier on 6 Oct. The connection check, the scene listing, the look direction, the per-tile histograms and the classification ran against Earth Engine; the frequency step has not run. The offline tests cover the pure-Python parts (thresholds, dates, grid, names, run log, frequency arithmetic). The owner confirmed the five method choices on 5 Oct (fixed drop −3 dB, VV counts, 8-pixel filter, Feb–Apr reference, 10 m for the priority events; `docs/decisions.md`). No parameter below has been tuned or validated against observed floods. Treat every number as a starting value.

First result: the per-tile Otsu threshold was accepted on 3 of about 1,100 tile checks (two VV tiles at −4.8 and −5.2 dB and one VH tile at −3.6 dB, all on the 29 Nov 2024 pass of orbit 172). Everywhere else the fixed −3 dB drop applies, so that value in practice decides the maps.

All parameters are in `config.yaml`; every run writes them, the scenes and every threshold into `out/sar_floods/runs/<run id>.json`.

## What is computed

1. **Scenes.** `COPERNICUS/S1_GRD`, IW, 10 m, scenes with both VV and VH, over the four provinces (`aoi.geojson`). Earth Engine's collection is sigma0 in dB after thermal-noise removal, radiometric calibration and range-Doppler terrain correction; it is not terrain-flattened. The ~25 s slices of one overflight are mosaicked into one **pass**. Near- and far-range edges are trimmed (incidence angle kept between 30.64° and 45.24°) against border noise.
2. **Orbits.** Passes are handled per relative orbit and direction (e.g. `D091`). An event pass is only ever compared with a reference from the same orbit, so the viewing geometry is identical.
3. **Dry reference.** Per orbit, the per-pixel **median** (in dB) of all scenes from 1 Feb to 30 Apr of the season's start year, all platforms. For season 2024 (1 Oct 2024 to 31 Jan 2025) that is Feb–Apr 2024. Reasons: Feb–Apr is the driest stretch on the east coast; the dry season *before* the event has the closest land cover; the median ignores an occasional wet scene. An orbit with fewer than 4 reference passes is skipped and logged.
4. **Speckle.** Focal median, 30 m radius circle, on the dB image; the same filter on the event pass and on the reference composite. Chosen because it is one standard, cheap operation with one parameter, robust to bright point targets, and gives the same result in dB and linear power. Refined Lee keeps edges better but is far heavier in Earth Engine and has more to tune; not used.
5. **Change.** `change = event − reference` in dB, per polarisation. Flood = strong drop.
6. **Masks** (pixel is not classified):
   - permanent water: JRC Global Surface Water v1.4 occurrence > 80 %
   - slope > 5° from FABDEM (bare earth; a surface model puts false steps at plantation edges), computed on the DEM's own 30 m grid
   - MERIT Hydro `hnd` (HAND) > 15 m (90 m data, first pass; S3 replaces it with FABDEM HAND)
   - radar layover and shadow per orbit (below)
7. **Threshold per tile.** The area is cut into 0.1° tiles (215 touch the provinces). For every pass, polarisation and tile, a histogram of the change (−20 to +10 dB, 0.2 dB bins, valid pixels only) is fetched and Otsu's threshold is computed locally (`threshold.py`). It is **used only if the histogram is bimodal enough**:
   - at least 2000 valid pixels (at the 50 m histogram scale)
   - each side of the threshold holds ≥ 5 % of the pixels
   - on the histogram smoothed over 5 bins, the lowest point between the mode below and the mode above the threshold is ≤ 0.7 × the smaller mode (a single hump fails: Otsu still cuts it in half, but both "modes" then sit at the cut)
   - the two modes are ≥ 3 dB apart
   - the threshold lies between −12 and −2 dB

   Otherwise the tile gets the **fixed drop of −3 dB** (power halved). The log records, per tile, the method, the threshold, the reason and the statistics. Tiles without data get the fixed drop.
8. **Clean-up.** Flood patches smaller than 8 connected pixels are removed per pass and polarisation. (Not in the original brief; added because a maximum over 20–100 passes otherwise keeps every pass's leftover speckle. `min_connected_pixels: 0` turns it off.)
9. **Polarisations.** VV and VH are thresholded separately and both are kept as bits in the extent rasters. `flood_rule: vv` decides what counts as flooded in `n_flooded` and the frequency (VV is the usual choice for open-water flooding; VH is noisier and close to the noise floor over water).

## Outputs

All rasters share one grid: EPSG:32647 (UTM 47N), 10 m, origin snapped to 30 m, 22 851 × 26 016 pixels.

| File | Made | Content |
|---|---|---|
| `jaga_sar_scene_<UTC time>_<S1x>_<orbit>_10m_<hash>.tif` | Earth Engine, priority events only | 1 band `extent` |
| `jaga_sar_max_<event>_10m_<hash>.tif` | Earth Engine, every season and both priority events | `extent` (flooded in any pass), `n_valid`, `n_flooded` |
| `jaga_sar_frequency_2017-2025_10m_<hash>.tif` | locally, from the season files | `frequency` = Σ n_flooded ÷ Σ n_valid (−1 = never validly observed), `n_flooded`, `n_valid` |

`extent` codes: 0 observed and dry, 1 flooded in VV only, 2 in VH only, 3 in both, 250 masked terrain (slope, HAND; in per-scene files also layover/shadow), 251 permanent water, 255 no valid observation. `<hash>` identifies the processing parameters and the area. Pass times are UTC, as in Sentinel product names: the ~06:20 Bangkok descending pass carries the previous day's date.

## Radar layover and shadow: method and limits

Method: the angular model of Vollrath, Mullissa & Reiche (2020). Terrain slope and aspect (FABDEM, 30 m) are combined with the orbit's incidence angle and range direction. The range direction is one bearing per orbit, from a plane fitted to the orbit's incidence-angle band over the area plus 100 km (measured 5 Oct 2026: 258–259° towards the radar on the ascending orbits 70 and 172, 101–102° on the descending orbits 62, 91 and 164; logged per run as `towards_radar_deg`). Layover is flagged where the slope towards the radar is at least the incidence angle; shadow where the local incidence angle is ≥ 85°. The mask is grown by 100 m.

Limits, stated plainly:
- It flags the slopes that **cause** layover and shadow. It does not trace where the displaced signal lands. A mountain's layover falls on the ground in front of it (towards the radar), by roughly height ÷ tan(incidence): about 400 m for a 300 m ridge. The 100 m buffer covers only part of that.
- In layover the image is bright, so floods there are **missed**, not invented. Narrow valley floors between steep slopes (Betong, Than To, Bannang Sata, upper Sai Buri, Sukhirin, Waeng) are therefore unreliable in these maps even where not masked.
- True radar shadow needs back-slopes steeper than ~45–60° here and is rare; most of the mask is layover.
- A 30 m DEM misses cliffs, cuttings and buildings. Urban layover is not handled at all (see below).
- Most affected terrain is already removed by the slope and HAND masks; the separate mask mainly matters at their edges.

## Known issues

- **Wind and rain on water.** Wind-roughened or rain-struck water is bright in VV, so flooded areas can be missed on the day (monsoon surges are windy). VH is less sensitive; compare code 2 (VH only) with code 1 on such passes.
- **Flooded vegetation.** Standing water under rubber, oil palm, mangrove and melaleuca/peat-swamp forest (Phru To Daeng, Phru Bacho) raises backscatter (double bounce) or leaves it unchanged. A drop-only detector misses it. Flooded plantations and swamp forest are under-mapped; this is the main omission to expect in Narathiwat.
- **Urban areas.** Buildings give layover and double bounce; water between buildings is mostly invisible at this resolution. Hat Yai, Yala, Pattani, Narathiwat and Sungai Kolok town centres will look dry even when flooded. Do not read "not flooded" in built-up areas as safe.
- **Rice paddies.** Main-season rice here is planted late (roughly Aug–Nov) and stands in water through Nov–Dec; in Feb–Apr fields are ripe, stubble or fallow. Paddy water is therefore mapped as flood (correct as "water present", wrong as "disaster flooding") and raises the frequency over paddy land. The reverse also happens: where dry-season rice is irrigated in Feb–Apr (e.g. the Songkhla Lake plain around Ranot), the reference is already dark and real floods are missed. The owner knows the local crop calendar better than this note; the reference window is one config line.
- **Wet reference.** Late floods fall inside the window in some years (e.g. end of February 2022). The median absorbs a minority of wet scenes, not a majority; on a thin reference (4–7 passes) it can be biased dark, which hides floods.
- **Change detection flags any strong darkening**: harvest, ploughing, cleared plantations, new ponds, aquaculture. There is no absolute backscatter test yet.
- **Otsu is rarely used when floods are small in a tile.** With a few percent of a tile flooded, Otsu cuts the main hump instead (covered by a test) and the tile falls back to −3 dB. Expect the fixed drop in most tiles; the log shows the share. Per-tile thresholds also leave visible steps at tile borders where neighbours differ.
- **Histogram scale.** Histograms are sampled at 50 m (Earth Engine reads the 40 m pyramid level, an average of dB values) for speed, while thresholds are applied to the 10 m filtered image. The class means agree; the spreads differ slightly.
- **Speckle filter** blurs edges by about 30 m and removes narrow features (canals, roads under water).
- **Orbit gaps and revisit.**
  - Sentinel-1B stopped on 23 Dec 2021. Seasons 2017–2020 may have both satellites (6-day repeat per orbit where B acquired here); season 2021 loses B mid-season; seasons 2022–2024 have Sentinel-1A only: one pass per orbit every 12 days, so a flood that rises and drains between passes is not seen at all. Overlapping orbits shorten the gap in places, unevenly.
  - Sentinel-1C was launched in Dec 2024 and Sentinel-1D in Nov 2025. Whether and from when their scenes are in `COPERNICUS/S1_GRD` over this area has not been checked; `run --dry-run` lists the platform of every pass.
  - The **maximum extent is the maximum of what was imaged**, not of the flood. `n_valid` shows how often each pixel was seen. Flood frequency mixes dense (2017–2021) and sparse (2022–2024) sampling.
  - A skipped orbit (thin reference) removes its passes from the event; the log lists them. In Nov–Dec 2025 that is orbit D164: six passes (five Sentinel-1A, one Sentinel-1C), but no acquisition at all in Feb–Apr 2025, so they are not used.
- **Relative orbit number.** Passes are grouped by `relativeOrbitNumber_start`. It changes at the equator on ascending passes; slices over 5.6–8° N start north of it, so start and stop numbers should agree, but this is unverified.
- **Border noise** in 2017–2018 scenes may survive the angle trim as dark stripes along swath edges, which would read as flood.
- **Area.** Processing stops at the province outline (+~1 km). The Malaysian side of the Kolok basin is not mapped.
- **Earth Engine catalog changes** (JRC v1.4, FABDEM community asset) would change results; asset ids are in the run log.

## First results, Nov–Dec 2024 (checked 6 Oct 2026, not validated)

Files: 20 per-scene rasters and the event maximum, 133 MB in total, in `jaga-rasters` under `sar/scene/` and `sar/max/` with the run log. All are valid COGs on the master grid (per-scene files are windows of it), with only the documented codes. A 256 × 256 pixel block of the 29 Nov scene near Tak Bai is identical, pixel for pixel, to the same block computed live in Earth Engine.

Area budget of the event maximum, inside the four provinces (19 860 km²):

| | km² | share |
|---|---|---|
| Masked terrain (slope > 5° or HAND > 15 m) | 9 964 | 50 % |
| Permanent water | 1 107 | 6 % |
| Observed, never flooded | 7 813 | 39 % |
| Flooded in at least one pass: VV only / VH only / both | 133 / 286 / 560 | 5 % |

- **Half the area is masked as terrain.** Whether the 90 m MERIT HAND > 15 m limit cuts into real floodplain has not been looked at; it is the first thing to check by eye.
- Flooded by the VV rule (codes 1 and 3): 693 km², 7.9 % of the observed land. The 29 Nov pass of orbit 172 alone has 8.3 %; the other passes of the wide orbits 1–3 %.
- VH-only pixels (286 km²) are about 40 % of the VV total. They do not count under `flood_rule: vv`.
- Each place was seen 5 times in the two months (one orbit) or 10 times (two orbits); almost nowhere more. Orbit 62 covers only about 80 km² of valid land.
- The share of flooded land on the quiet passes (1–3 %) is an upper bound on the false-alarm level of the −3 dB rule plus routine paddy water; it has not been separated.

Nothing here has been compared with gauges, the event timeline, GISTDA or local knowledge.

## Compute used

Run `20261005T115614Z_event-2024-nov-dec` (5–6 Oct 2026), from `sar_floods status`:

| Export | Passes | EECU-hours each | EECU-hours total |
|---|---|---|---|
| Per-scene, orbits A070 and A172 (cover most of the area) | 10 | 10.5–17.7 | 141.1 |
| Per-scene, orbits D062 and D091 (clip the area) | 10 | 1.8–3.3 | 23.8 |
| Event maximum (all 20 passes) | 1 | 67.2 | 67.2 |
| **Total** | 21 | | **232.1** |

After the last task the client warned: "Your project has exceeded its noncommercial compute quota and is now in restricted mode." No further exports were started. At this cost the 2025 event and the nine seasons do not fit the free tier as planned; the processing has to get cheaper or the plan smaller before anything else runs. Where it goes, from Earth Engine's profiler on one 0.1° box (Pattani plain, the 29 Nov 2024 pass, per-scene product, 10 m; about 190 EECU-seconds in total, 6 Oct 2026):

| Step | EECU-s | Note |
|---|---|---|
| `focalMedian` (speckle) | 55 | event pass and reference, two bands each; about half is the reference |
| `focalMax` (100 m layover buffer) | 53 | a 30 m mask grown at 10 m; the same for every pass of an orbit |
| `reduce.median` (reference composite) | 28 | recomputed for every pass |
| resampling, dB conversion, asset loading, other | about 55 | |
| slope, aspect and HAND masks alone | under 3 | the DEM reprojection is not the problem |

So roughly 60 % of each pass is spent on things that are identical for all passes of an orbit in a season: the reference median, its speckle filter and the layover mask. Since 6 Oct 2026 `sar_floods prepare` exports these once per orbit and season as Earth Engine assets on the output grid, and `run` reads them (see "Stored references"). The references for 2025 were made this way on 6 Oct (37.9 EECU-hours); the saving per pass is an estimate until the 2025 exports finish. The profile is one flat box; mountain tiles and `connectedPixelCount` at full scale may differ.

## Stored references

`sar_floods prepare <event>` starts one export per orbit to `projects/<EE_PROJECT>/assets/jaga_sar/jaga_sar_ref_<year>_<orbit>_<scale>m_<hash>`: the despeckled reference per polarisation and the layover mask, on the master grid, cut to the area plus 500 m. `run` uses a stored reference whose name matches (same reference year, orbit, pixel size and parameter hash) and otherwise computes the reference inside every request, as before. The run log records the source per orbit.

What changes in the results, as far as can be said without a real run:
- At the export pixel size the reference is the same computation, stored as 32-bit instead of 64-bit numbers: differences of about 1e-6 dB, which can flip a pixel only if its change sits exactly on the threshold.
- The tile histograms are sampled at 50 m. A stored reference is read there from the asset's pyramid (mean of 10 m pixels of the filtered median) instead of being recomputed from Sentinel-1's own pyramid. Histograms, and so the few Otsu thresholds, can differ slightly; the fixed drop is not affected. Thresholds already cached for a pass are reused.
- The layover mask's pyramid uses the maximum, so at 50 m a cell counts as layover if any 10 m pixel in it does.

First prepared run, references for Nov–Dec 2025 (run `20261006T080529Z_event-2025-nov-dec`, 6 Oct 2026):

| Orbit | Reference passes | EECU-hours | Asset size |
|---|---|---|---|
| A070 | 8 | 11.5 | 0.79 GB |
| A172 | 7 | 10.9 | 0.95 GB |
| D062 | 8 | 6.8 | 0.01 GB |
| D091 | 8 | 8.7 | 0.16 GB |
| **Total** | | **37.9** | **1.9 GB** of 250 GB asset storage |

The four tasks took 2 h 40 min of wall time, three running at once. Checked the same day:
- All four assets are on the exact master grid (EPSG:32647, 10 m, origin 615210, 879810, 22851 × 26016).
- One pass per orbit, the per-scene product built both ways (stored reference, and reference computed in the request, same cached thresholds), read back on 256 × 256 pixel blocks at five places: on the six blocks with data (Hat Yai, Pattani plain, Sai Buri hills with 92 % masked terrain, Kolok plain twice, Yala valley edge) every pixel is equal. The other blocks lie outside the pass. No block of orbit D062 had data, so that orbit is unchecked. This is a sample, not a full export both ways.
- The thresholds for the 2025 passes were decided with the stored references from the start; they were not compared with thresholds from computed references.

Still to measure: the compute per pass with a stored reference (the 2025 exports started 6 Oct, 13:52 UTC+3).

## To check by eye in the Code Editor

`code_editor/sar_floods.js` runs the same chain for one pass. For at least one pass per orbit of each priority event:
1. Reference VV: no dark stripes at swath edges, no obviously flooded reference (compare with the next orbit).
2. Change VV and VH: the flood stands out; note wind streaks on the lake and sea.
3. Threshold layer and Console table: where Otsu was used, is the value plausible (about −3 to −8 dB)? Do tile borders show in the flood layer?
4. Layover/shadow mask against the hillshade in the mountains: on the correct side of the ridges for ascending vs descending?
5. Slope and HAND masks: do they cut into real floodplain (Pattani and Sai Buri valleys, Kolok plain, around Songkhla Lake)?
6. Known flooded places on known dates (Hat Yai, Yala town, Sungai Kolok, Tak Bai, Sai Buri) from the owner's event timeline.
7. Paddy areas: how much of the "flood" is routine paddy water?
8. Does −3 dB over- or under-detect? Try −2.5 and −4.

## To verify on first run (untested Earth Engine and Drive usage)

Run `python -m sar_floods check`, then `run event-2024-nov-dec --dry-run`, then `--dry-run --with-thresholds`, before starting tasks.

- FABDEM asset id and band (`projects/sat-io/open-datasets/FABDEM`, `b1`) and that `first().projection()` is the common 1″ grid.
- Scene properties used for grouping: `platform_number`, `relativeOrbitNumber_start`, `orbitNumber_start`, `orbitProperties_pass`, `resolution_meters`.
- `reduceRegions` + `fixedHistogram` output naming for a two-band image (expected: one property per band).
- ~~`remap` with negative integer targets; `unmask(value, false)`; `connectedPixelCount` on a self-masked image.~~ Ran 5 Oct 2026 on four 0.1° test areas (Tak Bai, Pattani plain, Pattani bay, Songkhla Lake) for the 29 Nov 2024 pass and the event maximum: every extent code appears where expected and the pixel counts match the area. Not yet compared with the layers by eye.
- Partial masks. JRC `occurrence` has a mask equal to the occurrence (0.01–1), which `unmask` keeps; until 5 Oct it leaked into the valid-pixel image and weighted the histograms (fixed: the water mask is painted onto a constant; values and accepted thresholds did not change). `clip` still leaves a partial mask on the pixels cut by the province outline; they keep their values. Check the outline in the first downloaded file.
- ~~The look direction per orbit.~~ Verified 5 Oct 2026: 258–259° ascending, 101–102° descending, as expected. `ee.Terrain.aspect` on the `angle` band turned out unusable (a ~16 km grid: values only along cell edges, none at all for orbit 62, and about 20° off when taken in a scene's own projection), so the direction now comes from a plane fit.
- `reproject` of slope/aspect to the DEM grid inside a 10 m export (cost).
- Export with `crs` + `crsTransform` + `dimensions`, `fileDimensions` 23040 × 26112 (one file), `formatOptions.noData`, and that the output is a valid COG on the exact grid. If Earth Engine still splits the file, the downloader and the frequency step handle the parts.
- Whether one task holds a whole season (up to ~100 passes) without timing out; if not, lower the load with `--scale 20` or split the season.
- ~~Drive download with the Earth Engine credentials.~~ Works since the Drive API was enabled on the project (6 Oct 2026); 21 files, checksums verified by the downloader.
- ~~Export options.~~ One file per export, valid COG, exact grid, noData 255 (6 Oct 2026).
- ~~Compute used.~~ Measured 6 Oct 2026, see "Compute used". The project's quota tier and its reset date have not been checked against Google's documentation.
- ~~Whether one task holds a whole event.~~ The 20-pass event maximum completed as one task (67 EECU-hours). A season with up to ~100 passes is untested.

## Validation still open

- **GISTDA comparison: not done.** No GISTDA layer was accessed or downloaded. From public knowledge, candidates are (a) the yearly flood-extent layers and (b) the recurrent-flood ("repeatedly flooded area") layer shown on GISTDA's flood portal, and (c) the recent-flood layers of GISTDA's disaster/open-data API, which needs a registered key. Download formats, terms of reuse and coverage of the far south for 2017–2025 are unknown to us; the owner needs to check access or ask GISTDA. Note GISTDA's maps are largely SAR-based too, so agreement is a consistency check, not independent truth.
- Hold-out scenes for CSI, hit rate and false-alarm rate (science plan section 4): not selected yet.
- Gauge stage at pass time (S1 archive) and the owner's event timeline: not compared yet.

## References

- Otsu, N. (1979). A threshold selection method from gray-level histograms. IEEE Trans. SMC 9(1).
- Chini, M. et al. (2017). A hierarchical split-based approach for parametric thresholding of SAR images: flood inundation as a test case. IEEE TGRS 55(12). (Why a tile must be bimodal before its threshold is trusted.)
- Vollrath, A., Mullissa, A., Reiche, J. (2020). Angular-based radiometric slope correction for Sentinel-1 on Google Earth Engine. Remote Sensing 12(11), 1867.
- Mullissa, A. et al. (2021). Sentinel-1 SAR backscatter Analysis Ready Data preparation in Google Earth Engine. Remote Sensing 13(10), 1954.
