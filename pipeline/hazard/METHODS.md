# Hazard baseline: methods note (S3)

Status, 8 Oct 2026: **the HAND layer is decided and built** (see "The decided HAND"): streams from 0.9 km², mapped rivers burned in for the routing, height above sea level on coastal land without a stream. The hazard classes, the aggregation and the tiles are not started. Nothing here is tuned or validated. All parameters are in `config.yaml`.

FABDEM stays (owner, 8 Oct 2026): what is derived from it is published under CC BY-NC-SA 4.0 with its credit line; Jaga is non-profit and the donation feature is off (`docs/decisions.md`, `docs/attributions.md`).

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

## The decided HAND (8 Oct 2026, not validated)

Owner's decision of 8 Oct (`docs/decisions.md`), built by `hazard hand-burned` into `out/hazard/burned/`:
1. OpenStreetMap ways tagged `waterway=river` are rasterised and the DEM is lowered by 10 m along them. Streams and canals are not burned: they are mapped too unevenly.
2. Breaching, filling, D8 directions and accumulation as before, on the burned DEM. Streams from 1,000 cells (0.9 km²).
3. HAND is measured on the **unburned** surface along the flow directions of the burned one (`hand.hand_from_flow`): each cell's height above the stream cell it drains to; negative results (a stream cell higher than the land draining to it) are set to 0.
4. Coastal rule: a cell whose flow path ends beside the sea or Songkhla Lake without meeting a stream gets its height above sea level. A path that ends at the edge of the window gets no value.

Against the first HAND at the same threshold, inside the four provinces:

| | First (no burn) | Decided |
|---|---|---|
| Land without a HAND value | 294 km² | 0 km² |
| OSM river cells with a stream within 60 m | 65 % | 90 % |
| the same, below 20 m | 57 % | 86 % |
| OSM streams (not burned) with a stream within 60 m | 50 % | 50 % |
| JRC water over 50 % with a stream within 60 m | 41 % | 40 % |
| Land under 1 m / 2 m / 5 m | 18.1 / 24.9 / 37.0 % | 19.2 / 26.2 / 38.7 % |
| 2024 radar flood under 1 m / 2 m / 5 m | 76.8 / 85.8 / 92.2 % | 75.6 / 86.9 / 95.4 % |

Reading it honestly:
- The river figures improve because the rivers were burned in; that is the method working, not an independent test. The 10 % still not matched are mostly mapped rivers with less than 0.9 km² draining to them.
- The independent check is the 2024 radar flood, and there the change is small: slightly less of the flood under 1 m, slightly more under 2 m, and 95 % against 92 % under 5 m. Burning moves streams onto the real channels but does not sharpen HAND much as a predictor of where the radar saw water.
- The coastal rule gives every land cell a value. It treats a storm-tide or river-mouth flood as "sea at 0 m", which is a simplification.
- The 2024 flood used here is from the first radar run (`cd222f1`); the figures will be recomputed with the second run.

## Known issues and open points

- Stream threshold, river burning and the coastal rule were decided on 8 Oct 2026 (above). The burn depth (10 m) and the choice of rivers only are first values.
- Built-up land: the radar under-reports flooding in towns (owner, 8 Oct: Pattani town flooded where the map shows little), so the hazard classes must lean on HAND there, not on the radar frequency.
- Songkhla Lake is treated like the sea (level 0). Its level in a flood is not.
- The breaching distance and the missing cost limit are first guesses; dams (Bang Lang) and road embankments were not looked at one by one.
- The window is a workaround for memory; a larger machine can run the whole box.
- HAND from FABDEM here and the MERIT HAND used as a mask in S2 are different products: 6 % of the land with FABDEM HAND under 1 m (threshold 500) is masked as terrain in S2.
