# Data sources and credits

Every organisation whose data Jaga uses is credited (owner's decision, 8 Oct 2026). This list is the source for the credits page in the app (to be built before launch, phase A10) and for the attribution shown next to each map layer.

Jaga is non-profit. Several sources below allow non-commercial use only. The donation feature stays off; before it is ever switched on, the owner asks the licensors marked "ask first" whether donations for hosting change anything (decision 8 Oct 2026).

"Checked" means the licence text was read on that date. "To verify" means the terms are written here from memory and must be read at the source before launch.

| Source | Used for | Licence and terms | Credit line | Status |
|---|---|---|---|---|
| FABDEM V1-2 (University of Bristol, Fathom) | HAND and the hazard classes (S3); slope in the radar terrain mask (S2) | CC BY-NC-SA 4.0: non-commercial, attribution, and layers derived from it are shared under the same licence | FABDEM (Hawker et al. 2022), CC BY-NC-SA 4.0. Produced using Copernicus WorldDEM-30 © DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018, provided under COPERNICUS by the European Union and ESA; all rights reserved | Checked 6 Oct 2026. Ask first |
| Copernicus Sentinel-1 (European Union, ESA) | Radar flood extents and flood frequency (S2) | Free, full and open; credit required | Contains modified Copernicus Sentinel data 2017–2026 | To verify |
| JRC Global Surface Water 1.4 (European Commission JRC, Google) | Permanent-water mask; comparison of streams | Free with attribution | Pekel et al. 2016, Nature 540; source: EC JRC/Google | To verify |
| MERIT Hydro 1.0.1 (Yamazaki et al.) | Height above drainage in the radar terrain mask (S2) | CC BY-NC 4.0 or ODbL 1.0 | Yamazaki et al. 2019, Water Resources Research | To verify. Ask first if the CC BY-NC option is the one relied on |
| OpenStreetMap | Rivers burned into the elevation model; stream comparison; later roads and places | ODbL 1.0 | © OpenStreetMap contributors | To verify |
| OpenFreeMap, OpenMapTiles | Basemap in the app | Free; credit required | OpenFreeMap © OpenMapTiles, data from OpenStreetMap | To verify |
| ThaiWater, Hydro-Informatics Institute (HII) | Water level and rainfall from telemetry stations | Public API; no written terms found. The owner writes to HII (tracker, "HII email") | ข้อมูลจากคลังข้อมูลน้ำแห่งชาติ (ThaiWater) สถาบันสารสนเทศทรัพยากรน้ำ (สสน.) | Open: reply from HII |
| GISTDA (Geo-Informatics and Space Technology Development Agency) | Repeated-flood layer as a check on the radar flood frequency (S3); near-real-time flood extent on the public map in season | Open data API, free key from api-gateway.gistda.or.th; the catalogue names the licence "Open Data Common" and the data class public | ข้อมูลพื้นที่น้ำท่วมจากสำนักงานพัฒนาเทคโนโลยีอวกาศและภูมิสารสนเทศ (GISTDA) | To verify: read the licence text and confirm in writing that the layer may be shown in a public app (contact wgs@gistda.or.th) |
| Royal Thai Survey Department, via OCHA HDX | Province, district and tambon boundaries | CC BY-IGO | Administrative boundaries: Royal Thai Survey Department, via OCHA HDX | Checked 29 Sep 2026 (phase A1) |
| Open-Meteo (and the weather models and GloFAS it serves) | Rain and river-discharge forecasts (S5, A8) | Free API for non-commercial use; data CC BY 4.0 | Weather data by Open-Meteo.com | To verify. Ask first (draft in the tracker) |
| Google Earth Engine | Processing only; no data of its own is shown | Non-commercial tier | None required | Checked 6 Oct 2026 |
| Esri World Imagery | Background in screenshots on the private tracker only; not in the app | Esri terms | Esri, Maxar, Earthstar Geographics | Not for publication |

What the FABDEM licence means in practice: the code in this repository stays Apache-2.0. The data layers derived from FABDEM (HAND, the hazard classes and the tiles made from them) are published under CC BY-NC-SA 4.0 with the credit line above, and the app says so wherever they are shown.
