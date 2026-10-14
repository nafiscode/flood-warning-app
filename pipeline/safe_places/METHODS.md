# Safe-place candidates and their score (S4)

Science plan Module 2. `uv run python -m safe_places fetch`, then `run`. Nothing here is validated: every site is **unverified** until somebody has stood there, and the field sheet exists to make that happen.

## What the owner decided (12 Oct 2026)

- **Nothing is excluded.** The plan's hard exclusion ("flooded above knee depth in 2024 or 2025") is dropped: the radar gives no depth and sees almost nothing in towns. A doubtful site keeps its row and carries flags. The cost, said at the time: a flagged site can rank in someone's top three until a volunteer has checked it.
- **Travel** is on foot to places for people and by car to high-ground parking.
- **The scored candidates are loaded into the development database**, unverified. The live site reads the same database.

## Candidates

| Kind | Source | Count |
|---|---|---|
| School | OpenStreetMap | 809 |
| Temple | OpenStreetMap | 103 |
| Government building | OpenStreetMap | 90 |
| Other place of worship | OpenStreetMap | 63 |
| Mosque | OpenStreetMap | 54 |
| Parking on a highway embankment | main roads, this pipeline | 564 |
| Parking on a smaller road's embankment (gap filler) | secondary and tertiary roads, this pipeline | 37 (16 secondary, 21 tertiary) |
| High ground for parking | terrain, this pipeline | 883 |
| Official shelter | `official_shelters.csv` | 0: the template is empty until the owner fills it |

