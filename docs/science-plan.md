# Science plan: 2026 season, then 2027

This plan covers the analysis behind the app: what each module computes, from which open data, and how it is validated.
The 2026 target is *decision support for human-issued alerts*, not an automated forecast.

## 1. Flood mechanisms to capture

Each basin behaves differently, so we analyze them separately:
- **Pattani River:** rises in the Betong highlands. Bang Lang Dam releases matter. Flows through Yala city to Pattani Bay.
- **Kolok River:** a border river. Rain and gauges on the Malaysian (Kelantan) side matter. Flows past Sungai Kolok to its mouth at Tak Bai.
- **Sai Buri River** (Narathiwat/Pattani) and **Bang Nara River** (Narathiwat).
- **U-Taphao canal:** runs through Hat Yai into Songkhla Lake, so the lake level acts as a backwater.
- **Thepha River:** Songkhla.

Three drivers combine:
1. **Upstream mountain rain** travels downstream with a lag of hours to 1–2 days. This lag is the main source of warning lead time.
2. **Intense local rain** causes ponding with little lead time.
3. **The coastal "gate."** The northeast monsoon pushes water onshore and, with high tide, surge and the Songkhla Lake level, it slows drainage at the river mouths. That is why water stays for days.

## 2. Open data sources

Verify each ID and endpoint before use. Record anything that changes in `docs/decisions.md`. All pipeline data lives in `pipeline/data/`.

| Dataset | Source / ID | Use |
|---|---|---|
| Sentinel-1 GRD (SAR) | GEE `COPERNICUS/S1_GRD` | Flood extents 2017–2025 |
| FABDEM 30 m (bare-earth) | GEE community catalog `projects/sat-io/open-datasets/FABDEM` | HAND, freeboard, depth |
| Copernicus DEM GLO-30 | GEE `COPERNICUS/DEM/GLO30` | Cross-check |
| MERIT Hydro (includes a 90 m HAND band) | GEE `MERIT/Hydro/v1_0_1` | Quick first-pass HAND and masks |
| JRC Global Surface Water | GEE `JRC/GSW1_4/GlobalSurfaceWater` | Permanent-water mask |
| ESA WorldCover 10 m | GEE `ESA/WorldCover/v200` | Land cover, urban masks |
| GSMaP (hourly) | GEE `JAXA/GPM_L3/GSMaP/v8/operational` | Observed rain, hindcast |
| IMERG (30-min) | GEE `NASA/GPM_L3/IMERG_V07` | Observed rain, cross-check |
| ThaiWater (HII) public API | No key needed | Gauge levels and rain telemetry, live and history. Water level: 365 days per request, older years reachable (archived by S1). Daily rain: 31-day windows. Hourly rain: last ~42 h only, collected every 12 h from 28 Sep 2026. |
| Open-Meteo Forecast / Ensemble | Free non-commercial API | ECMWF IFS and GFS rain forecasts |
| Open-Meteo Flood API (GloFAS) | Free non-commercial API | Discharge forecast and historical |
| Open-Meteo Marine API | Verify sea-level/tide variable availability | Tide and sea level at river mouths (backup; ThaiWater tide/storm-surge data evaluated first in A8) |
| Malaysia JPS publicinfobanjir | Terms unclear ("All Rights Reserved", no reuse licence); not scraped until JPS/DID grants permission | Kolok and Kelantan-side gauges (e.g. Rantau Panjang 0740121WL) |
| OpenStreetMap | Geofabrik / osmnx | Roads, POIs, candidate safe places |
| Google Open Buildings | GEE `GOOGLE/Research/open-buildings/v3/polygons` | Exposure, village clusters |
| Admin boundaries | HDX COD-AB Thailand (ADM1–3) | Provinces, districts, tambons |
| Population | WorldPop or Meta HRSL | Exposure, prioritizing field checks |

Existing open projects that already call the ThaiWater API are useful references: `github.com/bejranonda/flood2026` and `github.com/gain9999/thaiwater`. Check their licenses before reusing any code.

## 3. Modules

