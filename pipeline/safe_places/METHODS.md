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
| High ground for parking | terrain, this pipeline | 883 |
| Official shelter | `official_shelters.csv` | 0: the template is empty until the owner fills it |

- OpenStreetMap objects are taken only when they have a name (a place nobody can name cannot be pointed to). **OpenStreetMap is thin here: 54 named mosques in four provinces that have thousands.** The official list and the volunteers are what will fill this.
- **Highway embankments** (added 12 Oct 2026 from the owner's knowledge): the main highways are built on fill about 2 m above the original ground, which makes them the real high ground for cars on the plains, and which a 30 m elevation model cannot see. Points of motorway, trunk and primary roads (not their bridges) on cells the radar saw dry in both events are candidates, up to three per tambon, chosen before the terrain ones and by the same rule (most houses within 1 km first, 1 km apart). Their freeboard is what the elevation model gives **plus an assumed 2 m of fill**, and the row says so (`embankment_fill_assumed_m`). Every one carries the flag `highway_shoulder`: whether cars may stand there, and where, is for the highway authority and a visit to say. Their names are generic ("คันทางหลวง ต.… 1"); the road tiles kept no highway numbers.
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

**Flags** (a flag never removes a site): `radar_flood`, `low_ground` (freeboard under 0.5 m), `floods_often` (over 2 % of valid passes), `route_cut` (fewer than half its houses still reach it), `no_road_mapped`, `no_flood_edge_near`, `highway_shoulder` (all 564 embankment points). With the embankment points the counts are: `radar_flood` 66, `low_ground` 629, `floods_often` 294, `route_cut` 312; 1,073 of 2,566 sites carry no flag. Scores: quartiles 0.55, 0.68, 0.85.

## Outputs

- `out/safe_places/safe_places.csv`: the columns of the `safe_places` table; `score_components` holds the parts, what was missing, the flags and the houses counted.
- `out/safe_places/field_sheet.csv`: for volunteers, the sites serving the most houses first, a map link each, why it was flagged, and empty columns for a photo, whether and how deep it flooded in 2024 and 2025, whether the road stays passable, how many people and cars it holds, toilets and water, a contact.
- `supabase/seed/50_safe_places.sql`: reloading replaces only this pipeline's own unverified rows; a site an admin has verified, rejected or edited is never touched.

## Not met, and other limits

- **The acceptance line "every populated tambon has at least 3 candidates" is not met: 29 of 377 tambons have fewer, 5 of them none** (50 and 11 before the highway embankments were added). They are flat coastal tambons (the Sathing Phra peninsula and Ranot in Songkhla, the Pattani coast around Yaring and Nong Chik) with no main highway, no ground 8 m above a stream and few named buildings in OpenStreetMap. They need the official shelter list; secondary roads, which are often on fill too, are not used yet.
- Nothing has been checked on the ground. Half the named buildings are flagged low ground, which on these plains is as likely FABDEM's error as the truth.
- Capacity, facilities and whether a building may be used as a shelter at all are unknown.
- A parking spot is a cell of terrain beside a road, not a place known to hold cars.
- Buildings and roads © OpenStreetMap contributors (ODbL). Heights from FABDEM (CC BY-NC-SA 4.0). Houses from Google Open Buildings (CC BY 4.0).