- OpenStreetMap objects are taken only when they have a name (a place nobody can name cannot be pointed to). **OpenStreetMap is thin here: 54 named mosques in four provinces that have thousands.** The official list and the volunteers are what will fill this.
- **Highway embankments** (added 12 Oct 2026 from the owner's knowledge): the main highways are built on fill about 2 m above the original ground, which makes them the real high ground for cars on the plains, and which a 30 m elevation model cannot see. Points of motorway, trunk and primary roads (not their bridges) on cells the radar saw dry in both events are candidates, up to three per tambon, chosen before the terrain ones and by the same rule (most houses within 1 km first, 1 km apart). Their freeboard is what the elevation model gives **plus an assumed 2 m of fill**, and the row says so (`embankment_fill_assumed_m`). Every one carries the flag `highway_shoulder`: whether cars may stand there, and where, is for the highway authority and a visit to say. Their names are generic ("คันทางหลวง ต.… 1"); the road tiles kept no highway numbers.
- **Smaller roads, only to fill gaps** (added 15 Oct 2026, see the section below): points on secondary and then tertiary roads, in tambons that still had fewer than three candidates. Source `jaga-road`, flag `road_shoulder`, names "คันถนน ต.… 1" / "Road embankment, … 1".
- High ground for parking: cells within one cell of a drivable road, more than 8 m above the nearest stream, on land the radar did not see flooded in either event; inside each tambon the cells with the most houses within 1 km come first, up to three, at least 1 km apart. Their names are made here ("ที่สูงริมถนน ต.… 1"), not somebody's name for the place.

## Features (on the hazard grid, 30 m)

- **Elevation:** FABDEM. Its error of a metre or more can decide a ranking on a flat plain.
- **Freeboard:** FwDET's idea, taken in height above the nearest stream instead of height above sea level. The flood's stage near a site is the median height above the stream of the 25 nearest cells on the edge of the radar flood (2024 and 2025 together), within 2 km; freeboard is the site's own height above the stream minus that. With heights above sea level a flood edge two kilometres up a valley reads metres too high and the first trial gave a hill mosque −15 m. Where no edge is that near, the site's height above the stream is used and the row says so (`freeboard_from`).
- **Flood frequency:** the nine-season frequency of the radar run `c97e0bf` at the site's cell. `flooded_2024`, `flooded_2025`: the radar's event extents at the cell.

## Dry-route check

Roads are OpenStreetMap's, kept as arrays with a search of our own (osmnx, named in the plan, was not used: this laptop had about 1.5 GB of memory free, and the search only ever needs a neighbourhood). 1.33 million nodes, 1.38 million road pieces.

- A road piece is **flooded** when two of its three sample points (both ends and the middle) lie on radar flood of either event, after flood patches under 20 cells (1.8 ha) are dropped; bridges and tunnels are never flooded. 2.9 % of road pieces are flooded by this rule.
- The first trial followed the plan literally (any touch, flood widened by a cell): 16.6 % of pieces flooded, the median site kept 22 % of its houses, and Betong, a hill town, kept a seventh. A network falls apart when every culvert and every flagged cell beside a road is a cut. The rule above is the correction; it has not been checked against a road anyone saw under water.
- A site **serves** the houses (Open Buildings counts, snapped to a road within 150 m) within 30 minutes' walk at 4 km/h, or 15 minutes' drive at 30 km/h for parking. `route_dry` is the share of those houses that can still reach it with the flooded pieces closed; the travel time is their mean time then.
- The radar is nearly blind in towns, so a town street it did not see is "dry" here. This check says nothing reliable inside Hat Yai or Pattani town.

## Score

`S = 0.35 freeboard + 0.20 (1 − flood frequency) + 0.25 route_dry + 0.10 (1 − travel time / limit) + 0.10 capacity`

Freeboard scores 1 at 5 m or more, 0 at or below the flood's stage. A part nobody knows is left out and the other weights are scaled up; capacity is unknown for every site so far. The weights are in `config.yaml`.

**Flags** (a flag never removes a site): `radar_flood`, `low_ground` (freeboard under 0.5 m), `floods_often` (over 2 % of valid passes), `route_cut` (fewer than half its houses still reach it), `no_road_mapped`, `no_flood_edge_near`, `highway_shoulder` (all 564 highway embankment points), `road_shoulder` (all 37 smaller-road points). Counts (15 Oct 2026): `radar_flood` 66, `low_ground` 636, `floods_often` 297, `route_cut` 327; 1,073 of 2,603 sites carry no flag. Scores: quartiles 0.55, 0.68, 0.84.

## Outputs

- `out/safe_places/safe_places.csv`: the columns of the `safe_places` table; `score_components` holds the parts, what was missing, the flags and the houses counted.
- `out/safe_places/field_sheet.csv`: for volunteers, the sites serving the most houses first, a map link each, why it was flagged, and empty columns for a photo, whether and how deep it flooded in 2024 and 2025, whether the road stays passable, how many people and cars it holds, toilets and water, a contact.
- `supabase/seed/50_safe_places.sql`: reloading replaces only this pipeline's own unverified rows; a site an admin has verified, rejected or edited is never touched.

## Smaller roads as a second tier (15 Oct 2026)

After the highway embankments, 29 of 377 tambons still had fewer than three candidates and 5 had none: flat coastal tambons with no main highway and no ground 8 m above a stream. Secondary and tertiary roads are often raised a little too, so they are used as a **second, lower tier, and only to fill gaps**:

- After the named buildings, the official shelters, the highway points and the terrain points are counted, a tambon with fewer than three candidates (`parking.road.fill_to`) gets points on **secondary** roads until it has three, then on **tertiary** roads for whatever is still missing. A tambon with three or more gets none, so the well-served tambons are untouched (the 2,566 earlier rows came out identical).
- The rule is the highway rule: points of those roads, not on a bridge or in a tunnel, on cells the radar saw dry in both events; most houses within 1 km first; 1 km apart, and 1 km from any highway or terrain point already picked in that tambon.
- **Their fill is an assumption, not a survey:** 1.0 m for secondary roads and 0.5 m for tertiary ones (`parking.road.tiers`), added to the freeboard and written in the row (`embankment_fill_assumed_m`, and `embankment_road_class`). Secondary roads here are usually raised less than the highways; many tertiary roads are hardly raised at all. Nobody has measured any of them.
- Source `jaga-road`, flag `road_shoulder` on every one, names "คันถนน ต.… 1" / "Road embankment, … 1" (numbered per tambon, like the highway ones). Whether cars may stand there is for the road's owner and a visit to say.

| | Before | After |
|---|---|---|
| Named buildings (`osm`) | 1,119 | 1,119 |
| Highway embankment (`jaga-highway`) | 564 | 564 |
| High ground by a road (`jaga-terrain`) | 883 | 883 |
| Smaller-road embankment (`jaga-road`) | 0 | 37 (16 secondary, 21 tertiary) |
| **All candidates** | **2,566** | **2,603** |
| Tambons with fewer than three | 29 | 8 |
| Tambons with none | 5 | 2 |

The 37 points: freeboard (with the assumed fill) from −1.2 to 4.8 m, median 1.3 m; 7 flagged `low_ground`, 15 `route_cut`, 3 `floods_often`; scores 0.37 to 0.85, median 0.52, so they mostly rank below the other candidates of a tambon, as they should. 24 tambons gained candidates.

**Still short (8)**, with the 30 m road cells of each class in the tambon (dry ones in brackets):

| Tambon | Province | Candidates | Main roads | Secondary | Tertiary | Why |
|---|---|---|---|---|---|---|
| 900208 Tha Hin | Songkhla | 0 | 0 | 0 | 0 | no road of these classes mapped, no named building |
| 900708 Phang Yang | Songkhla | 0 | 0 | 0 | 0 | the same |
| 940309 Bang Tawa | Pattani | 1 | 0 | 0 | 28 (23) | the tertiary road is short: no second point 1 km from the first |
| 900210 Bo Daeng | Songkhla | 2 | 53 (51) | 0 | 0 | the highway is too short in the tambon for a third point 1 km apart |
| 900712 Daen Sa-Nguan | Songkhla | 2 | 0 | 0 | 15 (8) | a few hundred metres of dry tertiary road: one point |
| 940103 Chabang Tiko | Pattani | 2 | 46 (45) | 0 | 25 (22) | small town tambon: every road cell is within 1 km of a point already picked |
| 940108 Bara Hom | Pattani | 2 | 30 (29) | 18 (18) | 14 (12) | the same |
| 940904 Tanyong Chueng Nga | Pattani | 2 | 0 | 0 | 30 (30) | the same |

Six of the eight are short only because of the 1 km spacing in small tambons (a 500 m spacing for this tier would probably fill most of them; not done, it would put parking points close together). Tha Hin and Phang Yang (the Sathing Phra peninsula and Ranot) have only residential and unclassified roads in OpenStreetMap; nothing in these rules can serve them, and they need the official shelter list or a volunteer. `summary.json` lists them under `tambons_under_3_why`.

## Not met, and other limits

- **The acceptance line "every populated tambon has at least 3 candidates" is not met: 8 of 377 tambons have fewer, 2 of them none** (50 and 11 before the highway embankments, 29 and 5 before the smaller roads). See the table above.
- Nothing has been checked on the ground. Half the named buildings are flagged low ground, which on these plains is as likely FABDEM's error as the truth.
- Capacity, facilities and whether a building may be used as a shelter at all are unknown.
- A parking spot is a cell of terrain beside a road, not a place known to hold cars.
- Buildings and roads © OpenStreetMap contributors (ODbL). Heights from FABDEM (CC BY-NC-SA 4.0). Houses from Google Open Buildings (CC BY 4.0).
