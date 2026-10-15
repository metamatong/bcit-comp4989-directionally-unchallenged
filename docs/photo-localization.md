# Photo-to-floor-plan localization

This implements the requested **actual photo + real BCIT plans** workflow. Gemini is the only analysis path. A readable sign, manually selected landmark, or OCR success is not required for Live photo comparison.

## Run and use

The converted assets are already included in `data/campus/visual/`. Restart the existing dev server after these backend changes (`Ctrl+C`, then `npm run dev`); do not start a second server on port 3000.

1. Use Live AI with the configured free-tier Gemini key.
2. Choose Find my location → Upload photo or Take a photo.
3. The browser prepares a resized JPEG preview. It does **not** run OCR in this Live flow.
4. Optionally add context or select a building. Leaving the building blank considers the entire prepared Burnaby collection.
5. Explicitly agree to send this photo and click **Analyze photo against BCIT plans**.
6. Review the photo observations, possible building/floor regions, visual matches, limitations, source PNG and geometry links. Gemini can instead report insufficient evidence and request another view.
7. Confirm a possible region only if it agrees with your surroundings. It remains an unverified estimate; it does not enable an invented campus route.

There is no mode selector, sample-photo control, manual fictional landmark picker or synthetic route. Missing Gemini configuration shows setup guidance, and provider failures retain the real-plan library without fabricating a result.

## Converted data

The pipeline converted all **89 downloaded official Burnaby floor-plan PDFs**, covering 45 buildings:

- 89 full-page PNGs rendered at 180 dpi.
- 89 overviews bounded to a 1,600-pixel long edge.
- 356 detail PNGs: four quadrants per page, each bounded to 1,200 pixels, with overlap covering 10% of the original page width/height.
- 89 structured geometry JSON files with **566,620 extracted drawing primitives** in total.
- Eight labeled overview sheets covering all plans exactly once (12 plans per sheet except the final sheet).
- An index recording source IDs, source PDF hashes, generated asset hashes, page dimensions, crop bounds, building/floor metadata, and attribution. PNG metadata also embeds the BCIT copyright notice, source index and reference-only notice.

The separate campus wayfinding PDF remains in the source library; this conversion targets the 89 floor plans. Generated visual assets occupy approximately 355 MB in this build.

Regenerate locally, with the Python dependencies from `requirements-data.txt`:

```bash
python scripts/prepare_visual_maps.py --workers 3
npm run data:validate
```

The script performs no network or model calls. Original PDFs are verified against their manifest hashes and remain unchanged. PNGs and JSON are derived reference artifacts, not revised official BCIT drawings. © British Columbia Institute of Technology. Source usage conditions remain in `data/campus/manifest.json` and [data.md](data.md).

## Geometry representation

Each JSON file records:

| Field | Meaning |
|---|---|
| `coordinateSystem` | Original page width/height in PDF points, top-left origin; normalized-coordinate divisors; no geographic coordinates or assumed metric scale |
| `primitives` | Extracted line, rectangle and curve objects, points/paths, bounding boxes, stroke/fill properties, stable primitive IDs and page provenance |
| `longSegments` | Longer extracted path segments with normalized endpoints; they may include annotations and are not asserted to be walls |
| `labels` | Embedded text boxes, or existing OCR label candidates when embedded text is absent; explicitly unverified |
| `regions` | The four detail-crop bounds in normalized original-page coordinates |
| `modelSummary` | Counts, up to 128 spatially distributed long segments, and up to 80 labels; omissions and sampling are disclosed |
| `architecturalElements` / `routingEdges` | Empty: no verified walls, doors, windows, room polygons or walkable edges are invented |

The exported geometry is structured **drawing evidence**, not a fully interpreted architectural model. It includes letters/symbols and other nonstructural paths. Gemini sees this limitation and compares the images as well as the geometric evidence. A human review or a dedicated segmentation/localization system is still required before treating semantic geometry or routes as verified.

## The two-step multimodal workflow

`server/photo-localization.ts` is one bounded orchestrator using the existing server-side Gemini adapter.

1. **Visual shortlisting.** Send the actual uploaded image and eight overview sheets to Gemini. A typed `select_floor_plans` function returns up to three eligible real plan IDs plus observable photo features. When a building hint narrows coverage to eight or fewer plans, send their individual overviews instead. This is visual comparison, not an OCR keyword gate.
2. **Detailed comparison.** Send the actual photo again with the selected plans' overviews, all four detail crops per plan, and source-linked JSON geometry summaries. A typed `propose_campus_locations` function returns up to three candidate regions or an abstention.
3. **Validation.** Reject unknown IDs, plans outside the selected scope, malformed function calls, unsupported fields, invalid/inverted coordinates, and inconsistent outcomes. A failed or cancelled comparison discards partial hypotheses.
4. **Confirmation.** Store only structured results and observable action summaries. Confirming a candidate updates `campusLocation`; it does not create route edges.

