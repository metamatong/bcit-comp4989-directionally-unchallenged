# Burnaby floor routing

The offline source archive contains 89 supplied floor plans, but visitor search is restricted to SE12, SW03, SW05 and SW01. A sign identifies a place on a sheet. Its walking approaches identify the doors or public-corridor areas from which a journey can start or end. Each occurrence has its own ID, printed bounds, source PDF hash and graph version. The app ranks starting candidates from photo evidence and GPS building matches and selects the strongest automatically; it does not ask the visitor to choose a start.


The current compiler catalogues **3,469 source occurrences**. It identifies a door or corridor approach for **2,390**. **1,750** have a walking-grid approach, across **87 sheets**. These are local floor counts before the live reviewed records are joined. They do not establish that two arbitrary places share a continuous route. NE18 floor 1 and SE30 floor 1 identify places in shop or warehouse drawings without a compiled public corridor approach.

The counts below group source-use labels into room types and circulation. The walking-grid column includes signed room areas, mapped thresholds, shared entrances and separately marked corridor-side stops. Visitor totals exclude staff-only spaces, shafts and voids. Reviewed stair and elevator transfers are counted separately in the network.

| Place type | Source occurrences | Identified door or approach | Walking-grid approach |
|---|---:|---:|---:|
| Corridor | 474 | 400 | 400 |
| Stairs | 166 | 81 | 66 |
| Elevator | 13 | 8 | 7 |
| Unspecified room | 1,691 | 993 | 398 |
| Classified rooms and other spaces | 1,125 | 908 | 879 |

The four-building inventory checks all fourteen sheets against one common interbuilding passage in both directions. It uses the same inferred stair edges as the visitor router. [Directional coverage by source occurrence](three-building-routing.md)

## Source preparation

The offline compiler reads every floor-plan PDF in the Burnaby manifest and checks its drawing geometry hash. It retains exact identifiers from the PDF text and source transcriptions. On flattened sheets it compares Tesseract readings from different raster passes, discarding conflicting identifiers at the same printed position. Repeated OCR can still misread a character. Source corrections take priority.

A fitted door swing needs evidence of a leaf and adjoining jamb. The compiler separates adjacent spaces at the threshold. It identifies public circulation from printed space uses, bounded narrow halls that serve distinct signed rooms, and source-bound corridor transcriptions. All accepted grid cells must fit entirely within the walking surface. Adjacent diagonal cells need both orthogonal neighbours. A door can be identified even when its adjoining public path is missing. The source data preserves that distinction.

The visitor searches these grids and fixed building connections together. The route search joins source-derived floor cells, doorways and corridors, then computes a path for each request. Same-building transfers are inferred from corresponding landings. SW05 also registers the actual stair enclosures on its source sheets. Building-to-building passages and outdoor crossings remain fixed reviewed links. By default, routing prefers paths without elevators and can use elevators if needed. Selecting **Use elevators** excludes stairs from every part of the route; if the mapped network has no elevator-only path, the app reports that no such route is available. This setting does not verify step-free or wheelchair access. Physical distance, travel time and access rights require separate evidence.

Adjacent SE12 stair segments meet at the same floor 3 landing when both transfers are mapped. An indoor landing joins its containing or source-checked corridor cell. Where an existing stair marker sits inside a drawn door swing, the compiler checks its node version, source point, fitted opening and unobstructed public-side approach, then saves the short path through the threshold. This applies at S300, S313 and S328. On floor 2, S209 joins the labelled 208Z corridor.

The SE12 west stair serves S100, S200 and S300. The confirmed outdoor walks connect S100 to entrance 102Z on floor 1 and S200 to dining entrance 201V on floor 2. A visitor walking between 302 and 100A passes through S200 on the stairs and uses 102Z to enter or leave the first floor. A walk starting at 201V uses the outdoor approach to board the stair at S200. Directions identify the ends of each outdoor walk. The exact path outside is unmeasured.

SW03 connects to SW01 in both directions on floors 1–4. The compiler checks the paired door swings along each approach and opens only the middle of their aperture inside the transcribed walking area. Overlapping walls, jambs and columns still block travel. Doorway floor-finish corrections match the original CAD layer. On the SW01 first-floor lobby route, the compiler also checks the exact layer, endpoints and occurrence count of each registered projection stroke. It clears those strokes only within the marked public aisle and preserves overlapping obstacles. An arrival-only room door keeps its direction at the doorway, allowing visitors to cross the shared public lobby both ways. These fixed cross-building links are described in the route data.

