# Photo evidence and source localization

The visitor workflow uses the photograph in one vision stage. Every later request uses structured evidence and saved source records.

## Extraction

The browser prepares one full view and four overlapping detail crops directly from the original image. Selection stays local. **Go** sends the consented bundle to `POST /api/sessions/:id/photo/evidence`. The configured provider receives these views without map hints or the destination.

The bounded result contains exact labels, clarity, source view, label kind and sign placement. Kinds distinguish room identifiers, explicitly printed building identifiers and explicitly printed floor numbers. Placement distinguishes door signs, directional signs and other/unknown contexts. Structured features record visible door count, window side relative to the photo and corridor shape. Unclear fields remain null or unknown.

Exact identifiers preserve all digits, prefixes, suffixes and leading zeroes. Labels are not derived from expected room numbering. A strict OpenAI schema bounds the response, and application validation rejects unusable or incomplete output. Explicit transport recovery shares the extraction deadline.

## Evidence receipt and location

The server retains an image-free, session-bound receipt containing the image/crop fingerprint, extracted fields, source scope and expiry. It releases request media bytes after extraction. Receipts expire after five minutes and are invalidated by a new extraction or reset.

`POST /api/sessions/:id/photo/location` accepts a request UUID, current session revision, evidence ID and optional GPS-derived building hint. It rejects photos, crops and client-supplied extracted labels. The `/photo` alias accepts the same metadata-only request. Requests are serialized by the existing session lease and remain idempotent by stage/request ID.

`label-localization.ts` searches complete source identifiers, using every clear nondirectional room label to constrain the source floor. Explicit building and floor labels constrain that search. Door-sign placement identifies the relevant label when several observations are present. Directional labels remain evidence without establishing the current doorway. A unique matching source doorway supplies an estimated vicinity. A source label with an ambiguous or missing doorway is shown without inventing a route origin. Conflicting, uncertain and unsupported evidence produces an unresolved result.

Window and corridor features remain visible observations because most source records lack equivalent semantic annotations. The resolver rejects an internally contradictory zero-visible-door result paired with a door-attached sign. It does not infer a camera heading, scale, distance or exact physical position from the photo features.

## Optional GPS

The unchecked-by-default photo option confirms the visitor is currently at the photographed location. After extraction, the browser requests a fresh reading and compares its accuracy area with official building footprints. Raw latitude/longitude stay in browser memory. The location request sends only matching building IDs, accuracy, capture time and the footprint hash.

The server validates freshness and map provenance before intersecting the building candidates with source label matches. GPS narrows buildings and cannot identify floors or route points. Contradictory or outside-pilot readings produce an explicit unresolved result. GPS failure is displayed, while unique label evidence can still resolve a place. [Device lifecycle](device-location.md)

## Navigation and rendering

`POST /api/sessions/:id/navigation` resolves the destination and computes a route over current approved graph points and connections, respecting source hashes, endpoint versions and direction. Source corridor bends produce the walking lines. The visitor objective minimizes recorded connection count. Missing endpoints or connections produce a coverage gap.

Location lookup, navigation and drawing the arrows make no provider requests. Relevant source plans are loaded only for displaying the result. Legacy visual-comparison helpers are outside the visitor request path.

## Verification

Tests cover a single provider stage, metadata-only lookup, exact identifier boundaries, directional-sign abstention, source doorway ambiguity, GPS consent/freshness/conflict, session/evidence binding, stale writes, retries and cancellation. Normal visitor API tests use a provider that rejects every operation except evidence extraction. Browser tests assert that only the extraction request carries media. Live checks and mocked GPS tests are recorded separately in the [verification record](verification.md).