Candidate boxes are `[left, top, right, bottom]` in normalized coordinates of the **entire original page**, even when the model uses a crop. The UI displays the box over that same original-page overview. Confidence labels are qualitative model judgments, not calibrated probabilities or measured positioning accuracy.

Overview shortlisting is not exhaustive detailed examination of every plan. It may omit the correct plan, particularly when corridors repeat or drawings are old. The UI reports both the number of overview plans considered and the plans inspected in detail. Unknown heading, scale, floor alignment, missing window/door semantics, and appearance absent from a plan remain important limits. No image-only uniqueness guarantee is made.

## Transport, privacy and budgets

`POST /api/sessions/:id/photo` requires an active Live session, explicit per-photo consent, a request UUID, the current session revision, and inline JPEG/PNG/WebP bytes. The upload endpoint accepts a 4 MB JSON body, validates base64 and image signatures, and limits decoded image bytes to 2.5 MB. The browser accepts originals up to 8 MB / 50 million pixels, resizes the long edge to 1,600 pixels, and removes original metadata through local re-encoding.

Only clicking Analyze sends the photo. Neither a configured key nor the default Live mode silently uploads it. Images go transiently to the local server and Google; no photo is stored on disk, in session objects, in activity logs, or in the source-image cache. Google free-tier data handling is disclosed and is governed by Google's terms; the application cannot promise immediate deletion by the provider.

The source-image cache contains only public BCIT assets and is bounded to 24 entries. The provider request body is capped at 18 MB, below the documented 20 MB inline limit. No Files API uploads are used. Normal analysis makes one visual-shortlist request and, if there is a shortlist, one detail request. Existing retry and shared minute/day budgets still apply. Budget failures now report how many seconds remain until the relevant application window can admit a request.

Photo comparisons have a 60-second overall deadline; each model request is bounded to at most 30 seconds. The client allows 70 seconds for transport/cleanup. Closing the panel or replacing a capture cancels client work; server cancellation checks prevent stale results from committing. Provider failures are reported directly; no substitute location is generated.

Both photo stages use low thinking with thought summaries disabled. The selection stage has a 4,096-token combined thinking/output cap; detailed comparison has an 8,192-token cap. This leaves space for the final structured result while bounding generation. A token-truncated or otherwise incomplete response cannot commit a partial hypothesis.

References: [Gemini Generate Content image input](https://ai.google.dev/gemini-api/docs/generate-content/image-understanding), [Gemini function calling](https://ai.google.dev/gemini-api/docs/function-calling), [BCIT floor-plan source](https://www.bcit.ca/facilities/campus-maps/floor-plans/).

## Response limits and recovery

An HTTP 200 from Gemini can still contain an unfinished generation. In the reproduced failure, `MAX_TOKENS` arrived without any answer parts: thinking consumed the earlier 1,800-token allowance. The app previously called this an “unsupported response.” It now reports `response_limit` accurately and uses the larger photo budgets above. See [provider diagnostics](provider.md#incomplete-response-diagnosis-and-handling).

After updating the code, restart the existing server, refresh the app, and retry the photo when provider quota is available. An optional building hint narrows the comparison if the user actually knows the building. A response-limit failure keeps Live AI selected and discards partial results. HTTP 429 means Google's quota has been reached; rapid repeated clicks do not fix it. The latest post-fix checks reached a timeout and then HTTP 429, so a completed live comparison remains unverified.

## Verification and remaining limits

Unit and HTTP tests verify actual image bytes in both model stages, real-source scope, geometry inclusion, consent, no OCR requirement, abstention, ID/coordinate rejection, transaction rollback, idempotency, cancellation, and separation from synthetic routes. Desktop/mobile browser tests exercise upload → consent → candidate plan → confirmation, and ambiguity/cancellation. Their model responses are mocked and labeled as such in saved screenshots.

One initial real-provider check used the user's supplied hallway screenshot, without a building hint. The request contained the supplied image plus eight official plan overview sheets (nine images, approximately 6.57 MB of JSON). Google returned HTTP 503 on the first attempt; the second attempt reached the 60-second overall deadline. The image transport path is confirmed, but that run did not produce a localization result. No physical-campus accuracy claim follows from this check. See [verification.md](verification.md) for the latest record.
