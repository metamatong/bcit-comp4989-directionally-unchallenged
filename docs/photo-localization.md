# Photo evidence and source localization

The visitor workflow uses the photograph in one vision stage. Later requests use structured evidence and source records.

## Extraction

The browser prepares one full view and four overlapping detail crops from the original image. Selection stays local. **Get Directions** sends the photo bundle to `POST /api/sessions/:id/photo/evidence`. The configured provider receives the views without map hints or the destination.

The bounded result contains exact labels, clarity, source view, label kind and sign placement. Kinds distinguish room and landmark signs, explicitly printed building identifiers and explicitly printed floor numbers. Placement distinguishes door signs, directional signs and other/unknown contexts. Structured features record visible door count, window side relative to the photo and corridor shape. Unclear fields remain null or unknown.

Exact identifiers preserve all digits, prefixes, suffixes and leading zeroes. Labels are not derived from expected room numbering. Application validation rejects unusable or incomplete output.

## Evidence receipt and automatic starting match

The server retains an image-free, session-bound receipt containing the image/crop fingerprint, extracted fields, source scope and expiry. It releases request media bytes after extraction. Receipts expire after five minutes and are invalidated by a new extraction or reset.

`POST /api/sessions/:id/photo/location` accepts a request UUID, current session revision, evidence ID and optional GPS-derived building hint. It rejects photos, crops and client-supplied extracted labels. When GPS is available, the browser computes building candidates from official footprints and keeps raw coordinates locally; when GPS is unavailable, the request omits `gps` and resolves across the four pilot buildings from photo evidence alone.

The resolver uses available GPS to narrow the building candidates, then ranks exact source matches using the photo labels, sign placement and available floor evidence. It selects the strongest source-linked estimate automatically. The visitor is not asked to confirm a starting room, doorway or corridor. If GPS succeeds outside the pilot footprints or contradicts the photo, or if no usable source match remains, the app explains the gap and offers a new photo.

GPS can narrow a building but cannot distinguish floors within that building. The photo and exact source labels provide floor evidence. When multiple floors remain plausible, the implementation ranks photo matches and takes the top match; the current data does not provide an indoor GPS signal that could independently resolve the floor. Building footprints and per-floor drawing alignment are separate coverage layers. [Device-location coverage](device-location.md)

Window and corridor features remain observations because most source records lack equivalent semantic annotations. The resolver rejects contradictory evidence, such as a clear door-attached sign combined with a reported zero visible doorways. It does not infer camera heading, scale, distance or exact physical position from photo features.

## Navigation

`POST /api/sessions/:id/navigation` resolves the destination and searches source-derived floor walking areas plus mapped transfers. No start-selection endpoint or starting-map-point picker is exposed. A missing starting approach or route remains a coverage gap and does not trigger a manual approval flow.

## Remaining source limits

The public visitor UI and API no longer expose a connection-review editor. Current route coverage still depends on the source-bound connections present in the published route dataset. Replacing same-building hand-authored transfer records with automatic transfer inference requires floor-to-floor geometric correspondence in the source data; that correspondence is not present for every plan. Cross-building links remain fixed developer-maintained data.
