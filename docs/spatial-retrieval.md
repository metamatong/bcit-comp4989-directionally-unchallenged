# Spatial retrieval for SE12, SW03, SW05 and SW01

A caller can resolve a complete identifier to source pages and printed positions, inspect nearby labels and drawing doors, and query the published route data for mapped passages. The photo pipeline uses exact plan labels after the configured provider reads the image. Visitor routes use the index to find destination candidates and calculate directions over generated walking areas plus mapped transfers. A source label does not create a navigable doorway, corridor or floor transition by itself.

Both SW05 PDFs are included in the pilot evidence inventory. Their 841 OCR readings are retained with the source hashes. Transcriptions distinguish 2895, 2875 and 2825 on floor 2 and flag conflicting OCR at the corresponding printed positions. The four-building bundle contains 17,500 OCR readings on 14 sheets. [SW05 floor 1](https://www.bcit.ca/files/facilities/campusdev/pdf/floorplans/sw/bsw0501.pdf) · [SW05 floor 2](https://www.bcit.ca/files/facilities/campusdev/pdf/floorplans/sw/bsw0502.pdf)

## Try a lookup

```sh
npm run spatial:query -- resolve_spatial_labels '{"purpose":"destination","labels":["SW03 2605"]}'
npm run spatial:query -- resolve_spatial_labels '{"purpose":"origin","labels":["S300","302"]}'
npm run spatial:query -- get_spatial_context '{"planId":"SW3-F2-p1","bounds":[0.50,0.34,0.61,0.48]}'
npm run spatial:query -- get_spatial_coverage
```

| Input | Result in the published data |
|---|---|
| `SW03 2605` | SW03 floor 2 classroom. Two door symbols adjoin the 2600 corridor. The door opposite vestibule 2604 has a bidirectional walking approach from the east elevator. The other door remains unbound. |
| `SW03 1710` | SW03 floor 1 lecture room. Both the lobby-1602 and corridor-1700 doorways have reviewed incoming approaches from S160. |
| `SW03 3615` | SW03 floor 3 classroom. The door opposite vestibule 3604 has a reviewed bidirectional approach along corridor 3600. |
| `SW01 2004` | SW01 floor 2 classroom. The source shows a door on corridor 2000. |
| `SE12 101N` | SE12 floor 1 conference room, with bounds on the original portrait sheet. |
| `S300` | Ambiguous across SE12 and SW01. Both candidates have source references. |
| `SW03 2458` | Unsupported. No admissible exact occurrence in these plans. |
| `SW01 302` | Unsupported. One OCR pass dropped the final digit from `3021`. Its observation remains available with the source correction. |

## Server contract

Import `pilotToolDeclarations` and `runPilotTool(name, args)` from `server/pilot-tools.ts`. The declarations contain JSON input schemas. The executor validates arguments, performs deterministic reads and uses no provider quota.

- `resolve_spatial_labels` takes a purpose, one or more labels and optional building/floor scope. `SW1`/`SW01` and `SW3`/`SW03` are building aliases. Every digit, prefix, suffix, internal hyphen and leading zero of a label is significant. Bare identifiers are searched across the pilot. The resolver returns all occurrences, their source reference, normalized page bounds, original PDF hash, method, space use when transcribed, and any associated drawing door. An exact reviewed checkpoint alias is returned separately. Queries with no evidence return `unsupported`. Other outcomes distinguish a unique candidate, ambiguity, partial evidence and inconsistent floors.
- `get_spatial_context` takes a plan ID and a nonempty normalized rectangle. It retrieves intersecting text observations as well as drawn doors, reviewed checkpoints and open passage questions in that region. It retains title-block and contradicted observations with their dispositions. Those records remain inspectable when an identifier lookup abstains.
- `get_reviewed_neighbors` takes a checkpoint UUID and returns the allowed outgoing steps with the next checkpoint, edge ID, graph revision, direction, cost if measured, and review basis. The result reports `unsupported-checkpoint` for an unknown UUID. This supports internal graph inspection. Visitor route calculation uses eligible checkpoints and reviewed connections for both indoor travel and building transfers.
- `get_spatial_coverage` returns per-floor counts, original source references and graph coverage. It also exposes the applicable floor-service observation and count of unreviewed passage questions.

Photo-label retrieval remains exact and source-bound. The visitor planner resolves destination text to source labels, selects among matching occurrences automatically, and asks the configured provider to generate a route from the photo-derived starting area. Room doors and corridor segments do not need manual route bindings. Only inter-building transfers are constrained to mapped connections. Tool output, including extracted text and generated route points, is treated as untrusted until it passes source and route validation.

## Coverage at network revision 82

The twelve pages contain 4,641 original geometry labels, 16,659 additional OCR observations and 378 source-read labels. OCR includes fragments, annotations, repeated readings and recognition errors. Grouping room-shaped identifiers by page gives 1,388 candidates after occurrence-specific source corrections. Counts include service spaces. The total number of actual rooms on campus remains unmeasured.

| Building | Floors | Identifier candidates by floor 1 / 2 / 3 / 4 | Source-read labels | Drawn door symbols | Approved checkpoints |
|---|---|---|---:|---:|---:|
| SE12 | 1–4 | 45 / 74 / 72 / 75 | 125 | 9 | 16 |
| SW03 | 1–4 | 48 / 118 / 76 / 81 | 126 | 8 | 23 |
| SW01 | 1–4 | 249 / 235 / 206 / 109 | 127 | 5 | 53 |

The SE12 floor 3 annotations include one drawn doorway for room 302 and two for room 320. They are bound to the original sheet and supply page positions for comparing photo regions. Room 302 also has a source-traced corridor frontage between its doorway and the exterior boundary. Doorway details for photo comparison are generated from each eligible door throughout the pilot. The individual room annotations do not grant route access.

SW03 floor 2 includes the office label 2082 and its drawing door on corridor 2000. Separate review questions bind this door and the 302 door on SE12 floor 3 to their respective existing checkpoints. Both room approaches have current bidirectional approvals in revision 41. The 2082 approach now begins at the corrected east entrance beside 2696/S260 and follows corridors 2600 and 2000.

The revision 82 export contains 92 approved points and 63 passages. Fifteen corridors have original-page traces, including the approaches to SE12 room 302, SW03 rooms 2082, 2605 and 3615, and both doors to 1710. The second-, third- and fourth-floor SE12 crossings meet the east side of SW03. The SW03 east elevator and S360/S460 stair connect floors 3 and 4. In SE12, four approved stair chains serve floors 2–4. The SE12 floor 2–3 elevator inquiry remains a floor-service report.

The current route data includes crossings between SW03 and SW01 on floors 1–4. Floor 1 joins the lobby 1602 doors to vestibule 1098 via outdoors; floors 2–4 use indoor passages. These are cross-building links in the fixed route dataset.

## Rebuild and maintain

1. Install Python with Pillow, Poppler's `pdftoppm`, Tesseract and its English data. The shipped JSON supports normal Node runtime use without Python. Rebuild the optical layer with `python3 scripts/prepare_pilot_labels.py`. The generator verifies the twelve original PDF hashes, renders at 300 and 400 dpi, reads multiple orientations, and transforms every accepted word box back to the original top-left page coordinates. A second RGB pass at 400 dpi captures strokes that rasterize differently in grayscale. Engine and renderer versions are stored alongside the results.
2. Update `plan-annotations.json` from the official PDF page when adding a source-read label, a plan-use classification or a door symbol. The broad drawing rectangle separates marginal sheet text. A correction applies to one wrong reading at one page region and cites the transcribed printed value. Source hash changes require a new review. All 12 floors have source-read samples. The initial review used enlarged original PDF regions, including rotated details for SE12 floor 1.
3. To update the approved network, run `node --import tsx scripts/export-pilot-network.ts /path/to/private/topology.json data/campus/spatial`. The exporter checks content-bound approvals, endpoint versions, source hashes and withdrawals. The published projection uses allowlisted data fields and omits raw review history, reviewer names, timestamps and free-text evidence notes. A source-document fingerprint and record review hashes support auditing against a private copy. Confirmed candidate bindings include the A/B node IDs and definition and presentation hashes. A fresh checkout imports these receipts to enable the same reviewed corridors and room doors. Treat each export as a versioned snapshot and re-export after review changes.
4. Corridor traces and exact room-door bindings determine visitor route coverage. The visitor planner uses the current approved graph, preserving source hashes, endpoint versions and permitted directions. Missing records produce a coverage result without a generated fallback.
5. Run `npm run data:validate`, `npm run test:unit` and `npm run build`. Restart a running server after replacing the assets. These tests exercise retrieval, data integrity and mocked photo requests. Physical localization accuracy requires independent campus photos and ground truth.

All plan references, label positions and door annotations are derived from © British Columbia Institute of Technology. Original PDF files, hashes and use conditions are listed in the existing manifest. [BCIT floor plans](https://www.bcit.ca/facilities/campus-maps/floor-plans/) · [Source-data notes](data.md)
