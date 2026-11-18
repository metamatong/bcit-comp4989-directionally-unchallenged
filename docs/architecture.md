# Architecture

DirectionallyUnchallenged uses a React/TypeScript client and an Express server for photo localization and AI route generation against official BCIT Burnaby floor plans. The server selects Gemini (default), OpenAI, or Groq through `AI_PROVIDER`. The previous fictional map, deterministic demo routing, closure simulation, OCR sign matching and mode switch have been removed at the user's request.

The local listener and Vercel function share the visitor API. Vercel serves a static frontend, verifies compact plan evidence at cold start, and shares encrypted session state across workers. [Deployment and retention](operations.md#vercel)

## Request flow

1. The browser prepares a context image and four overlapping crops directly from the original bitmap. Capture/upload alone makes no AI request.
2. After per-photo consent, `POST /photo/evidence` calls the configured vision provider with only those five photo views. The `read_photo_labels` tool returns observed room identifiers and short scene observations, with no plan hints or location estimate.
3. A server-generated evidence ID is bound to a fingerprint of the same photo/crops and session for five minutes. No media bytes are retained between requests.
4. `POST /photo` supplies that evidence ID and the same image bundle. The deterministic `retrieve_room_labels` tool searches every extracted source label using whole-identifier equality.
5. Clear matches in up to three plans go directly to a second provider call with full source labels, geometry and plan crops. Uncertain/unmatched readings or a larger ambiguous candidate set can use an additional visual shortlist. Signs are not mandatory.
6. The model verifies the actual image against source evidence and proposes one region or abstains. Complete identifier pairs must agree exactly; `302` cannot be matched to `3021`. Bounds/source IDs are validated and partial hypotheses roll back on failure.
7. A successful photo comparison automatically selects its single best source-grounded starting area. The client displays **Starting position acquired** before requesting directions. The destination is not sent during photo analysis; it is combined with the starting area and official plans in the separate route-generation request.
8. `server/wayfinding.ts` resolves room labels from the source index, then calls the configured provider to select the destination occurrence and generate floor-local route lines. The model sees official plan images, the photo-derived starting bounds, and the candidate destination bounds. Stairs and elevators are matched between the supplied floor plans. Between buildings, the model may use only current mapped building-link/outdoor connections; it cannot invent a crossing. Generated points and transfers are checked against the supplied plan set and those building links before a route is displayed. Room doors and corridor segments do not require manual approval.
9. The client groups consecutive corridor steps into floor visits and displays the complete itinerary by default. Each floor uses its original page coordinates. Stairs, elevators and building crossings start a new visit. An outdoor crossing has no intermediate geometry. Visitors can switch to manual floor navigation.

Route generation binds to the topology revision read before the provider call. If the editor changes that revision during generation, the server returns HTTP 409 and asks for a new route request. This prevents a response from using a building connection whose approval was withdrawn while the request was in flight.

`route-geometry.ts` checks the displayed floor paths against all extracted long vector strokes in the original page coordinate system. Consecutive corridor steps are checked as one floor visit, including the segments joining their displayed stops. Source-traced corridor bends are supplied as geometry evidence independently of topology approvals. A crossing triggers one bounded regeneration with stroke IDs and intersection coordinates. A second crossing returns `no-route`. Both attempts share a 90-second deadline. The strokes remain unclassified drawing evidence, and the check can reject annotations as well as structural strokes. A clear result does not prove physical walkability or validate a stair/elevator service.

The hosted geometry bundle carries the complete long-stroke list for each plan, bound to its original PDF and geometry hashes and the build digest. Its count must match the source summary. The smaller segment sample used in photo model context remains separate.

`generated-route.ts` owns the route response schema, source checks and provider tool declaration. The destination ID enum contains only the exact retrieved source occurrences. Malformed responses and source-validation failures receive the same bounded correction opportunity as drawing crossings. After a second rejection, the visitor sees the specific failed constraint. **Retry route** requests a new route with the existing session and photo-derived area, without repeating either photo stage or uploading photo bytes.

`photo-evidence.ts` owns label extraction and receipt validation; `photo-media.ts` owns shared media schemas, bounds, sizes and fingerprinting. `room-labels.ts` indexes all full source labels. `photo-localization.ts` owns retrieval, visual selection and comparison. `photo-doorways.ts` retrieves all eligible doorway details, crops the original plan raster with sharp, and resolves source-bound vicinity hypotheses from structured visual assessments. `photo-grounding.ts` checks the proposed area against original-page print and door locations and returns the source labels used by the overlay. `provider-config.ts` selects and validates the server provider. `provider.ts` owns the common contract and Gemini transport/fallback parsing; `openai-provider.ts` and `openai-response.ts` implement stateless Responses image/function calls and completed-output validation. `provider-budget.ts` enforces OpenAI request ceilings. `visual-data.ts` verifies public source provenance and includes complete labels in model context. `src/photo.ts` and `photo-views.ts` prepare original-image crops. The full dataset stays behind the scenes.

The server exposes `pilotToolDeclarations` and `runPilotTool` for exact label resolution, page-region context, mapped connections and floor coverage. These tools read checked-in evidence without a provider key. The photo workflow uses the pilot evidence in its second stage. A room result supplies the printed region and source-read labels. Visitor routing does not require a photo-matched graph checkpoint or reviewed destination door; the AI plans the route from the relevant floor plans and the app's mapped building connections. [Pilot retrieval contract](spatial-retrieval.md)

## API and state

- `GET /api/bootstrap`: coverage, visual plan metadata, selected provider/API model, provider readiness and a validated device-location calibration catalogue. A source validation failure supplies `locationNotice` and leaves photo analysis available.
- `POST /api/sessions`: empty object creates a live-analysis session. Provider readiness controls the setup notice, not a fallback mode.
- `POST /api/sessions/:id/photo/evidence`: consented photo label reading; returns structured evidence in session state.
- `POST /api/sessions/:id/photo`: exact retrieval and visual comparison using the evidence ID and identical media bundle.
- `POST /api/sessions/:id/navigation/origins` returns eligible checkpoints inside the current photo hypothesis for internal clients. It is not used by the visitor screen.
- `POST /api/sessions/:id/navigation` sends the photo-derived starting area, typed destination matches, relevant official floor plans, and approved inter-building connections to the configured provider. Responses contain validated map positions, ordered steps and source-plan IDs. No visitor route requires choosing a checkpoint or approving a corridor.
- `POST /api/sessions/:id/actions`: `reset` and a legacy explicit region-selection action; the current visitor UI does not call the latter.
- `GET /api/sessions/:id`, `GET /api/health`: state and readiness. The removed `/api/search` endpoint returns HTTP 404.

The private evidence map holds a fingerprint and structured readings only, never media. Successful comparison or reset invalidates its receipt; failed comparison can reuse it until expiry.

A session contains its capability ID, revision, `mode: live` marker, short-lived photo evidence, campus analysis and selected location hypothesis, provider attempt count, short activity summaries, applied request IDs and expiry. It has no synthetic node, route, destination, disruption or replay fields. Removed action types are rejected. Browser mode preferences are cleared.

Idempotency/revision checks and one active comparison per session protect state. Cancellation and deadlines prevent late results committing. Sessions expire after 30 minutes; the service caps sessions at 200 and API traffic at 180 requests/minute/IP. This is a local prototype, not a publicly hardened service.

## Evidence and limits

Source PDFs, image rasters, text/geometry and reviewed topology are distinct layers. Geometry JSON contains raw drawing primitives, not verified semantic walls or routes. The legacy campus graph/landmark files remain empty placeholders. The local editor's separate `topology.json` stores manually entered points, explicit connections, evidence and review history; it starts empty.

The configured provider proposes photo-derived positions and floor-level routes from the supplied official plans. It cannot create a cross-building connection: those steps must match the mapped connections. Generated route points are checked against the selected plans and the photo start/destination evidence before display. No provider confirms a user's physical position, turns raw drawing paths into verified campus connections, or executes instructions found in images/documents. Internal thinking is not requested or logged. Keys remain server-side; photos are never saved with source assets or in session logs.

See [photo localization](photo-localization.md), [provider](provider.md), [data](data.md) and [verification](verification.md).

Walking location runs in `src/location/` as an explicitly started foreground watch. The photo-start flow does not request device location. `server/geolocation.ts` validates archived official footprints and calibration records for the optional walking overlay. Photo/session/navigation requests omit device coordinates. [Device state and coverage](device-location.md)

## Internal topology authoring

The separately loaded `/internal/topology` React view uses only the 12 official SE12/SW3/SW1 plans. Its loopback-only API in `topology-api.ts` operates independently of photo sessions and the configured vision provider. It remains an internal graph inspection/editor; visitor routing uses its approved inter-building links while generating within-building paths from plans.

`topology.ts` validates edits, attaches original-source hashes, stores page-normalized points and writes `data/campus/topology.json` using an exclusive lock, expected document revision and atomic rename. Approval records bind to content hashes and record versions, retaining evidence snapshots in review history. Point edits or withdrawal of point approval invalidate incident connection approvals. Client-supplied approval/source fields are rejected.

`routing.ts` computes routes for the internal graph checker: both endpoints and the connection must be approved, have current source hashes, and match their reviewed content/endpoint versions. It respects one-way passages. Edge-count routing and measured-distance routing are explicit objectives; unknown distances never become metric costs. The visitor route planner does not use this graph search for room-to-room paths; it asks the configured AI provider to generate those paths and validates building transfers against mapped links. See [topology editor](topology-editor.md).

The editor opens on `ConnectionReview`. The server binds each question to its definition, source hashes and page-specific point snapshots. The `answer-candidate` command records a marked-point confirmation and its direction. T with a known direction can promote both endpoints and their connection in one locked transaction. F or unknown withdraws an earlier candidate approval. For an unlocated elevator, `record-floor-observation` records service to a pair of floors and returns a review state. Creating route records still requires the marked-point command. A floor change clears the old page coordinates. [Topology editor](topology-editor.md)

## AI request timing and telemetry

`provider-timing.ts` carries an absolute deadline across model calls, transport retries and response reading. Photo reading uses 45 seconds, visual selection and comparison share 90 seconds, and navigation uses 90 seconds. Browser response windows add ten seconds. Cancellation propagates from the HTTP response through the provider, including navigation. A retry after failed comparison reuses valid image-bound label evidence.

`photo-plan-context.ts` selects source-bound detail crops and serializes all labels compactly. `openai-stream.ts` observes SSE timing events and forwards only a completed terminal response to validation. `provider-metrics.ts` emits numeric success/failure telemetry and upstream request IDs, with token counts when available. `scripts/summarize-ai-metrics.ts` groups these records into latency distributions.
