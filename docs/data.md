# Source data, preprocessing and coverage

The visitor catalogue and walking grids are compiled from all 89 sheets. See [floor routing](floor-routing.md) for source inputs, regeneration, coverage and the distinction between a printed sign, a doorway and a connected approach.


## Official sources and restrictions

The only floor-plan collection used is [BCIT Facilities: Floor Plans](https://www.bcit.ca/facilities/campus-maps/floor-plans/). The importer discovers links from that page and accepts only the Burnaby NE, NW, SE and SW filename/directory patterns. It does not construct unobserved PDF URLs or ingest other campuses. The separate CARI section is excluded.

The internal source dataset includes **89 floor-plan PDFs across 45 buildings** plus the [Burnaby Campus Wayfinding PDF](https://www.bcit.ca/files/maps/pdf/bcit_wayfinding.pdf), linked from [BCIT Campus Maps & Wayfinding](https://www.bcit.ca/facilities/campus-maps/). Downloaded on **October 15, 2026**. Each entry in `data/campus/manifest.json` records URL, source index, retrieval time, SHA-256, relative file path, attribution, and review status. The saved index HTML also has a hash.

© British Columbia Institute of Technology. BCIT's stated reuse conditions limit copies to informational, non-commercial use, require its copyright notice, prohibit modifications to the source content, and permit revocation. Other uses need permission. Original PDFs are preserved byte-for-byte; derived research annotations are separate and are not presented as revised official plans. Review permission before wider distribution or commercial use. [BCIT copyright terms](https://www.bcit.ca/copyright/).

BCIT describes the plans as general information and does not warrant their accuracy or completeness. “Official source” therefore means provenance, not physical verification. Location results link their relevant original plans and show attribution; there is no general source browser.

## Regenerate the dataset

Python 3.10+ is required only for data/proposal tooling. Create a virtual environment and install `requirements-data.txt`. Install a local Tesseract executable for OCR of outlined/scanned PDFs (for example `brew install tesseract` on macOS). The browser does not run OCR; this executable is used only for optional source-PDF preprocessing.

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-data.txt
python scripts/prepare_maps.py                 # Reuse existing PDFs; extract text/OCR
python scripts/prepare_maps.py --refresh       # Refresh official index and source copies
python scripts/prepare_maps.py --extract-only  # Re-extract only, verify stored hashes first
npm run data:validate
```

A download is first written to a `.part` file, checked for a PDF header, and then moved to its destination. Four parallel download workers use retries/timeouts. Extraction is local and sequential. Existing source retrieval dates are preserved unless a source is refreshed. Failed downloads stop the run rather than filling in invented records.

`pdfplumber` extracts embedded words and bounding boxes. When a page has no embedded text, local Tesseract reads a 150 dpi raster with sparse-text segmentation; low-confidence words are excluded. OCR boxes are mapped back into PDF point coordinates. Temporary rasters are deleted. Without Tesseract, empty pages are flagged for later OCR instead of silently labeled searchable. Restart the app after regenerated JSON is written.

The delivered run used OCR on 80 documents, produced **1,045 numeric/alphanumeric label candidates**, and still has two empty-text documents: **NW6-F1** and **SW9-F2**. Candidates can include dimensions, dates, or OCR errors; they are **not 1,045 verified rooms**. Search results remain excerpts, not asserted room identities. The unmodified PDFs are usable even when text extraction fails.

## Data layers

The pilot spatial evidence under `data/campus/spatial/` includes additional OCR, transcriptions, door symbols and reviewed passages. [Pilot data, regeneration and coverage](spatial-retrieval.md)

| Layer | Files | Meaning |
|---|---|---|
| Source images/documents | `data/campus/raw/*.pdf` | 90 unmodified official files |
| Acquisition/provenance | `manifest.json`, `floor-plans-source.html` | URLs, dates, hashes, rights and source evidence |
| Searchable evidence | `text/*.json`, `catalogue.json` | Text method, page sizes, label candidates, boxes and `sourceRef` |
| Campus records | `coverage.json`, `landmarks.json` | Building/floor catalogue; no promoted verified room/entrance/transition records yet |
| Legacy campus placeholders | `data/campus/graph.json`, `landmarks.json` | Empty; not consumed by the topology editor or its route checker |
| Reviewed topology | `data/campus/topology.json` | Human-confirmed points/connections, original source hashes, evidence and version-bound review history |
| Connection proposals | `data/campus/connection-candidates.json` | Source-bound questions for the four pilot buildings, with separate confirmation and direction records |

Floor-plan coordinates use PDF points with a top-left origin. `data/campus/geolocation/floor-alignment-evidence.json` binds exterior corners or stacked features to the official drawings and geographic source. The compiler produces approximate GPS overlays for 65 of 89 plans and records the gaps on the remaining 24. Indoor GPS accuracy and routing distances remain unmeasured. Raw drawing primitives remain unclassified. [Geographic provenance and coverage](device-location.md)

A limited visual source review inspected SE12 floor 1, SW1 floor 1 and the campus wayfinding map. No complete set of campus entrances, corridor connections or accessibility properties is verified. Visitor routes are generated from official floor plans; only mapped building connections constrain transfers. Fictional routing data and controls have been removed at the user's request.

## Downloaded building/floor coverage

The following is **document coverage**, not routing support. `coverage.json` is the machine-readable source.

| Building | Downloaded floors |
|---|---|
| NE1 | 1, 2, 3, 4 |
| NE10 | 1 |
| NE12 | 1, 2 |
| NE16 | 1 |
| NE18 | 1 |
| NE2 | 1, 2 |
| NE20 | 1, 2 |
| NE21 | 1 |
| NE22 | 1 |
| NE23 | 1 |
| NE24 | 1 |
| NE25 | 1, 2, 3 |
| NE28 | 1 |
| NE3 | 1, 2 |
| NE4 | 1, 2 |
| NE6 | 1, 2 |
| NE7 | 1 |
| NE8 | 1, 2 |
| NE9 | 1, 2 |
| NW1 | 1 |
| NW3 | 1, 2 |
| NW4 | 1, 2, 3, 4 |
| NW5 | 1, 2 |
| NW6 | 1, 2 |
| NW7 | 1 |
| SE1 | 1, 2 |
| SE10 | 1, 2 |
| SE12 | 1, 2, 3, 4 |
| SE14 | 1, 2, 3 |
| SE16 | 1 |
| SE2 | 1, 2, 3 |
| SE30 | 1 |
| SE4 | 1 |
| SE40 | 1, 2 |
| SE41 | 1, 2 |
| SE42 | 1, 2 |
| SE50 | 1 |
| SE6 | 1, 2, 3 |
| SE8 | 1, 2 |
| SE9 | 1 |
| SW1 | 1, 2, 3, 4 |
| SW2 | 1, 2, 3 |
| SW3 | 1, 2, 3, 4 |
| SW5 | 1, 2 |
| SW9 | 1, 2 |

## Route records and extension

The visitor router uses fixed records for crossings between buildings. It infers vertical transfers at runtime from the source landing inventory in SE12, SW03 and SW01. For SW05 it derives the landings and stair pairs from the two registered floor drawings. The published dataset also preserves the earlier hand-authored vertical records for provenance.

The published route snapshot contains 103 points and 71 connections at revision 91. SW03 and SW05 connect on floor 1. Visitors can walk outdoors in both directions between the south doors of SW03 lobby 1602, beside corridor 1604 and stair S170, and the main doors of SW05 lobby 1800. Routes from SW05 floor 2 use the internal stairs to reach this crossing. Other supplied plans have searchable labels and generated walking areas, but floor-to-floor links are not universally available. Do not infer a physical connection from matching labels alone. [SW01 source records and coverage](sw01-routing.md)

SW05 room 1840 shares the public entrance at vestibule 1843, and room 1850 shares the entrance at 1853. The project user confirmed that the west, centre and east exterior lecture doors open only from inside. Their drawn leaves carry `exteriorAccess: "exit-only"` in the source annotations. Indoor room stops use the vestibules. The published-network validator permits a directional departure at a marked exterior exit and rejects a crossing that would bring visitors back through that exit.

Rebuild derived assets from the official plans and preserve their source hashes. The building GPS footprint layer and the per-floor geographic alignments have separate provenance. See [device-location coverage](device-location.md).

## Visual and geometry conversion

All 89 floor-plan PDFs now also have full PNGs, bounded overviews, four overlapping crops, and structured geometry JSON under `data/campus/visual/`. Eight labeled overview sheets support coarse visual comparison. The corpus contains 566,620 extracted line/rectangle/curve primitives, explicitly unclassified. Source and derived hashes are checked by `npm run data:validate`. No room polygon, door, window, scale, accessibility property or walking edge is invented from those paths. The actual photo is compared with source images and sampled geometry, producing unverified region hypotheses rather than verified campus landmarks. See [photo-localization.md](photo-localization.md) for schema, conversion commands, scope and privacy.

Geometry hashes cover exact UTF-8/LF bytes. Windows CRLF conversion changes those hashes and prevents comparison after photo-label reading. `.gitattributes` enforces LF for geometry checkouts and disables text conversion for PDFs/PNGs; the visual generator writes UTF-8/LF bytes explicitly. Restore altered files from the unchanged source assets or regenerate them, then run `npm run data:validate` and restart the server. Do not update expected hashes merely to accept changed checkout bytes or relax runtime verification.


## Complete label retrieval

Runtime lookup indexes every label in the geometry files' full `labels` arrays (5,463 extracted labels in the included corpus). This includes annotations and unreviewed OCR/PDF text; it is not a verified room count. Exact whole-identifier equality preserves leading zeroes, suffixes and all digits. The SE12 third-floor `302` label is included even though the older `modelSummary.labels` preview omitted it after 80 entries.

`planGeometrySummary` also replaces that legacy preview with all source labels when preparing model input. The regeneration script writes complete summaries going forward. Existing PDFs, PNGs and geometry files remain byte-for-byte unchanged for this fix; their full label arrays already contain the needed data. `npm run data:validate` checks index completeness alongside source hashes.
