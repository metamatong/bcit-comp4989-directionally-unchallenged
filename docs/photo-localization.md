# Photo labels, exact retrieval and floor-plan localization

The app uses the actual photo and detailed views in two separate API stages. Gemini reads visible evidence first, a deterministic tool retrieves exact labels from all available source records, and a later Gemini call compares the photo against the retrieved plans. There is no training step or general Campus library screen.

## User flow

1. Upload or capture a photo. The browser prepares a full view and four overlapping detail crops from the **original decoded image**, before discarding original metadata.
2. Consent once to sending this photo and its detail views, then select Analyze.
3. The client calls the label-reading endpoint and shows progress while Gemini reads visible identifiers.
4. The client sends the same image bundle with the returned evidence ID to the location endpoint. Relevant source plans appear only with the resulting hypothesis.
5. Confirm a region only if it agrees with the surroundings. The model can abstain and ask for another photo.

The local server must be restarted after backend edits. Frontend HMR does not reload Node. Existing converted source files work without regeneration.

## API stages and agent tools

| Stage | Endpoint | Behavior |
|---|---|---|
| Read photo labels | `POST /api/sessions/:id/photo/evidence` | Gemini receives only the full photo and four photo crops, with no candidate plan IDs or drawings to bias its reading. The forced `read_photo_labels` tool returns complete room identifiers, clear/uncertain flags, source view IDs and brief observable scene features. No location is selected. |
| Retrieve and localize | `POST /api/sessions/:id/photo` | Requires the first stage's server-issued `evidenceId`, the next session revision and the identical image/context bundle. The server executes `retrieve_room_labels`, fetches matching plan details, and asks Gemini to verify a single supported region or abstain. |

Both endpoints require per-photo consent, a new request UUID, current revision, the full image and four detail crops. Idempotency is scoped to each API stage; both stages use the same per-session lock. The second endpoint rejects absent, cross-session, expired or changed-photo evidence before model work. Clients cannot supply their own trusted label readings.

The first response places short-lived structured evidence in `session.photoEvidence`. Its ID is valid for five minutes. A private in-memory SHA-256 fingerprint binds it to that session's full image, crops, crop bounds and optional context. The fingerprint and media bytes are never returned in session state. Only the structured readings and fingerprint are held between requests; no image bytes are retained. The cleanup sweep runs once a minute. Reset, newer successful label reading, or a successful location result invalidates the previous receipt.

If comparison fails, its partial source/region hypotheses roll back while the already accepted first-stage evidence remains valid until expiry. The browser can retry comparison without spending another label-reading call for the same prepared image. Replacing or closing the photo clears its local reuse reference.

This is a bounded observe → retrieve → verify workflow. The model chooses the observed label queries; source lookup is deterministic; the next model stage must use those tool results and the actual imagery. Observable activity records each stage without hidden reasoning.

## Exact label lookup

`server/room-labels.ts` indexes **all 5,463 currently extracted source labels** from the complete `geometry.labels` arrays across the 89 plans. This is a count of source labels, including annotations, not 5,463 verified rooms. Extraction is incomplete in some PDFs.

Lookup normalizes Unicode compatibility forms, letter case and whitespace. It preserves digits, leading zeroes, letters, prefixes, suffixes and punctuation. It never performs substring, prefix, numeric or fuzzy matching. Thus `302`, `3021`, `0302`, `302A`, `A302`, `3O2` and `302-1` are distinct identifiers.

The SE12 third-floor `302` label is at index 155 in its full 285-label list. The old first-80-label preview omitted it. Runtime retrieval and model geometry now use the complete `labels` array; legacy `modelSummary.labels` previews are ignored. The regeneration script also writes complete label summaries for future regenerated artifacts. No source PDF or existing PNG/geometry hash needs to change to activate the runtime fix.

Clear exact matches narrow the candidate plans. One to three matching plans go directly to detailed comparison, avoiding the coarse atlas shortlist. Ambiguous matches spanning more plans use an additional visual shortlist over the matching set. Uncertain readings, absent readable labels, or labels with no exact source match retain the visual-shortlist path across eligible plans; signs are not mandatory.

