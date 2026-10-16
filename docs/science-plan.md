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
3. **The coastal "gate."** The northeast monsoon pushes water onshore and, with high tide, surge and the Songkhla Lake level, it slows drainage at the river mouths. That is why water stays for days. Measured in Module 10 (16 Oct 2026): what decides it is the daily *low* water, not the high one.

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

### Module 7: Dam release (Bang Lang)

Added 9 Oct 2026 (owner). Bang Lang dam on the Pattani River (EGAT, Yala) releases water in the peak season; the flood wave then travels through Bannang Sata, Yala town, Yarang and Pattani town to the sea.

Data, all free:
- ThaiWater `analyst/dam`: storage, level, inflow, release and spill for Bang Lang by the hour (dam id 50, EGAT) and by the day (id 26, RID), with history through `dam_hourly_graph`, `dam_daily_graph` and `dam_yearly_graph`.
- EGAT's telemetry gauges along the river, already in the S1 archive (BLGTD01 at the tailwater bridge to BLGTD05 at Pattani town), and the RID gauges X.77, X.40A, X.275 and X.10A.
- The radar seasons of S2 (the release of January 2021 falls in season 2020).

Steps:
1. Archive the dam's hourly and daily series with the S1 collector, from the first year ThaiWater has, and keep collecting.
2. Find the past releases (spill above zero, or release well above the turbine range) and, for each, the time the rise reached each gauge. This gives a travel time per reach as a range over the events, and how it shortens as the release grows.
3. The affected zone: tambons along the river below the dam, from HAND and from the radar extents of the release floods. Two or three release sizes, not a continuous model.
4. A signal for admins: storage against the level at which the spillway is used, the rate of rise and the inflow. Advisory only.
5. Output for the app: per release size, the tambons affected and for each the earliest and latest arrival after the gates open, with a safety margin taken off the earliest.

Limits to state wherever this is shown: a few past events, hourly gauges, no hydraulic model, and rain below the dam adds water the dam's figures do not include. The estimate is a range from past releases, not a forecast.

**Done, 10 Oct 2026** (`pipeline/dam_release`, METHODS.md there): step 1 (the archive), step 4 (the
signal, as named criteria measured against 108,597 hourly readings) and an **interim** step 3 — the
path from OpenStreetMap rather than from HAND and the radar, so the app has something to draw
while the analysis is done. It gives the reservoir (43.0 km²), the channel leaving the dam, 134.3 km
of river to the sea and the lower 5 km of ten tributaries, which cross 39 tambons (36 on the stem).
It says where the river runs, **not how far the water spreads**, and it is not a flood zone.

**Still to do: steps 2 and 5, and step 3 properly.** The travel times from the 2014, 2015 and
January 2021 releases to the EGAT (BLGTD01–05) and RID (X.77, X.40A, X.275, X.10A) gauges, then
the zone from HAND and the radar extents, then the arrival ranges per tambon. Until those exist
the app shows no arrival time at all. The two versions of the geometry are kept side by side under
different `source` values for the owner to compare before one replaces the other (decision 10 Oct).

One thing the data showed that matters for the design: ThaiWater's feed for this dam **lags by
hours** (at 06:00 Bangkok only the 00:00 hour was published), so it is a record that trails
reality, not a warning in time. The operator's own screen is what would give warning.

### Module 8: Road embankments (later; not scheduled)

Added 12 Oct 2026 from the owner's knowledge of the area: the main highways are built on fill about 2 m above the original ground. They stay dry when the land beside them floods, and they hold water back where it has no way through.

1. **Parking on the embankments.** Add the main highways (trunk and primary roads, where the radar saw no flood on the carriageway) as candidates for high-ground parking, beside the terrain rule of Module 2. The 30 m elevation model smooths a 2 m embankment away, so this has to come from the road map and the radar, not from elevation. Whether cars may stand on a shoulder is a question for the highway authority, not for the map.
2. **Where water needs a path.** Along each highway line, compare the flood on its two sides in the radar seasons: water standing higher or longer on the upstream side is water the road holds back. Mark those stretches, and the mapped bridges and culverts along them, so the authorities can see where an opening is missing or too small. Output: a layer and a list per highway section for the provincial highway and irrigation offices, as advice, never as a public alert. **Built 15 Oct 2026** (`pipeline/highway_paths`). **How the offices get it, chosen by the owner on 16 Oct 2026: a page of their own in the authority console** (phase A19, after launch), not a document pack and not in the public app: an office registers as a verified authority with the `planning` capability and province-wide coverage, and sees its own province's stretches with the reasons, a map layer and a download, behind RLS. Until A19 is built the lists stay on the laptop in `pipeline/out/highway_paths/`.
3. **Honest limits.** The radar sees extent, not depth; a 10 to 20 m pixel beside a road is noisy; culverts are mostly unmapped in OpenStreetMap. The list is where to look, to be confirmed on the ground.

### Module 9: Seasonal outlook (is this season likely to be a wet one?)

Added 14 Oct 2026 at the owner's request: can Jaga say ahead of the season whether it will bring heavy floods like 2024 and 2025?

**What is and is not predictable.** The rain total of a November to January season can be leaned one way or the other some weeks ahead, mostly from the state of the Pacific (ENSO) and from the seasonal forecast models. The floods that do the damage come from bursts of a few days, and nobody can foresee those more than about one to two weeks ahead. So the product is an **outlook in thirds** (odds of a drier, normal or wetter season), never a flood forecast, and a dry-leaning outlook never lowers readiness.

