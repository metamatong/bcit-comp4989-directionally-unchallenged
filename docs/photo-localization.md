# Photo evidence and source localization

The visitor workflow uses the photograph in one vision stage. Every later request uses structured evidence and saved source records.

## Extraction

The browser prepares one full view and four overlapping detail crops directly from the original image. Selection stays local. **Go** sends the consented bundle to `POST /api/sessions/:id/photo/evidence`. The configured provider receives these views without map hints or the destination.

The bounded result contains exact labels, clarity, source view, label kind and sign placement. Kinds distinguish room and landmark signs, explicitly printed building identifiers and explicitly printed floor numbers. Placement distinguishes door signs, directional signs and other/unknown contexts. Structured features record visible door count, window side relative to the photo and corridor shape. Unclear fields remain null or unknown.

Exact identifiers preserve all digits, prefixes, suffixes and leading zeroes. Labels are not derived from expected room numbering. A strict OpenAI schema bounds the response, and application validation rejects unusable or incomplete output. Explicit transport recovery shares the extraction deadline.

## Evidence receipt and location

The server retains an image-free, session-bound receipt containing the image/crop fingerprint, extracted fields, source scope and expiry. It releases request media bytes after extraction. Receipts expire after five minutes and are invalidated by a new extraction or reset.

`POST /api/sessions/:id/photo/location` accepts a request UUID, current session revision, evidence ID and optional GPS-derived building hint. It rejects photos, crops and client-supplied extracted labels. The `/photo` alias accepts the same metadata-only request. Requests are serialized by the existing session lease and remain idempotent by stage/request ID.

The resolver narrows the candidate buildings using explicit building/floor signage and any fresh device building matches. It compares every clear nondirectional room or landmark reading against the supplied records, preserving the full identifier. It automatically selects a single place only when all those readings agree. Direction signs remain visible as context.

When a second reading is missing from the catalogue or disagrees with the location, a supported doorway can be offered for explicit confirmation. Competing supported doorway signs on disjoint floors cannot silently select either floor. For example, a reported `323` and `98` with a device match for SE12 offers SE12 floor 3 room 323 and explains the unmatched reading. The navigation endpoint requires the visitor to select the candidate first. The visitor can also reject it and take another photo. The evidence panel shows the actual readings and the provider’s reported clarity.


Window and corridor features remain visible observations because most source records lack equivalent semantic annotations. The resolver rejects an internally contradictory zero-visible-door result paired with a door-attached sign. It does not infer a camera heading, scale, distance or exact physical position from the photo features.

## Optional GPS

The unchecked-by-default photo option confirms the visitor is currently at the photographed location. After extraction, the browser requests a fresh reading and compares its accuracy area with official building footprints. Raw latitude/longitude stay in browser memory. The location request sends only matching building IDs, accuracy, capture time and the footprint hash.

The server validates freshness and map provenance before applying building scope to the source evidence. A valid matched footprint with no usable sign returns a building-only result with no floor, doorway or route. Contradictory building evidence remains unresolved. GPS failure is displayed, while unique label evidence can still resolve a place. [Device lifecycle](device-location.md)

## Navigation and rendering

`POST /api/sessions/:id/navigation` resolves the destination and computes a route over current approved graph points and connections, respecting source hashes, endpoint versions and direction. Source corridor bends produce the walking lines. The visitor planner includes source-derived floor cells and explicit door crossings. [Floor routing](floor-routing.md) Missing endpoints or connections produce a coverage gap.

Location lookup, navigation and drawing the arrows make no provider requests. Relevant source plans are loaded only for displaying the result. Legacy visual-comparison helpers are outside the visitor request path.

## Verification

Tests cover a single provider stage, metadata-only lookup, exact identifier boundaries, directional-sign abstention, source doorway ambiguity, GPS consent/freshness/conflict, session/evidence binding, stale writes, retries and cancellation. Normal visitor API tests use a provider that rejects every operation except evidence extraction. Browser tests assert that only the extraction request carries media. Live checks and mocked GPS tests are recorded separately in the [verification record](verification.md).

## Door plaques and direction signs

The evidence prompt distinguishes room-identification plaques beside or above a visible doorway, including projecting plaques, from signs whose visible arrows or wording direct travel to another location. Mounting orientation alone is not a direction. Unclear placement remains unknown. Directional-only evidence still cannot establish the starting doorway.

## Label recognition and starting-route coverage

A source occurrence binds its printed label and bounds to the original PDF and compiled graph. The printed bounds locate the sign on the drawing. Walking starts use a door or a point in the signed corridor. SE12 323 has two marked approaches to its window corridor. Selecting a door uses the current session evidence without sending another image.

The app distinguishes a missing doorway, a doorway awaiting a public approach, and a missing connection between known approaches. A fallback model is recorded with the extraction and does not affect routing.