SW03 and SW05 connect on floor 1. Visitors can walk outdoors in both directions between the south doors of SW03 lobby 1602, beside corridor 1604 and stair S170, and the main doors of SW05 lobby 1800. Routes from SW05 floor 2 use the internal stairs to reach this crossing. Official main-entrance GIS features identify buildings and approach directions but lack floor-plan doorway IDs. Connecting those features to a particular indoor approach requires a correspondence on the source sheet. [BCIT entrance layer](https://services2.arcgis.com/IgcrRjRW95F0HKSw/arcgis/rest/services/CentralBuildingEntrances/FeatureServer/0) · [BCIT pedestrian route layer](https://services2.arcgis.com/IgcrRjRW95F0HKSw/arcgis/rest/services/AccessibleRoutes_BSite_20241113/FeatureServer/0)

The layered SW01 compiler also resolves signed enclosures, open bays, suite entries and independently marked room areas. Interior pins follow their own source-checked path to a circulation cell. The declared staff-only area is excluded from both surfaces. [SW01 walking coverage and exact gaps](sw01-routing.md)

On layered plans a confirmed indoor building passage can be marked within the swing of its double doors. If that mark has no ordinary grid connection, the compiler checks the fitted leaves from the CAD door layer and looks for a public walking cell within the aperture. The short segment must clear the structural walls and fixtures. On SE12 floor 4 this connects the SW03 passage at corridor 408C to the walking network serving 402. The existing transfer still controls travel between the buildings. [Official SE12 fourth-floor plan](https://www.bcit.ca/files/facilities/campusdev/pdf/floorplans/se/bse1204.pdf)

On SW03 floor 1, corridor 1700 connects the reviewed lobby 1602 approach to the corridor side of AV room 1730. The corridor caption overlaps the door swing, and the steps inside the room partition its label from the threshold in the raster. The compiler checks the fitted leaf, the room label and a walking cell in the named corridor before binding the arrival point. The marker sits outside the door. [Official SW03 first-floor plan](https://www.bcit.ca/files/facilities/campusdev/pdf/floorplans/sw/bsw0301.pdf)

## Starting between two rooms

Rooms 2680 and 2695 on SW03 floor 2 each have two entrances on corridor 2600. The shaft labels M261 and M260 are printed inside those labs, which made the general room detector withhold their approaches. Four entries in `floor-circulation.json` bind the exact room identifiers to the door-swing curves on this sheet. The compiler checks the CAD layer, the room side of each swing and a clear path on the public side before accepting the walking cell. [Official SW03 floor 2 plan](https://www.bcit.ca/files/facilities/campusdev/pdf/floorplans/sw/bsw0302.pdf)

The compiler uses named corridor rectangles to identify rooms with entrances on opposite sides of the same connected strip. Their entrance spans must overlap along the corridor, allowing for a stagger up to the drawn corridor width. The visitor API matches full room numbers and requires a single matching floor and strip. The first map shades the resulting area. Walking starts at a public grid cell within it. This currently supports qualifying pairs on SW03 floors 2 and 4, including 2680/2695 and 4710/4725 respectively.

## Use and regeneration

The running app uses the checked-in graph. To inspect a place or the per-floor inventory, including missing approaches, run:

```sh
npm run spatial:query -- get_floor_places '{"label":"323","building":"SE12","floor":"3"}'
npm run spatial:query -- get_floor_routing_coverage '{}'
```

To regenerate the graph, install the dependencies in `requirements-data.txt` in a Python 3.11 environment and make Tesseract with English data available on PATH. Then run:

```sh
python scripts/floor_graph/compile.py
```

`data/campus/spatial/floor-circulation.json` keeps supplemental labels, corridor areas and approach points with the individual PDF hashes. The compiler writes `floor-graphs.json` and its checksum. It caches intermediate OCR under `tmp/floor-compiler`. The build packages the graph for the visitor API. Same-building transfer inference uses adjacent floor plans and source-backed stair/elevator landing records; it does not require connection-review records.

## Sample five journeys

`npm run routes:sample` starts an isolated loopback visitor API, samples ten distinct source occurrences without checking connectivity, and pairs the first five with the last five. Each case supplies a simulated exact sign, building and floor to the normal post-extraction API. It supplies simulated GPS building metadata and uses automatic source-start selection. If a destination remains ambiguous, it selects the sampled destination occurrence and repeats navigation. The printed random seed reproduces the selection against the same version of the catalogue. The `--network` option samples visitor places in SE12, SW03, SW05 and SW01 before checking connectivity. An optional `--building SW01` selects from all places on the requested building’s sheets. For the observed results, see the [verification record](verification.md).