### Module 1: Hazard baseline (pre-season)
1. **Map floods from SAR.**
   - Take Sentinel-1 VV (and VH) scenes for each event window: October–January for every season 2017–2025, with the November–December 2024 and 2025 events as the priority.
   - Detect flooding by change detection against a dry-season reference composite built per orbit.
   - Threshold per tile (Otsu) or with a fixed backscatter drop. Keep the parameters logged.
   - Mask permanent water (JRC occurrence > 80%), steep terrain, and high HAND (> 15 m, MERIT first pass).
2. **Summarize the extents:**
   - maximum extent per event
   - flood frequency = flooded observations ÷ valid observations
3. **Compute HAND at 30 m from FABDEM:**
   - condition the DEM (breach/fill), then flow direction, then accumulation
   - tune the stream threshold so the stream network matches OSM and JRC rivers
   - compute HAND
4. **Assign a hazard class per cell** (initial rules, to be tuned):

   | Class | Rule |
   |---|---|
   | High | flooded in 2024 or 2025, or flood frequency ≥ 0.3, or HAND < 2 m within the floodplain |
   | Medium | flood frequency 0.1–0.3, or HAND 2–5 m |
   | Low | everything else in the floodplain |

5. **Aggregate** per tambon and per village cluster: share of buildings in each class.
6. **Outputs:**
   - raster COGs
   - PMTiles vector classes for the map
   - `hazard_by_tambon` table
7. **Validation:**
   - compare against GISTDA historical flood layers where they can be downloaded
   - owner review of known hotspots
   - report CSI (critical success index) and bias against held-out scenes

### Module 2: Safe-place ranking
1. **Candidates:**
   - official shelters (CSV from owner and volunteers)
   - from OSM: schools, mosques, temples, government buildings
   - high-ground parking: local terrain highs near roads with HAND > 8 m (tunable)
2. **Freeboard:**
   - Estimate the local maximum flood water surface elevation from the 2024/2025 extents, by sampling DEM values along the extent boundary (the FwDET approach).
   - Freeboard = site elevation − local water surface elevation.
3. **Dry-route check:**
   - Build the road graph with osmnx.
   - Remove edges that intersect the max extent (with a buffer).
   - Test whether each candidate is reachable from village centroids, and compute travel time.
4. **Score** (initial weights, tunable):
   `S = 0.35·freeboard_norm + 0.20·(1 − flood_freq) + 0.25·route_dry + 0.10·(1 − travel_time_norm) + 0.10·capacity_norm`
   - **Hard exclusion:** flooded above knee depth in 2024 or 2025.
   - **Unverified sites** are flagged in the app.
5. **Field verification:** the global DEM's vertical error of 1 to several metres can flip rankings on flat plains. Generate a prioritized field sheet (CSV plus map links), ordered by population served. Volunteers confirm:
   - a photo
   - "flooded in 2024/2025? how deep?"
   - access and capacity
6. **Output:** `safe_places` table with `score_components`.

### Module 3: Trigger thresholds (signals for admins)
1. **Warning zones:** start with Pattani River, Kolok and U-Taphao.
2. **Signals per zone:**
   - basin-average accumulated rainfall over 24 h and 72 h: observed (GSMaP/IMERG) and forecast (ECMWF/GFS, 1–5 days)
   - upstream gauge level and rate of rise (ThaiWater)
   - GloFAS discharge and its return-period exceedance
   - tide and onshore-wind proxy at the river mouth
   - Bang Lang release, if it can be obtained
3. **Hindcast the 2024 and 2025 events.** Gauges come from the S1 archive (ThaiWater water level reaches back years, so 2024 is covered where stations reported). Hourly rain before 28 Sep 2026 comes from GSMaP/IMERG.
   - Build an event timeline per zone (`pipeline/data/event_timeline.csv`, filled by the owner from news, social media and memory), recording when each district flooded, the peak, and when water receded.
   - Refine the timing with SAR scenes and gauge exceedance times.
   - Record each signal's value at T−72, −48, −24, −12 and −6 h before flood onset.
