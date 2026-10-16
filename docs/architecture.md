# Architecture

CampusLens is a local React/TypeScript client and Express server for photo comparison against official BCIT Burnaby floor plans. Gemini is the only inference provider. The previous fictional map, deterministic demo routing, closure simulation, OCR sign matching and mode switch have been removed at the user's request.

## Request flow

1. The browser prepares a JPEG with a 1,600-pixel long edge and removes original metadata. Capture/upload alone makes no AI request.
2. The user consents to this photo and submits it with a request UUID and session revision.
3. The server validates the image, consent, provider readiness, revision and per-session lock.
4. One bounded orchestrator sends the actual photo with official plan overviews. Gemini shortlists at most three supplied plan IDs.
5. If there is a shortlist, the same photo is compared against selected overviews, source crops and sampled geometry using a second typed function.
6. Completion status and tool arguments are checked, including source scope and normalized region coordinates. A failed/cancelled turn rolls back partial hypotheses.
7. Gemini returns only the best supported region or abstains. The client displays that source-linked estimate; only the user can confirm it.

`server/photo-localization.ts` owns the two-stage workflow. `provider.ts` owns the REST adapter, completion parsing, bounded retries, ordered Gemini model failover and request budgets. `visual-data.ts` verifies and supplies public plan assets. `session.ts` stores only transient structured results/activity. The source library/search require no model.

## API and state

- `GET /api/bootstrap`: source catalogue, coverage, visual plan metadata and provider readiness. No fictional graph or default-mode setting.
- `POST /api/sessions`: empty object creates a live-analysis session. Provider readiness controls the setup notice, not a fallback mode.
- `POST /api/sessions/:id/photo`: consented photo comparison.
- `POST /api/sessions/:id/actions`: only `confirm-campus-region` and `reset`.
- `GET /api/sessions/:id`, `GET /api/search`, `GET /api/health`: state, official source search and readiness.

A session contains its capability ID, revision, `mode: live` marker, campus analysis/confirmed hypothesis, provider attempt count, short activity summaries, applied request IDs and expiry. It has no synthetic node, route, destination, disruption or replay fields. Removed action types are rejected. Browser mode preferences are cleared.

Idempotency/revision checks and one active comparison per session protect state. Cancellation and deadlines prevent late results committing. Sessions expire after 30 minutes; the service caps sessions at 200 and API traffic at 180 requests/minute/IP. This is a local prototype, not a publicly hardened service.

## Evidence and limits

Source PDFs, image rasters, text/geometry and verified topology are distinct layers. Geometry JSON contains raw drawing primitives, not verified semantic walls or routes. Campus graph/landmark files remain empty review placeholders and are not used to produce directions.

No provider can create a route, confirm the user's position, turn raw drawing paths into verified campus connections, or execute instructions found in images/documents. Internal thinking is not requested or logged. Keys remain server-side; photos are never saved with source assets or in session logs.

See [photo localization](photo-localization.md), [provider](provider.md), [data](data.md) and [verification](verification.md).
