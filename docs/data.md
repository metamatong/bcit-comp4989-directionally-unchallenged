# Source data, preprocessing and coverage

## Official sources and restrictions

The only floor-plan collection used is [BCIT Facilities: Floor Plans](https://www.bcit.ca/facilities/campus-maps/floor-plans/). The importer discovers links from that page and accepts only the Burnaby NE, NW, SE and SW filename/directory patterns. It does not construct unobserved PDF URLs or ingest other campuses. The separate CARI section is excluded.

The source library includes **89 floor-plan PDFs across 45 buildings** plus the [Burnaby Campus Wayfinding PDF](https://www.bcit.ca/files/maps/pdf/bcit_wayfinding.pdf), linked from [BCIT Campus Maps & Wayfinding](https://www.bcit.ca/facilities/campus-maps/). Downloaded on **October 15, 2026**. Each entry in `data/campus/manifest.json` records URL, source index, retrieval time, SHA-256, relative file path, attribution, and review status. The saved index HTML also has a hash.

© British Columbia Institute of Technology. BCIT's stated reuse conditions limit copies to informational, non-commercial use, require its copyright notice, prohibit modifications to the source content, and permit revocation. Other uses need permission. Original PDFs are preserved byte-for-byte; derived research annotations are separate and are not presented as revised official plans. Review permission before wider distribution or commercial use. [BCIT copyright terms](https://www.bcit.ca/copyright/).

BCIT describes the plans as general information and does not warrant their accuracy or completeness. “Official source” therefore means provenance, not physical verification. The app links the unmodified originals and shows the attribution in its source library.

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

| Layer | Files | Meaning |
|---|---|---|
| Source images/documents | `data/campus/raw/*.pdf` | 90 unmodified official files |
| Acquisition/provenance | `manifest.json`, `floor-plans-source.html` | URLs, dates, hashes, rights and source evidence |
| Searchable evidence | `text/*.json`, `catalogue.json` | Text method, page sizes, label candidates, boxes and `sourceRef` |
| Campus records | `coverage.json`, `landmarks.json` | Building/floor catalogue; no promoted verified room/entrance/transition records yet |
| Campus topology | `data/campus/graph.json` | Empty until connections are reviewed and validated |

Floor-plan coordinates use PDF points with a top-left origin. There are no geographic coordinates, measured distances, inferred scale, or cross-floor alignment. Raw drawing primitives remain unclassified.

A limited visual source review inspected SE12 floor 1, SW1 floor 1 and the campus wayfinding map. No complete set of campus entrances, corridor connections or accessibility properties is verified. Walking routes are unavailable. Fictional routing data and controls have been removed at the user's request.

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

## Correct and extend records

Inspect extracted labels and geometry against the original PDFs before promoting them to reviewed records. Keep source ID, page/region, review date, reviewer and the exact observation. Original PDFs must remain unchanged. Regenerate derived visual assets with `python scripts/prepare_visual_maps.py --workers 3`, then run `npm run data:validate` and the relevant tests.

Future walking edges need independently reviewed endpoints, passages, transitions, restrictions, scale/cost assumptions and accessibility evidence. Keep unknown values unknown. Campus graph/landmark files remain empty; filling them does not automatically enable directions. A source refresh requires reviewing changed hashes and dependent records. Do not infer doors or adjacency from nearby OCR text alone.

## Visual and geometry conversion

All 89 floor-plan PDFs now also have full PNGs, bounded overviews, four overlapping crops, and structured geometry JSON under `data/campus/visual/`. Eight labeled overview sheets support coarse visual comparison. The corpus contains 566,620 extracted line/rectangle/curve primitives, explicitly unclassified. Source and derived hashes are checked by `npm run data:validate`. No room polygon, door, window, scale, accessibility property or walking edge is invented from those paths. The actual photo is compared with source images and sampled geometry, producing unverified region hypotheses rather than verified campus landmarks. See [photo-localization.md](photo-localization.md) for schema, conversion commands, scope and privacy.
