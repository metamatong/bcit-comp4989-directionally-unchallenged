# Burnaby floor routing

Visitors can search the 89 supplied floor plans. A sign identifies a place on a sheet. Its walking approaches identify the doors or parts of a public corridor from which a journey can start or end. Each occurrence has its own ID, printed bounds, source PDF hash and graph version. When a sign or doorway is ambiguous, the visitor can pick the matching occurrence or numbered marker using the original session.


The current compiler catalogues **3,383 source occurrences**. It identifies a door or corridor approach for **1,806**. **871** have a walking-grid approach, across **87 sheets**. These are local floor counts before the live reviewed records are joined. They do not establish that two arbitrary places share a continuous route. NE18 floor 1 and SE30 floor 1 identify places in shop or warehouse drawings without a compiled public corridor approach.

## Source preparation

The offline compiler reads every floor-plan PDF in the Burnaby manifest and checks its drawing geometry hash. It retains exact identifiers from the PDF text and source transcriptions. On flattened sheets it compares Tesseract readings from different raster passes, discarding conflicting identifiers at the same printed position. Repeated OCR can still misread a character. Source corrections take priority.

A fitted door swing needs evidence of a leaf and adjoining jamb. The compiler separates adjacent spaces at the threshold. It identifies public circulation from printed space uses, bounded narrow halls that serve distinct signed rooms, and source-bound corridor transcriptions. All accepted grid cells must fit entirely within the walking surface. Adjacent diagonal cells need both orthogonal neighbours. A door can be identified even when its adjoining public path is missing. The source data preserves that distinction.

The visitor searches these grids and the live, directed topology together. The search joins a reviewed trace to a floor only at a contained cell or a source-checked connection to that trace. Route lines use the traversed cells, drawn doorway openings and approved trace vertices. Costs use drawing-grid units and a fixed transfer cost. Physical distance, travel time and access rights require separate evidence.

The published interbuilding connections serve SE12 and SW03. Other floor plans can support local routes independently. The GPS catalogue covers 43 of the 45 building footprints. The official main-entrance GIS features identify buildings and approach directions. They lack floor-plan doorway IDs. Connecting those features to a particular indoor approach requires a correspondence on the source sheet. [BCIT entrance layer](https://services2.arcgis.com/IgcrRjRW95F0HKSw/arcgis/rest/services/CentralBuildingEntrances/FeatureServer/0) · [BCIT pedestrian route layer](https://services2.arcgis.com/IgcrRjRW95F0HKSw/arcgis/rest/services/AccessibleRoutes_BSite_20241113/FeatureServer/0)

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

`data/campus/spatial/floor-circulation.json` keeps supplemental labels, corridor areas and approach points with the individual PDF hashes. The compiler writes `floor-graphs.json` and its checksum. It caches intermediate OCR under `tmp/floor-compiler`. The build packages the graph for the visitor API. The local editor manages human-reviewed transfers, including their direction and history.

## Sample five journeys

`npm run routes:sample` starts an isolated loopback visitor API, samples ten distinct source occurrences without checking connectivity, and pairs the first five with the last five. Each case supplies a simulated exact sign, building and floor to the normal post-extraction API. It selects the sampled occurrence and, when needed, one of its doors. It sends a single navigation request per pair. The printed random seed reproduces the selection against the same version of the catalogue. For the observed results, see the [verification record](verification.md).
