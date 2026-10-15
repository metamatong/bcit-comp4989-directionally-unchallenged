# CampusLens

A mobile-friendly BCIT Burnaby photo-to-floor-plan app. Gemini compares an uploaded photograph with real BCIT floor-plan PNGs and extracted geometry, then proposes source-linked regions for review.

The library contains **89 official floor plans covering 45 Burnaby buildings**, plus the campus map. All floor plans have PNGs and structured geometry JSON. Results are **unverified AI location hypotheses**. Real walking routes remain unsupported.

Demo mode has been removed: no fictional places, sample-photo button, manual demo landmarks, simulated closures, or synthetic routing. Gemini is the only analysis path. Provider failures show a setup or retry message; the official plan library remains available.

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

Open [CampusLens locally](http://127.0.0.1:3000). Configure `GEMINI_API_KEY` and an eligible `GEMINI_MODEL` in the private `.env`. Set `AI_FREE_TIER_CONFIRMED=true` only after verifying that API project's free tier. Supported models are `gemini-3.5-flash-lite`, `gemini-3.6-flash` and `gemini-3.8-flash`. Keys stay server-side. The existing private key/model are preserved.

Restart the existing server after backend or environment changes: Ctrl+C, then `npm run dev`. Do not launch another instance on port 3000. Development reloads use that same port. Without valid provider configuration, photo analysis is disabled and the app displays setup guidance; browsing official plans still works.

`AI_DEFAULT_MODE` is no longer used. Old browser mode preferences are cleared automatically, and removed mode/fixture/simulation API actions are rejected.

## Use

1. Select **Find my location**, then upload or capture a campus photo.
2. Optionally provide context or a building hint. A readable sign is not required.
3. Agree to send this photo to Google and select **Analyze photo against BCIT plans**.
4. Review possible regions, image/geometry evidence, uncertainty and original sources. Gemini can ask for another view instead of proposing a match.
5. Confirm a possible region that agrees with your surroundings. **Clear analysis** removes the current result.

Photos are prepared locally and sent only after per-photo consent and submission. No photo is saved in application storage. Google's free-tier data handling applies. Camera preview captures only when requested; it does not track movement or provide walking directions.

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

Photo comparison uses low thinking and 4,096/8,192-token selection/detail allowances. Incomplete responses cannot become location results. HTTP 429 requires waiting for Google's quota; HTTP 503 indicates provider unavailability. No alternate model or sample result is substituted. See [provider notes](docs/provider.md).

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
│   ├── api.ts, photo.ts, types.ts
│   └── components/  CameraCapture, CampusLibrary, CampusLocationResults
├── server/
│   ├── index.ts, app.ts, runtime.ts
│   ├── provider.ts, photo-localization.ts, session.ts
│   └── data.ts, retrieval.ts, visual-data.ts
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
