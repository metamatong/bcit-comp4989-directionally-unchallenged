# Architecture

DirectionallyUnchallenged uses a React/TypeScript client and Express server for one-pass photo evidence extraction, automatic source localization and floor-plan navigation. The server selects Gemini (default), OpenAI or Groq through `AI_PROVIDER`. Localization and routing use structured evidence and source data without later model calls.

## Visitor flow

1. The browser prepares a photo and detail crops locally. On **Get Directions**, it requests a fresh GPS reading immediately so the browser permission request is tied to the visitor's tap.
2. The browser sends GPS-derived building IDs and the photo bundle to the single vision stage for labels, label kind/placement and visible scene features. If that work makes the GPS reading stale, the browser refreshes it before matching.
3. The browser intersects the GPS accuracy area with official building footprints. Raw coordinates stay on-device; derived building candidates and metadata go to the extraction and location endpoints. Only building IDs are forwarded to the provider; they cannot supply unseen room digits or a floor. Evidence reuse requires unchanged building context.
4. Source localization ranks exact photo-label matches within GPS-compatible buildings and selects the strongest starting estimate. The visitor is not asked to select or confirm a start. GPS cannot distinguish floors.
5. Navigation resolves the destination and searches generated floor walking areas plus the current mapped transfer data. A complete walking route opens on its first step and starts a foreground location watch. The route step selects the floor map, and a fresh GPS reading can show a dot on a geographically aligned floor. The full itinerary remains available through **Route overview**.

## Visitor API

- `GET /api/bootstrap`: visual plan metadata, provider readiness, source coverage and validated building/floor location catalogue.
- `POST /api/sessions`: creates an empty live-analysis session.
- `POST /api/sessions/:id/photo/evidence`: the only image and vision request.
- `POST /api/sessions/:id/photo/location`: metadata-only localization with a required GPS building hint.
- `POST /api/sessions/:id/navigation`: calculates a route from the automatic photo/GPS start to the requested destination.
- `POST /api/sessions/:id/navigation/surface`: returns walking cells for a custom destination point.
- `POST /api/sessions/:id/actions`: resets the session.
- `GET /api/sessions/:id`, `GET /api/health`: state and readiness.

There is no visitor API for choosing a starting doorway, selecting a starting point on a floor map or approving a connection. The old topology editor route and its write API are not mounted by the application.

## Route data and known migration gap

`server/floor-graph.ts` loads source-derived room/corridor areas for all supplied plans. `server/floor-search.ts` combines those grids with mapped corridors and floor transfers. Cross-building links are fixed source data. The current published route dataset still contains legacy hand-authored same-building stair/elevator records; replacing these with automatic transfer inference is not complete. Do not describe those records as automatically derived or add a visitor/manual approval step to compensate.

Floor-plan geographic calibration is independent from route connectivity. The campus footprint catalogue supports building-level GPS narrowing, and SE12 floor 3 has an active approximate overlay. Thirteen proposed registrations remain separate development candidates pending independent source evidence. Other floor maps hide the dot until source-grounded transforms are available. See [device location](device-location.md), [photo localization](photo-localization.md) and [floor routing](floor-routing.md).

The router preserves main's approach tiers (mapped stops, shared entrances, then corridor-side stops), shared-door departure regions, directional transfer constraints and visitor exclusions. It selects a reachable approach automatically without origin-choice fields or endpoints. Partial routes open in the overview, which marks the missing first or final segment. Guided tracking stops when the visitor opens the overview or finishes the route.

## Privacy and runtime

The private photo receipt retains structured fields and an image fingerprint for five minutes. Request media bytes are released after extraction. Session state contains no raw photo or GPS coordinates. Sessions expire after 30 minutes; the service caps sessions at 200 and API traffic at 180 requests per minute per IP.

The local listener and Vercel function share the visitor API. Vercel verifies compact source assets at cold start and shares encrypted session state across workers. Provider keys remain server-side. This is a local prototype, not a publicly hardened service.
