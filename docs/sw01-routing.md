# SW01 visitor routing

The visitor planner uses four official Burnaby drawings and the published route data. It reads room numbers together with their space-use captions. It distinguishes a room-side door, a shared suite entrance and an interior area. The room number identifies the space. The route coordinates come from its traversable geometry.

The current inventory covers all four pilot buildings and reports each direction independently. [Coverage by room and floor](three-building-routing.md)

On floor 1 the southern double doors at vestibule 1020 lead past S120 into lobby 1101. The 1501 east entrance serves the public aisle through atrium 1303. Both indoor approaches now reach the door of room 1106. The compiler keeps the short projected strokes and two diagonal mechanical diagram lines in the archived drawing and clears their registered spans in the public walking mask. Columns, other walls and door thresholds retain their own collision masks. [Official SW01 floor 1 plan](https://www.bcit.ca/files/facilities/campusdev/pdf/floorplans/sw/bsw0101.pdf)

## Revision 82 baseline

Revision 82 contains the following SW01 results. The audit checked all source occurrences in both directions on the visitor graph. The same-floor column requires a path to a SW03 passage on that sheet. The last column also permits the reviewed level changes inside SW01.

| SW01 floor | Source occurrences | At least one usable approach | Same-floor passage | Round trip to a passage |
|---|---:|---:|---:|---:|
| 1 | 273 | 249 | 209 | 214 |
| 2 | 239 | 205 | 191 | 192 |
| 3 | 174 | 158 | 153 | 155 |
| 4 | 94 | 71 | 69 | 69 |
| **Total** | **780** | **683** | **622** | **630** |

Of the 630 connected places, 28 use a shared entrance. The photo/GPS match selects the starting estimate automatically; the app does not ask visitors to confirm their position. Another 53 places have a local approach on a separate walking component. All 25 occurrences classified as classrooms and all seven elevator landings in the current route data are reachable to and from a building passage. The stair category has 43 occurrences, of which 34 connect to a passage. Same-building floor connections in this snapshot are legacy hand-authored data and are not yet inferred automatically.

Of the remaining 97 source records, 58 are shafts and two are voids. Room 1494 is excluded from public directions as a staff-only area. Neither the public nor the terminal walking surfaces permit a pin or a walk inside the two marked storage areas.

The other 36 records still need a walking approach. The second-floor list includes equipment areas and stepped study spaces. The third-floor plan has office partitions with incomplete entrance information. The identifiers below are available for source review.

| Floor | Source identifiers with unresolved walking approaches |
|---|---|
| 1 | 1070, S107, 1068, 1017, 1482, 1498, 1583, 1358 |
| 2 | S245, 2240, 2250, S242, 2280, 2440, 2442, 2430, S243, 2438, S249, 2490, S244, 2444, S232, S234, S235, 2305, 2308 |
| 3 | 3051, 3312, 3314, 3320, 3340, 3348, 3332, 3321, 3379 |
| 4 | None |

## Confirmed level changes

Each adjacent pair in a row is present as a bidirectional link in the current route dataset. Intersections on the same floor reuse the same node. The seven elevator stops use the lobby side of the named shaft or car. The three-floor Gateway car bears the inscription 2500LB on the third-floor drawing. Automatic derivation of these same-building links is still pending. [BCIT elevator map](https://www.bcit.ca/files/facilities/pdf/bcitelevators.pdf)

| Facility | Floor 1 | Floor 2 | Floor 3 | Floor 4 |
|---|---|---|---|---|
| East end stair | S190 | S290 | S390 | S490 |
| West end stair | S100 | S200 | S300 | S400 |
| West interior stair | S120 | S220 | S320 | S420 |
| East interior stair | S140 | S250 | S350 | S450 |
| West annex stair | S119 | S219 | S319 | |
| South annex stair | S130 | S230 | S330 | |
| East annex stair | S160 | S260 | S360 | |
| Atrium stair | S131 | S231 | | |
| Main elevator | 1040 | 2036 | 3042 | 4038 |
| Gateway elevator | 1301 | 2325 | 2500LB | |

The route dataset includes the floor-1 atrium 1302 doors to 1120, 1130, 1160 and 1170, plus the indoor boundary to lobby 1300. Vestibule 1020 connects outdoors to lobby 1000 and lobby 1101. On floor 3, a mapped double-door approach connects corridor 3100 to office 3130 and serves the inner offices 3120, 3124, 3126 and 3140. [Floor 1](https://www.bcit.ca/files/facilities/campusdev/pdf/floorplans/sw/bsw0101.pdf) · [Floor 2](https://www.bcit.ca/files/facilities/campusdev/pdf/floorplans/sw/bsw0102.pdf) · [Floor 3](https://www.bcit.ca/files/facilities/campusdev/pdf/floorplans/sw/bsw0103.pdf) · [Floor 4](https://www.bcit.ca/files/facilities/campusdev/pdf/floorplans/sw/bsw0104.pdf)

## Map points and source processing

The app selects the starting estimate automatically from GPS building candidates and photo evidence; it has no starting-point map adjustment. A named destination uses its mapped entrance. For an unnamed destination, **Choose a map point** in the destination form or enter a building and optional floor. Shading represents source-derived walking cells. Staff-only interiors, walls and voids stay outside both walking meshes.

The compiler reads named CAD layers for walls, glazing, columns, furnishings, stair treads and door swings. It retains multiple cubic segments of one door leaf and recognizes opposing leaves of different widths. A floor-specific exception at the 1300–1320 threshold matches the two original fine sill strokes and the drawn leaf. Independent walls still block traversal. Through routes stay on circulation cells. A route to a suite or an interior pin can append its own checked terminal walk. These walks cannot connect unrelated public corridors.

The router first minimizes transfers, then building changes and outdoor legs. It uses drawing-grid cost to break remaining ties. These costs give no physical distance or walking time. Photo evidence, route data and physical-campus accuracy are separate kinds of evidence.

## Reproduce the results

```sh
npm run routes:coverage -- SW01
node --import tsx scripts/report-building-coverage.ts SW01 --csv
npm run routes:sample -- 444e5ee8 --building SW01
```

The five pairs were sampled from the full set of 780 places before checking connectivity. The API used simulated exact sign readings with real source and route data. Four journeys returned directions. The fifth returned the confirmed staff-only restriction.

| Origin | Destination | Visitor result |
|---|---|---|
| 1591 | 2350 | Route from floor 1 to floor 2 |
| 1037 | 1586 | Route on floor 1 |
| 1134 | 1146 | Route on floor 1 |
| 1225 | 1139 | Route on floor 1 from a mapped entrance |
| 1494 | 2010 | Staff-only origin |