An exact label match alone never produces a location. Gemini must recheck the photo/crops against the supplied drawing and return an explicit `labelMatches` entry. The server verifies whole-label equality, the observed identifier and its presence in the chosen source plan. A proposed `302` → `3021` match is rejected. A label-guided result without a supporting clear exact label is also rejected; abstention remains valid. Missing extracted labels do not prove that a room is absent from the actual campus.

## Photo views and coordinate systems

The client creates a context JPEG with a maximum 1,600-pixel long edge and four detail JPEGs, each also bounded to 1,600 pixels. Detail crops are cut directly from the original bitmap and are not enlargements of the already-resized preview. Each pair of adjacent quadrants overlaps by 10% of the original image dimension. Small images are not upscaled.

Each view is capped at 450,000 encoded JPEG bytes, reducing quality and then size if necessary. This keeps five views within the server's existing 2.5 MB aggregate decoded-media limit and 4 MB JSON request limit. Original uploads remain limited to 8 MB and 50 million pixels. All output views are re-encoded to strip original metadata.

Photo crop coordinates and floor-plan coordinates are separate. Photo crop bounds describe the original uploaded scene. Final location bounds are `[left, top, right, bottom]` in normalized coordinates of the **whole original floor-plan page**, never relative to a photo or plan crop. Source-label text boxes are not camera-position coordinates.

## BCIT source preparation

The corpus contains 89 official Burnaby floor-plan PDFs covering 45 buildings, plus a separate campus map. Each floor plan has a full PNG at 180 dpi, an overview, four overlapping detail PNGs and geometry JSON. Eight overview sheets support visual shortlisting. Source and derived hashes and BCIT attribution are retained. The geometry contains 566,620 raw unclassified drawing primitives; no semantic walls, doors, accessibility or walking connections are invented.

For detailed comparison Gemini receives the full photo and four photo crops again, along with each selected plan's overview, four plan crops, and source-linked geometry containing **every extracted label**. Long drawing segments remain a disclosed sample of up to 128 per plan. All 90 original PDFs and 631 derived asset hashes remain unchanged by this retrieval fix.

```bash
python scripts/prepare_visual_maps.py --workers 3  # Optional source regeneration
npm run data:validate                            # Source, asset and complete-label-index checks
```

Original PDFs remain unmodified. © British Columbia Institute of Technology. See [data.md](data.md) and the manifest for source restrictions.

## Budgets, failures and privacy

A clear exact-label case normally uses two Gemini calls across the two app API requests: photo reading, then detailed comparison. Visual-only or ambiguous-label cases can use a third model call for shortlisting. An empty visual shortlist can abstain without detail comparison. Existing retries, configured Gemini fallbacks and shared minute/day limits still apply to every attempt.

Label reading has a 45-second deadline and a 55-second client timeout. Localization has a 60-second deadline and a 70-second client timeout. Individual model requests allow at most 30 seconds. Reading/shortlisting allow 4,096 combined thinking/output tokens; detailed comparison allows 8,192. Gemini 3 uses low thinking; the adapter maps the photo setting to a 1,024-token thinking budget for Gemini 2.5. Thought summaries remain disabled. Inline provider bodies remain capped at 18 MB.

Uploads/crops stay in client memory until closure/replacement. Both API stages release their media references after processing. The public source cache contains only official plan assets. Google free-tier data handling remains disclosed; the app cannot promise immediate provider deletion. No photo reference dataset or persistent user-image collection has been added.

## Verification and next work

Code/API tests cover the SE12 `302` regression, exact identifier boundaries, complete label inclusion, original-image crop coordinates, per-view/aggregate size budgets, isolated first-stage model input, two API calls, idempotency, evidence binding/expiry/reset, comparison-only retry, cancellation, rollback and retained visual matching without signs. Model responses are mocked. Browser/screen tests are not run per the user's request.

This fixes information loss and prefix confusion in retrieval. It does not establish that Gemini always reads an image correctly or identifies a physical location. Next, evaluate the supplied SE12 photograph and separate SE12/SW1 photographs with known ground truth, then build a small mapped reference-photo collection if appearance-based ambiguity remains. Reference photos and evaluation photos must be separate.

References: [Gemini image inputs](https://ai.google.dev/gemini-api/docs/generate-content/image-understanding), [Gemini thinking settings](https://ai.google.dev/gemini-api/docs/generate-content/thinking), [BCIT floor plans](https://www.bcit.ca/facilities/campus-maps/floor-plans/).
