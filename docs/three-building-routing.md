# Visitor routes in SE12, SW03, SW05 and SW01

Of 1,191 visitor occurrences, 1,080 connect in both directions to the SE12 end of the confirmed third-floor passage to SW03. The audit covers fourteen sheets and excludes 145 shafts or voids and 14 staff-only entries.

A **mapped stop** is a doorway, a public circulation point or a marked room area. A **shared entrance** serves the named space through a suite or vestibule. A **corridor-side stop** lies along a verified common wall and is labelled as an approximate arrival. The **remaining** column includes every occurrence without a continuous walk to the common network in both directions. A one-way destination can still accept arrivals. Counts describe stored drawing evidence and confirmations. They do not measure indoor positioning accuracy.

| Official sheet | Visitor places | Mapped stop | Shared entrance | Corridor-side stop | Remaining |
|---|---:|---:|---:|---:|---:|
| [SE12 floor 1](https://www.bcit.ca/files/facilities/campusdev/pdf/floorplans/se/bse1201.pdf) | 49 | 35 | 1 | 0 | 13 |
| [SE12 floor 2](https://www.bcit.ca/files/facilities/campusdev/pdf/floorplans/se/bse1202.pdf) | 66 | 40 | 2 | 3 | 21 |
| [SE12 floor 3](https://www.bcit.ca/files/facilities/campusdev/pdf/floorplans/se/bse1203.pdf) | 62 | 56 | 1 | 3 | 2 |
| [SE12 floor 4](https://www.bcit.ca/files/facilities/campusdev/pdf/floorplans/se/bse1204.pdf) | 68 | 61 | 4 | 0 | 3 |
| [SW03 floor 1](https://www.bcit.ca/files/facilities/campusdev/pdf/floorplans/sw/bsw0301.pdf) | 38 | 26 | 8 | 0 | 4 |
| [SW03 floor 2](https://www.bcit.ca/files/facilities/campusdev/pdf/floorplans/sw/bsw0302.pdf) | 82 | 65 | 9 | 1 | 7 |
| [SW03 floor 3](https://www.bcit.ca/files/facilities/campusdev/pdf/floorplans/sw/bsw0303.pdf) | 45 | 37 | 7 | 1 | 0 |
| [SW03 floor 4](https://www.bcit.ca/files/facilities/campusdev/pdf/floorplans/sw/bsw0304.pdf) | 52 | 41 | 8 | 3 | 0 |
| [SW05 floor 1](https://www.bcit.ca/files/facilities/campusdev/pdf/floorplans/sw/bsw0501.pdf) | 11 | 9 | 2 | 0 | 0 |
| [SW05 floor 2](https://www.bcit.ca/files/facilities/campusdev/pdf/floorplans/sw/bsw0502.pdf) | 10 | 10 | 0 | 0 | 0 |
| [SW01 floor 1](https://www.bcit.ca/files/facilities/campusdev/pdf/floorplans/sw/bsw0101.pdf) | 254 | 207 | 20 | 2 | 25 |
| [SW01 floor 2](https://www.bcit.ca/files/facilities/campusdev/pdf/floorplans/sw/bsw0102.pdf) | 221 | 179 | 14 | 0 | 28 |
| [SW01 floor 3](https://www.bcit.ca/files/facilities/campusdev/pdf/floorplans/sw/bsw0103.pdf) | 164 | 152 | 1 | 5 | 6 |
| [SW01 floor 4](https://www.bcit.ca/files/facilities/campusdev/pdf/floorplans/sw/bsw0104.pdf) | 69 | 64 | 3 | 0 | 2 |
| **Total** | **1,191** | **982** | **80** | **18** | **111** |

The audit searches the visitor graph forward and in reverse. Older three-building reports traversed saved vertical edges, including connections that the current visitor router omits. Counts now reflect runtime transfer inference and retain floors with zero interbuilding coverage. A room may still accept arrivals in one direction. [Complete origin and destination inventory](three-building-coverage.csv)

## SE12 west stairs

The signed landings S100 and S200 each have a confirmed outdoor approach to a mapped entrance. They continue the same stair as S300 on floor 3. In both directions, 36 of the 49 first-floor visitor places can reach the common network, including washroom 100A via entrance 102Z. The dining entrance 201V provides access to S200 from inside floor 2.

## SW05 first and second floors

The visitor router pairs SW05 stair enclosures across the two registered source sheets. It requires the matching signed stair number, a fitted doorway with a public grid approach on each floor and a unique overlapping enclosure in both directions. The left stair is S180–S280 and the right stair is S189–S289. These pairs are computed at runtime without device GPS or a stored inter-floor approval. [SW05 floor 1](https://www.bcit.ca/files/facilities/campusdev/pdf/floorplans/sw/bsw0501.pdf) · [SW05 floor 2](https://www.bcit.ca/files/facilities/campusdev/pdf/floorplans/sw/bsw0502.pdf)

SW03 and SW05 connect on floor 1. Visitors can walk outdoors in both directions between the south doors of SW03 lobby 1602, beside corridor 1604 and stair S170, and the main doors of SW05 lobby 1800. Routes from SW05 floor 2 use the internal stairs to reach this crossing.

21 of 21 visitor places on the two SW05 sheets can start and finish a walk to lobby 1800 within the building. From lobby 1800, visitors can reach lecture room 1840 through west vestibule 1843 (C) and lecture room 1850 through east vestibule 1853 (D). Both approaches work in either direction. The west exterior door (E), the central pair (G) and the east door (F) open only from the inside. The plans locate these exits. Their onward outdoor paths have not been mapped. The six shaft callouts remain searchable plan evidence and are excluded from visitor endpoints.

## How the visitor sees a route

An exact SE12 323 door reading can describe either of two doors. For SW03 1750 the two walks share the same first turn and direction. The app shades the possible starting stretch and draws the route through SW03 to the public side of the 1750 lecture-room door on corridor 1700. When the approaches lead in different directions, the router uses the available sign evidence and the connected approaches to select a departure.

When a named room has a missing first or final connection, the app can show a partial walk between reachable public points. A separate marker identifies the printed room. The line begins or ends at a named stop on that room’s sheet, and the text identifies the missing leg. Partial walks do not count toward round-trip coverage. The last checkpoint is selected by its position on the drawing among reachable signed corridors and approved transfer stops. The system draws only checked walking geometry.

## Reviewed transfers

Revision 87 introduced user confirmation of bidirectional stairs between SE12 S100 and S200 and between SW03 S160 and S260. It also includes three bidirectional outdoor passages in SE12. These join S100 and the 102Z entrance on floor 1, S200 and the 201V dining entrance on floor 2, and the SW03-side exit and the 203Y vestibule on floor 2. The outdoor directions identify both doors or landings. Outdoor path geometry and distances remain unmeasured.

Revision 89 adds two confirmed, bidirectional SW03 west-wing connections. On floor 1 visitors can walk outside between the corridor 1700 vestibule by S180 and the corridor 1900 exterior entrance. In the west wing, the S190 and S299 stair landings connect floors 1 and 2. SE12 323 can now reach SW03 1920 through the outdoor link and SE12 302 can reach SW03 2910 via the same link and the west staircase. The outdoor map deliberately ends at each doorway.

The SE12 first-floor source prints corridor 101Y and vestibule 100Z over each other. The compiler preserves both explicitly transcribed identities. A designated public walking strip joins lobby 101L to the corridor side of the 100E communications-room door and the 100A washroom. At SW03, the source identifies S480 on the west and S460 on the east of floor 4. Their two distinct landings can now be resolved by their own identifiers.

Revision 90 adds a bidirectional outdoor crossing between the SW03 lobby 1602 exit and the east doors of SW01 lobby 1501. For SW03 1730 to SW01 1106 the visitor enters SW01 once, walks west through atrium 1303 and finishes at the lobby side of the 1106 doorway. The separate 1098 entrance remains available for destinations along corridor 1290. From vestibule 1020 the south double doors beside S120 lead indoors through lobby 1101. [Official SW01 floor 1 plan](https://www.bcit.ca/files/facilities/campusdev/pdf/floorplans/sw/bsw0101.pdf)

## Reproduce the inventory

```sh
npm run routes:coverage -- --network
node --import tsx scripts/report-building-coverage.ts --network --csv > docs/three-building-coverage.csv
npm run routes:sample -- --network
```

A regression test compares the full inventory with the distributed data. For other buildings, the source inventory retains every supplied sheet, including sheets with zero walking approaches. [Campus-wide coverage and regeneration](floor-routing.md)
