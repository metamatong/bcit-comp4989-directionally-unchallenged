# Architecture

DirectionallyUnchallenged uses a React/TypeScript client and Express server for one-pass photo evidence extraction, automatic source localization and floor-plan navigation. The server selects Gemini (default), OpenAI or Groq through `AI_PROVIDER`. Localization and routing use structured evidence and source data without later model calls.

## Visitor flow

1. The browser prepares a photo and detail crops locally. On **Get Directions**, it requests a fresh GPS reading immediately so the browser permission request is tied to the visitor's tap.
2. The browser sends GPS-derived building IDs and the photo bundle to the single vision stage for labels, label kind/placement and visible scene features. If that work makes the GPS reading stale, the browser refreshes it before matching.
   The pending photo-evidence request displays an animated axonometric map derived from the four pilot footprints. Reduced-motion mode shows the static map.
3. The browser intersects the GPS accuracy area with official building footprints. Raw coordinates stay on-device; derived building candidates and metadata go to the extraction and location endpoints. Only building IDs are forwarded to the provider; they cannot supply unseen room digits or a floor. Evidence reuse requires unchanged building context.
4. Source localization ranks exact photo-label matches within GPS-compatible buildings and selects the strongest starting estimate. The visitor is not asked to select or confirm a start. GPS cannot distinguish floors.
5. Navigation resolves the destination and searches generated floor walking areas plus source-plan inferred same-building transfers and fixed inter-building links. A complete walking route opens on its first step and starts a foreground location watch (plus browser-only motion tracking on same-plan indoor corridor steps when available and permitted). The route step selects the floor map, and fresh GPS readings fused with corridor map-matching and transient motion evidence can show a dot on a geographically aligned floor. The full itinerary remains available through **Route overview**. The optional 3D projection shares the route, tracking overlay and progress state with the 2D map. It loads source-hash-matched wall geometry for SE12 and SW03 on demand. Other pilot floors use the projected sheet. The campus inset projects fresh device readings onto the registered ground plane and reports off-map or unavailable readings. During photo analysis the same map labels the submission fix. On the indoor sheet the camera can hold the tracker’s labelled last-known point for its active floor.

## Visitor API

- `GET /api/bootstrap`: visual plan metadata, provider readiness, source coverage and validated building/floor location catalogue.
- `GET /api/plans/:planId/walking-surface`: pilot-scoped public corridor/lobby walking cells (`step`, `runs`, source hashes) fetched lazily by the browser for client-side indoor GPS map-matching; kept distinct from `LocationCatalogue`.
- `POST /api/sessions`: creates an empty live-analysis session.
- `POST /api/sessions/:id/photo/evidence`: the only image and vision request.
- `POST /api/sessions/:id/photo/location`: metadata-only localization with a required GPS building hint.
- `POST /api/sessions/:id/navigation`: calculates a route from the automatic photo/GPS start to the requested destination.
- `POST /api/sessions/:id/navigation/surface`: returns walking cells for a custom destination point.
- `POST /api/sessions/:id/actions`: resets the session.
- `GET /api/sessions/:id`, `GET /api/health`: state and readiness.

There is no visitor API for choosing a starting doorway, selecting a starting point on a floor map or approving a connection. The old topology editor route and its write API are not mounted by the application.

## Route data and pilot scope

The source archive retains all supplied plans, while the visitor API and browser expose only SE12, SW03, SW05 and SW01. `server/floor-graph.ts` loads source-derived walking areas. `server/floor-search.ts` calculates each requested path across connected cells and doorways. In SE12, SW03 and SW01, same-building stairs and elevators are paired from source-plan landing labels and positions at runtime; legacy manually confirmed vertical edges are omitted from visitor routing. Links between buildings remain fixed source records and are the only connections requiring manual review. The visitor router pairs SW05 stair enclosures across the two registered source sheets. It requires the matching signed stair number, a fitted doorway with a public grid approach on each floor and a unique overlapping enclosure in both directions. The left stair is S180–S280 and the right stair is S189–S289. These pairs are computed at runtime without device GPS or a stored inter-floor approval.

A same-floor outdoor passage can connect an exterior stair landing to an entrance on the walking grid. The router checks that the passage is active before pairing the landing with the uniquely numbered stair on the adjacent floor. Route search retains the permitted direction of the outdoor walk.

Floor-plan geographic calibration is independent from route connectivity. The campus footprint catalogue supports building-level GPS narrowing. Reviewed exterior corners and shared structural features provide approximate drawing alignments for 65 of the 89 supplied floor plans. The server validates the compiled catalogue before exposing it to the browser. See [device location](device-location.md), [photo localization](photo-localization.md) and [floor routing](floor-routing.md).

Guided tracking prefetches walking surfaces and applies the current floor and transfer step before consuming GPS fixes. The floor matcher uses `min(24 m, max(reportedAccuracy, 16 m))` when the fix overlaps the active footprint and `min(20 m, max(reportedAccuracy, 12 m))` otherwise. The watch uses the original timestamp for deduplication and for timed corridor rejection streaks, which restart after gaps longer than four seconds. Age and floor transitions use the skew-adjusted timestamp. A stationary hold requires a recent accepted corridor fix after any detected step, movement onset or sensor recovery that invalidated the previous anchor. Stage 2 bases its live and bridge windows on accepted fixes and requires a fresh GPS anchor after gyroscope recovery. On aligned floors, a browser-only heading estimator projects the compass bearing onto the drawing. A live gyro can track turns between compass samples on same-plan corridor steps. The estimator keeps a valid bearing through quiet compass intervals and clears it after a detected turn loses gyro continuity or goes unconfirmed. The cone uses the live dot and shares its map frame. The live matched status displays the same uncertainty radius that the map draws. The raw GPS status displays phone-reported accuracy. [Tracking rules and limits](device-location.md)

The router preserves source-backed approach tiers (mapped stops, shared entrances, then corridor-side stops), shared-door departure regions, directional building-link constraints and visitor exclusions. It selects a reachable approach automatically without origin-choice fields or endpoints. When a complete path is unavailable, it returns the reachable portion where possible, marks the last mapped stop and identifies the requested place on the plan. Guided tracking stops when the visitor opens the overview or finishes the route.

## Privacy and runtime

The private photo receipt retains structured fields and an image fingerprint for five minutes. Request media bytes are released after extraction. Session state contains no raw photo or GPS coordinates. Sessions expire after 30 minutes; the service caps sessions at 200 and API traffic at 180 requests per minute per IP.

The local listener and Vercel function share the visitor API. Vercel verifies compact source assets at cold start and shares encrypted session state across workers. Provider keys remain server-side. This is a local prototype, not a publicly hardened service.

The Gemini adapter can retry an upstream quota error with another configured credential for the same model. The worker tracks each key's retry time per model. Every transport attempt draws from one application budget across the primary key and its backups.
