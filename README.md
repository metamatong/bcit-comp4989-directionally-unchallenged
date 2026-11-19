# DirectionallyUnchallenged

Add a photo, enter a destination and tap **Get Directions** for walking directions on the supplied BCIT Burnaby plans. The app reads the photo once, matches the signs to its catalogue and uses the saved walking network.

The catalogue covers **89 official floor plans in 45 buildings**. A place can have several entrances. When signs or entrances are ambiguous, select the building, floor or marked door. Continuous travel depends on the mapped approaches on each floor and the confirmed passages between them. [Floor graph coverage and regeneration](docs/floor-routing.md)

## Run locally

Requires Node.js 22+ and npm. The included source assets need no Python to run.

Clone the [project repository](https://github.com/metamatong/bcit-comp4989-directionally-unchallenged) first, or use your existing checkout:

```bash
git clone https://github.com/metamatong/bcit-comp4989-directionally-unchallenged.git
cd bcit-comp4989-directionally-unchallenged
```

Official PDFs and converted floor-plan assets are included. The private `.env`, installed dependencies, builds and temporary test files are excluded from Git.

Geometry JSON must retain LF line endings to match its recorded hashes. `.gitattributes` preserves these on Windows; `npm run data:validate` detects altered assets before photo analysis.

```bash
npm ci
# Copy .env.example to .env only if you do not already have your private .env.
npm run dev
```

Open [DirectionallyUnchallenged locally](http://127.0.0.1:3000). Keep `AI_PROVIDER=gemini` (the default) and configure `GEMINI_API_KEY`, a primary `GEMINI_MODEL`, and an ordered `GEMINI_FALLBACK_MODELS` list in the private `.env`. New installations default to Gemini 3.5 Flash-Lite with Gemini 3.8 Flash as fallback. The supported stable Flash models are Gemini 3.5 Flash, 3.5 Flash-Lite, 3.6 Flash, 3.7 Flash and 3.8 Flash. Gemini 2.5 is excluded because Google restricts it to existing users; Google does not currently list it as shut down. Set `AI_FREE_TIER_CONFIRMED=true` only after verifying model access and eligibility for your API project. Keys stay server-side. Explicit fallback settings are preserved, including an empty list to disable fallback.

To use OpenAI, set `AI_PROVIDER=openai` and fill in `OPENAI_API_KEY` in `.env`. To use Groq, set `AI_PROVIDER=groq`, fill in `GROQ_API_KEY`, and use the default `GROQ_MODEL=qwen/qwen3.8-27b`. Groq performs the same first-stage extraction through its OpenAI-compatible Responses API. The adapter combines input views into a labeled contact sheet for Groq's three-image limit. Providers never switch automatically. See [provider setup](docs/provider.md).

The Node server does not restart automatically when files change. Restart it manually after backend or environment changes: Ctrl+C, then `npm run dev`. Frontend edits can still refresh through Vite HMR on the same port. Do not launch another instance on port 3000. Without valid provider configuration, photo analysis is disabled and the app displays setup guidance.

## Vercel deployment

The Git-connected Vercel project builds the frontend and the visitor API with `npm run build:vercel`. Preview and Production use server-side settings for the selected AI provider and a free Upstash for Redis connection for expiring sessions. The build verifies the source archive and packages compact summaries for all 89 plans. The annotation editor runs on the local workstation. [Setup and Preview checks](docs/operations.md#vercel)

## Use

1. Upload or capture a photo containing a nearby room sign, then tap **Next**.
2. Enter a destination such as `SW03 2605`. Stairs are preferred by default; check **Accessibility: prefer elevators** to prefer an elevator route. This preference does not verify accessibility or elevator availability. Optionally check **Use device location with this photo** while standing where it was taken. The checkbox starts no request until submission.
3. Tap **Get Directions**. If GPS is opted in, the browser first derives building candidates and includes those IDs as uncertain context for the configured provider. The provider extracts exact visible labels, sign placement, visible door count, window side and corridor shape in the first stage; building context must not fill in unreadable text. The following location request sends only the evidence ID and optional GPS-derived building candidates. Raw device coordinates stay in the browser.
4. Source lookup selects a unique starting estimate or offers matching places. Conflicting labels, directional-only signs or a GPS contradiction produce an explanation. Scene features are retained as observations, and doorway placement helps choose the relevant label. Unavailable window/count annotations do not imply a spatial match.
5. The app resolves the destination and calculates a route over the floor walking grids and current reviewed connections. **Walking directions** shows one arrow-separated route overview, followed by a continuous stack of maps with A/B descriptions in travel order. Floor changes appear in the overview; one zoom control applies to all maps. Photo bytes, floor-plan images and destinations are sent to no later AI stage.
6. Tap **GO** on the overview to see one instruction and its map at a time. Use **Previous**, **Next step**, and **Finish route** to mark progress manually, or **Route overview** to return to all maps. Transfers offer departure and arrival maps. GO stops any optional position watch and makes no provider request.

With elevators preferred, SE12 302 to SW03 2605 enters SW03 through the east third-floor passage beside S360 and shaft 3696, follows the short approach to the east elevator, and continues on floor 2. Reviewed network revision 41 also places the floor-2 outdoor entrance beside 2696/S260, with short access to the elevator and corridor 2600; it no longer uses the doorway between 2063 and 2080. The corrected fourth-floor east passage is confirmed for both directions between SE12 and SW03. The east elevator and S360/S460 stair transfer between SW03 floors 3 and 4 are also confirmed in both directions. The visitor planner can join these records to the public corridor surfaces on the same sheet. `SE12 302 → SW03 1710` now follows the east stairs from floor 3 through floor 2 to S160 on floor 1. Both the lobby-1602 doorway and corridor-1700 doorway have reviewed arrival approaches in the confirmed travel direction toward 1710. `SW03 2604` is a distinct vestibule whose source label exists but has no reviewed arrival approach. The planner also checks drawing-derived approaches. Its costs express travel on the floor grid and transfers. Physical distance and accessibility remain unmeasured.

SE12 323 to SW03 1750 follows the common corridor outside 323 to the corridor-side lecture-room door. Where an entrance is missing, the overview can show the connected portion to a named stop on the correct floor and identify the unverified stretch. The SW03 west wing is reachable through the outdoor connection between corridors 1700 and 1900 and the S190–S299 stairs. Shafts, voids and staff-only spaces are excluded from visitor routes. [Coverage for all twelve floors of SE12, SW03 and SW01](docs/three-building-routing.md)

The full photo and four detail crops are prepared locally from the original image. The footer’s **Coverage & privacy** dialog identifies the extraction provider and data handling. The server keeps image-free evidence receipts, and the browser discards its prepared photo after locating the result, removal or navigation away. Explicit retries can reuse unexpired extraction evidence.

Expand **Device position** below the maps for optional **Show my position** tracking and manual floor selection. The initial GPS checkbox is a one-shot reading used for building candidates. GPS cannot determine a floor. Position overlay calibration currently covers SE12 floor 3. [Device-location coverage](docs/device-location.md)

## Internal connection editor

The [local topology editor](http://127.0.0.1:3000/internal/topology) maintains source-linked checkpoints, corridor traces and stair/elevator/building connections. Only current approvals and permitted directions enter routing. The east SW03 elevator and S360/S460 stairs for floors 3–4 have confirmed bidirectional transfers using the existing third-floor landing identities. Editing a point invalidates incident approvals. Local review history persists in the ignored `data/campus/topology.json`. [Editor workflow](docs/topology-editor.md)

## Checks

```bash
npm run test:unit         # Unit, API and provider regression tests
npm test                  # Unit/API plus desktop/mobile browser automation
npm run build             # Type check and production frontend build
npm run data:validate     # 90 PDF hashes and 631 derived asset hashes
npm start                 # Serve the production build locally
npm run format
npm run routes:sample         # Five unfiltered local visitor API journeys with source sign readings
npm run ai:metrics -- /path/to/server.log  # Summarize AI attempt latency and token usage
```

Tests mock AI providers and spend no provider quota. Browser automation, when requested, uses an isolated server on port 3100 with credentials disabled and installed Google Chrome. It is not a physical-phone or Safari test. The browser OCR packages, worker assets and installation hook have been removed; optional local PDF preprocessing can still use Tesseract.

Exact retrieval preserves every digit, prefix, suffix and leading zero, including `302`, `3021` and `0302`. All 5,463 original labels remain available as evidence. The visitor place index also contains floor-wide transcriptions, repeated OCR and doorway positions. The legacy pilot evidence is available with `npm run spatial:query -- resolve_spatial_labels '{"purpose":"destination","labels":["SW03 2605"]}'`.

Extraction has a 45-second server budget and uses strict OpenAI output schemas when OpenAI is selected. Retries honor that deadline and request budgets. Provider metrics record timings, payload sizes and token counts without photos, prompts or visitor identifiers. Location lookup and routing perform no model inference. [Provider details](docs/provider.md)

## Documentation

- [Supplied original brief](docs/project-brief.txt) and [current requirements coverage](docs/requirements.md)
- [Photo localization and conversion](docs/photo-localization.md)
- [Device location, calibration coverage and walking](docs/device-location.md)
- [Architecture](docs/architecture.md), [source data](docs/data.md), [operations and privacy](docs/operations.md)
- [Internal topology editor and manual connection review](docs/topology-editor.md)
- [Provider configuration and diagnostics](docs/provider.md)
- [Verification and remaining limitations](docs/verification.md)
- [Project walkthrough](docs/walkthrough.md) and [mobile landing screen](outputs/screenshots/landing-mobile-390x844.png)
- [Proposal source](docs/proposal.md) and [two-page proposal](output/pdf/proposal_groupnumber.pdf)

The latest user direction removes the synthetic fallback described in the original brief. Visitor routes combine drawing-derived walking areas with current reviewed records. Photo-label estimates and route records have not been independently field-verified. The reviewed transfers connect SE12, SW03 and SW01. Other buildings have local coverage. Closures, ETAs and accessibility remain unverified. The separately referenced assignment PDF was not supplied. Verify assignment requirements and dates against it before submission. The supplied brief lists October 21, 2026, 23:59 (timezone unspecified) for the proposal and October 22 for the presentation. Group/member placeholders remain. Coursework submission is separate from hosting the visitor app.

## Project hierarchy

```text
mvp/
├── README.md, AGENTS.md
├── package.json, package-lock.json, tsconfig.json, vite.config.ts, vercel.json
├── vitest.config.ts, playwright.config.ts
├── .env.example, .gitignore, .gitattributes, .prettierrc.json, .prettierignore
├── requirements-data.txt, index.html
├── src/
│   ├── App.tsx, main.tsx, styles.css, wayfinding.ts, wayfinding.css
│   ├── TopologyEditor.tsx, topology.ts, topology.css
│   ├── api.ts, ai-provider.ts, photo.ts, photo-views.ts, types.ts
│   ├── location/  Device acquisition, building hints, page projection and foreground lifecycle
│   └── components/  Photo/result inputs, RouteDirections, GuidedDirections, FloorPointPicker, device position and topology review
├── server/
│   ├── index.ts, app.ts, runtime.ts, configured-app.ts, vercel.ts
│   ├── visitor-api.ts, visitor-sessions.ts, redis-visitor-sessions.ts
│   ├── provider.ts, provider-config.ts, provider-budget.ts, provider-timing.ts, provider-metrics.ts
│   ├── openai-provider.ts, openai-input.ts, openai-schema.ts, openai-response.ts, openai-stream.ts
│   ├── floor-graph.ts, floor-interior.ts, floor-search.ts, route-queue.ts, map-points.ts
│   ├── floor-coverage.ts, shared-corridor.ts, campus-journey.ts, floor-checkpoints.ts, routing-readiness.ts
│   ├── label-localization.ts, starting-place-evidence.ts, session.ts
│   ├── photo-localization.ts, photo-plan-context.ts  Legacy source-comparison utilities
│   ├── photo-evidence.ts, photo-media.ts, photo-grounding.ts, photo-doorways.ts, room-labels.ts
│   ├── topology.ts, topology-api.ts, routing.ts, visitor-paths.ts
│   ├── wayfinding.ts, generated-route.ts, route-geometry.ts
│   ├── topology-candidates.ts, topology-provenance.ts, topology-import.ts, topology-english.ts
│   ├── pilot-evidence.ts, pilot-network.ts, pilot-inquiries.ts
│   ├── spatial-retrieval.ts, pilot-tools.ts
│   ├── geolocation.ts              Source-bound calibration validation
│   └── data.ts, visual-data.ts
├── data/campus/
│   ├── floor-plans-source.html, manifest.json, coverage.json, catalogue.json
│   ├── graph.json, landmarks.json  Legacy empty placeholders, not used by routing
│   ├── topology.json              Local annotations and review history, created on first use and ignored by Git
│   ├── topology-english-migration.json  Fingerprints of earlier application text and translated definitions
│   ├── connection-candidates.json  Unverified source-grounded questions; never route edges
│   ├── raw/                       90 unmodified official PDFs
│   ├── spatial/                   pilot-ocr, plan-annotations, reviewed-network, passage-inquiries, corridor-traces, floor-circulation and floor-graphs JSON and checksums
│   ├── geolocation/               Archived official GIS footprints and floor calibration records
│   ├── text/                      Extracted text, boxes and provenance
│   └── visual/                    index.json, png/, geometry/, atlas/
├── scripts/
│   ├── prepare_maps.py, prepare_visual_maps.py, prepare_pilot_labels.py
│   ├── export-pilot-network.ts, query-spatial.ts
│   ├── floor_graph/              Floor compiler, source labels, doors, walking surfaces and landing access
│   │   ├── cad_layers.py, cad_spaces.py, cad_routing.py, cad_places.py, cad_doorways.py
│   │   ├── cad_frontages.py, cad_landings.py, open_fronts.py, public_components.py, terminal_paths.py
│   │   ├── corridor_frontages.py, landing_access.py, passage_openings.py
│   │   └── drawing_frontages.py, door_stations.py, corridor_vicinities.py, suite_entries.py
│   ├── sample-floor-routes.ts, report-building-coverage.ts, prepare-geolocation.ts
│   ├── validate-data.ts, build-vercel.ts, summarize-ai-metrics.ts
│   └── render_proposal.py
├── tests/
│   ├── visitor-sessions.test.ts
│   ├── api.test.ts, client-state.test.ts, data.test.ts, visual-data.test.ts, runtime.test.ts
│   ├── provider.test.ts, provider-response.test.ts, provider-config.test.ts
│   ├── openai-provider.test.ts, openai-api.test.ts, spatial-retrieval.test.ts
│   ├── ai-runtime.test.ts, photo-plan-context.test.ts, openai-schema.test.ts
│   ├── photo-localization.test.ts, photo-doorways.test.ts, photo-api.test.ts, route-results.test.ts
│   ├── photo.test.ts, photo-location-input.test.ts, room-labels.test.ts, photo-fixtures.ts
│   ├── device-location.test.ts, browser-location.test.ts, device-location-lifecycle.test.ts, location-fixtures.ts
│   ├── topology.test.ts, topology-api.test.ts, topology-editor.test.ts
│   ├── topology-candidates.test.ts, topology-english.test.ts, wayfinding.test.ts, wayfinding-api.test.ts
│   ├── ai-wayfinding.test.ts, wayfinding-fixtures.ts, route-geometry.test.ts, route-recovery.test.ts
│   ├── reviewed-navigation.test.ts, label-localization.test.ts, floor-four-passage.test.ts
│   ├── se12-floor-transfers.test.ts, shared-corridor.test.ts, west-wing-routes.test.ts
│   ├── sw03-sw01-passages.test.ts, sw01-spaces.test.ts, test_passage_openings.py, test_sw01_cad.py
│   ├── sw03-1710-route.test.ts, route-coverage-message.test.ts, three-building-coverage.test.ts
│   ├── route-preference.test.ts, guided-directions.test.ts
│   ├── route-preference.test.ts, guided-directions.test.ts
│   └── e2e/journey.spec.ts, photo.spec.ts
├── docs/
│   ├── project-brief.txt, requirements.md, architecture.md, data.md
│   ├── provider.md, operations.md, photo-localization.md, walkthrough.md
│   ├── device-location.md, floor-routing.md, sw01-routing.md
│   ├── three-building-routing.md, three-building-coverage.csv
│   ├── verification.md, proposal.md, topology-editor.md, spatial-retrieval.md
│   └── screenshots/  Automated test artifacts; mocked results are labeled
├── output/pdf/proposal_groupnumber.pdf
├── outputs/screenshots/landing-mobile-390x844.png
└── .vercel/, dist/, node_modules/, test-results/, tmp/  Generated local output
```

Original BCIT documents retain their attribution and usage restrictions; no endorsement is implied. See the source manifest and data notes.
