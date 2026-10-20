# CampusLens

A mobile-friendly BCIT Burnaby photo-to-floor-plan app. Gemini first reads visible room labels from the photo and detail crops. The server retrieves exact matches from all extracted floor-plan labels, then Gemini compares the photo with real plan images and geometry to propose a source-linked region.

The internal reference dataset contains **89 official floor plans covering 45 Burnaby buildings**, plus the campus map. All floor plans have PNGs and structured geometry JSON. Results are **unverified AI location hypotheses**. Real walking routes remain unsupported.

This does not train a model on BCIT. Gemini is pretrained and compares a photo with plan drawings; the plans are not labeled camera-view examples, so reliable exact positioning is not guaranteed.

## Run locally

Requires Node.js 22+ and npm. The included source assets need no Python to run.

Clone the [project repository](https://github.com/metamatong/bcit-comp4989-directionally-unchallenged) first, or use your existing checkout:

```bash
git clone https://github.com/metamatong/bcit-comp4989-directionally-unchallenged.git
cd bcit-comp4989-directionally-unchallenged
```

Official PDFs and converted floor-plan assets are included. The private `.env`, installed dependencies, builds and temporary test files are excluded from Git.

```bash
npm ci
# Copy .env.example to .env only if you do not already have your private .env.
npm run dev
```

Open [CampusLens locally](http://127.0.0.1:3000). Configure `GEMINI_API_KEY`, a primary `GEMINI_MODEL`, and an ordered `GEMINI_FALLBACK_MODELS` list in the private `.env`. New installations default to Gemini 3.5 Flash-Lite with Gemini 3.8 Flash as fallback; Google lists both on its free tier. Existing primary selections are preserved; a 3.8 primary defaults to a 3.5 Flash-Lite backup. Gemini 2.5 is no longer an automatic fallback because Google restricts generation access for new users. Set `AI_FREE_TIER_CONFIRMED=true` only after verifying model access and eligibility for your API project. Keys stay server-side. Explicit fallback settings are preserved, including an empty list to disable fallback.

The Node server does not restart automatically when files change. Restart it manually after backend or environment changes: Ctrl+C, then `npm run dev`. Frontend edits can still refresh through Vite HMR on the same port. Do not launch another instance on port 3000. Without valid provider configuration, photo analysis is disabled and the app displays setup guidance.

## Use

There is no Campus library, general plan browser, or introductory marketing banner. Start with photo input; the result shows the matching plan region and links to that plan. Full source data and geometry remain available to Gemini on the server.

1. Use **Upload photo** or **Take a photo** directly in the first screen's **Find my location** section.
2. Agree to send this photo and its detail views to Google, then select Analyze. Label reading and location comparison run as two separate API requests.
3. Review the single best source-linked estimate, or take another photo if the evidence is unclear.
4. Review results below the photo input and confirm the estimate only if it matches your surroundings. **Clear** removes the result. **Remove photo** discards the local preview; **Cancel analysis** stops an active comparison.

The photo workflow is inline, with no location popup or extra launch button. Consent and analysis controls appear after choosing a photo. The full view and four detail crops are prepared locally from the original image. Photos are sent only after per-photo consent and submission. No photo is saved in application storage. Removing a photo, confirming a result or leaving the page discards the browser's prepared photo. Mobile capture uses the device's photo picker/camera; the app has no live camera preview or movement tracking. Google's free-tier data handling applies.

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

Exact retrieval uses all 5,463 extracted source labels, including SE12 floor 3 room `302` beyond the former 80-label cutoff. `302` never matches `3021` or `0302`. The two API stages use a short-lived evidence ID bound to the same photo/crops; no image bytes are stored between stages. Clear exact matches go directly to detailed plan comparison; unreadable or ambiguous labels can still use visual shortlisting.

Photo reading/shortlisting and detailed comparison use 4,096/8,192-token allowances with bounded thinking. When a Gemini model hits quota, is unavailable, or returns an unusable response, the server tries the configured Gemini fallback models. Incomplete responses cannot become location results. See [provider notes](docs/provider.md).

## Documentation

- [Supplied original brief](docs/project-brief.txt) and [current requirements coverage](docs/requirements.md)
- [Photo localization and conversion](docs/photo-localization.md)
- [Architecture](docs/architecture.md), [source data](docs/data.md), [operations and privacy](docs/operations.md)
- [Provider configuration and diagnostics](docs/provider.md)
- [Verification and remaining limitations](docs/verification.md)
- [Project walkthrough](docs/walkthrough.md)
- [Proposal source](docs/proposal.md) and [two-page proposal](output/pdf/proposal_groupnumber.pdf)

The latest user direction removes the synthetic fallback described in the original brief. Destination routing, closures and ETAs await verified campus topology. The separately referenced assignment PDF was not supplied. Verify assignment requirements and dates against it before submission. The supplied brief lists October 21, 2026, 23:59 (timezone unspecified) for the proposal and October 22 for the presentation. Group/member placeholders remain. No coursework has been submitted and the app has not been deployed.

## Project hierarchy

```text
mvp/
├── README.md, AGENTS.md
├── package.json, package-lock.json, tsconfig.json, vite.config.ts
├── vitest.config.ts, playwright.config.ts
├── .env.example, .gitignore, .prettierrc.json, .prettierignore
├── requirements-data.txt, index.html
├── src/
│   ├── App.tsx, main.tsx, styles.css
│   ├── api.ts, photo.ts, photo-views.ts, types.ts
│   └── components/  PhotoLocationInput, CampusLocationResults
├── server/
│   ├── index.ts, app.ts, runtime.ts
│   ├── provider.ts, photo-localization.ts, session.ts
│   ├── photo-evidence.ts, photo-media.ts, room-labels.ts
│   └── data.ts, visual-data.ts
├── data/campus/
│   ├── floor-plans-source.html, manifest.json, coverage.json, catalogue.json
│   ├── graph.json, landmarks.json  Empty placeholders for reviewed real records
│   ├── raw/                       90 unmodified official PDFs
│   ├── text/                      Extracted text, boxes and provenance
│   └── visual/                    index.json, png/, geometry/, atlas/
├── scripts/
│   ├── prepare_maps.py, prepare_visual_maps.py
│   ├── validate-data.ts
│   └── render_proposal.py
├── tests/
│   ├── api.test.ts, client-state.test.ts, data.test.ts, runtime.test.ts
│   ├── provider.test.ts, provider-response.test.ts
│   ├── photo-localization.test.ts, photo-api.test.ts
│   ├── photo.test.ts, photo-location-input.test.ts, room-labels.test.ts, photo-fixtures.ts
│   └── e2e/journey.spec.ts, photo.spec.ts
├── docs/
│   ├── project-brief.txt, requirements.md, architecture.md, data.md
│   ├── provider.md, operations.md, photo-localization.md, walkthrough.md
│   ├── verification.md, proposal.md
│   └── screenshots/  Automated test artifacts; mocked results are labeled
├── output/pdf/proposal_groupnumber.pdf
└── dist/, node_modules/, test-results/, tmp/  Generated local output
```

Original BCIT documents retain their attribution and usage restrictions; no endorsement is implied. See the source manifest and data notes.
