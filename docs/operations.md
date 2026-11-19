# Operations and privacy

## Setup

Use Node.js 22+, `npm ci`, and `npm run dev`. The app defaults to `127.0.0.1:3000`; frontend edits can refresh through Vite HMR on the existing listener. The Node server does not restart automatically for file changes. Restart it manually after backend, environment or regenerated data changes. A duplicate launch fails clearly; do not start another instance on the same port.

With `AI_PROVIDER=gemini` (default), set `GEMINI_API_KEY` in private `.env`, choose a primary `GEMINI_MODEL`, and set an ordered comma-separated `GEMINI_FALLBACK_MODELS` list. Supported stable Flash models are Gemini 3.5 Flash, 3.5 Flash-Lite, 3.6 Flash, 3.7 Flash and 3.8 Flash. Defaults use Gemini 3.5 Flash-Lite and Gemini 3.8 Flash. An existing 3.8 primary defaults to a 3.5 Flash-Lite backup. Gemini 2.5 is excluded because Google restricts it to existing users, although it is not currently listed as shut down. Verify eligibility and generation access for the specific API project before setting `AI_FREE_TIER_CONFIRMED=true`; model metadata can return HTTP 200 even when generation returns 404. `.env.example` is a keyless template. Never put secrets in frontend variables. `AI_DEFAULT_MODE` is obsolete and ignored. No mode switch or synthetic location fallback exists.

For paid OpenAI, set `AI_PROVIDER=openai`, fill `OPENAI_API_KEY`, keep `OPENAI_MODEL=luna-6.0` (alias for `gpt-6-luna`) or select another compatible API model, then restart. OpenAI ignores Gemini settings and free-tier confirmation. The selected provider is shown in readiness and per-photo disclosure. There is no automatic provider switch. [Adapter and privacy details](provider.md)

For Groq, set `AI_PROVIDER=groq`, fill `GROQ_API_KEY`, and keep `GROQ_MODEL=qwen/qwen3.8-27b` unless the adapter is updated for another Groq vision model. The Groq adapter uses the OpenAI-compatible Responses API and combines photo/plan views into one labeled contact sheet to fit the model's image limit. Groq rate limits and any account billing apply; check the Groq console before relying on free quota. Groq may retain request data for up to 30 days for reliability and abuse monitoring. [Groq data controls](https://console.groq.com/docs/your-data)

Without provider configuration, users see setup guidance. Photo submission is disabled in the client and rejected by the server. With configuration, tapping **Get Directions** authorizes one photo evidence extraction stage. Exact-label location lookup and reviewed-graph routing run locally using the structured result.

## Vercel

Connect the GitHub repository to Vercel and track `main` for Production. The repository build command writes Build Output API v3 artifacts to `.vercel/output`. It validates the 90 source PDFs and 631 derived assets, then packages verified PNGs, source-bound geometry summaries and the published reviewed network. Source PDF links resolve to BCIT. The build constructs the hosted routing snapshot from the reviewed network in Git. Local annotations stay on the workstation.

Configure `AI_PROVIDER` and its server-side key/model settings for each target environment. Gemini requires verified free-tier confirmation; OpenAI requires paid API access. Connect Upstash for Redis to Preview and Production with its free plan and automatic upgrades disabled. The integration supplies `KV_REST_API_URL` and `KV_REST_API_TOKEN`. Hosted workers use encrypted session records with a 30-minute expiry. Photo label evidence has its own five-minute expiry. The database receives neither photo bytes nor device coordinates. A per-session lease protects revisions and retries across workers. All workers using the same provider key share its rolling request budget.

Each Vercel build loads its packaged function and checks both SE12 302 to SW03 1730 and SE12 323 to SW03 1750 at their actual corridor-side doors. `GET /api/health?check=routing` runs the same check on Preview or Production and reports the loaded floor graph version, topology revision and floors visited. It uses fixed sign evidence, the visitor router and the published plans, and returns HTTP 503 if either journey is unavailable. A hosted worker caches the check against its immutable map. The ordinary `GET /api/health` remains a lightweight liveness check.

