# Architecture

DirectionallyUnchallenged uses a React/TypeScript client and an Express server for photo comparison against official BCIT Burnaby floor plans. The server selects Gemini (default) or paid OpenAI through `AI_PROVIDER`. The previous fictional map, deterministic demo routing, closure simulation, OCR sign matching and mode switch have been removed at the user's request.

The local listener and Vercel function share the visitor API. Vercel serves a static frontend, verifies compact plan evidence at cold start, and shares encrypted session state across workers. [Deployment and retention](operations.md#vercel)

## Request flow

1. The browser prepares a context image and four overlapping crops directly from the original bitmap. Capture/upload alone makes no AI request.
2. After per-photo consent, `POST /photo/evidence` calls the configured vision provider with only those five photo views. The `read_photo_labels` tool returns observed room identifiers and short scene observations, with no plan hints or location estimate.
3. A server-generated evidence ID is bound to a fingerprint of the same photo/crops and session for five minutes. No media bytes are retained between requests.
4. `POST /photo` supplies that evidence ID and the same image bundle. The deterministic `retrieve_room_labels` tool searches every extracted source label using whole-identifier equality.
5. Clear matches in up to three plans go directly to a second provider call with full source labels, geometry and plan crops. Uncertain/unmatched readings or a larger ambiguous candidate set can use an additional visual shortlist. Signs are not mandatory.
6. The model verifies the actual image against source evidence and proposes one region or abstains. Complete identifier pairs must agree exactly; `302` cannot be matched to `3021`. Bounds/source IDs are validated and partial hypotheses roll back on failure.
7. A successful photo comparison automatically selects its single best source-grounded hypothesis. After **Go**, the client asks for a route without showing a region or starting-point confirmation. The server uses the photo hypothesis only when it contains exactly one approved checkpoint; zero or multiple matches request a clearer photo. Destination text never enters either photo-analysis prompt.
8. `server/wayfinding.ts` resolves source labels or named checkpoint types in the pilot. It accepts a one-character room-code typo only when it maps to one unique reviewed destination, and clarifies multiple destination occurrences. A room binds only to a specific reviewed doorway. The planner uses the fewest approved, displayable graph connections. `server/visitor-paths.ts` checks each corridor trace against the current source hash, candidate definition, explicit answer, endpoints and edge review. Exact shared portions of adjacent traces can be walked once.
9. The client groups consecutive corridor steps into floor visits and displays the complete itinerary by default. Each floor uses its original page coordinates. Stairs, elevators and building crossings start a new visit. An outdoor crossing has no intermediate geometry. Visitors can switch to manual floor navigation.

`photo-evidence.ts` owns label extraction and receipt validation; `photo-media.ts` owns shared media schemas, bounds, sizes and fingerprinting. `room-labels.ts` indexes all full source labels. `photo-localization.ts` owns retrieval, visual selection and comparison. `photo-doorways.ts` retrieves all eligible doorway details, crops the original plan raster with sharp, and resolves source-bound vicinity hypotheses from structured visual assessments. `photo-grounding.ts` checks the proposed area against original-page print and door locations and returns the source labels used by the overlay. `provider-config.ts` selects and validates the server provider. `provider.ts` owns the common contract and Gemini transport/fallback parsing; `openai-provider.ts` and `openai-response.ts` implement stateless Responses image/function calls and completed-output validation. `provider-budget.ts` enforces OpenAI request ceilings. `visual-data.ts` verifies public source provenance and includes complete labels in model context. `src/photo.ts` and `photo-views.ts` prepare original-image crops. The full dataset stays behind the scenes.

The server exposes `pilotToolDeclarations` and `runPilotTool` for exact label resolution, page-region context, reviewed outgoing connections and floor coverage. These tools read checked-in evidence without a provider key. The photo workflow uses the pilot evidence in its second stage. A room result supplies the printed region and any source-read doors. Visitor routing requires one photo-matched approved start and a reviewed destination door in the connected graph. [Pilot retrieval contract](spatial-retrieval.md)

## API and state

- `GET /api/bootstrap`: coverage, visual plan metadata, selected provider/API model, provider readiness and a validated device-location calibration catalogue. A source validation failure supplies `locationNotice` and leaves photo analysis available.
- `POST /api/sessions`: empty object creates a live-analysis session. Provider readiness controls the setup notice, not a fallback mode.
- `POST /api/sessions/:id/photo/evidence`: consented photo label reading; returns structured evidence in session state.
- `POST /api/sessions/:id/photo`: exact retrieval and visual comparison using the evidence ID and identical media bundle.
- `POST /api/sessions/:id/navigation/origins` returns eligible checkpoints inside the current photo hypothesis for internal clients. It is not used by the visitor screen.
- `POST /api/sessions/:id/navigation` resolves the typed destination and returns a route when the photo hypothesis maps to one approved checkpoint. The request includes the current session revision and selected hypothesis ID. An ambiguous destination selection also requires the current topology revision. Responses contain public map positions, ordered steps and source-plan IDs.
- `POST /api/sessions/:id/actions`: `reset` and a legacy explicit region-selection action; the current visitor UI does not call the latter.
- `GET /api/sessions/:id`, `GET /api/health`: state and readiness. The removed `/api/search` endpoint returns HTTP 404.

The private evidence map holds a fingerprint and structured readings only, never media. Successful comparison or reset invalidates its receipt; failed comparison can reuse it until expiry.

A session contains its capability ID, revision, `mode: live` marker, short-lived photo evidence, campus analysis and selected location hypothesis, provider attempt count, short activity summaries, applied request IDs and expiry. It has no synthetic node, route, destination, disruption or replay fields. Removed action types are rejected. Browser mode preferences are cleared.

Idempotency/revision checks and one active comparison per session protect state. Cancellation and deadlines prevent late results committing. Sessions expire after 30 minutes; the service caps sessions at 200 and API traffic at 180 requests/minute/IP. This is a local prototype, not a publicly hardened service.

## Evidence and limits

Source PDFs, image rasters, text/geometry and reviewed topology are distinct layers. Geometry JSON contains raw drawing primitives, not verified semantic walls or routes. The legacy campus graph/landmark files remain empty placeholders. The local editor's separate `topology.json` stores manually entered points, explicit connections, evidence and review history; it starts empty.

No provider can create a route, confirm the user's position, turn raw drawing paths into verified campus connections, or execute instructions found in images/documents. Internal thinking is not requested or logged. Keys remain server-side; photos are never saved with source assets or in session logs.

See [photo localization](photo-localization.md), [provider](provider.md), [data](data.md) and [verification](verification.md).

Walking location runs in `src/location/` as an explicitly started foreground watch. The photo-start flow does not request device location. `server/geolocation.ts` validates archived official footprints and calibration records for the optional walking overlay. Photo/session/navigation requests omit device coordinates. [Device state and coverage](device-location.md)

## Internal topology authoring

The separately loaded `/internal/topology` React view uses only the 12 official SE12/SW3/SW1 plans. Its loopback-only API in `topology-api.ts` operates independently of photo sessions and the configured vision provider. Photo localization remains a two-stage process; the visitor UI automatically selects its sole hypothesis but does not snap it to a graph point unless exactly one approved checkpoint lies within the source-bound region.

`topology.ts` validates edits, attaches original-source hashes, stores page-normalized points and writes `data/campus/topology.json` using an exclusive lock, expected document revision and atomic rename. Approval records bind to content hashes and record versions, retaining evidence snapshots in review history. Point edits or withdrawal of point approval invalidate incident connection approvals. Client-supplied approval/source fields are rejected.

`routing.ts` computes routes over the currently eligible graph: both endpoints and the connection must be approved, have current source hashes, and match their reviewed content/endpoint versions. It respects one-way passages. Edge-count routing and measured-distance routing are explicit objectives; unknown distances never become metric costs. A route includes the graph revision and ordered point/edge IDs for evidence lookup. Empty or disconnected graphs return no route. The visitor planner reuses the same graph search with a filter for displayable passages. See [topology editor](topology-editor.md).

The editor opens on `ConnectionReview`. The server binds each question to its definition, source hashes and page-specific point snapshots. The `answer-candidate` command records a marked-point confirmation and its direction. T with a known direction can promote both endpoints and their connection in one locked transaction. F or unknown withdraws an earlier candidate approval. For an unlocated elevator, `record-floor-observation` records service to a pair of floors and returns a review state. Creating route records still requires the marked-point command. A floor change clears the old page coordinates. [Topology editor](topology-editor.md)
