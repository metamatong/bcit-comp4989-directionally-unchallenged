# Architecture

DirectionallyUnchallenged uses a React/TypeScript client and Express server for one-pass photo evidence extraction, exact source lookup and floor-graph navigation. The server selects Gemini (default), OpenAI, or Groq through `AI_PROVIDER`. The previous fictional map, deterministic demo routing, closure simulation, OCR sign matching and mode switch have been removed at the user's request.

The local listener and Vercel function share the visitor API. Vercel serves a static frontend, verifies compact plan evidence at cold start, and shares encrypted session state across workers. [Deployment and retention](operations.md#vercel)

## Request flow

1. The browser prepares a full photo view and four detail crops from the original bitmap. Selection is local until **Get Directions**.
2. If the GPS checkbox is selected, the browser requests one fresh reading before extraction and intersects its accuracy area with the official building footprints. Raw coordinates stay in the browser. Only matching building IDs, timestamp, accuracy and the footprint source hash enter the extraction request and later location request. Only building IDs are forwarded to the provider. Extraction rejects stale or wrong-source metadata, and the browser refreshes a reading older than 25 seconds before location. Evidence retry caching includes the building IDs and source hash.
3. `POST /api/sessions/:id/photo/evidence` is the only vision stage. The configured provider reads labels, label kind/placement, visible door count, window side and corridor shape with optional validated GPS-derived building IDs as uncertain context, but no floor plans, room lists or inferred floor.
4. A session-bound evidence receipt retains structured fields and the image fingerprint for five minutes. Server media bytes are released after extraction.
5. `POST /api/sessions/:id/photo/location` sends the evidence ID and optional building hint. It rejects images and client-supplied labels. `label-localization.ts` uses exact source retrieval, all clear nondirectional labels, explicit building/floor signs, door-sign placement and GPS candidates to identify one source-linked estimate. Directional labels remain evidence but cannot establish the current doorway. Repeated locations and partial sign matches require explicit visitor selection. An unsupported extra reading can coexist with a supported sign. Incompatible supported doorways leave the start unresolved. A footprint alone produces a building-only result. Window/count features are recorded as observations, with contradictory zero-door/door-sign evidence rejected.
6. `POST /api/sessions/:id/navigation` resolves the destination and runs Dijkstra over the compiled floor grids, source doorways and current reviewed transfers. Exact place occurrences stay bound to the source and graph version. Multiple entrances have individual markers. [Floor routing](floor-routing.md)
7. The client shows one route overview with combined transfer endpoints, then draws the returned coordinates and arrows in a continuous map stack. Each map has a floor label and A/B legend. Zoom and source attribution are shared. Optional walking-position controls are collapsed below the maps; changing the explicitly selected tracking floor stops the watch until resumed.

Photo interpretation occurs only in step 3. Source lookup, GPS narrowing and graph routing perform no provider calls. Earlier visual-comparison utilities remain isolated from the visitor API.

## API and state

- `GET /api/bootstrap`: coverage, visual plan metadata, selected provider/API model, provider readiness and a validated device-location calibration catalogue. A source validation failure supplies `locationNotice` and leaves photo analysis available.
- `POST /api/sessions`: empty object creates a live-analysis session. Provider readiness controls the setup notice, not a fallback mode.
- `POST /api/sessions/:id/photo/evidence`: consented photo label reading; returns structured evidence in session state.
- `POST /api/sessions/:id/photo/location`: metadata-only exact lookup using the evidence receipt and optional GPS building candidates. The `/photo` alias accepts the same metadata-only contract.
- `POST /api/sessions/:id/navigation/origins` returns mapped starting options for the current source occurrence when any exist. Unconnected physical door hypotheses remain available in the floor inventory.
- `POST /api/sessions/:id/navigation/surface` returns selectable walking cells for an identified starting floor or an explicitly selected destination. Navigation rechecks each pin against the current sheet and graph.
- `POST /api/sessions/:id/navigation`: current reviewed-graph route calculation, with source-bound start and destination checks.
- `POST /api/sessions/:id/actions`: `reset` and explicit selection of a matching starting place.
- `GET /api/sessions/:id`, `GET /api/health`: state and readiness. The removed `/api/search` endpoint returns HTTP 404.

The private evidence map holds a fingerprint and structured readings only, never media. Location lookup can reuse the receipt until expiry. A new extraction or reset invalidates it.

A session contains its capability ID, revision, `mode: live` marker, short-lived photo evidence, campus analysis and selected location hypothesis, provider attempt count, short activity summaries, applied request IDs and expiry. It has no synthetic node, route, destination, disruption or replay fields. Removed action types are rejected. Browser mode preferences are cleared.

Idempotency/revision checks and one active mutation per session protect state. Cancellation and deadlines prevent late results committing. Sessions expire after 30 minutes; the service caps sessions at 200 and API traffic at 180 requests/minute/IP. This is a local prototype, not a publicly hardened service.

## Evidence and limits

Source PDFs, image rasters, text/geometry and reviewed topology are distinct layers. Geometry JSON contains raw drawing primitives, not verified semantic walls or routes. The legacy campus graph/landmark files remain empty placeholders. The local editor's separate `topology.json` stores manually entered points, explicit connections, evidence and review history; it initializes from the published reviewed network.

The configured provider extracts photo evidence. Source records determine the estimated starting place and reviewed connections determine the route. It cannot create a cross-building connection: those steps must match the mapped connections. Generated route points are checked against the selected plans and the photo start/destination evidence before display. No provider confirms a user's physical position, turns raw drawing paths into verified campus connections, or executes instructions found in images/documents. Internal thinking is not requested or logged. Keys remain server-side; photos are never saved with source assets or in session logs.

See [photo localization](photo-localization.md), [provider](provider.md), [data](data.md) and [verification](verification.md).

Walking location runs in `src/location/` as an explicitly started foreground watch. The photo-start flow offers an explicit GPS checkbox and sends only derived building candidates to the server. `server/geolocation.ts` validates archived official footprints and calibration records for the optional walking overlay. Photo/session/navigation requests omit device coordinates. [Device state and coverage](device-location.md)

## Internal topology authoring

The separately loaded `/internal/topology` React view uses only the 12 official SE12/SW3/SW1 plans. Its loopback-only API in `topology-api.ts` operates independently of photo sessions and the configured vision provider. It remains an internal graph inspection/editor; visitor routing uses its approved graph and source corridor traces.

`topology.ts` validates edits, attaches original-source hashes, stores page-normalized points and writes `data/campus/topology.json` using an exclusive lock, expected document revision and atomic rename. Approval records bind to content hashes and record versions, retaining evidence snapshots in review history. Point edits or withdrawal of point approval invalidate incident connection approvals. Client-supplied approval/source fields are rejected.

`routing.ts` computes routes for the internal graph checker: both endpoints and the connection must be approved, have current source hashes, and match their reviewed content/endpoint versions. It respects one-way passages. Edge-count routing and measured-distance routing are explicit objectives; unknown distances never become metric costs. The visitor planner also uses this graph search when the photo start and destination bind to a complete current reviewed path. Additional coverage requires corresponding reviewed route records. See [topology editor](topology-editor.md).

The editor opens on `ConnectionReview`. The server binds each question to its definition, source hashes and page-specific point snapshots. The `answer-candidate` command records a marked-point confirmation and its direction. T with a known direction can promote both endpoints and their connection in one locked transaction. F or unknown withdraws an earlier candidate approval. For an unlocated elevator, `record-floor-observation` records service to a pair of floors and returns a review state. Creating route records still requires the marked-point command. A floor change clears the old page coordinates. [Topology editor](topology-editor.md)

## AI request timing and telemetry

`provider-timing.ts` bounds extraction by a 45-second deadline, with ten seconds of browser response grace. Transport retries use the remaining deadline and request budget. `openai-stream.ts` applies only completed output, and strict schemas bound extracted fields. Source lookup and routing require no inference deadline.

`provider-metrics.ts` emits numeric extraction success/failure telemetry and upstream request IDs. Photos, prompt text and visitor identifiers are excluded. `scripts/summarize-ai-metrics.ts` reports model latency and token distributions.
