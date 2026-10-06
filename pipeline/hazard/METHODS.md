# Hazard baseline: methods note (S3)

Status, 6 Oct 2026: the source rasters are exported and downloaded, and HAND has run once for four candidate stream thresholds. The stream threshold is **not chosen**; the hazard classes, the aggregation and the tiles are not started. Nothing here is tuned or validated. All parameters are in `config.yaml`.

Nothing derived from FABDEM (CC BY-NC-SA 4.0) is published until the owner has decided on the licence (`docs/decisions.md`, 6 Oct 2026).

## Sources

- **FABDEM V1-2** (bare-earth, 1 arc-second), from the Earth Engine community catalogue, exported on its own grid (cell centres on whole arc-seconds) for 99–103° E, 5–9° N: 14,400 × 14,400 cells, 361 MB.
- **JRC Global Surface Water 1.4**, occurrence, on the same grid.
- **OpenStreetMap waterways** (river, canal, stream, drain) from Overpass, 6 Oct 2026: 14,522 ways in the HAND window. ODbL.

How FABDEM stores water here (looked at on 6 Oct): whole 1° tiles that are all sea are missing (31 % of the box); the sea inside other tiles and Songkhla Lake are exactly 0.0 m (two patches hold nearly all such cells); 4,350 land cells are below 0 m, down to −57 m. Missing and exactly-0 cells become nodata, so streams end at the coast and at the lake shore. Negative land is kept: turned into nodata it would act as an outlet inland.

## HAND

1. Working grid: UTM 47N, 30 m, bilinear, origin on whole cells. Window 99.5–102.5° E, 5.5–8.5° N (11,098 × 11,113 cells, 55.6 million of them land): the whole box does not fit in this laptop's memory.
2. WhiteboxTools 2.3.6: least-cost breaching (search distance 50 cells = 1.5 km, no cost limit), then filling of what is left with flats fixed, D8 flow direction, D8 accumulation in cells.
3. For each threshold (500, 1000, 2000, 5000 cells = 0.45, 0.9, 1.8, 4.5 km²): streams, then elevation above the stream cell each cell drains to.

The whole chain took 9 minutes. Window check: the 15,467 land cells on the window edge were followed down the flow directions; none of their paths enters the four provinces, so no catchment of the provinces is cut.

## First results inside the four provinces (not validated)

Land: 18,772 km². The 2024 radar flood is the S2 event maximum for Nov–Dec 2024 (VV rule, 684 km² on this grid), resampled to 30 m.

| Threshold (cells) | Stream length, km per km² | Land with HAND under 1 m | 2024 flood with HAND under 1 m | under 2 m | under 5 m | Land without a HAND value |
|---|---|---|---|---|---|---|
| 500 | 0.95 | 20.7 % | 79.8 % | 87.9 % | 93.6 % | 210 km² |
| 1000 | 0.69 | 18.1 % | 76.8 % | 85.8 % | 92.3 % | 294 km² |
| 2000 | 0.51 | 15.6 % | 73.0 % | 83.0 % | 90.3 % | 409 km² |
| 5000 | 0.34 | 12.8 % | 66.5 % | 77.6 % | 86.2 % | 641 km² |

Of the land that the radar observed in the 0–1 m class, 15–20 % was flooded in 2024; in every class above 3 m, under 2.5 %. So HAND separates the flooded land well at every threshold, slightly better at the low ones.

## Streams against mapped water

Share of mapped cells inside the provinces that have a modelled stream within 60 m (`streams-compare`):

| Threshold | OSM river (93,288 cells) | OSM stream (60,978) | OSM canal (34,352) | OSM drain (3,856) | JRC water over 50 % (105,375) | Modelled stream cells with mapped water within 60 m |
|---|---|---|---|---|---|---|
| 500 | 68 % | 54 % | 30 % | 12 % | 47 % | 15 % |
| 1000 | 65 % | 50 % | 26 % | 8 % | 41 % | 18 % |
| 2000 | 62 % | 45 % | 21 % | 6 % | 35 % | 22 % |
| 5000 | 59 % | 37 % | 17 % | 4 % | 31 % | 29 % |

OSM rivers by ground height and search distance (one-off analysis, 6 Oct):

| Threshold | Below 20 m: 60 m | 150 m | 300 m | Above 20 m: 60 m | 150 m | 300 m |
|---|---|---|---|---|---|---|
| 500 | 62 % | 73 % | 88 % | 76 % | 88 % | 96 % |
| 1000 | 57 % | 68 % | 81 % | 74 % | 86 % | 93 % |
| 2000 | 53 % | 62 % | 74 % | 73 % | 84 % | 91 % |
| 5000 | 49 % | 57 % | 67 % | 71 % | 82 % | 89 % |

What this says:
- The comparison does not single out a threshold. Every score falls smoothly as the threshold rises, and a denser network finds more mapped water partly by chance. OSM maps too few headwater streams to say where the modelled network becomes too dense (the last column is a lower bound).
- The larger problem is position in the plain. Below 20 m, about four in ten mapped river cells have no modelled stream within 60 m at any threshold: D8 on a 30 m bare-earth model does not follow the real channels in flat land. The threshold cannot fix that. Options: burn the mapped rivers into the DEM before breaching; in the plain, measure height above mapped water (OSM, JRC) instead of the modelled streams; or accept it and rely on the radar extents there.
- Canals and drains are mostly not followed, as expected.

## Known issues and open points

- **Stream threshold: to be chosen by the owner.** A provisional 1000 cells (0.9 km²) is a common middle value; the data above do not decide it.
- **Lowland stream position** (above): decide whether to burn mapped rivers in.
- **Coastal land without HAND**: cells that drain to the sea or the lake without meeting a stream get no value (210–641 km² in the provinces, by threshold). They are low coastal land and need a rule, for example height above sea level.
- Songkhla Lake is treated like the sea (level 0). Its level in a flood is not.
- The breaching distance and the missing cost limit are first guesses; dams (Bang Lang) and road embankments were not looked at one by one.
- The window is a workaround for memory; a larger machine can run the whole box.
- HAND from FABDEM here and the MERIT HAND used as a mask in S2 are different products: 6 % of the land with FABDEM HAND under 1 m (threshold 500) is masked as terrain in S2.