4. **Set provisional thresholds:**
   - **Watch:** the level reached about 48–72 h before onset in both events.
   - **Warning:** about 24 h before onset.
   - **Evacuate:** gauge at critical level, or flooding observed upstream.
5. **Check for false alarms** by running the thresholds across every October–January from 2017 to 2025 with rainfall and GloFAS (and gauges where they exist). Report:
   - POD (probability of detection)
   - FAR (false alarm ratio)
   - median lead time
6. **Output:** `thresholds.yaml`, loaded into the `thresholds` table with `provisional = true`. The app shows a *suggested* level with its reasons; admins decide.
7. **Limitation:** two recent events is a thin sample. The thresholds are provisional and get revised after the season.

### Module 4: Stage-to-extent library (live flood map)
1. **Pair observations:** for each key gauge, match SAR extents with the gauge stage at acquisition time.
2. **Build synthetic extents:** for each stage step of 0.25 m within the reach's catchment, flood the cells whose HAND is below the stage-derived height. Calibrate the HAND offset to maximize CSI against the SAR extents.
3. **Export:** one extent/depth layer per step (PMTiles), plus a lookup table (gauge, stage → layer).
4. **At runtime:** the app shows the layer that matches the current or forecast stage, labeled "estimated", and crowd reports can override it locally.

### Module 5: Safe-return window
1. From the hourly ThaiWater records of 2025 (and 2024 where available), measure per gauge the time from peak to below warning level and to below bank-full.
2. Cross-check with SAR time series: revisit is roughly every 6–12 days depending on satellites and orbits, so it is coarse.
3. Admins issue the return window as a range, conditional on the rain forecast. The system helps by showing the historical recession durations for the zone.

### Module 6: Crowd reports as a sensor
1. Depth by body reference maps to rough depths: ankle ≈ 0.1 m, knee ≈ 0.5 m, waist ≈ 1.0 m, chest ≈ 1.3 m, above head ≥ 1.7 m.
2. Use reports during an event to confirm or correct Module 4 extents locally, and to support admin decisions.
3. After the season, the reports become a validation dataset for thresholds and extents.

## 4. Validation metrics

- **Extents:** CSI, hit rate, false-alarm rate against held-out SAR.
- **Alerts:** POD, FAR, and lead time per zone. After the season, compare issued alerts with reports and SAR.
- **Safe places:** share of top-3 sites that stayed dry and reachable (from reports and volunteer checks).

## 5. Urgent this week

1. Archive ThaiWater history for every station in the four provinces (done 28 Sep 2026: `pipeline/ingest_thaiwater`, data in `pipeline/data/` = the private repo nafiscode/jaga-data). The 365-day limit turned out to be per request, not total, so all water-level years are archived. Scheduled jobs: weekly refresh, hourly rain every 12 h, and a daily-rain backfill to Oct 2017.
2. Fill in `event_timeline.csv` for the 2024 and 2025 events while memories and news links are fresh.
3. Recruit field volunteers for the safe-place checks and brief them on the field sheet.

## 6. The 2027 roadmap

- Calibrated HEC-HMS plus HEC-RAS 2D (or LISFLOOD-FP) models for the priority basins, driven by ECMWF ensemble forecasts.
- Semi-automated alerts with admin approval.
- ML post-processing trained on the 2026 season's gauges, reports and alerts.
- A higher-resolution DEM from Thai agencies if access is granted.

### Other hazards (placeholders in 2026; see spec section 13)
- **Flash flood:** rainfall-threshold nowcasts for steep catchments (Betong, Than To, Sukhirin and similar), using GSMaP/IMERG and short-range forecasts, and existing Thai agency flash-flood risk products if accessible.
- **Landslide:** rainfall intensity–duration thresholds combined with a susceptibility map (slope, HAND, land cover, past landslide points).
- **Forest and peat fire:** NASA FIRMS active-fire hotspots (free API key) plus fire-danger weather indices. The peat swamp forest in Narathiwat is the main dry-season concern. House and urban fires: SOS only.
- **Earthquake:** not forecastable. Post-event only: official earthquake reports (TMD, plus global feeds such as USGS), felt reports, SOS, damage reports and open-space assembly points.
