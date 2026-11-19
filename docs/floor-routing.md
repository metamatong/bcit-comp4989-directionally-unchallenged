# Burnaby floor routing

Visitors can search the 89 supplied floor plans. A sign identifies a place on a sheet. Its walking approaches identify the doors or public-corridor areas from which a journey can start or end. Each occurrence has its own ID, printed bounds, source PDF hash and graph version. The app ranks starting candidates from photo evidence and GPS building matches and selects the strongest automatically; it does not ask the visitor to choose a start.


The current compiler catalogues **3,439 source occurrences**. It identifies a door or corridor approach for **2,215**. **1,495** have a walking-grid approach, across **87 sheets**. These are local floor counts before mapped transfer data is joined. They do not establish that two arbitrary places share a continuous route. NE18 floor 1 and SE30 floor 1 identify places in shop or warehouse drawings without a compiled public corridor approach.

The counts below group source-use labels into room types and circulation. A place appears in the walking-grid column when at least one of its approaches joins a public walking cell directly or through an individually traced terminal path. Reviewed stair and elevator transfers are counted separately in the network.

| Place type | Source occurrences | Identified door or approach | Walking-grid approach |
|---|---:|---:|---:|
| Corridor | 469 | 378 | 378 |
| Stairs | 162 | 69 | 53 |
| Elevator | 13 | 8 | 7 |
| Unspecified room | 1,895 | 1,081 | 437 |
| Classified rooms and other spaces | 900 | 679 | 620 |

## Source preparation

The offline compiler reads every floor-plan PDF in the Burnaby manifest and checks its drawing geometry hash. It retains exact identifiers from the PDF text and source transcriptions. On flattened sheets it compares Tesseract readings from different raster passes, discarding conflicting identifiers at the same printed position. Repeated OCR can still misread a character. Source corrections take priority.

A fitted door swing needs evidence of a leaf and adjoining jamb. The compiler separates adjacent spaces at the threshold. It identifies public circulation from printed space uses, bounded narrow halls that serve distinct signed rooms, and source-bound corridor transcriptions. All accepted grid cells must fit entirely within the walking surface. Adjacent diagonal cells need both orthogonal neighbours. A door can be identified even when its adjoining public path is missing. The source data preserves that distinction.

The visitor searches these grids and mapped route connections together. The search joins traces to floor cells at contained points or source-checked connections. Route lines use traversed cells, drawn doorway openings and mapped trace vertices. By default, routing first seeks a complete path without elevators; checking **Accessibility: prefer elevators** first seeks one without stairs. If no complete preferred path exists, routing falls back to other mapped transfers. Within the preferred set, route comparison first counts transfers, then building changes and outdoor legs; drawing-grid cost breaks remaining ties. This is a transfer preference, not verified step-free or wheelchair routing. Physical distance, travel time and access rights require separate evidence.

In SE12, the four stair chains for floors 2–4 reuse each approved floor 3 node. Within each sheet, a landing joins its containing or source-checked corridor cell. Where an existing stair marker sits inside a drawn door swing, the compiler checks its node version, source point, fitted opening and unobstructed public-side approach, then saves the short path through the threshold. This applies at S300, S313 and S328. On floor 2, S209 joins the labelled 208Z corridor. The three separate perimeter landings do not imply public paths across the exterior areas on that sheet.

SW03 connects to SW01 in both directions on floors 1–4. The compiler checks the paired door swings along each approach and opens only the middle of their aperture inside the transcribed walking area. Overlapping walls, jambs and columns still block travel. A floor marking can be cleared only when its source stroke matches the CAD floor-finish layer. An arrival-only room door keeps its direction at the doorway, allowing visitors to cross the shared public lobby both ways. These fixed cross-building links are described in the route data.

The published interbuilding connections link SE12, SW03 and SW01. Other floor plans can support local routes independently. The GPS catalogue covers 43 of the 45 building footprints. The official main-entrance GIS features identify buildings and approach directions. They lack floor-plan doorway IDs. Connecting those features to a particular indoor approach requires a correspondence on the source sheet. [BCIT entrance layer](https://services2.arcgis.com/IgcrRjRW95F0HKSw/arcgis/rest/services/CentralBuildingEntrances/FeatureServer/0) · [BCIT pedestrian route layer](https://services2.arcgis.com/IgcrRjRW95F0HKSw/arcgis/rest/services/AccessibleRoutes_BSite_20241113/FeatureServer/0)

The layered SW01 compiler also resolves signed enclosures, open bays, suite entries and independently marked room areas. Interior pins follow their own source-checked path to a circulation cell. The declared staff-only area is excluded from both surfaces. [SW01 walking coverage and exact gaps](sw01-routing.md)

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

`data/campus/spatial/floor-circulation.json` keeps supplemental labels, corridor areas and approach points with the individual PDF hashes. The compiler writes `floor-graphs.json` and its checksum. It caches intermediate OCR under `tmp/floor-compiler`. The build packages the graph for the visitor API. The current published route dataset still carries legacy hand-authored same-building transfers; automatic transfer inference remains an implementation gap.

## Sample five journeys

`npm run routes:sample` starts an isolated loopback visitor API, samples ten distinct source occurrences without checking connectivity, and pairs the first five with the last five. Each case supplies a simulated exact sign, building and floor to the normal post-extraction API. It selects the sampled occurrence and, when needed, one of its doors. It sends a single navigation request per pair. The printed random seed reproduces the selection against the same version of the catalogue. An optional `--building SW01` selects from all places on the requested building’s sheets. For the observed results, see the [verification record](verification.md).
