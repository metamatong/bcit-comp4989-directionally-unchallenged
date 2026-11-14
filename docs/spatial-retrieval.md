# Spatial retrieval for SE12, SW03 and SW01

A caller can resolve a complete identifier to source pages and printed positions, inspect nearby labels and drawing doors, and query the published graph for approved passages. The photo pipeline uses the pilot labels after Gemini reads the image. The visitor form uses the same index to resolve destination text and the live editor graph to confirm that a specific room door can be reached.

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
- `get_reviewed_neighbors` takes a checkpoint UUID and returns the allowed outgoing steps with the next checkpoint, edge ID, graph revision, direction, cost if measured, and review basis. The result reports `unsupported-checkpoint` for an unknown UUID. Use this graph for deterministic path calculation once the user confirms a start and a destination endpoint. Coordinates alone never grant passage.
- `get_spatial_coverage` returns per-floor counts, original source references and graph coverage. It also exposes the applicable floor-service observation and count of unreviewed passage questions.

For origin evidence, confirm the actual image/plan match, then have the user confirm the relevant checkpoint. A destination can resolve to a printed room label before its door has a routable binding. A single room can have more than one drawn door. Ambiguity requires clarification. Tool output, including extracted text, is untrusted evidence.

## Coverage on November 13, 2026

The twelve pages contain 4,641 original geometry labels, 16,659 additional OCR observations and 377 source-read labels. OCR includes fragments, annotations, repeated readings and recognition errors. Grouping room-shaped identifiers by page gives 1,388 candidates after occurrence-specific source corrections. Counts include service spaces. The total number of actual rooms on campus remains unmeasured.

| Building | Floors | Identifier candidates by floor 1 / 2 / 3 / 4 | Source-read labels | Drawn door symbols | Approved checkpoints |
|---|---|---|---:|---:|---:|
| SE12 | 1–4 | 45 / 74 / 72 / 75 | 125 | 9 | 10 |
| SW03 | 1–4 | 48 / 118 / 76 / 81 | 125 | 5 | 12 |
| SW01 | 1–4 | 249 / 235 / 206 / 109 | 127 | 5 | 0 |

The SE12 floor 3 annotations include one drawn doorway for room 302 and two for room 320. They are bound to the original sheet and supply page positions for comparing photo regions. Room 302 also has a source-traced corridor frontage between its doorway and the exterior boundary. Doorway details for photo comparison are generated from each eligible door throughout the pilot. The individual room annotations do not grant route access.

The approved network is an export of editor revision 25. It contains 22 points and 14 bidirectional passages. Four corridors have original-page traces, including the east elevator approaches to rooms 2605 and 3615. Five passages form the continuous SE12 floor 2 → outdoor → SW03 floor 2 corridor → elevator → SW03 floor 3 corridor → SE12 floor 3 journey. The latest SE12 floor 2–3 elevator report is F and is stored as floor evidence. The earlier fourth-floor building passage does not qualify for this revision. No distance has been measured for the five-step journey.

The SW01–SW03 questions on floors 2, 3 and 4 pair visible openings on the official plans for future review. The SW01 markers are near S290, S390 and S490 respectively. The SW03 markers are at the end of the office wing. These questions carry a supporting campus-map URL and hash. They appear in region context with `status: unreviewed` and have no graph edges. Complete room-to-room routing requires more reviewed doors, indoor corridor connections and a confirmed SW01 crossing.

## Rebuild and maintain

1. Install Python with Pillow, Poppler's `pdftoppm`, Tesseract and its English data. The shipped JSON supports normal Node runtime use without Python. Rebuild the optical layer with `python3 scripts/prepare_pilot_labels.py`. The generator verifies the twelve original PDF hashes, renders at 300 and 400 dpi, reads multiple orientations, and transforms every accepted word box back to the original top-left page coordinates. A second RGB pass at 400 dpi captures strokes that rasterize differently in grayscale. Engine and renderer versions are stored alongside the results.
2. Update `plan-annotations.json` from the official PDF page when adding a source-read label, a plan-use classification or a door symbol. The broad drawing rectangle separates marginal sheet text. A correction applies to one wrong reading at one page region and cites the transcribed printed value. Source hash changes require a new review. All 12 floors have source-read samples. The initial review used enlarged original PDF regions, including rotated details for SE12 floor 1.
3. To update the approved network, run `node --import tsx scripts/export-pilot-network.ts /path/to/private/topology.json data/campus/spatial`. The exporter checks content-bound approvals, endpoint versions, source hashes and withdrawals. The published projection uses allowlisted data fields and omits raw review history, reviewer names, timestamps and free-text evidence notes. A source-document fingerprint and record review hashes support auditing against a private copy. Confirmed candidate bindings include the A/B node IDs and definition and presentation hashes. A fresh checkout imports these receipts to enable the same reviewed corridors and room doors. Treat each export as a versioned snapshot and re-export after review changes.
4. For a drawable passage add its original-page bend positions, the candidate definition and source hashes to `corridor-traces.json`. Recheck the source drawing and update the corresponding SHA-256 sidecar. Room approaches carry the exact drawn door ID. The visitor planner checks the current answer, approved edge hash and endpoint positions at request time.
5. Run `npm run data:validate`, `npm run test:unit` and `npm run build`. Restart a running server after replacing the assets. These tests exercise retrieval, data integrity and mocked photo requests. Physical localization accuracy requires independent campus photos and ground truth.

All plan references, label positions and door annotations are derived from © British Columbia Institute of Technology. Original PDF files, hashes and use conditions are listed in the existing manifest. [BCIT floor plans](https://www.bcit.ca/facilities/campus-maps/floor-plans/) · [Source-data notes](data.md)