1. **The record (built 14 Oct 2026, `pipeline/seasonal_outlook`, METHODS.md).** 45 seasons of CHIRPS rain over the four provinces against NOAA's ENSO index. First findings: the two wettest five-day bursts of the record are 2025 and 2024; the Pacific's state before the season explains about 17% of the differences in season totals and 9% in the worst burst; El Niño seasons were in the dry third 5 times in 9 and in the wet third once; season totals have risen about 14% a decade in this record (to be checked against a second record), with no trend shown in the worst burst.
2. **A second rainfall record** (ERA5-Land, and the ThaiWater and TMD gauges where they reach back) to check the totals, the bursts and the trend before anything is quoted.
3. **The forecast models.** ECMWF SEAS5 and the other free seasonal systems (Copernicus C3S, or Open-Meteo's seasonal service) for the box around the provinces, and a **hindcast check**: how often did each model's wet, normal or dry lean come true here in past seasons. Only a model that beats "always say normal" in that check is used.
4. **The outlook.** Odds for the three thirds from the record and the models that passed, issued once before the season (mid-October) and updated monthly, written with its skill beside it ("in past seasons a lean like this was right about N times in 10").
5. **Two to four weeks ahead** (a later step): the extended-range forecasts and the MJO for "a wet spell is more likely in week 3", which is where bursts first become visible.
6. **Rain to flood.** Tie season rain and burst size to flooded area (the nine radar seasons) and to the gauges, so the outlook can say what a wet third has meant on the ground.

**Where it is shown.** To the admins first (the signal dashboard of A8), as one of the things a person weighs. Whether it is shown to the public at all, and in what words, is the owner's decision after the hindcast check; if it is, it sits apart from the alert levels and wears none of their colours.

### Module 10: The coastal gate (how long the water stays)

Added 16 Oct 2026 at the owner's request, after a friend in Narathiwat described the Bang Nara flooding while the sea stood high and the water could not get out. Driver 3 of section 1 had been named since the first draft and never measured. **Built the same day** (`pipeline/coastal_gate`, METHODS.md, report.md).

**The mechanism.** Three days of rain put the same volume of water in a basin whether the sea is high or low; what differs is how long it takes to leave. A river drains while the sea is below it, so the figure that decides whether water leaves or stays is not the high tide but the **low** tide: the floor the river has to get over. Two things lift that floor together on this coast — the north-east monsoon's **set-up**, which piles water against the shore for days at a time, and a **collapsing tidal range**, because the Gulf's tide is largely diurnal and its range varies far more than a semidiurnal coast's. High mean plus small range is the case where the gate never opens, and a spring-tide calendar would miss it: at springs the low waters go *lower*, which helps a river drain.

1. **The record (built).** Open-Meteo's marine model, hourly sea level at four river mouths — the three warning zones' tide points plus the Bang Nara, which has no zone. The archive starts in late 2022, so it is four seasons. The slow part comes out with a Godin filter (24-24-25 h moving means), not the single 25-hour mean of the tide check, which passes several centimetres of the diurnal tide. Per Bangkok day: lower low water, higher high water, range, and the set-up; percentiles over October to January only.
2. **What the floods show.** At all four mouths, in both the 2024 and the 2025 flood, the **low water** stood at the 96th to 99th percentile of season days while the **high water** was unremarkable (81st to 97th) and the set-up at the 94th to 98th. The one flood that was rain without a sea component — Hat Yai, 18 December 2025 — sits at the 78th. That contrast is why this is a modifier and not a trigger.
3. **The wind explains it,** so it is forecastable: onshore wind stress against the set-up gives r = +0.72 to +0.89 depending on the mouth, and the marine forecast runs 7 days out, far beyond the rain-driven lead time.
4. **The live flag (built).** A day is *shut* when its lowest sea level stays at or over the mouth's low-water p90; the flag is raised at two shut days running. Base rate over four seasons: about three spells a season per mouth, one of which is the flood. Far too noisy for a trigger; the right cost for a modifier, where being wrong means an admin reads "the water will leave slowly" on a day when no water needs to leave.
5. **Where it is shown.** The admins' signal dashboard, beside the tide chart, in words and never in an alert colour, and as a note on the safe-return window (Module 5) for the gauges the tide reaches. It can never raise a level and never publish (safety rule 2), and it is not shown to the public (safety rule 8: a bare sea-level percentile would read as a forecast).
6. **Honest limits.** A model, not a gauge: it sat about 0.7 m off the Pattani tide gauge and its cell is a few kilometres offshore, so only percentiles within one mouth's own series mean anything. Four seasons is a first estimate — re-cut the reference after this one. ThaiWater lists station 2143 `NR` at the Bang Nara mouth but answers no readings for 2024-2026, so there is no observed tide here to test against; getting one is the first thing to fix if the gate is ever to do more than advise.
7. **The gap it turned up.** No warning zone covers Mueang Narathiwat (tambons 9601xx), so the Bang Nara — the provincial capital's river — has no signals, no thresholds and no gauge in the tide's reach. Its only reporting gauge in the catchment, X.73 at Tanyong Mat, sits about 14 m above mean sea level, well above the tide. A zone of its own is a separate decision (`docs/decisions.md`, 16 Oct 2026); until then the Kolok mouth at Tak Bai, 20 km along the same shore, stands in.

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
