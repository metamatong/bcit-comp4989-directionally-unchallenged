# DirectionallyUnchallenged

Enter a destination and take a photo to find a reviewed walking route in the BCIT Burnaby SE12, SW03 and SW01 pilot. Gemini reads the photo, then compares it with the eligible source plans. After you confirm the region and your starting point, the app displays directions on each relevant floor.

The internal reference dataset contains **89 official floor plans covering 45 Burnaby buildings**, plus the campus map. All floor plans have PNGs and structured geometry JSON. Photo results are **unverified AI location hypotheses**. A separate local topology editor supports T/F/unknown candidate confirmation, manual annotation and route checks for SE12, SW03 and SW01. The visitor planner reads current approvals from that editor. It displays a coverage gap for destinations without a reviewed approach.

This does not train a model on BCIT. Gemini is pretrained and compares a photo with plan drawings; the plans are not labeled camera-view examples, so reliable exact positioning is not guaranteed.

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

Open [DirectionallyUnchallenged locally](http://127.0.0.1:3000). Configure `GEMINI_API_KEY`, a primary `GEMINI_MODEL`, and an ordered `GEMINI_FALLBACK_MODELS` list in the private `.env`. New installations default to Gemini 3.5 Flash-Lite with Gemini 3.8 Flash as fallback; Google lists both on its free tier. Existing primary selections are preserved; a 3.8 primary defaults to a 3.5 Flash-Lite backup. Gemini 2.5 is no longer an automatic fallback because Google restricts generation access for new users. Set `AI_FREE_TIER_CONFIRMED=true` only after verifying model access and eligibility for your API project. Keys stay server-side. Explicit fallback settings are preserved, including an empty list to disable fallback.

The Node server does not restart automatically when files change. Restart it manually after backend or environment changes: Ctrl+C, then `npm run dev`. Frontend edits can still refresh through Vite HMR on the same port. Do not launch another instance on port 3000. Without valid provider configuration, photo analysis is disabled and the app displays setup guidance.

## Use

A destination and a starting photo open a walking itinerary. A photo-only submission shows the location evidence.

1. Use **Upload photo** or **Take a photo** directly in the first screen's **Find my location** section.
2. Enter a destination such as `SW03 3615` and select **Find my route** to send the selected photo and its detail views to Google Gemini. You can also run a photo-only comparison and enter the destination later.
3. Choose **Start at …** for the marked door or checkpoint where you are standing. This confirms the photo area and the specific route start in one action. Choose the intended place if the destination label has several matches. Insufficient evidence or a missing reviewed connection produces a coverage message.
4. **Walking directions** shows all floor plans in travel order. Follow the arrows on each floor and the instructions for crossing buildings or changing floors. **One floor at a time** opens manual floor navigation. **Edit photo or destination** and **Photo location evidence** are available below the itinerary. **Start over** clears the current result.

A connected example runs from the SW03 2605 door opposite vestibule 2604 to the SW03 3615 door opposite vestibule 3604 via the east elevator. SE12 floor 2 joins this network at its exterior door and floor 3 at its indoor passage. SW01 has searchable labels and zero reviewed connections in this revision. `SW01 2004` shows its source location and `SW03 2458` returns no exact match.

The photo workflow is inline, with no location popup or extra launch button. A submission button and a short Gemini data-use notice appear after choosing a photo. The full view and four detail crops are prepared locally from the original image. Pressing the analysis button authorizes both photo requests for that submission. No photo is saved in application storage. Removing a photo, confirming a result or leaving the page discards the browser's prepared photo. Mobile capture uses the device's photo picker/camera; the app has no live camera preview or movement tracking. Google's free-tier data handling applies.

## Internal connection editor

Open [the local topology editor](http://127.0.0.1:3000/internal/topology) after starting or restarting the server. It works without a Gemini key and is separate from the photo screen. Access is limited to this computer through `localhost` or `127.0.0.1` (IPv6 loopback also works); it is not a phone/LAN editing service.

1. The default **후보 확인 · T / F** view selects the first unanswered proposal. Enter a reviewer name or nickname, compare the two official floor plans and answer **T**, **F** or **모름**. For stairs and elevators the direction choices show the floor numbers.
2. After T, explicitly choose **양방향 A ↔ B**, **A → B만**, **B → A만**, or **모름**. T plus a known direction records approval of the displayed endpoints and that passage in one atomic save. F and unknown are saved without adding routes; an unknown direction also stays outside routing.
3. If a proposed marker or floor is wrong, use **A/B 위치·층 수정** before answering. Changing a floor clears the point; mark its actual position on the new plan. Saved answers include exact endpoint snapshots, original-source hashes, reviewer, time, direction and optional notes. They are labeled **user confirmation**, not a claim that a field visit occurred.
4. Use **직접 수정 · 경로 확인** for the original manual point/connection editor or route checker. The confirmed proposal also offers **이 연결의 경로 확인** with its endpoints selected. **Fewest recorded connections** minimizes edge count; **Shortest recorded distance** uses only approved, measured edges and cannot compare unmeasured alternatives.

The catalogue contains three building-passage reviews, nine floor 2–3 reviews and two SW03 corridor reviews. The corridor questions use the previously reviewed door and lift stop on each floor. Open **후보 확인 · T / F** and check whether the entire corridor between A and B is passable, then record its permitted direction. [Floor-by-floor evidence](docs/topology-editor.md#stairs-and-elevators-between-floors-2-and-3)

The indoor journey from SE12 room 302 to SW03 office 2082 uses two additional corridor reviews. The revision 28 snapshot includes both bidirectional approvals for new installations. Open the [SE12 floor 3 segment](http://127.0.0.1:3000/internal/topology?candidate=se12-f3-302-to-sw03-link) and the [SW03 floor 2 segment](http://127.0.0.1:3000/internal/topology?candidate=sw3-f2-exterior-door-to-2082) to inspect the marked lines and the recorded directions. The third-floor building passage and the SW03 east elevator already have current approvals.

At revision 28 the user has confirmed seven stair pairs, the SW03 east elevator, two building crossings and six indoor corridor segments in both directions. Four room doorways now have reviewed approaches. The SE12 elevator inquiry has a final F response. The fourth-floor building passage is in draft. [Pilot route and its endpoints](docs/topology-editor.md#first-continuous-route)

The user also reported that part of SE12 floor 2 meets the ground. This is context, not a universal floor-to-elevation mapping, an entrance position, or evidence of step-free access. Second-floor travel is represented as an outdoor passage between source-linked exterior doors, with unknown distance and intermediate geometry. More candidates require source-grounded preparation; there is no automatic all-building reconstruction or runtime Gemini call for this workflow. F rejects only the presented candidate, not every possible path between the buildings. Changing a prior T to F, unknown or unknown direction withdraws that candidate connection from routing while preserving answer history.

Plan reviews, user confirmations and dated field observations are recorded separately. The manual editor remains available for adding corridors and transitions outside the prepared questions. Editing a point clears its own and its incident connections' approvals; editing a connection clears that connection's approval. Withdrawing point approval also invalidates its connections. Re-review is explicit. The two-stage photo analysis never creates or approves topology and its user-confirmed region does not automatically become a route start.

A fresh checkout initializes the editor from the approved public network. Further edits and the private review history persist across reloads and restarts in the Git-ignored `data/campus/topology.json`. Existing workstations retain their original records. **Export saved graph** downloads a backup; unsaved form edits are not included. Revision checks reject conflicting edits from another tab. See [the topology workflow, storage and recovery guide](docs/topology-editor.md).

## Checks

```bash
npm run test:unit         # Unit, API and provider regression tests
npm test                  # Unit/API plus desktop/mobile browser automation
npm run build             # Type check and production frontend build
npm run data:validate     # 90 PDF hashes and 631 derived asset hashes
npm start                 # Serve the production build locally
npm run format
```

Tests mock Gemini and spend no provider quota. Browser automation, when requested, uses an isolated server on port 3100 with credentials disabled and installed Google Chrome. It is not a physical-phone or Safari test. The browser OCR packages, worker assets and installation hook have been removed; optional local PDF preprocessing can still use Tesseract.

SE12, SW03 and SW01 have a server-side spatial index across floors 1–4. It includes 378 source-read labels, 20 drawn door locations, whole-page OCR evidence and a revisioned graph of 24 approved checkpoints and 16 passages. Try a label with `npm run spatial:query -- resolve_spatial_labels '{"purpose":"destination","labels":["SW03 2605"]}'`. Unknown labels return `unsupported`. [Tool contracts, coverage and examples](docs/spatial-retrieval.md)

Photo retrieval preserves exact identifiers, including `302`, `3021` and `0302`. All 5,463 original labels remain available as source evidence. The second stage uses the pilot drawing index to retrieve matching observations and their page boxes. Optical-only hits go through visual shortlisting. Detailed photo-to-plan comparison and user confirmation follow.

During photo analysis the input shows the current step and elapsed time. A failure appears next to the photo with its cause and an explicit retry button. A retry reuses any valid label reading and recovers an expired session with the same selected photo.

Photo reading/shortlisting and detailed comparison use 4,096/8,192-token allowances with bounded thinking. When a Gemini model hits quota, is unavailable, or returns an unusable response, the server tries the configured Gemini fallback models. Incomplete responses cannot become location results. See [provider notes](docs/provider.md).

## Documentation

- [Supplied original brief](docs/project-brief.txt) and [current requirements coverage](docs/requirements.md)
- [Photo localization and conversion](docs/photo-localization.md)
- [Architecture](docs/architecture.md), [source data](docs/data.md), [operations and privacy](docs/operations.md)
- [Internal topology editor and manual connection review](docs/topology-editor.md)
- [Provider configuration and diagnostics](docs/provider.md)
- [Verification and remaining limitations](docs/verification.md)
- [Project walkthrough](docs/walkthrough.md) and [mobile landing screen](outputs/screenshots/landing-mobile-390x844.png)
- [Proposal source](docs/proposal.md) and [two-page proposal](output/pdf/proposal_groupnumber.pdf)

The latest user direction removes the synthetic fallback described in the original brief. Visitor directions use approved passages and source-bound walking traces. Closures, ETAs, campus-wide routing and accessibility remain outside this pilot. The separately referenced assignment PDF was not supplied. Verify assignment requirements and dates against it before submission. The supplied brief lists October 21, 2026, 23:59 (timezone unspecified) for the proposal and October 22 for the presentation. Group/member placeholders remain. No coursework has been submitted and the app has not been deployed.

## Project hierarchy

```text
mvp/
├── README.md, AGENTS.md
├── package.json, package-lock.json, tsconfig.json, vite.config.ts
├── vitest.config.ts, playwright.config.ts
├── .env.example, .gitignore, .gitattributes, .prettierrc.json, .prettierignore
├── requirements-data.txt, index.html
├── src/
│   ├── App.tsx, main.tsx, styles.css, wayfinding.ts, wayfinding.css
│   ├── TopologyEditor.tsx, topology.ts, topology.css
│   ├── api.ts, photo.ts, photo-views.ts, types.ts
│   └── components/  PhotoLocationInput, CampusLocationResults, JourneyPanel, RouteDirections, RouteMap, TopologyPlan, TopologyForms, ConnectionReview
├── server/
│   ├── index.ts, app.ts, runtime.ts
│   ├── provider.ts, photo-localization.ts, session.ts
│   ├── photo-evidence.ts, photo-media.ts, photo-grounding.ts, photo-doorways.ts, room-labels.ts
│   ├── topology.ts, topology-api.ts, routing.ts, visitor-paths.ts, wayfinding.ts
│   ├── topology-candidates.ts, topology-provenance.ts, topology-import.ts
│   ├── pilot-evidence.ts, pilot-network.ts, pilot-inquiries.ts
│   ├── spatial-retrieval.ts, pilot-tools.ts
│   └── data.ts, visual-data.ts
├── data/campus/
│   ├── floor-plans-source.html, manifest.json, coverage.json, catalogue.json
│   ├── graph.json, landmarks.json  Legacy empty placeholders, not used by routing
│   ├── topology.json              Local annotations and review history, created on first use and ignored by Git
│   ├── connection-candidates.json  Unverified source-grounded questions; never route edges
│   ├── raw/                       90 unmodified official PDFs
│   ├── spatial/                   pilot-ocr, plan-annotations, reviewed-network, passage-inquiries, corridor-traces JSON and checksums
│   ├── text/                      Extracted text, boxes and provenance
│   └── visual/                    index.json, png/, geometry/, atlas/
├── scripts/
│   ├── prepare_maps.py, prepare_visual_maps.py, prepare_pilot_labels.py
│   ├── export-pilot-network.ts, query-spatial.ts
│   ├── validate-data.ts
│   └── render_proposal.py
├── tests/
│   ├── api.test.ts, client-state.test.ts, data.test.ts, visual-data.test.ts, runtime.test.ts
│   ├── provider.test.ts, provider-response.test.ts, spatial-retrieval.test.ts
│   ├── photo-localization.test.ts, photo-doorways.test.ts, photo-api.test.ts, route-results.test.ts
│   ├── photo.test.ts, photo-location-input.test.ts, room-labels.test.ts, photo-fixtures.ts
│   ├── topology.test.ts, topology-api.test.ts, topology-editor.test.ts
│   ├── topology-candidates.test.ts, wayfinding.test.ts, wayfinding-api.test.ts
│   └── e2e/journey.spec.ts, photo.spec.ts
├── docs/
│   ├── project-brief.txt, requirements.md, architecture.md, data.md
│   ├── provider.md, operations.md, photo-localization.md, walkthrough.md
│   ├── verification.md, proposal.md, topology-editor.md, spatial-retrieval.md
│   └── screenshots/  Automated test artifacts; mocked results are labeled
├── output/pdf/proposal_groupnumber.pdf
├── outputs/screenshots/landing-mobile-390x844.png
└── dist/, node_modules/, test-results/, tmp/  Generated local output
```

Original BCIT documents retain their attribution and usage restrictions; no endorsement is implied. See the source manifest and data notes.
