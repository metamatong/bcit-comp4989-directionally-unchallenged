# Architecture

CampusLens is a local React/TypeScript client and Express server for photo comparison against official BCIT Burnaby floor plans. Gemini is the only inference provider. The previous fictional map, deterministic demo routing, closure simulation, OCR sign matching and mode switch have been removed at the user's request.

## Request flow

1. The browser prepares a context image and four overlapping crops directly from the original bitmap. Capture/upload alone makes no AI request.
2. After per-photo consent, `POST /photo/evidence` calls Gemini with only those five photo views. The `read_photo_labels` tool returns observed room identifiers and short scene observations, with no plan hints or location estimate.
3. A server-generated evidence ID is bound to a fingerprint of the same photo/crops and session for five minutes. No media bytes are retained between requests.
4. `POST /photo` supplies that evidence ID and the same image bundle. The deterministic `retrieve_room_labels` tool searches every extracted source label using whole-identifier equality.
5. Clear matches in up to three plans go directly to a second Gemini call with full source labels, geometry and plan crops. Uncertain/unmatched readings or a larger ambiguous candidate set can use an additional visual shortlist. Signs are not mandatory.
6. The model verifies the actual image against source evidence and proposes one region or abstains. Complete identifier pairs must agree exactly; `302` cannot be matched to `3021`. Bounds/source IDs are validated and partial hypotheses roll back on failure.
7. Only the user confirms a returned region. First-stage reading alone never sets location.

`photo-evidence.ts` owns label extraction and receipt validation; `photo-media.ts` owns shared media schemas, bounds, sizes and fingerprinting. `room-labels.ts` indexes all full source labels. `photo-localization.ts` owns retrieval, visual selection and comparison. `provider.ts` handles transport, bounded retries, fallback and completion parsing. `visual-data.ts` verifies public source provenance and includes complete labels in model context. `src/photo.ts` and `photo-views.ts` prepare original-image crops. The full dataset stays behind the scenes.

## API and state

- `GET /api/bootstrap`: coverage, visual plan metadata used to display results and provider readiness. The general source catalogue is not exposed. No fictional graph or default-mode setting.
- `POST /api/sessions`: empty object creates a live-analysis session. Provider readiness controls the setup notice, not a fallback mode.
- `POST /api/sessions/:id/photo/evidence`: consented photo label reading; returns structured evidence in session state.
- `POST /api/sessions/:id/photo`: exact retrieval and visual comparison using the evidence ID and identical media bundle.
- `POST /api/sessions/:id/actions`: only `confirm-campus-region` and `reset`.
- `GET /api/sessions/:id`, `GET /api/health`: state and readiness. The removed `/api/search` endpoint returns HTTP 404.

The private evidence map holds a fingerprint and structured readings only, never media. Successful comparison or reset invalidates its receipt; failed comparison can reuse it until expiry.

A session contains its capability ID, revision, `mode: live` marker, short-lived photo evidence, campus analysis/confirmed hypothesis, provider attempt count, short activity summaries, applied request IDs and expiry. It has no synthetic node, route, destination, disruption or replay fields. Removed action types are rejected. Browser mode preferences are cleared.

Idempotency/revision checks and one active comparison per session protect state. Cancellation and deadlines prevent late results committing. Sessions expire after 30 minutes; the service caps sessions at 200 and API traffic at 180 requests/minute/IP. This is a local prototype, not a publicly hardened service.

## Evidence and limits

Source PDFs, image rasters, text/geometry and verified topology are distinct layers. Geometry JSON contains raw drawing primitives, not verified semantic walls or routes. Campus graph/landmark files remain empty review placeholders and are not used to produce directions.

No provider can create a route, confirm the user's position, turn raw drawing paths into verified campus connections, or execute instructions found in images/documents. Internal thinking is not requested or logged. Keys remain server-side; photos are never saved with source assets or in session logs.

See [photo localization](photo-localization.md), [provider](provider.md), [data](data.md) and [verification](verification.md).
