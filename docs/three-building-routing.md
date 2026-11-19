# Visitor routes in SE12, SW03 and SW01

The graph connects 999 of 1,165 visitor place occurrences to the same public passage in both directions. The audit covers all twelve supplied sheets for these buildings. It keeps 139 shafts and voids and 14 staff-only records out of visitor counts. A reviewed passenger landing beside a shaft remains a separate, usable stop.

A **mapped stop** is a doorway, a public circulation point or a marked room area. A **shared entrance** serves the named space through a suite or vestibule. A **corridor-side stop** lies along a verified common wall and is labelled as an approximate arrival. The **remaining** column includes every occurrence without a continuous walk to the common network in both directions. A one-way destination can still accept arrivals. Counts describe stored drawing evidence and confirmations. They do not measure indoor positioning accuracy.

| Official sheet | Visitor places | Mapped stop | Shared entrance | Corridor-side stop | Remaining |
|---|---:|---:|---:|---:|---:|
| [SE12 floor 1](https://www.bcit.ca/files/facilities/campusdev/pdf/floorplans/se/bse1201.pdf) | 46 | 30 | 0 | 0 | 16 |
| [SE12 floor 2](https://www.bcit.ca/files/facilities/campusdev/pdf/floorplans/se/bse1202.pdf) | 65 | 33 | 2 | 4 | 26 |
| [SE12 floor 3](https://www.bcit.ca/files/facilities/campusdev/pdf/floorplans/se/bse1203.pdf) | 62 | 53 | 0 | 3 | 6 |
| [SE12 floor 4](https://www.bcit.ca/files/facilities/campusdev/pdf/floorplans/se/bse1204.pdf) | 68 | 61 | 1 | 0 | 6 |
| [SW03 floor 1](https://www.bcit.ca/files/facilities/campusdev/pdf/floorplans/sw/bsw0301.pdf) | 38 | 17 | 6 | 0 | 15 |
| [SW03 floor 2](https://www.bcit.ca/files/facilities/campusdev/pdf/floorplans/sw/bsw0302.pdf) | 82 | 55 | 7 | 1 | 19 |
| [SW03 floor 3](https://www.bcit.ca/files/facilities/campusdev/pdf/floorplans/sw/bsw0303.pdf) | 45 | 36 | 7 | 1 | 1 |
| [SW03 floor 4](https://www.bcit.ca/files/facilities/campusdev/pdf/floorplans/sw/bsw0304.pdf) | 51 | 39 | 4 | 4 | 4 |
| [SW01 floor 1](https://www.bcit.ca/files/facilities/campusdev/pdf/floorplans/sw/bsw0101.pdf) | 254 | 203 | 12 | 2 | 37 |
| [SW01 floor 2](https://www.bcit.ca/files/facilities/campusdev/pdf/floorplans/sw/bsw0102.pdf) | 221 | 179 | 14 | 0 | 28 |
| [SW01 floor 3](https://www.bcit.ca/files/facilities/campusdev/pdf/floorplans/sw/bsw0103.pdf) | 164 | 152 | 1 | 5 | 6 |
| [SW01 floor 4](https://www.bcit.ca/files/facilities/campusdev/pdf/floorplans/sw/bsw0104.pdf) | 69 | 64 | 3 | 0 | 2 |
| **Total** | **1,165** | **922** | **57** | **20** | **166** |

The audit traverses the live directional edges outward and in reverse from the SE12 end of the confirmed third-floor SW03 passage. Each place must have an eligible destination and origin in those results. Reviewed entrances retain their approved directions. For example, SW03 1710 accepts arrivals at two doors. Direction checks keep it out of the round-trip count. Remaining records on SW03 include rooms on the west wings of floors 1 and 2. The plans show doors beside stairwells S180 and S280. The compiled approaches lack a confirmed public link from those corridors into the main network. [Complete origin and destination inventory](three-building-coverage.csv)

## How the visitor sees a route

An exact SE12 323 door reading can describe either of two doors. For SW03 1750 the two walks share the same first turn and direction. The app shades the possible starting stretch and draws the route through SW03 to the public side of the 1750 lecture-room door on corridor 1700. When the source doors lead in different directions, the visitor can select their entrance.

When a named room has a missing first or final connection, the app can show a partial walk between reachable public points. A separate marker identifies the printed room. The line begins or ends at a named stop on that room’s sheet, and the text identifies the missing leg. Partial walks do not count toward round-trip coverage. The last checkpoint is selected by its position on the drawing among reachable signed corridors and approved transfer stops. The system draws only checked walking geometry.

## Reviewed transfers

Network revision 87 includes user confirmation of bidirectional stairs between SE12 S100 and S200 and between SW03 S160 and S260. It also includes three bidirectional outdoor passages in SE12. These join S100 and the 102Z entrance on floor 1, S200 and the 201V dining entrance on floor 2, and the SW03-side exit and the 203Y vestibule on floor 2. The outdoor directions identify both doors or landings. Outdoor path geometry and distances remain unmeasured.

## Reproduce the inventory

```sh
npm run routes:coverage -- --network
node --import tsx scripts/report-building-coverage.ts --network --csv > docs/three-building-coverage.csv
npm run routes:sample -- --network
```

A regression test compares the full inventory with the distributed data. For other buildings, the source inventory retains every supplied sheet, including sheets with zero walking approaches. [Campus-wide coverage and regeneration](floor-routing.md)
