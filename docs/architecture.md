# Architecture

DirectionallyUnchallenged is a local React/TypeScript client and Express server for photo comparison against official BCIT Burnaby floor plans. Gemini is the only inference provider. The previous fictional map, deterministic demo routing, closure simulation, OCR sign matching and mode switch have been removed at the user's request.

## Request flow

1. The browser prepares a context image and four overlapping crops directly from the original bitmap. Capture/upload alone makes no AI request.
2. After per-photo consent, `POST /photo/evidence` calls Gemini with only those five photo views. The `read_photo_labels` tool returns observed room identifiers and short scene observations, with no plan hints or location estimate.
3. A server-generated evidence ID is bound to a fingerprint of the same photo/crops and session for five minutes. No media bytes are retained between requests.
4. `POST /photo` supplies that evidence ID and the same image bundle. The deterministic `retrieve_room_labels` tool searches every extracted source label using whole-identifier equality.
5. Clear matches in up to three plans go directly to a second Gemini call with full source labels, geometry and plan crops. Uncertain/unmatched readings or a larger ambiguous candidate set can use an additional visual shortlist. Signs are not mandatory.
6. The model verifies the actual image against source evidence and proposes one region or abstains. Complete identifier pairs must agree exactly; `302` cannot be matched to `3021`. Bounds/source IDs are validated and partial hypotheses roll back on failure.
7. The user confirms the returned region. The visitor chooses a reviewed starting point inside those bounds. The destination text never enters either photo-analysis prompt.
8. `server/wayfinding.ts` resolves exact destination labels or an explicitly named checkpoint type in the pilot. It clarifies ambiguous choices and binds a room only to a specific reviewed doorway. The planner uses the fewest approved, displayable graph connections. `server/visitor-paths.ts` checks each corridor trace against the current source hash, candidate definition, explicit answer, endpoints and edge review. Exact shared portions of adjacent traces can be walked once.
9. The client draws oriented corridor paths on the official floor page. Stairs, elevators and building crossings display a departure marker and the next step on the arrival floor. Outdoor intermediate geometry is unknown. Step changes are manual.

`photo-evidence.ts` owns label extraction and receipt validation; `photo-media.ts` owns shared media schemas, bounds, sizes and fingerprinting. `room-labels.ts` indexes all full source labels. `photo-localization.ts` owns retrieval, visual selection and comparison. `provider.ts` handles transport, bounded retries, fallback and completion parsing. `visual-data.ts` verifies public source provenance and includes complete labels in model context. `src/photo.ts` and `photo-views.ts` prepare original-image crops. The full dataset stays behind the scenes.

The server exposes `pilotToolDeclarations` and `runPilotTool` for exact label resolution, page-region context, reviewed outgoing connections and floor coverage. These tools read checked-in evidence without a provider key. The photo workflow uses the pilot evidence in its second stage. A room result supplies the printed region and any source-read doors. Visitor routing requires a confirmed start and a reviewed destination door in the connected graph. [Pilot retrieval contract](spatial-retrieval.md)

## API and state

- `GET /api/bootstrap`: coverage, visual plan metadata used to display results and provider readiness. The general source catalogue is not exposed. No fictional graph or default-mode setting.
- `POST /api/sessions`: empty object creates a live-analysis session. Provider readiness controls the setup notice, not a fallback mode.
- `POST /api/sessions/:id/photo/evidence`: consented photo label reading; returns structured evidence in session state.
- `POST /api/sessions/:id/photo`: exact retrieval and visual comparison using the evidence ID and identical media bundle.
- `POST /api/sessions/:id/navigation` resolves the typed destination and returns eligible starts or a route. The request includes the current session revision and confirmed candidate ID. Selecting an endpoint also requires the current topology revision. Responses contain public map positions, ordered steps and source-plan IDs.
- `POST /api/sessions/:id/actions`: only `confirm-campus-region` and `reset`.
- `GET /api/sessions/:id`, `GET /api/health`: state and readiness. The removed `/api/search` endpoint returns HTTP 404.

The private evidence map holds a fingerprint and structured readings only, never media. Successful comparison or reset invalidates its receipt; failed comparison can reuse it until expiry.

A session contains its capability ID, revision, `mode: live` marker, short-lived photo evidence, campus analysis/confirmed hypothesis, provider attempt count, short activity summaries, applied request IDs and expiry. It has no synthetic node, route, destination, disruption or replay fields. Removed action types are rejected. Browser mode preferences are cleared.

Idempotency/revision checks and one active comparison per session protect state. Cancellation and deadlines prevent late results committing. Sessions expire after 30 minutes; the service caps sessions at 200 and API traffic at 180 requests/minute/IP. This is a local prototype, not a publicly hardened service.

## Evidence and limits

Source PDFs, image rasters, text/geometry and reviewed topology are distinct layers. Geometry JSON contains raw drawing primitives, not verified semantic walls or routes. The legacy campus graph/landmark files remain empty placeholders. The local editor's separate `topology.json` stores manually entered points, explicit connections, evidence and review history; it starts empty.

No provider can create a route, confirm the user's position, turn raw drawing paths into verified campus connections, or execute instructions found in images/documents. Internal thinking is not requested or logged. Keys remain server-side; photos are never saved with source assets or in session logs.

See [photo localization](photo-localization.md), [provider](provider.md), [data](data.md) and [verification](verification.md).

## Internal topology authoring

The separately loaded `/internal/topology` React view uses only the 12 official SE12/SW3/SW1 plans. Its loopback-only API in `topology-api.ts` operates independently of photo sessions and Gemini. The exact-label and two-stage localization flows remain unchanged; a confirmed photo region is not automatically snapped to a graph point.

`topology.ts` validates edits, attaches original-source hashes, stores page-normalized points and writes `data/campus/topology.json` using an exclusive lock, expected document revision and atomic rename. Approval records bind to content hashes and record versions, retaining evidence snapshots in review history. Point edits or withdrawal of point approval invalidate incident connection approvals. Client-supplied approval/source fields are rejected.

`routing.ts` computes routes over the currently eligible graph: both endpoints and the connection must be approved, have current source hashes, and match their reviewed content/endpoint versions. It respects one-way passages. Edge-count routing and measured-distance routing are explicit objectives; unknown distances never become metric costs. A route includes the graph revision and ordered point/edge IDs for evidence lookup. Empty or disconnected graphs return no route. The visitor planner reuses the same graph search with a filter for displayable passages. See [topology editor](topology-editor.md).

The editor opens on `ConnectionReview`. The server binds each question to its definition, source hashes and page-specific point snapshots. The `answer-candidate` command records a marked-point confirmation and its direction. T with a known direction can promote both endpoints and their connection in one locked transaction. F or unknown withdraws an earlier candidate approval. For an unlocated elevator, `record-floor-observation` records service to a pair of floors and returns a review state. Creating route records still requires the marked-point command. A floor change clears the old page coordinates. [Topology editor](topology-editor.md)