To verify photo extraction as well, use a consented test photo and destination through the visitor flow. Check the returned plan image URLs and that `/internal/topology` denies access. A merge into the tracked production branch starts a new deployment. [Vercel Git deployments](https://vercel.com/docs/git#production-branch)

## Media and state

The browser accepts JPEG/PNG/WebP up to 8 MB and 50 million pixels, creates a full view and four overlapping original-image crops, each with at most a 1,600-pixel long edge and 450 KB JPEG bytes, without original metadata. The server limits photo bodies to 4 MB and aggregate decoded bytes across all five views to 2.5 MB. Only the extraction stage sends the consented image bundle transiently to the selected provider. The following location request contains the evidence ID and optional GPS-derived building candidates. The application saves no media to disk, caches or session logs. The Coverage & privacy dialog identifies the provider and its data handling. OpenAI requests disable response storage.

Mobile photo capture uses the browser/device photo picker. Optional device location is available as a one-shot initial building hint and as an explicitly started foreground walking overlay. Phone geolocation requires HTTPS and permission. Physical-device capture and geolocation behavior remain unverified. [Controls and coverage](device-location.md)

The visitor flow is **photo → Next → destination → Get Directions → overview → GO → steps**. The notice identifies the extraction provider. The first request carries the photo and original-image detail views. The next request carries only the evidence ID and optional GPS building candidates. The app displays **Starting area estimated** for a unique source match and requests the route from the reviewed graph. A missing source match or connection produces a coverage explanation. A newly selected photo clears the previous route.

Routes exist only in the active browser view. Editing the destination or replacing the photo clears directions. Recheck recalculates from the saved starting estimate and the current approved graph, without a provider request.

First-stage evidence IDs expire after five minutes and are bound to a session and image/crop fingerprint. No media is stored between API stages. A failed location lookup may retry with the accepted evidence until expiry. Session results expire after 30 minutes. Reload creates a new session. Clear analysis removes the current result. Device coordinates stay in browser memory. The optional initial-location request sends derived building candidates, accuracy, timestamp and source hash to the app, while provider requests omit all GPS data. Walking tracking requires an explicit start and pauses when the page hides. Browser/device location services have their own handling. Obsolete mode preferences are removed from browser storage. API responses use `no-store` and reject cross-origin requests.

## Failures and recovery

- Configuration errors: fix the selected provider and private server key/model settings (plus Gemini free-tier confirmation when applicable), restart and refresh.
- Gemini quota, temporary service or response errors: try the configured Gemini fallbacks. If they also fail, the error is shown and no substitute location is generated.
- `response_limit`: no partial result is applied. The next configured model may be tried; otherwise, retake the photo and retry.
- A slow model: the server temporarily prioritizes an available configured backup. The photo status reports the failed stage and cause. A retry keeps the selected photo and reuses unexpired readings when possible. An expired session is renewed once on submission.
- Insufficient evidence: provide another view. This is an analysis result, not a transport failure.

Fallback is limited to configured Gemini models in this checkout; there is no sample-location substitution. Refresh state after an interrupted connection before retrying. Per-photo consent, typed validation and source constraints remain required. Photo selection is an unverified app hypothesis, not a field-verified user position.

## Validation

`npm run test:unit` checks code/API contracts, `npm run build` checks TypeScript and builds production files, and `npm run data:validate` checks official assets. `npm test` additionally runs browser automation with both providers disabled on isolated port 3100. The user currently requested no further screen checks. No live provider calls are needed for regression tests.

Keep infrastructure smoke tests, live provider results and physical-campus evaluation separate. See [verification](verification.md) and [provider notes](provider.md).

## Local topology editing

`/internal/topology` is a separate local workstation tool for manually annotating SE12/SW03/SW01, independent of either AI provider. The page and `/api/internal/topology` require loopback access and a local Host header, with cross-site requests rejected. Remote/LAN and phone access are not enabled by changing `HOST`; there is no remote staff authentication.

Annotations, textual evidence and self-entered reviewer names persist in the Git-ignored `data/campus/topology.json`. A fresh checkout initializes this file from the public network on first use. They do not contain photos or session location histories. Export saved graph provides a revisioned JSON backup. Writes use an exclusive file lock, optimistic revision checks and atomic replacement. Invalid storage is not automatically reset. Stop the server before restoring backups or removing an abandoned lock. Detailed recovery, review and route-limit instructions are in [the editor guide](topology-editor.md).

The default candidate review view uses `connection-candidates.json`. Marked-point T/F/unknown responses and direction decisions are stored in `topology.json.candidateAnswers`. Floor-only elevator reports, including partial positions when supplied, are stored in `topology.json.floorObservations`. Both retain the reviewer, timestamp and source references. Older documents read missing collections as empty. Restart the local server after editing the proposal catalogue. Reloading the editor retrieves the first unanswered question.
